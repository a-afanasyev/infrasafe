'use strict';

/**
 * [Sprint 10 PR-2] AlertVerification model.
 *
 * Persistent queue for post-resolve sensor re-checks. Each row represents
 * a deferred "verify this alert is really gone" task. After grace period,
 * the verifier examines sensor state; if fault persists, a new alert is
 * created (different alert_id) — physical reality wins over administrative
 * state.
 *
 * Drained by `src/services/alertVerificationService.js` (singleton,
 * advisory_lock, 15s tick).
 *
 * Status state machine:
 *   pending → passed             (no fault observed in window)
 *   pending → reopened           (fault still present, new alert created)
 *   pending → suppressed         (operator-set alert_suppressions active)
 *   pending → engineer_required  (max_reopens_per_24h hit, halt auto-reopen)
 *   pending → skipped            (transient — e.g. service stopped mid-tick)
 *
 * Idempotency: enqueue uses ON CONFLICT (the partial UNIQUE index
 * `idx_one_pending_per_alert WHERE status='pending'`) so duplicate
 * UK_REQUEST_RESOLVED events don't create multiple verification rows.
 *
 * Multi-replica: pickDue uses FOR UPDATE SKIP LOCKED as per-row guard.
 * Replica-wide drain coordination lives in alertVerificationService via
 * pg_try_advisory_lock — mirrors ukOutboxService pattern (Sprint 9).
 *
 * Schema: see database/migrations/025_alert_verifications.sql
 */

const { randomUUID } = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger');

class AlertVerification {
    /**
     * Idempotently enqueue a verification task. Returns the inserted row,
     * or `null` if a pending verification already exists for this alert
     * (idempotent retry — caller treats as success).
     *
     * @param {Object} data
     * @param {number} data.original_alert_id     — alert that was just resolved
     * @param {string} data.infrastructure_type   — e.g. 'controller', 'transformer'
     * @param {number} data.infrastructure_id     — FK to the entity
     * @param {string} data.alert_type            — e.g. 'LEAK_DETECTED'
     * @param {string} [data.reopen_chain_id]     — UUID to link reopens; if omitted, a new chain starts
     * @param {number} [data.reopen_sequence=1]   — 1 for first verification, N for the N-th reopen
     * @param {Date|string} data.run_at           — when to first attempt verification (resolved_at + grace)
     * @param {Date|string} data.window_until     — verification expires at this time (run_at + window)
     */
    static async enqueue(data) {
        const {
            original_alert_id,
            infrastructure_type,
            infrastructure_id,
            alert_type,
            reopen_chain_id = randomUUID(),
            reopen_sequence = 1,
            run_at,
            window_until
        } = data;

        if (!original_alert_id) {
            throw new Error('AlertVerification.enqueue: original_alert_id is required');
        }
        if (!infrastructure_type || !infrastructure_id || !alert_type) {
            throw new Error('AlertVerification.enqueue: infrastructure_type/id and alert_type are required');
        }
        if (!run_at || !window_until) {
            throw new Error('AlertVerification.enqueue: run_at and window_until are required');
        }

        try {
            const result = await db.query(
                `INSERT INTO alert_verifications
                    (original_alert_id, reopen_chain_id, reopen_sequence,
                     infrastructure_type, infrastructure_id, alert_type,
                     run_at, window_until, status, attempts, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 0, NOW())
                 ON CONFLICT (original_alert_id) WHERE status = 'pending' DO NOTHING
                 RETURNING *`,
                [
                    original_alert_id, reopen_chain_id, reopen_sequence,
                    infrastructure_type, infrastructure_id, alert_type,
                    run_at, window_until
                ]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.enqueue error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Pick the next pending verification ready to run (run_at <= NOW()).
     * Uses FOR UPDATE SKIP LOCKED so multiple replicas can't pick the same
     * row even if both hold the advisory lock racy (defense-in-depth).
     *
     * Caller MUST commit subsequent markPassed/markReopened/etc. in the
     * same transaction or use the application-level advisory lock (drained
     * by alertVerificationService).
     */
    static async pickDue() {
        try {
            const result = await db.query(
                `SELECT * FROM alert_verifications
                 WHERE status = 'pending' AND run_at <= NOW()
                 ORDER BY run_at ASC, id ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.pickDue error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [Sprint 10 PR-3] Mark that the verification's VERIFY event was
     * dispatched. Bumps attempts but keeps status='pending' so the row
     * waits for ALERT_REOPENED match (until window_until). Idempotent
     * via the `attempts = 0` guard — re-dispatch is prevented.
     */
    static async markDispatched(id) {
        try {
            const result = await db.query(
                `UPDATE alert_verifications
                 SET attempts = attempts + 1
                 WHERE id = $1 AND status = 'pending' AND attempts = 0
                 RETURNING *`,
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markDispatched error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [Sprint 10 PR-3] Find a pending verification for a chain so we can
     * mark it 'reopened' when a fresh alert with matching reopen_chain_id
     * is created. Returns the most-recent pending row (one per chain by
     * the partial UNIQUE index).
     */
    static async findPendingByChainId(reopenChainId) {
        try {
            const result = await db.query(
                `SELECT * FROM alert_verifications
                 WHERE reopen_chain_id = $1 AND status = 'pending'
                 ORDER BY id DESC
                 LIMIT 1`,
                [reopenChainId]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.findPendingByChainId error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark verification passed — sensor recovered, no reopen needed.
     * Increments attempts (audit trail) and stamps processed_at.
     *
     * [B-020] All terminal mark* methods carry `AND status = 'pending'` so a
     * crash-retry is a true no-op: alertVerificationService finalizes the
     * parent alert FIRST then calls mark*; if it crashes between the two, the
     * row stays 'pending' and the next drain re-runs without re-stamping
     * processed_at / double-bumping attempts. Mirrors markDispatched's guard.
     */
    static async markPassed(id) {
        try {
            const result = await db.query(
                `UPDATE alert_verifications
                 SET status = 'passed',
                     attempts = attempts + 1,
                     processed_at = NOW()
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markPassed error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark verification reopened — sensor still shows fault, a new alert
     * was created. Links the new alert via new_alert_id for audit / UI
     * "chain history" view.
     */
    static async markReopened(id, newAlertId) {
        if (!newAlertId) {
            throw new Error('AlertVerification.markReopened: newAlertId is required');
        }
        try {
            const result = await db.query(
                `UPDATE alert_verifications
                 SET status = 'reopened',
                     attempts = attempts + 1,
                     processed_at = NOW(),
                     new_alert_id = $2
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [id, newAlertId]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markReopened error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark verification suppressed — an active AlertSuppression matched
     * this {infra_type, infra_id, alert_type}. Operator chose to ignore;
     * no reopen, but row stays for audit.
     */
    static async markSuppressed(id) {
        try {
            const result = await db.query(
                `UPDATE alert_verifications
                 SET status = 'suppressed',
                     attempts = attempts + 1,
                     processed_at = NOW()
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markSuppressed error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark verification engineer_required — reopen quota exceeded for the
     * chain in last 24h. Auto-reopen halts; alert goes to engineer review.
     */
    static async markEngineerRequired(id) {
        try {
            const result = await db.query(
                `UPDATE alert_verifications
                 SET status = 'engineer_required',
                     attempts = attempts + 1,
                     processed_at = NOW()
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markEngineerRequired error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark verification skipped — transient cause (e.g. service stopped
     * mid-tick, or window_until elapsed before pickup). Operator can
     * inspect; no automatic re-enqueue.
     */
    static async markSkipped(id, reason) {
        try {
            const result = await db.query(
                `UPDATE alert_verifications
                 SET status = 'skipped',
                     attempts = attempts + 1,
                     processed_at = NOW()
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [id]
            );
            if (result.rows[0] && reason) {
                logger.info(`AlertVerification ${id} skipped: ${reason}`);
            }
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markSkipped error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Count successful reopens in the last `withinHours` for this chain.
     * Used by alertVerificationService to enforce max_reopens_per_24h.
     */
    static async countRecentReopensForChain(reopenChainId, withinHours = 24) {
        try {
            const result = await db.query(
                `SELECT COUNT(*)::int AS count
                 FROM alert_verifications
                 WHERE reopen_chain_id = $1
                   AND status = 'reopened'
                   AND processed_at >= NOW() - ($2::int * INTERVAL '1 hour')`,
                [reopenChainId, withinHours]
            );
            return result.rows[0].count;
        } catch (error) {
            logger.error(`AlertVerification.countRecentReopensForChain error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Lookup the full chain history (all verifications for one reopen_chain_id).
     * Used by admin UI "Reopen history" view.
     */
    static async findByChainId(reopenChainId) {
        try {
            const result = await db.query(
                `SELECT * FROM alert_verifications
                 WHERE reopen_chain_id = $1
                 ORDER BY reopen_sequence ASC, created_at ASC`,
                [reopenChainId]
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertVerification.findByChainId error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AlertVerification;
