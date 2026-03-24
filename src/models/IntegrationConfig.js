const db = require('../config/database');
const logger = require('../utils/logger');

class IntegrationConfig {
    /**
     * Get a config value by key
     * @param {string} key - Config key
     * @param {*} defaultValue - Value to return if key not found
     * @returns {Promise<*>} - Config value or defaultValue
     */
    static async get(key, defaultValue = null) {
        try {
            const { rows } = await db.query(
                'SELECT value FROM integration_config WHERE key = $1',
                [key]
            );
            return rows.length ? rows[0].value : defaultValue;
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
        return value === 'true';
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
            return result.rowCount > 0;
        } catch (error) {
            logger.error(`Error in IntegrationConfig.delete: ${error.message}`);
            throw error;
        }
    }
}

module.exports = IntegrationConfig;
