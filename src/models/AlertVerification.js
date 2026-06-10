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
 * [B-021] Every method takes an optional trailing `executor = db` so a
 * caller can run it on a checked-out client inside a transaction (the
 * verification drain wraps pickDue + finalize + mark* in one transaction on
 * one client that also holds the advisory lock). `db` (pool wrapper) and a
 * `PoolClient` both expose `.query(text, params)`, so the param is
 * duck-typed — existing callers pass nothing and get the pool wrapper.
 *
 * Schema: see database/migrations/025_alert_verifications.sql
 */

const { randomUUID } = require('crypto');
const db = require('../config/database');
const logger = require('../utils/logger');

// [AUD-001 PR-C] Re-dispatch + lease timing (set by markDispatched).
//   REDISPATCH_INTERVAL_SECONDS — how long after a dispatch before the row is
//     eligible to be re-picked by pickDue (fair-queue cursor). 60s also stops
//     the checker being hammered every 15s tick.
//   DISPATCH_LEASE_SECONDS — operational bound on the checker chain (several
//     sequential queries at 30s statement_timeout each, plus init). While the
//     lease is live the window-expired branch must NOT terminalise the row — a
//     slow checker may still create a reopen that only binds to a 'pending'
//     row. This is a chosen bound, NOT a proven maximum: if a checker ever
//     exceeds it the verification→reopened linkage (quota count) is lost, but
//     the reopen alert itself is still created and reaches UK. Calibrate from
//     observed checker latency; a heartbeat/generation scheme is a separate
//     ticket if real overruns appear.
const REDISPATCH_INTERVAL_SECONDS = 60;
const DISPATCH_LEASE_SECONDS = 240;

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
     * @param {{query: Function}} [executor=db]   — pool wrapper or checked-out client
     */
    static async enqueue(data, executor = db) {
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
            const result = await executor.query(
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
     * [B-021] The FOR UPDATE row-lock is only actually held when this runs
     * inside a transaction on a checked-out client — pass that client as
     * `executor` (the verification drain does). Run standalone (pool
     * wrapper) the lock is released the instant the statement returns.
     */
    static async pickDue(executor = db) {
        try {
            // [AUD-001 PR-C] Fair queue. A dispatched row sets next_dispatch_at
            // (NOW()+REDISPATCH_INTERVAL); it stays invisible to pickDue until
            // that passes, so re-emit is throttled and the checker isn't hammered
            // every tick. Ordering by COALESCE(next_dispatch_at, run_at) interleaves
            // fresh rows (run_at) and retries (next_dispatch_at) oldest-due-first —
            // neither class starves the other (a strict attempts=0-first scheme
            // would starve retries under a steady stream of fresh verifications).
            const result = await executor.query(
                `SELECT * FROM alert_verifications
                 WHERE status = 'pending' AND run_at <= NOW()
                   AND (next_dispatch_at IS NULL OR next_dispatch_at <= NOW())
                 ORDER BY COALESCE(next_dispatch_at, run_at) ASC, id ASC
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
     * [Sprint 10 PR-3 → AUD-001 PR-C] Mark that the verification's VERIFY event
     * was dispatched. Bumps attempts but keeps status='pending' so the row waits
     * for an ALERT_REOPENED match (until window_until).
     *
     * PR-C drops the old `attempts = 0` single-dispatch guard so the row CAN be
     * re-dispatched (durable at-least-once delivery — a lost emit between COMMIT
     * and the listener is recovered on a later tick). Re-emit is throttled by
     * next_dispatch_at (pickDue won't re-pick until it passes); downstream
     * idempotency holds on the DB (dedup index + pending-guarded mark*).
     *
     * Also stamps:
     *   - next_dispatch_at = NOW()+REDISPATCH_INTERVAL — fair-queue re-pick cursor.
     *   - dispatch_lease_until = NOW()+DISPATCH_LEASE_SECONDS — while live, the
     *     window-expired branch must NOT terminalise (a slow checker may still
     *     bind a reopen to this 'pending' row).
     * The `status = 'pending'` guard keeps it race-safe (a row that already
     * terminalised matches zero rows).
     */
    static async markDispatched(id, executor = db) {
        try {
            const result = await executor.query(
                `UPDATE alert_verifications
                 SET attempts = attempts + 1,
                     next_dispatch_at = NOW() + ($2 * INTERVAL '1 second'),
                     dispatch_lease_until = NOW() + ($3 * INTERVAL '1 second')
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [id, REDISPATCH_INTERVAL_SECONDS, DISPATCH_LEASE_SECONDS]
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
    static async findPendingByChainId(reopenChainId, executor = db) {
        try {
            const result = await executor.query(
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
    static async markPassed(id, executor = db) {
        try {
            const result = await executor.query(
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
    static async markReopened(id, newAlertId, executor = db) {
        if (!newAlertId) {
            throw new Error('AlertVerification.markReopened: newAlertId is required');
        }
        try {
            const result = await executor.query(
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
    static async markSuppressed(id, executor = db) {
        try {
            const result = await executor.query(
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
    static async markEngineerRequired(id, executor = db) {
        try {
            const result = await executor.query(
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
    static async markSkipped(id, reason, executor = db) {
        try {
            const result = await executor.query(
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
     * [AUD-001 PR-B] Stamp last_checked_at — a checker actually evaluated the
     * fault condition against fresh post-resolve telemetry and returned
     * {checked:true}. Unlike the terminal mark* helpers this does NOT change
     * status (stays 'pending') and does NOT bump attempts; it only records
     * that a real check completed, so the window-expired branch can mark the
     * row 'passed' (checked, fault gone) rather than 'skipped' (dispatched but
     * the checker crashed / had no fresh data and never completed).
     *
     * The `status = 'pending'` guard keeps it idempotent and race-safe: if the
     * row already terminalised (e.g. a reopen landed first), this is a no-op.
     */
    static async markChecked(id, executor = db) {
        try {
            const result = await executor.query(
                `UPDATE alert_verifications
                 SET last_checked_at = NOW()
                 WHERE id = $1 AND status = 'pending'
                 RETURNING *`,
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markChecked error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [AUD-001 PR-C] Engineer-escalation durable ack. Stamped by the forwarder
     * listener once UK delivery succeeds. Like markChecked it does NOT change
     * status (the row is already 'engineer_required') and does NOT bump attempts;
     * the `uk_notified_at IS NULL` guard makes it idempotent — a re-ack matches
     * zero rows. Once stamped, the engineer sweep skips the row (its working set
     * is `engineer_required AND uk_notified_at IS NULL`).
     */
    static async markUkNotified(id, executor = db) {
        try {
            const result = await executor.query(
                `UPDATE alert_verifications
                 SET uk_notified_at = NOW()
                 WHERE id = $1 AND uk_notified_at IS NULL
                 RETURNING *`,
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertVerification.markUkNotified error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [AUD-001 PR-C] Working set for the engineer-escalation sweep: rows that
     * reached engineer_required but UK hasn't acked yet, due for a (re)emit.
     * Ordered by COALESCE(uk_notify_next_attempt_at, processed_at) so the
     * rotation cursor (set by deferEngineerNotifications before each emit)
     * pushes just-attempted rows to the tail — 5 permanently-undeliverable
     * rows can't forever shadow a deliverable one under LIMIT.
     */
    static async pickUnnotifiedEngineer(limit = 5, executor = db) {
        try {
            const result = await executor.query(
                `SELECT * FROM alert_verifications
                 WHERE status = 'engineer_required'
                   AND uk_notified_at IS NULL
                   AND (uk_notify_next_attempt_at IS NULL OR uk_notify_next_attempt_at <= NOW())
                 ORDER BY COALESCE(uk_notify_next_attempt_at, processed_at) ASC, id ASC
                 LIMIT $1`,
                [limit]
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertVerification.pickUnnotifiedEngineer error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [AUD-001 PR-C] Push the given engineer rows into the rotation tail by N
     * seconds (called under the sweep's advisory lock BEFORE emit, so a picked
     * row isn't re-selected next tick regardless of the listener outcome). A
     * no-op for an empty id list (avoids a `= ANY('{}')` round-trip).
     */
    static async deferEngineerNotifications(ids, seconds = 300, executor = db) {
        if (!Array.isArray(ids) || ids.length === 0) return 0;
        try {
            const result = await executor.query(
                `UPDATE alert_verifications
                 SET uk_notify_next_attempt_at = NOW() + ($2 * INTERVAL '1 second')
                 WHERE id = ANY($1)`,
                [ids, Math.max(1, Math.floor(seconds))]
            );
            return result.rowCount || 0;
        } catch (error) {
            logger.error(`AlertVerification.deferEngineerNotifications error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Count successful reopens in the last `withinHours` for this chain.
     * Used by alertVerificationService to enforce max_reopens_per_24h.
     */
    static async countRecentReopensForChain(reopenChainId, withinHours = 24, executor = db) {
        try {
            const result = await executor.query(
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
    static async findByChainId(reopenChainId, executor = db) {
        try {
            const result = await executor.query(
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
