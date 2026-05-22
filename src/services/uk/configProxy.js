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
            // [Sprint 9 / FIX-007 O5] Two-direction secret split — mask both.
            infrasafe_webhook_secret: '●●●●●●●●',
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
     * Get open-request count per building.
     *
     * [Sprint 9 / FIX-007 O4] UK confirmed they will NOT implement
     * `/requests/counts-by-building`. Counts are now built locally from
     * `alert_request_map` status:
     *
     *   pending  — outbox enqueued, not yet sent
     *   sent     — UK acked (202/409); awaiting UK request.created callback
     *   active   — UK created request; awaiting human resolution
     *   resolved — UK closed request (Принято/Отменена) — EXCLUDED
     *   cancelled— manual close — EXCLUDED
     *
     * Return shape `{buildings: {<external_id>: <count>}}` is preserved so
     * existing route consumers (`GET /api/integration/request-counts`)
     * continue to work without change.
     *
     * ⚠️ UNDER-COUNT CAVEAT: counts include only requests created from
     * InfraSafe alerts. Requests opened directly by residents via the
     * Telegram bot are NOT counted until UK ARCH-113 lands (UK doesn't
     * emit `request.*` webhooks for bot-originated requests). Do not
     * present these counts as "total open requests" in operator UI
     * without that caveat.
     *
     * 60s in-memory cache (single-replica). Invalidated by
     * requestProcessor.handleRequestWebhook on every UK request event.
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

            const db = require('../../config/database');
            const result = await db.query(
                `SELECT building_external_id::text AS external_id, COUNT(*)::int AS count
                 FROM alert_request_map
                 WHERE status IN ('pending', 'sent', 'active')
                   AND building_external_id IS NOT NULL
                 GROUP BY building_external_id`
            );

            const buildings = {};
            for (const row of result.rows) {
                buildings[row.external_id] = row.count;
            }
            const counts = { buildings };
            this._requestCountsCache = counts;
            this._requestCountsCacheTime = Date.now();
            return counts;
        } catch (error) {
            logger.error(`ukConfigProxy.getRequestCounts error: ${error.message}`);
            return EMPTY;
        }
    }

    /**
     * Get recent open-state requests for a single building, by UUID.
     *
     * [Sprint 9 / FIX-007 O4] Same data source switch as getRequestCounts —
     * we query alert_request_map locally instead of the (non-existent) UK
     * `/requests/by-building` endpoint. Returns mapping rows so the API
     * consumer sees `uk_request_number`, `status`, `updated_at`.
     *
     * Same UNDER-COUNT CAVEAT applies (see getRequestCounts header).
     */
    async getBuildingRequests(externalId, limit = 3) {
        const EMPTY = { requests: [] };
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        try {
            if (!externalId || !UUID_RE.test(externalId)) return EMPTY;

            const enabled = await this.isEnabled();
            if (!enabled) return EMPTY;

            const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 3, 1), 50);

            const db = require('../../config/database');
            const result = await db.query(
                `SELECT id, uk_request_number, status, infrasafe_alert_id,
                        idempotency_key, created_at, updated_at
                 FROM alert_request_map
                 WHERE building_external_id = $1
                   AND status IN ('pending', 'sent', 'active')
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [externalId, safeLimit]
            );

            return { requests: result.rows };
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
