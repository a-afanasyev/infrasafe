'use strict';

/**
 * [Sprint 9 / FIX-007] UK outbox model.
 *
 * Persistent outbox queue for outbound InfraSafe → UK webhooks. Drained by
 * `src/services/uk/ukOutboxService.js` at ≤30/мин.
 *
 * Status state machine:
 *   pending → sent  (on 202/409 from UK)
 *   pending → dead  (on 401/422, or after 5 failed 5xx attempts)
 *
 * Idempotency: enqueue uses `INSERT ... ON CONFLICT (event_id) DO NOTHING`
 * so concurrent retries with the same idempotency_key are no-ops, not
 * duplicates. Caller treats a `null` return as "already queued or already
 * sent" — both are success.
 *
 * Multi-replica: drain uses `FOR UPDATE SKIP LOCKED` as a per-row guard.
 * Replicawide rate-limit guard lives in ukOutboxService via
 * pg_try_advisory_lock — see that file.
 *
 * Schema: see database/migrations/022_uk_outbox.sql
 */

const db = require('../config/database');
const logger = require('../utils/logger');
const metrics = require('../observability/metrics');   // [AR-2]

// After this many failed send attempts a row is marked dead.
const MAX_ATTEMPTS = 5;

class UkOutbox {
    /**
     * Idempotently enqueue an outbound event. Returns the inserted row, or
     * `null` if a row with the same `event_id` already exists (idempotent
     * retry — caller treats as success).
     *
     * @param {{event_id: string, payload_body: string}} data
     */
    static async enqueue(data) {
        const { event_id, payload_body } = data;
        if (!event_id || typeof event_id !== 'string') {
            throw new Error('UkOutbox.enqueue: event_id is required');
        }
        if (!payload_body || typeof payload_body !== 'string') {
            throw new Error('UkOutbox.enqueue: payload_body must be a non-empty string');
        }
        try {
            const result = await db.query(
                `INSERT INTO uk_outbox (event_id, payload_body, status, next_attempt_at, created_at)
                 VALUES ($1, $2, 'pending', NOW(), NOW())
                 ON CONFLICT (event_id) DO NOTHING
                 RETURNING *`,
                [event_id, payload_body]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.enqueue error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [AUD-001 PR-B] Read a row by its unique event_id. Used by the engineer-
     * escalation ack-contract: when enqueue returns null (ON CONFLICT), the
     * caller reads the existing row to tell a delivered/in-flight duplicate
     * (pending/sent → ok) from a dead one (PR-C revives those).
     */
    static async findByEventId(eventId) {
        try {
            const result = await db.query(
                'SELECT * FROM uk_outbox WHERE event_id = $1',
                [eventId]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.findByEventId error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Pick the next pending row ready for send. Uses FOR UPDATE SKIP LOCKED
     * so multiple workers/replicas can't pick the same row. Caller is
     * responsible for committing the transaction (markSent/markFailed/markDead).
     *
     * NOTE: this is a single-statement helper. The caller's
     * markSent/markFailed/markDead happens in a separate query — that's
     * acceptable here because the row is already locked at the application
     * level by the advisory lock in ukOutboxService.
     */
    static async pickNext() {
        try {
            const result = await db.query(
                `SELECT * FROM uk_outbox
                 WHERE status = 'pending' AND next_attempt_at <= NOW()
                 ORDER BY next_attempt_at ASC, id ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.pickNext error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark row as successfully delivered. Records the response code for
     * audit (202 = success, 409 = idempotent re-delivery).
     */
    static async markSent(id, responseCode) {
        try {
            const result = await db.query(
                `UPDATE uk_outbox
                 SET status = 'sent',
                     last_response_code = $2,
                     last_error = NULL,
                     sent_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [id, responseCode]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.markSent error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Record a retriable failure (429/503/network) and bump attempt_count.
     * If attempts reach MAX_ATTEMPTS the row stays pending but next_attempt_at
     * is set far in the future; caller should detect this and call markDead.
     *
     * @param {number} id
     * @param {string} errorMessage
     * @param {number|null} responseCode
     * @param {number} backoffSeconds — seconds to wait before next attempt
     */
    static async markFailed(id, errorMessage, responseCode, backoffSeconds) {
        try {
            const result = await db.query(
                `UPDATE uk_outbox
                 SET attempt_count = attempt_count + 1,
                     last_error = $2,
                     last_response_code = $3,
                     next_attempt_at = NOW() + ($4 * INTERVAL '1 second')
                 WHERE id = $1
                 RETURNING *`,
                [id, errorMessage, responseCode, Math.max(1, Math.floor(backoffSeconds))]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.markFailed error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Mark row as terminally dead — no further retries. Caller should write
     * the failure to infrastructure_alerts.data.notification_failures for
     * operator visibility (see alertForwarder.js pattern).
     */
    static async markDead(id, errorMessage, responseCode) {
        try {
            const result = await db.query(
                `UPDATE uk_outbox
                 SET status = 'dead',
                     attempt_count = attempt_count + 1,
                     last_error = $2,
                     last_response_code = $3
                 WHERE id = $1
                 RETURNING *`,
                [id, errorMessage, responseCode]
            );
            // [AR-2] Считаем здесь, а не в трёх местах ukOutboxService: это
            // единственная точка, где строка ТОЧНО стала dead. Правило
            // InfrasafeOutboxDead смотрит increase(...[1h]), поэтому нужен
            // именно счётчик, а не количество строк в таблице.
            if (result.rows[0]) metrics.incOutboxDead();
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.markDead error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Reset attempt_count to 0 and next_attempt_at to NOW. Used when the
     * worker detects a "skip" condition (e.g. missing secret) — we don't
     * want to burn through retry budget on a config issue.
     */
    static async resetForSkip(id, backoffSeconds = 60) {
        try {
            const result = await db.query(
                `UPDATE uk_outbox
                 SET next_attempt_at = NOW() + ($2 * INTERVAL '1 second'),
                     last_error = $3
                 WHERE id = $1
                 RETURNING *`,
                [id, Math.max(1, Math.floor(backoffSeconds)), 'skipped: send-time precondition not met']
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.resetForSkip error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [AUD-001 PR-C] Revive a terminally-dead row back to pending so the drain
     * retries it. Used by the engineer-escalation ack-contract: when enqueue
     * returns null (ON CONFLICT) AND the existing row is 'dead', a blind ack
     * would bury a critical escalation forever — revive it instead. The
     * `status = 'dead'` guard makes it idempotent and race-safe (a row another
     * worker already revived/sent matches zero rows). Resets attempt_count so
     * the full backoff budget is available again, AND created_at so the
     * drain-TTL guard (ukOutboxService._isStale) gives the revived row a fresh
     * delivery window — without this a row dead-by-age would be re-killed on the
     * very next drain tick, looping forever against the sweep that revives it.
     */
    static async reviveDead(eventId) {
        try {
            const result = await db.query(
                `UPDATE uk_outbox
                 SET status = 'pending',
                     attempt_count = 0,
                     next_attempt_at = NOW(),
                     created_at = NOW(),
                     last_error = NULL
                 WHERE event_id = $1 AND status = 'dead'
                 RETURNING *`,
                [eventId]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`UkOutbox.reviveDead error: ${error.message}`);
            throw error;
        }
    }

    static get MAX_ATTEMPTS() {
        return MAX_ATTEMPTS;
    }

    /**
     * Diagnostic: count rows by status. Used by potential ops dashboards.
     */
    static async countByStatus() {
        try {
            const result = await db.query(
                `SELECT status, COUNT(*)::int as count
                 FROM uk_outbox
                 GROUP BY status`
            );
            return result.rows.reduce((acc, r) => {
                acc[r.status] = r.count;
                return acc;
            }, {});
        } catch (error) {
            logger.error(`UkOutbox.countByStatus error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = UkOutbox;
