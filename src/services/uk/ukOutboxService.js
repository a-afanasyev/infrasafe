'use strict';

/**
 * [Sprint 9 / FIX-007] UK outbox drain worker.
 *
 * Periodically picks the next pending row from `uk_outbox`, signs +
 * POSTs it via `ukWebhookClient`, and updates the row according to the
 * outcome (sent / failed-retry / dead / skip).
 *
 * Pattern modelled on `src/services/mvRefreshService.js` — singleton +
 * setInterval + warmup + in-flight mutex + unref()'d timers + throttled
 * failure log. Two additions:
 *
 *   - **Advisory lock** (`pg_try_advisory_lock` keyed on a stable hash)
 *     so multiple replicas don't race the same row. mvRefreshService
 *     deferred this; we don't repeat the mistake — running two replicas
 *     with N×30/мин would burst past UK's 60/мин fixed-window limit.
 *
 *   - **Per-tick single-row drain** — the design intent is "≤1 send
 *     every N seconds" not "drain everything as fast as possible". With
 *     `UK_OUTBOX_DRAIN_INTERVAL_MS=2000` the steady-state rate is 30/мин,
 *     half of UK's 60/мин limit (safety margin per FIX-007 round N2).
 *
 * Env controls:
 *   - UK_USE_WEBHOOK_SENDER       — master gate (default 'false'). When
 *                                   false the worker doesn't even start
 *                                   the interval (cheap dormant state).
 *   - UK_OUTBOX_DRAIN_INTERVAL_MS — drain tick interval (default 2000ms,
 *                                   clamped to [500, 60000]).
 *
 * Outcome → row transition:
 *   success → UkOutbox.markSent + AlertRequestMap.markSent (with NULL
 *             request_number; UK Phase 1 doesn't return one)
 *   dead    → UkOutbox.markDead + record notification_failure on the
 *             underlying alert (operator visibility)
 *   retry   → UkOutbox.markFailed with exponential backoff
 *             (2,4,8,16,32 seconds) up to MAX_ATTEMPTS, then mark dead
 *   skip    → UkOutbox.resetForSkip (60s) — config issue, don't burn
 *             retry budget
 */

const db = require('../../config/database');
const logger = require('../../utils/logger');

const UkOutbox = require('../../models/UkOutbox');
const AlertRequestMap = require('../../models/AlertRequestMap');
const IntegrationLog = require('../../models/IntegrationLog');
const ukWebhookClient = require('../../clients/ukWebhookClient');

const DEFAULT_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 60000;
const WARMUP_DELAY_MS = 5000;

// Advisory lock key. Use a stable string hashed to a positive 31-bit int
// — pg_try_advisory_lock(bigint) needs a deterministic key shared across
// replicas. The exact value doesn't matter, only stability.
//   crypto.createHash('sha256').update('infrasafe.uk_outbox_drain').digest()[0..4]
// → 0x46c8a9b1 → 1187807153. Hard-coded so we never need to recompute.
const ADVISORY_LOCK_KEY = 1187807153;

// [Sprint 7 / H2] Failure-log throttling mirrors mvRefreshService.
const FAILURE_LOG_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes
const FAILURE_ESCALATE_THRESHOLD = 5;

// Exponential backoff schedule on retriable failures (seconds).
const BACKOFF_SCHEDULE = [2, 4, 8, 16, 32];

class UkOutboxService {
    constructor() {
        this._timer = null;
        this._warmupTimer = null;
        this._running = false;
        this._stopped = false;
        this._consecutiveFailures = 0;
        this._lastFailureLogAt = 0;
    }

    isEnabled() {
        const flag = (process.env.UK_USE_WEBHOOK_SENDER ?? 'false').toString().toLowerCase();
        return flag === 'true' || flag === '1';
    }

    intervalMs() {
        const raw = Number(process.env.UK_OUTBOX_DRAIN_INTERVAL_MS);
        if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
        return Math.min(Math.max(Math.floor(raw), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
    }

    start() {
        if (!this.isEnabled()) {
            logger.info('ukOutboxService disabled via UK_USE_WEBHOOK_SENDER (dormant)');
            return;
        }
        if (this._timer) {
            logger.warn('ukOutboxService already started — skipping duplicate start');
            return;
        }
        this._stopped = false;
        const interval = this.intervalMs();
        logger.info(`ukOutboxService starting (interval=${interval}ms, ≈${Math.round(60000 / interval)}/мин)`);

        this._warmupTimer = setTimeout(() => { void this._tick(); }, WARMUP_DELAY_MS);
        this._warmupTimer.unref();

        this._timer = setInterval(() => { void this._tick(); }, interval);
        this._timer.unref();
    }

    async stop() {
        this._stopped = true;
        if (this._warmupTimer) {
            clearTimeout(this._warmupTimer);
            this._warmupTimer = null;
        }
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            logger.info('ukOutboxService stopped');
        }
    }

    /**
     * Single drain tick. Acquires the cross-replica advisory lock,
     * picks one row, sends it, transitions the row by outcome.
     *
     * The advisory lock is held for the duration of one tick only — we
     * release it in `finally` so a slow tick on one replica doesn't
     * starve another replica's interval.
     */
    async _tick() {
        if (this._stopped) return;
        if (this._running) {
            // Previous tick still inflight — skip; don't queue overlap.
            return;
        }
        this._running = true;

        try {
            // [B-022] Acquire + release the cross-replica advisory lock on ONE
            // checked-out client. Session-scoped advisory locks are bound to the
            // physical connection; taking/releasing them through the pool wrapper
            // (db.query) lands on arbitrary connections, so the unlock often
            // no-ops on a connection that never held the lock and the lock leaks
            // on the one that did (same class as the B-021 verification-drain
            // fix). Pinning one client for the tick makes the mutex actually
            // hold for the whole drain — and auto-release if the process dies
            // (the backend session closes). The drain's own row ops stay on the
            // pool: they only need the lock to be HELD (it is, by this client's
            // session), not to share its connection.
            const client = await db.getPool().connect();
            try {
                const lockResult = await client.query(
                    'SELECT pg_try_advisory_lock($1) AS locked',
                    [ADVISORY_LOCK_KEY]
                );
                const locked = lockResult.rows[0] && lockResult.rows[0].locked === true;
                if (!locked) {
                    // Another replica is draining; quiet exit (client released
                    // by the finally below).
                    return;
                }

                try {
                    await this._drainOne();
                    this._consecutiveFailures = 0;
                    this._lastFailureLogAt = 0;
                } finally {
                    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
                        logger.warn(`ukOutboxService: advisory_unlock failed: ${err.message}`);
                    });
                }
            } finally {
                client.release();
            }
        } catch (err) {
            this._consecutiveFailures += 1;
            this._logFailure(err);
        } finally {
            this._running = false;
        }
    }

    /**
     * Drain exactly one row.
     *
     * Important: this is a single-row operation per tick, by design. The
     * drain rate is enforced by the interval, not by batch size.
     */
    async _drainOne() {
        const row = await UkOutbox.pickNext();
        if (!row) {
            return; // queue empty — quiet
        }

        const outcome = await ukWebhookClient.send(row.payload_body);

        if (outcome.outcome === 'success') {
            await UkOutbox.markSent(row.id, outcome.code);
            await this._markAlertRequestMapSent(row.event_id);
            await this._syncIntegrationLog(row.event_id, 'success', null);
            logger.info(`ukOutboxService: sent event_id=${row.event_id} (${outcome.code})`);
            return;
        }

        if (outcome.outcome === 'dead') {
            await UkOutbox.markDead(row.id, outcome.error, outcome.code || null);
            await this._syncIntegrationLog(row.event_id, 'failed', outcome.error);
            logger.warn(`ukOutboxService: event_id=${row.event_id} marked dead (${outcome.code}): ${outcome.error}`);
            await this._recordNotificationFailure(row, outcome);
            return;
        }

        if (outcome.outcome === 'skip') {
            // Config issue (no secret / no URL); back off 60s, don't burn
            // retry budget. Logged once per FAILURE_LOG_THROTTLE_MS window
            // via _logFailure.
            await UkOutbox.resetForSkip(row.id, 60);
            this._consecutiveFailures += 1;
            const skipErr = new Error(`ukOutboxService skip: ${outcome.error}`);
            this._logFailure(skipErr);
            return;
        }

        // outcome === 'retry'
        const nextAttempt = row.attempt_count + 1;
        if (nextAttempt >= UkOutbox.MAX_ATTEMPTS) {
            await UkOutbox.markDead(row.id, outcome.error, outcome.code || null);
            await this._syncIntegrationLog(row.event_id, 'failed', outcome.error);
            logger.warn(`ukOutboxService: event_id=${row.event_id} dead after ${nextAttempt} attempts: ${outcome.error}`);
            await this._recordNotificationFailure(row, outcome);
            return;
        }
        // BACKOFF_SCHEDULE is 0-indexed: schedule[0]=2s is the first
        // retry's delay (after attempt 1 fails). `nextAttempt` already
        // counts the just-incremented attempt, so subtract one to index.
        const backoffSec = BACKOFF_SCHEDULE[Math.min(nextAttempt - 1, BACKOFF_SCHEDULE.length - 1)];
        await UkOutbox.markFailed(row.id, outcome.error, outcome.code || null, backoffSec);
        await this._syncIntegrationLog(row.event_id, 'retrying', outcome.error);
        logger.info(`ukOutboxService: event_id=${row.event_id} retry in ${backoffSec}s (attempt ${nextAttempt}/${UkOutbox.MAX_ATTEMPTS}): ${outcome.error}`);
    }

    /**
     * [B-007] Best-effort sync of the integration_log row (written at enqueue
     * time, keyed by event_id) to reflect the drain outcome. NEVER let a log
     * write failure break the drain — the outbox row transition is the source
     * of truth; this is observability only.
     */
    async _syncIntegrationLog(eventId, status, errorMessage) {
        try {
            await IntegrationLog.updateStatusByEventId(eventId, status, errorMessage ?? null);
        } catch (err) {
            logger.warn(`ukOutboxService: integration_log sync failed for event_id=${eventId} (${status}): ${err.message}`);
        }
    }

    /**
     * After successful UK delivery, mark the corresponding AlertRequestMap
     * row as 'sent'. We match by idempotency_key (== event_id).
     * uk_request_number stays NULL in Phase 1 (UK doesn't return one yet);
     * it'll be filled by requestProcessor when UK Phase 2 sends
     * `request.created` with our event_id in the payload.
     */
    async _markAlertRequestMapSent(eventId) {
        try {
            const mapping = await AlertRequestMap.findByIdempotencyKey(eventId);
            if (!mapping) {
                // No mapping for this event_id is unusual but not fatal —
                // could happen if alertForwarder enqueued without creating
                // a mapping (e.g. test fixtures). Log and move on.
                logger.debug(`ukOutboxService: no AlertRequestMap for event_id=${eventId}`);
                return;
            }
            // Skip if already past 'sent' (terminal-ish state for our side).
            if (mapping.status === 'sent' || mapping.status === 'resolved' || mapping.status === 'cancelled') {
                return;
            }
            await AlertRequestMap.markSent(mapping.id, null);
        } catch (err) {
            // Don't let an AlertRequestMap write failure mask the outbox
            // success — log and move on. Operator can reconcile later.
            logger.warn(`ukOutboxService: AlertRequestMap.markSent failed for event_id=${eventId}: ${err.message}`);
        }
    }

    /**
     * On terminal failure (dead row), append to the underlying alert's
     * notification_failures journal — mirrors the existing operator UX
     * pattern from alertForwarder L202-218. Best-effort: failures here
     * are logged and swallowed.
     */
    async _recordNotificationFailure(row, outcome) {
        try {
            const mapping = await AlertRequestMap.findByIdempotencyKey(row.event_id);
            if (!mapping || !mapping.infrasafe_alert_id) {
                logger.debug(`ukOutboxService: no alert to attach notification_failure for event_id=${row.event_id}`);
                return;
            }
            await db.query(
                `UPDATE infrastructure_alerts
                 SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
                     'notification_failures',
                     COALESCE(data->'notification_failures', '[]'::jsonb) || jsonb_build_array(
                         jsonb_build_object(
                             'channel', 'uk_webhook',
                             'event_id', $2::text,
                             'attempt_count', $3::int,
                             'response_code', $4,
                             'error', $5::text,
                             'failed_at', to_jsonb(NOW())
                         )
                     )
                 )
                 WHERE alert_id = $1`,
                [
                    mapping.infrasafe_alert_id,
                    row.event_id,
                    row.attempt_count + 1,
                    outcome.code || null,
                    outcome.error || 'unknown'
                ]
            );
        } catch (err) {
            logger.warn(`ukOutboxService: failed to record notification_failure for event_id=${row.event_id}: ${err.message}`);
        }
    }

    _logFailure(err) {
        const now = Date.now();
        const isFirst = this._consecutiveFailures === 1;
        const justEscalated = this._consecutiveFailures === FAILURE_ESCALATE_THRESHOLD;
        const windowElapsed = (now - this._lastFailureLogAt) >= FAILURE_LOG_THROTTLE_MS;
        if (!isFirst && !justEscalated && !windowElapsed) {
            return;
        }
        this._lastFailureLogAt = now;
        const msg = `ukOutboxService tick failed (consecutive: ${this._consecutiveFailures}): ${err.message}`;
        if (this._consecutiveFailures >= FAILURE_ESCALATE_THRESHOLD) {
            logger.warn(msg);
        } else {
            logger.error(msg);
        }
    }
}

const singleton = new UkOutboxService();
module.exports = singleton;
module.exports.UkOutboxService = UkOutboxService;
