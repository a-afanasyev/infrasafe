'use strict';

/**
 * [Sprint 10 PR-2] Alert verification drain worker.
 *
 * Periodically picks the next due `alert_verifications` row, dispatches a
 * VERIFY_<TYPE> event so the appropriate checker can examine current
 * sensor state, then waits for window_until before marking the row passed
 * (no new alert) or reopened (new alert detected).
 *
 * Pattern modelled on `src/services/uk/ukOutboxService.js` (Sprint 9):
 *   - Singleton + setInterval + warmup + in-flight mutex + unref()'d timers
 *   - Cross-replica advisory lock (`pg_try_advisory_lock`) so multiple
 *     replicas don't race the same row
 *   - Per-tick single-row drain (FOR UPDATE SKIP LOCKED in the model)
 *   - Throttled failure log
 *
 * Outcome per tick:
 *   1. No pending row due → quiet exit
 *   2. AlertSuppression.isActive(infra+type) → markSuppressed, emit nothing
 *   3. countRecentReopensForChain >= max_reopens_per_24h → markEngineerRequired,
 *      emit ALERT_ENGINEER_REQUIRED so UI/notification flows can react
 *   4. Otherwise → emit VERIFY_<TYPE>. The checker creates a new alert if
 *      condition persists; this service polls after window_until expires
 *      (handled in a second pass: when the row is past window_until without
 *      being matched to a new alert_id, it's markPassed).
 *
 * PR-2 scope: ships the drain worker scaffolding behind feature flag
 * `ALERT_VERIFICATION_ENABLED=false`. PR-3 wires alertService.resolveAlert
 * to enqueue rows + adds the post-window passed/reopened reconciliation.
 *
 * Env controls:
 *   - ALERT_VERIFICATION_ENABLED    — master gate (default 'false'). When
 *                                     false the worker doesn't start the
 *                                     interval (cheap dormant state).
 *   - ALERT_VERIFICATION_TICK_MS    — tick interval (default 15000ms,
 *                                     clamped to [1000, 300000]).
 */

const db = require('../config/database');
const logger = require('../utils/logger');

const AlertVerification = require('../models/AlertVerification');
const alertEvents = require('../events/alertEvents');

const DEFAULT_INTERVAL_MS = 15000;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 300000;
const WARMUP_DELAY_MS = 5000;

// Advisory lock key — stable hash of 'infrasafe.alert_verification_drain'
// (sha256 first 4 bytes as int32). Hard-coded for stability.
//   crypto.createHash('sha256')
//     .update('infrasafe.alert_verification_drain')
//     .digest().readUInt32BE(0)
// → 0x32a4f7c8 → 849608648
const ADVISORY_LOCK_KEY = 849608648;

// Failure-log throttling mirrors ukOutboxService.
const FAILURE_LOG_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes
const FAILURE_ESCALATE_THRESHOLD = 5;

// Map alert_type → corresponding VERIFY_* event. Unknown types are
// skipped silently (logged once via _logFailure) — there's nothing to
// verify if no checker subscribes to the event.
const TYPE_TO_VERIFY_EVENT = Object.freeze({
    'TRANSFORMER_OVERLOAD':          alertEvents.EVENTS.VERIFY_TRANSFORMER,
    'TRANSFORMER_CRITICAL_OVERLOAD': alertEvents.EVENTS.VERIFY_TRANSFORMER,
    'LEAK_DETECTED':                 alertEvents.EVENTS.VERIFY_LEAK,
    'VOLTAGE_ANOMALY':               alertEvents.EVENTS.VERIFY_VOLTAGE,
    'HEATING_FAILURE':               alertEvents.EVENTS.VERIFY_HEATING,
});

class AlertVerificationService {
    constructor() {
        this._timer = null;
        this._warmupTimer = null;
        this._running = false;
        this._stopped = false;
        this._consecutiveFailures = 0;
        this._lastFailureLogAt = 0;
    }

    isEnabled() {
        const flag = (process.env.ALERT_VERIFICATION_ENABLED ?? 'false').toString().toLowerCase();
        return flag === 'true' || flag === '1';
    }

    intervalMs() {
        const raw = Number(process.env.ALERT_VERIFICATION_TICK_MS);
        if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
        return Math.min(Math.max(Math.floor(raw), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
    }

    start() {
        if (!this.isEnabled()) {
            logger.info('alertVerificationService disabled via ALERT_VERIFICATION_ENABLED (dormant)');
            return;
        }
        if (this._timer) {
            logger.warn('alertVerificationService already started — skipping duplicate start');
            return;
        }
        this._stopped = false;
        const interval = this.intervalMs();
        logger.info(`alertVerificationService starting (interval=${interval}ms)`);

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
            logger.info('alertVerificationService stopped');
        }
    }

    /**
     * Single drain tick. Acquires cross-replica advisory lock, picks one
     * due verification, dispatches it.
     */
    async _tick() {
        if (this._stopped) return;
        if (this._running) {
            // Previous tick still inflight — skip; don't queue overlap.
            return;
        }
        this._running = true;

        try {
            // [B-021] Check out ONE client and do lock + drain + unlock all on
            // it. Session-scoped advisory locks are bound to the physical
            // connection — acquiring/releasing them through the pool wrapper
            // (db.query) lands on arbitrary connections, so the unlock often
            // no-ops on a connection that never held the lock and the lock
            // leaks on the connection that did. Pinning one client makes the
            // cross-replica mutex actually hold for the whole tick, lets the
            // drain run as one transaction on that connection, and auto-releases
            // the lock if the process dies (the backend session closes).
            const client = await db.getPool().connect();
            try {
                const lockResult = await client.query(
                    'SELECT pg_try_advisory_lock($1) AS locked',
                    [ADVISORY_LOCK_KEY]
                );
                const locked = lockResult.rows[0] && lockResult.rows[0].locked === true;
                if (!locked) {
                    // Another replica is processing; quiet exit (client released
                    // by the finally below).
                    return;
                }

                try {
                    await this._drainOne(client);
                    this._consecutiveFailures = 0;
                    this._lastFailureLogAt = 0;
                } finally {
                    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
                        logger.warn(`alertVerificationService: advisory_unlock failed: ${err.message}`);
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
     * Process exactly one due verification row.
     *
     * Decision tree:
     *   1. No row → return
     *   2. Past window_until + already dispatched (attempts>0) → markPassed
     *      (no reopen happened; sensor recovered)
     *   3. Past window_until + never dispatched (attempts=0) → markSkipped
     *      (we never even got to fire the VERIFY event)
     *   4. Suppression active → markSuppressed
     *   5. Reopen quota exceeded → markEngineerRequired + emit
     *   6. Unknown alert_type (no VERIFY mapping) → markSkipped + log
     *   7. Happy path → emit VERIFY_<TYPE>; row stays pending so a
     *      future tick can examine post-emit state
     *
     * [Sprint 10 PR-3] The "did a new alert appear?" reconciliation is
     * handled via the ALERT_REOPENED event listener (registered at module
     * load below). When the checker creates a reopen alert, the listener
     * calls AlertVerification.markReopened(verification.id, newAlertId).
     * If no reopen happens within window, this _drainOne path catches the
     * row on a future tick and marks it passed.
     */
    async _drainOne(executor = db) {
        // [B-021] Wrap pick + decision + the two write-backs
        // (_finalizeAlertStatus on infrastructure_alerts + AlertVerification
        // mark* on alert_verifications) in ONE transaction on the locked
        // client. Either both land or neither does — no window where the
        // alert is finalized but the verification row isn't (or vice versa).
        // pickDue's FOR UPDATE SKIP LOCKED row-lock now actually holds for
        // the whole unit (it was a no-op under autocommit). Any VERIFY_* /
        // ALERT_ENGINEER_REQUIRED emit is deferred until AFTER COMMIT so a
        // checker never reacts to state that gets rolled back.
        let pendingEmit = null;
        await executor.query('BEGIN');
        try {
            pendingEmit = await this._processDue(executor);
            await executor.query('COMMIT');
        } catch (err) {
            await executor.query('ROLLBACK').catch((e) => {
                logger.warn(`alertVerificationService: ROLLBACK failed: ${e.message}`);
            });
            throw err;
        }

        if (pendingEmit) {
            alertEvents.emit(pendingEmit.event, pendingEmit.payload);
        }
    }

    /**
     * Decision tree for one due verification. Runs entirely on `executor`
     * (the locked transaction client). Performs all DB writes; returns a
     * `{ event, payload }` descriptor for any event the caller must emit
     * AFTER commit, or `null` when nothing should be emitted.
     */
    async _processDue(executor) {
        const row = await AlertVerification.pickDue(executor);
        if (!row) {
            return null; // queue empty / nothing due
        }

        // Window expired
        const now = Date.now();
        const windowUntilMs = new Date(row.window_until).getTime();
        if (now > windowUntilMs) {
            if (row.attempts > 0) {
                // We dispatched the VERIFY event earlier, no reopen happened
                // in the window → sensor recovered. Mark passed.
                // [B-020] finalize the parent alert FIRST (now also atomic via
                // the surrounding transaction): both UPDATEs commit together.
                await this._finalizeAlertStatus(row.original_alert_id, 'resolved', executor);
                await AlertVerification.markPassed(row.id, executor);
                logger.info(`alertVerificationService: verification ${row.id} passed (no reopen within window)`);
            } else {
                // We never even got to fire — drain was starved.
                await this._finalizeAlertStatus(row.original_alert_id, 'resolved', executor);
                await AlertVerification.markSkipped(row.id, `window expired (${row.window_until})`, executor);
            }
            return null;
        }

        // If we've already dispatched once (attempts > 0) and we're still
        // inside the window, leave the row pending so the ALERT_REOPENED
        // listener can match. Subsequent ticks would re-emit, creating
        // duplicate UK requests — that's wrong.
        if (row.attempts > 0) {
            return null;
        }

        // [Sprint 10 PR-4] AlertSuppression.isActive check. Conditional
        // require kept so a missing model degrades cleanly.
        try {
            const AlertSuppression = require('../models/AlertSuppression');
            if (typeof AlertSuppression.isActive === 'function') {
                const suppressed = await AlertSuppression.isActive(
                    row.infrastructure_type,
                    row.infrastructure_id,
                    row.alert_type
                );
                if (suppressed) {
                    // [B-020] operator chose to ignore — close the alert.
                    await this._finalizeAlertStatus(row.original_alert_id, 'resolved', executor);
                    await AlertVerification.markSuppressed(row.id, executor);
                    logger.info(`alertVerificationService: verification ${row.id} suppressed (${row.infrastructure_type}:${row.infrastructure_id}/${row.alert_type})`);
                    return null;
                }
            }
        } catch (err) {
            // Module absent — degrade cleanly. Note: a query error from a
            // PRESENT model would propagate (poisoning the txn) and roll the
            // tick back, which is correct.
            if (err.code !== 'MODULE_NOT_FOUND') {
                throw err;
            }
        }

        // Reopen quota — fetch rule's max_reopens_per_24h
        const ruleQuota = await this._getReopenQuota(row.alert_type, executor);
        if (ruleQuota > 0) {
            const recentReopens = await AlertVerification.countRecentReopensForChain(
                row.reopen_chain_id, 24, executor
            );
            if (recentReopens >= ruleQuota) {
                // [B-020] escalate the alert itself — the operator/UI needs
                // to see engineer_required, not a stuck resolved_verifying.
                await this._finalizeAlertStatus(row.original_alert_id, 'engineer_required', executor);
                await AlertVerification.markEngineerRequired(row.id, executor);
                logger.warn(`alertVerificationService: chain ${row.reopen_chain_id} exceeded ${ruleQuota} reopens/24h — engineer_required`);
                return {
                    event: alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED,
                    payload: {
                        reopenChainId: row.reopen_chain_id,
                        lastAlertId: row.original_alert_id,
                        reopenCount: recentReopens
                    }
                };
            }
        }

        // Dispatch the VERIFY event to the appropriate checker
        const verifyEvent = TYPE_TO_VERIFY_EVENT[row.alert_type];
        if (!verifyEvent) {
            // [B-020] nothing to verify — don't leave the alert hanging.
            await this._finalizeAlertStatus(row.original_alert_id, 'resolved', executor);
            await AlertVerification.markSkipped(row.id, `no VERIFY mapping for alert_type=${row.alert_type}`, executor);
            return null;
        }

        // [Sprint 10 PR-3] Look up the previous UK request number from the
        // original alert (set by alertService.resolveAlert system-path), passed
        // to the checker for the reopen payload's `related_request_number`.
        // Runs on the same client/txn; a failure rolls the tick back (retried).
        let previousUkRequestNumber = null;
        const prevQuery = await executor.query(
            'SELECT previous_uk_request_number FROM infrastructure_alerts WHERE alert_id = $1',
            [row.original_alert_id]
        );
        if (prevQuery.rows[0]) {
            previousUkRequestNumber = prevQuery.rows[0].previous_uk_request_number || null;
        }

        // Mark the row as dispatched so subsequent ticks within the window
        // don't re-emit. The actual emit happens after COMMIT (caller).
        await AlertVerification.markDispatched(row.id, executor);

        logger.info(`alertVerificationService: emitted ${verifyEvent} for verification ${row.id} (chain ${row.reopen_chain_id}, seq→${row.reopen_sequence + 1})`);

        return {
            event: verifyEvent,
            payload: {
                infraType: row.infrastructure_type,
                infraId: row.infrastructure_id,
                alertType: row.alert_type,
                bypassCooldown: true,
                reopenChainId: row.reopen_chain_id,
                reopenSequence: row.reopen_sequence + 1,
                originalAlertId: row.original_alert_id,
                previousUkRequestNumber
            }
        };
    }

    /**
     * Read max_reopens_per_24h from alert_rules for the given alert_type.
     * Returns 0 if no rule exists (defensive: don't enforce quota with no
     * rule to define it). When multiple severities exist for the type,
     * the most-restrictive (lowest) value wins.
     */
    async _getReopenQuota(alertType, executor = db) {
        // [B-021] Runs inside the drain transaction (executor = locked client).
        // A query error must propagate so the surrounding transaction rolls
        // back — swallowing it would poison the txn (PG aborts it) and the
        // next statement would fail anyway with a more confusing error.
        const result = await executor.query(
            `SELECT MIN(max_reopens_per_24h) AS quota
             FROM alert_rules
             WHERE alert_type = $1 AND enabled = true`,
            [alertType]
        );
        const quota = result.rows[0] && result.rows[0].quota;
        return Number.isFinite(quota) ? quota : 0;
    }

    /**
     * [B-020] Transition the parent alert OUT of the transient
     * 'resolved_verifying' state once its verification reaches a terminal
     * outcome. Without this the alert orphans in resolved_verifying forever
     * (prod alerts 25, 26 sat there for days).
     *
     * Outcome → status mapping (caller-supplied):
     *   passed / reopened / suppressed / skipped → 'resolved'
     *   engineer_required (reopen quota hit)     → 'engineer_required'
     *
     * The `status = 'resolved_verifying'` guard makes this idempotent and
     * safe against races: a second call (e.g. crash-retry, or an operator
     * who already closed it) matches zero rows and is a no-op. Failures are
     * logged but never thrown — the verification row transition is the
     * source of truth and must not be blocked by a write-back hiccup.
     */
    async _finalizeAlertStatus(originalAlertId, newStatus, executor = db) {
        if (!originalAlertId) return;
        // [B-021] When run inside the drain transaction (executor is a checked-
        // out client, not the pool wrapper), a write-back failure MUST roll the
        // whole unit back — so let it propagate. Standalone (executor === db,
        // e.g. a legacy caller) keep the B-020 swallow: the verification-row
        // transition is the source of truth and must not be blocked by a
        // write-back hiccup.
        const inTransaction = executor !== db;
        try {
            await executor.query(
                `UPDATE infrastructure_alerts
                 SET status = $2
                 WHERE alert_id = $1 AND status = 'resolved_verifying'`,
                [originalAlertId, newStatus]
            );
        } catch (err) {
            if (inTransaction) throw err;
            logger.warn(`alertVerificationService: finalize alert ${originalAlertId} → ${newStatus} failed: ${err.message}`);
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
        const msg = `alertVerificationService tick failed (consecutive: ${this._consecutiveFailures}): ${err.message}`;
        if (this._consecutiveFailures >= FAILURE_ESCALATE_THRESHOLD) {
            logger.warn(msg);
        } else {
            logger.error(msg);
        }
    }
}

const singleton = new AlertVerificationService();

// [Sprint 10 PR-3] ALERT_REOPENED listener — when alertService.createAlert
// emits this after inserting a reopen alert, look up the matching pending
// verification by reopen_chain_id and markReopened with the new alert_id.
// This is the "did a new alert appear?" reconciliation that closes the
// verification loop.
//
// Fire-and-forget: errors are logged but don't propagate (the new alert
// row is already persisted). Operator can manually fix orphaned
// verification rows from admin UI if needed.
alertEvents.on(alertEvents.EVENTS.ALERT_REOPENED, async (payload) => {
    const { alertId, reopenChainId } = payload || {};
    if (!alertId || !reopenChainId) {
        logger.warn(`alertVerificationService: ALERT_REOPENED missing alertId or reopenChainId`);
        return;
    }
    try {
        const pending = await AlertVerification.findPendingByChainId(reopenChainId);
        if (!pending) {
            logger.debug(`alertVerificationService: ALERT_REOPENED chain ${reopenChainId} has no pending verification`);
            return;
        }
        // [B-020] finalize-FIRST (same crash-safe ordering as _drainOne): the
        // OLD alert is superseded by the freshly-created reopen alert (active),
        // so move it out of resolved_verifying → resolved BEFORE marking the
        // verification reopened. If the process crashes between the two, the
        // verification row stays 'pending' so _drainOne re-runs and the alert
        // never orphans. Doing markReopened first would leave the row
        // non-pending (pickDue skips it) with the alert stuck — re-introducing
        // the very B-020 bug this fix closes.
        if (pending.original_alert_id) {
            await singleton._finalizeAlertStatus(pending.original_alert_id, 'resolved');
        }
        await AlertVerification.markReopened(pending.id, alertId);
        logger.info(`alertVerificationService: verification ${pending.id} → reopened (new alert_id=${alertId}, chain=${reopenChainId})`);
    } catch (err) {
        logger.error(`alertVerificationService: ALERT_REOPENED handler failed: ${err.message}`);
    }
});

module.exports = singleton;
module.exports.AlertVerificationService = AlertVerificationService;
// [B-021] Exported so the system-path resolveAlert (alertService) can take the
// SAME advisory lock and serialise against the drain worker (PR3).
module.exports.ADVISORY_LOCK_KEY = ADVISORY_LOCK_KEY;
