const db = require('../config/database');
const logger = require('../utils/logger');

// Phase 11.5: in-memory 60-second cache. Every webhook and alert emit
// calls isEnabled() which used to hit Postgres on every single request.
// The config changes at most a few times per deployment, so a short
// TTL is safe. Cache is invalidated on set() / delete() so an admin
// flipping the switch sees the change within milliseconds.
const CACHE_TTL_MS = 60_000;
const configCache = new Map(); // key → { value, expiresAt }

function cacheGet(key) {
    const entry = configCache.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
        configCache.delete(key);
        return undefined;
    }
    return entry.value;
}
function cacheSet(key, value) {
    configCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}
function cacheInvalidate(key) {
    if (key) configCache.delete(key);
    else configCache.clear();
}

class IntegrationConfig {
    /**
     * Get a config value by key
     * @param {string} key - Config key
     * @param {*} defaultValue - Value to return if key not found
     * @returns {Promise<*>} - Config value or defaultValue
     */
    static async get(key, defaultValue = null) {
        try {
            const cached = cacheGet(key);
            if (cached !== undefined) return cached;

            const { rows } = await db.query(
                'SELECT value FROM integration_config WHERE key = $1',
                [key]
            );
            const value = rows.length ? rows[0].value : defaultValue;
            cacheSet(key, value);
            return value;
        } catch (error) {
            logger.error(`Error in IntegrationConfig.get: ${error.message}`);
            throw error;
        }
    }

    /**
     * Set (upsert) a config key-value pair
     * @param {string} key - Config key
     * @param {string} value - Config value
     * @returns {Promise<Object>} - The upserted row
     */
    static async set(key, value) {
        try {
            const { rows } = await db.query(
                `INSERT INTO integration_config (key, value, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
                RETURNING *`,
                [key, value]
            );
            cacheInvalidate(key);
            return rows[0];
        } catch (error) {
            logger.error(`Error in IntegrationConfig.set: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all config entries as a key-value object
     * @returns {Promise<Object>} - All config as { key: value } object
     */
    static async getAll() {
        try {
            const { rows } = await db.query(
                'SELECT key, value FROM integration_config'
            );
            return rows.reduce((acc, row) => {
                acc[row.key] = row.value;
                return acc;
            }, {});
        } catch (error) {
            logger.error(`Error in IntegrationConfig.getAll: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check if UK integration is enabled
     * @returns {Promise<boolean>}
     */
    static async isEnabled() {
        const value = await IntegrationConfig.get('uk_integration_enabled', 'false');
        // Phase 11.6 (ARCH-119): case-insensitive parsing; accept 'True',
        // 'TRUE', '1', etc. without the admin having to think about casing.
        return String(value).toLowerCase() === 'true' || String(value) === '1';
    }

    /**
     * Delete a config key
     * @param {string} key - Config key to delete
     * @returns {Promise<boolean>} - true if deleted, false if not found
     */
    static async delete(key) {
        try {
            const result = await db.query(
                'DELETE FROM integration_config WHERE key = $1',
                [key]
            );
            cacheInvalidate(key);
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`Error in IntegrationConfig.delete: ${error.message}`);
            throw error;
        }
    }

    /**
     * Clear the in-memory cache (test use + manual "reload config").
     * Not exported for production callers — but handy in jest suites.
     */
    static _clearCache() {
        cacheInvalidate();
    }
}

module.exports = IntegrationConfig;
