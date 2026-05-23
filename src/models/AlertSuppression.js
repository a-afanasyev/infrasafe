'use strict';

/**
 * [Sprint 10 PR-4] AlertSuppression model.
 *
 * Operator-driven "mute" for an infrastructure tuple: "this sensor is
 * broken / transformer under planned maintenance / known issue — don't
 * react to alerts of type X for the next N hours". Without this, a stuck
 * sensor creates a reopen-loop (PR-2 verifier reopens the alert, UK
 * creates a new ticket, operator closes it, verifier reopens again).
 *
 * Keyed on (infra_type, infra_id, alert_type) — NOT alert_id — so the
 * suppression survives the reopen chain (each reopen gets a new alert_id
 * but the underlying entity stays the same).
 *
 * Active = `cleared_at IS NULL AND suppress_until > NOW()`.
 *
 * Cap: max suppression duration enforced in the create() validator.
 *      Default cap 24h prevents permanent muting; operators can re-apply
 *      after expiry if the issue persists.
 *
 * Schema: see database/migrations/026_alert_suppressions.sql
 *
 * Consumed by:
 *   - alertVerificationService._drainOne (already wired in PR-2 via
 *     conditional require — the check activates as soon as this model
 *     ships, no service-side change needed)
 *   - Future leak/transformer auto-checkers (Sprint 10.x): consult
 *     isActive() before emitting a new alert
 */

const db = require('../config/database');
const logger = require('../utils/logger');

const MAX_SUPPRESSION_HOURS = 24;
const VALID_REASONS = Object.freeze(['faulty_sensor', 'under_repair', 'planned_maintenance', 'known_issue', 'other']);

class AlertSuppression {
    /**
     * Returns true if an active suppression matches the tuple. Active means
     * `cleared_at IS NULL AND suppress_until > NOW()`. Uses the partial
     * index `idx_suppression_active` for the initial scan.
     */
    static async isActive(infraType, infraId, alertType) {
        try {
            const result = await db.query(
                `SELECT 1
                 FROM alert_suppressions
                 WHERE infrastructure_type = $1
                   AND infrastructure_id = $2
                   AND alert_type = $3
                   AND cleared_at IS NULL
                   AND suppress_until > NOW()
                 LIMIT 1`,
                [infraType, infraId, alertType]
            );
            return result.rows.length > 0;
        } catch (error) {
            logger.error(`AlertSuppression.isActive error: ${error.message}`);
            // Fail-open: if the suppression check fails, don't block the
            // verifier/checker. The risk of letting one alert through is
            // smaller than the risk of suppressing real alerts due to a DB
            // hiccup. Operator can re-apply suppression if needed.
            return false;
        }
    }

    /**
     * Create a new suppression. Cap enforced in validator.
     *
     * @param {Object} data
     * @param {string} data.infrastructure_type — e.g. 'controller'
     * @param {number} data.infrastructure_id
     * @param {string} data.alert_type          — e.g. 'LEAK_DETECTED'
     * @param {number} data.duration_hours      — 1..24
     * @param {string} data.reason              — from VALID_REASONS
     * @param {string} [data.comment]
     * @param {number} [data.suppressed_by]     — user_id of operator
     */
    static async create(data) {
        const {
            infrastructure_type,
            infrastructure_id,
            alert_type,
            duration_hours,
            reason,
            comment = null,
            suppressed_by = null
        } = data;

        if (!infrastructure_type || !infrastructure_id || !alert_type) {
            throw new Error('AlertSuppression.create: infrastructure_type/id and alert_type are required');
        }
        if (!Number.isFinite(duration_hours) || duration_hours <= 0) {
            throw new Error('AlertSuppression.create: duration_hours must be a positive number');
        }
        if (duration_hours > MAX_SUPPRESSION_HOURS) {
            throw new Error(`AlertSuppression.create: duration_hours exceeds cap of ${MAX_SUPPRESSION_HOURS}h`);
        }
        if (!VALID_REASONS.includes(reason)) {
            throw new Error(`AlertSuppression.create: reason must be one of ${VALID_REASONS.join(', ')}`);
        }

        try {
            const result = await db.query(
                `INSERT INTO alert_suppressions
                    (infrastructure_type, infrastructure_id, alert_type,
                     suppress_until, reason, comment, suppressed_by, created_at)
                 VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 hour'), $5, $6, $7, NOW())
                 RETURNING *`,
                [
                    infrastructure_type, infrastructure_id, alert_type,
                    duration_hours, reason, comment, suppressed_by
                ]
            );
            return result.rows[0];
        } catch (error) {
            logger.error(`AlertSuppression.create error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Manually clear an active suppression ("sensor fixed, resume monitoring").
     * Sets cleared_at and records who cleared it. Idempotent: returns the
     * updated row, or null if no such id / already cleared.
     */
    static async clear(id, clearedBy) {
        if (!id) {
            throw new Error('AlertSuppression.clear: id is required');
        }
        try {
            const result = await db.query(
                `UPDATE alert_suppressions
                 SET cleared_at = NOW(),
                     cleared_by = $2
                 WHERE id = $1
                   AND cleared_at IS NULL
                 RETURNING *`,
                [id, clearedBy || null]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertSuppression.clear error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find a single suppression by id (includes expired + cleared ones for
     * audit lookup).
     */
    static async findById(id) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_suppressions WHERE id = $1',
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertSuppression.findById error: ${error.message}`);
            throw error;
        }
    }

    /**
     * List suppressions. Filters:
     *   - active=true → only currently-active (default)
     *   - active=false → only inactive (cleared or expired)
     *   - active=undefined → all
     *   - infraType/infraId → filter by entity
     *   - alertType → filter by type
     * Ordered most-recent first.
     */
    static async list(filters = {}) {
        const { active, infraType, infraId, alertType, limit = 100 } = filters;
        const conditions = [];
        const params = [];

        if (active === true) {
            conditions.push('cleared_at IS NULL AND suppress_until > NOW()');
        } else if (active === false) {
            conditions.push('(cleared_at IS NOT NULL OR suppress_until <= NOW())');
        }
        if (infraType) {
            params.push(infraType);
            conditions.push(`infrastructure_type = $${params.length}`);
        }
        if (infraId) {
            params.push(infraId);
            conditions.push(`infrastructure_id = $${params.length}`);
        }
        if (alertType) {
            params.push(alertType);
            conditions.push(`alert_type = $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limitClause = Number.isFinite(limit) && limit > 0 ? `LIMIT ${Math.min(Math.floor(limit), 500)}` : 'LIMIT 100';

        try {
            const result = await db.query(
                `SELECT * FROM alert_suppressions
                 ${whereClause}
                 ORDER BY created_at DESC
                 ${limitClause}`,
                params
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertSuppression.list error: ${error.message}`);
            throw error;
        }
    }
}

AlertSuppression.MAX_SUPPRESSION_HOURS = MAX_SUPPRESSION_HOURS;
AlertSuppression.VALID_REASONS = VALID_REASONS;

module.exports = AlertSuppression;
