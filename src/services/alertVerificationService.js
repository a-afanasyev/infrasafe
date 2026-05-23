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
            // Non-blocking advisory lock for cross-replica coordination.
            const lockResult = await db.query(
                'SELECT pg_try_advisory_lock($1) AS locked',
                [ADVISORY_LOCK_KEY]
            );
            const locked = lockResult.rows[0] && lockResult.rows[0].locked === true;
            if (!locked) {
                // Another replica is processing; quiet exit.
                return;
            }

            try {
                await this._drainOne();
                this._consecutiveFailures = 0;
                this._lastFailureLogAt = 0;
            } finally {
                await db.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
                    logger.warn(`alertVerificationService: advisory_unlock failed: ${err.message}`);
                });
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
    async _drainOne() {
        const row = await AlertVerification.pickDue();
        if (!row) {
            return; // queue empty / nothing due
        }

        // Window expired
        const now = Date.now();
        const windowUntilMs = new Date(row.window_until).getTime();
        if (now > windowUntilMs) {
            if (row.attempts > 0) {
                // We dispatched the VERIFY event earlier, no reopen happened
                // in the window → sensor recovered. Mark passed.
                await AlertVerification.markPassed(row.id);
                logger.info(`alertVerificationService: verification ${row.id} passed (no reopen within window)`);
            } else {
                // We never even got to fire — drain was starved.
                await AlertVerification.markSkipped(row.id, `window expired (${row.window_until})`);
            }
            return;
        }

        // If we've already dispatched once (attempts > 0) and we're still
        // inside the window, leave the row pending so the ALERT_REOPENED
        // listener can match. Subsequent ticks would re-emit, creating
        // duplicate UK requests — that's wrong.
        if (row.attempts > 0) {
            return;
        }

        // [Sprint 10 PR-4 hook] AlertSuppression.isActive check goes here.
        // For PR-2 scaffolding the suppressions table doesn't exist yet —
        // skip cleanly. The conditional pre-flight makes PR-4 a single-file
        // change.
        try {
            const AlertSuppression = require('../models/AlertSuppression');
            if (typeof AlertSuppression.isActive === 'function') {
                const suppressed = await AlertSuppression.isActive(
                    row.infrastructure_type,
                    row.infrastructure_id,
                    row.alert_type
                );
                if (suppressed) {
                    await AlertVerification.markSuppressed(row.id);
                    logger.info(`alertVerificationService: verification ${row.id} suppressed (${row.infrastructure_type}:${row.infrastructure_id}/${row.alert_type})`);
                    return;
                }
            }
        } catch (err) {
            // PR-2: model doesn't exist yet — that's expected. Log only
            // genuine errors (not module-not-found during scaffolding).
            if (err.code !== 'MODULE_NOT_FOUND') {
                logger.warn(`alertVerificationService: suppression check failed: ${err.message}`);
            }
        }

        // Reopen quota — fetch rule's max_reopens_per_24h
        const ruleQuota = await this._getReopenQuota(row.alert_type);
        if (ruleQuota > 0) {
            const recentReopens = await AlertVerification.countRecentReopensForChain(
                row.reopen_chain_id, 24
            );
            if (recentReopens >= ruleQuota) {
                await AlertVerification.markEngineerRequired(row.id);
                alertEvents.emit(
                    alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED,
                    {
                        reopenChainId: row.reopen_chain_id,
                        lastAlertId: row.original_alert_id,
                        reopenCount: recentReopens
                    }
                );
                logger.warn(`alertVerificationService: chain ${row.reopen_chain_id} exceeded ${ruleQuota} reopens/24h — engineer_required`);
                return;
            }
        }

        // Dispatch the VERIFY event to the appropriate checker
        const verifyEvent = TYPE_TO_VERIFY_EVENT[row.alert_type];
        if (!verifyEvent) {
            await AlertVerification.markSkipped(row.id, `no VERIFY mapping for alert_type=${row.alert_type}`);
            return;
        }

        // [Sprint 10 PR-3] Look up the previous UK request number from the
        // original alert (set there by alertService.resolveAlert system-path).
        // Passed through to the checker so the reopen alert's UK payload can
        // include `related_request_number` for operator context on the УК UI
        // ("Повторное обращение №2, предыдущая заявка 260523-004").
        let previousUkRequestNumber = null;
        try {
            const prevQuery = await db.query(
                'SELECT previous_uk_request_number FROM infrastructure_alerts WHERE alert_id = $1',
                [row.original_alert_id]
            );
            if (prevQuery.rows[0]) {
                previousUkRequestNumber = prevQuery.rows[0].previous_uk_request_number || null;
            }
        } catch (e) {
            logger.debug(`alertVerificationService: previous_uk_request_number lookup failed: ${e.message}`);
        }

        alertEvents.emit(verifyEvent, {
            infraType: row.infrastructure_type,
            infraId: row.infrastructure_id,
            alertType: row.alert_type,
            bypassCooldown: true,
            reopenChainId: row.reopen_chain_id,
            reopenSequence: row.reopen_sequence + 1,
            originalAlertId: row.original_alert_id,
            previousUkRequestNumber
        });

        // Mark the row as dispatched so subsequent ticks within the window
        // don't re-emit (would create duplicate UK requests). When the
        // ALERT_REOPENED listener fires, it markReopened; if window expires
        // without reopen, the windowExpired branch marks it passed.
        await AlertVerification.markDispatched(row.id);

        logger.info(`alertVerificationService: emitted ${verifyEvent} for verification ${row.id} (chain ${row.reopen_chain_id}, seq→${row.reopen_sequence + 1})`);
    }

    /**
     * Read max_reopens_per_24h from alert_rules for the given alert_type.
     * Returns 0 if no rule exists (defensive: don't enforce quota with no
     * rule to define it). When multiple severities exist for the type,
     * the most-restrictive (lowest) value wins.
     */
    async _getReopenQuota(alertType) {
        try {
            const result = await db.query(
                `SELECT MIN(max_reopens_per_24h) AS quota
                 FROM alert_rules
                 WHERE alert_type = $1 AND enabled = true`,
                [alertType]
            );
            const quota = result.rows[0] && result.rows[0].quota;
            return Number.isFinite(quota) ? quota : 0;
        } catch (err) {
            logger.warn(`alertVerificationService: _getReopenQuota failed for ${alertType}: ${err.message}`);
            return 0;
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
        await AlertVerification.markReopened(pending.id, alertId);
        logger.info(`alertVerificationService: verification ${pending.id} → reopened (new alert_id=${alertId}, chain=${reopenChainId})`);
    } catch (err) {
        logger.error(`alertVerificationService: ALERT_REOPENED handler failed: ${err.message}`);
    }
});

module.exports = singleton;
module.exports.AlertVerificationService = AlertVerificationService;
