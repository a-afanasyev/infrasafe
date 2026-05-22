'use strict';

/**
 * [P1-14 split] UK configuration + UK API proxy with TTL cache.
 *
 * Owns:
 *   - isEnabled / getConfig / updateConfig — admin-facing config surface.
 *   - getRequestCounts / getBuildingRequests — UK API read-through cache.
 *   - invalidateRequestCache — write-side invalidation hook called by
 *     requestProcessor when a request event arrives.
 *
 * Module-level state:
 *   - _requestCountsCache + _requestCountsCacheTime — 60s TTL cache for
 *     the dashboard's request-count overlay. Single-replica today; the
 *     scale-out backlog item (P1-15) will migrate this to cacheService.
 */

const IntegrationConfig = require('../../models/IntegrationConfig');
const logger = require('../../utils/logger');
const { validateUKApiUrl } = require('../../utils/urlValidation');

const ALLOWED_CONFIG_KEYS = ['uk_integration_enabled', 'uk_api_url', 'uk_frontend_url'];
const SENSITIVE_KEYS = ['uk_webhook_secret', 'uk_service_user', 'uk_service_password'];
const CACHE_TTL_MS = 60 * 1000;

class UKConfigProxy {
    _requestCountsCache = null;
    _requestCountsCacheTime = 0;

    /** True for a real boolean or the JSON-body strings 'true'/'false'. */
    static _isBoolish(value) {
        return typeof value === 'boolean'
            || value === 'true'
            || value === 'false';
    }

    /** True for an http(s) URL string no longer than 255 chars. */
    static _isHttpUrl(value) {
        if (typeof value !== 'string' || value.length === 0 || value.length > 255) {
            return false;
        }
        try {
            const parsed = new URL(value);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    /**
     * Check if UK integration is enabled. Never throws — returns false on
     * any error so callers can fall back to "integration off" safely.
     */
    async isEnabled() {
        try {
            return await IntegrationConfig.isEnabled();
        } catch (error) {
            logger.error(`ukConfigProxy.isEnabled error: ${error.message}`);
            return false;
        }
    }

    /** Get all config merged with masked sensitive values. */
    async getConfig() {
        const dbConfig = await IntegrationConfig.getAll();
        return {
            ...dbConfig,
            uk_webhook_secret: '●●●●●●●●',
            uk_service_user: '●●●●●●●●',
            uk_service_password: '●●●●●●●●'
        };
    }

    /**
     * Update allowed config keys. Throws on sensitive keys, skips unknown
     * keys, type-validates each whitelisted value before persisting.
     */
    async updateConfig(settings) {
        for (const [key, value] of Object.entries(settings)) {
            if (SENSITIVE_KEYS.includes(key)) {
                throw new Error('Cannot update this setting via API');
            }
            if (ALLOWED_CONFIG_KEYS.includes(key)) {
                // [Sprint 7 / P1-7] Type-validate each whitelisted key before
                // persisting. The whitelist alone gates which keys are
                // writable; this gates that the value is well-formed.
                if (key === 'uk_api_url') {
                    validateUKApiUrl(value);
                } else if (key === 'uk_integration_enabled') {
                    if (!UKConfigProxy._isBoolish(value)) {
                        throw new Error('Invalid value for uk_integration_enabled');
                    }
                } else if (key === 'uk_frontend_url') {
                    if (!UKConfigProxy._isHttpUrl(value)) {
                        throw new Error('Invalid value for uk_frontend_url');
                    }
                }
                await IntegrationConfig.set(key, value);
            } else {
                logger.warn(`ukConfigProxy.updateConfig: unknown key "${key}", skipping`);
            }
        }
    }

    /**
     * Fetch /requests/counts-by-building via ukApiClient with 60s cache.
     * Returns {buildings:{}} on any failure (graceful degradation).
     */
    async getRequestCounts() {
        const EMPTY = { buildings: {} };
        try {
            const enabled = await this.isEnabled();
            if (!enabled) return EMPTY;

            const now = Date.now();
            if (this._requestCountsCache && (now - this._requestCountsCacheTime) < CACHE_TTL_MS) {
                return this._requestCountsCache;
            }

            const ukApiClient = require('../../clients/ukApiClient');
            const response = await ukApiClient.get('/requests/counts-by-building');

            const result = response || EMPTY;
            this._requestCountsCache = result;
            this._requestCountsCacheTime = Date.now();
            return result;
        } catch (error) {
            logger.error(`ukConfigProxy.getRequestCounts error: ${error.message}`);
            return EMPTY;
        }
    }

    /**
     * Fetch /requests/by-building for a specific external_id. UUID-validated
     * before any network call.
     */
    async getBuildingRequests(externalId, limit = 3) {
        const EMPTY = { requests: [] };
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        try {
            if (!externalId || !UUID_RE.test(externalId)) return EMPTY;

            const enabled = await this.isEnabled();
            if (!enabled) return EMPTY;

            const ukApiClient = require('../../clients/ukApiClient');
            const response = await ukApiClient.get(
                `/requests/by-building?external_id=${encodeURIComponent(externalId)}&limit=${limit}`
            );

            return response || EMPTY;
        } catch (error) {
            logger.error(`ukConfigProxy.getBuildingRequests error: ${error.message}`);
            return EMPTY;
        }
    }

    /** Clear the request-counts cache. Called by requestProcessor on any request event. */
    invalidateRequestCache() {
        this._requestCountsCache = null;
        this._requestCountsCacheTime = 0;
    }
}

const singleton = new UKConfigProxy();
module.exports = singleton;
module.exports.UKConfigProxy = UKConfigProxy;
