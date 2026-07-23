'use strict';

/**
 * [request.reconcile — UK contract 2026-07-23] Registry of UK-originated
 * requests (bot/dashboard), learned via the request.reconcile webhook.
 *
 * Requests originated from InfraSafe alerts live in alert_request_map — its
 * infrasafe_alert_id NOT NULL invariant carries the alert auto-resolve flow
 * and deliberately cannot host alert-less rows. The reconciliation inventory
 * (GET /uk-requests-metrics) serves the union of both tables.
 *
 * Convergence contract: each UK reconcile cycle mints a fresh event_id (by
 * design — bypasses delivery dedup), so idempotency comes from the atomic
 * upsert on uk_request_number here, not from event-level dedup.
 */

const db = require('../config/database');
const logger = require('../utils/logger');

class UkRequest {
    /**
     * Atomically upsert a reconciled UK request. Race-safe: concurrent
     * deliveries collapse into one row via ON CONFLICT DO UPDATE.
     * A reconcile without a building must not erase a previously known
     * building linkage — hence COALESCE on the conflict path.
     * @param {Object} params
     * @param {string} params.requestNumber - UK request number (upsert key)
     * @param {string} params.status - UK production status dictionary value
     * @param {string|null} params.buildingExternalId - shared hash-derived UUID or null
     * @returns {Promise<Object>} - The upserted row
     */
    static async reconcile({ requestNumber, status, buildingExternalId }) {
        try {
            const { rows } = await db.query(
                `INSERT INTO uk_requests (uk_request_number, status, building_external_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (uk_request_number) DO UPDATE
                 SET status = EXCLUDED.status,
                     building_external_id = COALESCE(EXCLUDED.building_external_id, uk_requests.building_external_id),
                     last_reconciled_at = NOW()
                 RETURNING *`,
                [requestNumber, status, buildingExternalId ?? null]
            );
            return rows[0];
        } catch (error) {
            logger.error(`UkRequest.reconcile error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = UkRequest;
