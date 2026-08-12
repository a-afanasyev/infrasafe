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
const metrics = require('../observability/metrics');   // [AR-2]

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

// [AUD-001 PR-C] Engineer-escalation sweep — at-least-once (re)delivery of
// ALERT_ENGINEER_REQUIRED for rows whose UK ticket hasn't been acked yet.
//   BATCH — rows examined per tick (fair-rotation cursor + LIMIT).
//   DEFER — how long a picked row is pushed into the rotation tail BEFORE emit,
//           so 5 permanently-undeliverable rows can't shadow a deliverable one
//           and re-emits are paced (≈ every 5 min, not every tick).
const ENGINEER_SWEEP_BATCH = 5;
const ENGINEER_SWEEP_DEFER_SECONDS = 300;

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

        // [AUD-001 PR-C] Engineer-sweep emits are collected under the lock and
        // fired AFTER the lock is released (pendingEmit pattern) so the advisory
        // mutex isn't held across the listener fan-out.
        let sweepEmits = [];
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
                    // [AUD-001 PR-C] Under the same lock (serialised across
                    // replicas), re-deliver any engineer escalation UK hasn't
                    // acked. Separate query set from the drain — they don't
                    // contend. Emits deferred to after the unlock.
                    sweepEmits = await this._sweepEngineerNotifications(client);
                    this._consecutiveFailures = 0;
                    this._lastFailureLogAt = 0;
                } finally {
                    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
                        logger.warn(`alertVerificationService: advisory_unlock failed: ${err.message}`);
                    });
                }
            } finally {
                db.releaseClient(client);
            }
        } catch (err) {
            this._consecutiveFailures += 1;
            this._logFailure(err);
        } finally {
            this._running = false;
            // [AR-2] Отмечаем ЗАВЕРШЁННЫЙ тик, включая неудачный: правило
            // InfrasafeVerificationWorkerStalled следит за тем, что воркер
            // вообще крутится (`time() - last_tick > 300`). Если ставить метку
            // только при успехе, застрявший на ошибках воркер выглядел бы
            // мёртвым — но это уже покрывают счётчики отказов, а «не тикает
            // вовсе» иначе не отличить от «тикает и падает».
            metrics.markVerificationTick();
        }

        for (const e of sweepEmits) {
            alertEvents.emit(e.event, e.payload);
        }
    }

    /**
     * [AUD-001 PR-C] Engineer-escalation sweep. Picks up to BATCH
     * engineer_required rows whose UK ticket hasn't been acked
     * (uk_notified_at IS NULL) and that are due per the rotation cursor, pushes
     * them all into the tail (DEFER seconds) BEFORE building emits — so a row is
     * never re-selected next tick regardless of the listener outcome, and
     * permanently-undeliverable rows can't starve deliverable ones. Returns the
     * emit descriptors for the caller to fire after the advisory lock is
     * released.
     *
     * Runs as autocommit statements on the (now post-COMMIT) drain client; the
     * forwarder listener acks via AlertVerification.markUkNotified on success,
     * which self-terminates this sweep for that row.
     */
    async _sweepEngineerNotifications(executor = db) {
        const rows = await AlertVerification.pickUnnotifiedEngineer(ENGINEER_SWEEP_BATCH, executor);
        if (!rows.length) return [];

        await AlertVerification.deferEngineerNotifications(
            rows.map((r) => r.id), ENGINEER_SWEEP_DEFER_SECONDS, executor
        );

        const emits = [];
        for (const row of rows) {
            const alertRow = await executor.query(
                'SELECT * FROM infrastructure_alerts WHERE alert_id = $1',
                [row.original_alert_id]
            );
            emits.push({
                event: alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED,
                payload: {
                    alertData: alertRow.rows[0] || null,
                    alertId: row.original_alert_id,
                    verificationId: row.id,
                    reopenChainId: row.reopen_chain_id,
                    reopenCount: null
                }
            });
            logger.info(`alertVerificationService: engineer-sweep re-emitting escalation for verification ${row.id} (alert ${row.original_alert_id})`);
        }
        return emits;
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
        // [AR-11] Транзакция через общий хелпер, режим «чужое соединение»:
        // `executor` держит кадр двумя уровнями выше (_tick) под advisory-локом
        // и сам же его освобождает. Хелпер поэтому НЕ вызывает release —
        // выдернуть соединение из-под чужого кадра нельзя. Пометка испорченного
        // клиента живёт на самом объекте и доезжает до releaseClient там.
        const pendingEmit = await db.withTransaction(
            () => this._processDue(executor),
            { client: executor, context: 'alertVerificationService drain' }
        );

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

        const now = Date.now();
        const windowExpired = now > new Date(row.window_until).getTime();
        // [AUD-001 PR-C] A dispatch lease is live while a (possibly slow) checker
        // may still create a reopen that binds to this 'pending' row. While
        // active it blocks TERMINALISATION (passed/skipped/suppressed/engineer);
        // it does NOT block re-dispatch (keeping the verification alive is the
        // point — markDispatched re-extends the lease).
        const leaseActive = row.dispatch_lease_until != null
            && now < new Date(row.dispatch_lease_until).getTime();

        // [B-021 W1 → AUD-001 PR-C] Reconcile a superseding reopen from DURABLE
        // DB state on any row that was already dispatched (attempts>0 — a checker
        // may have created a reopen whose ephemeral ALERT_REOPENED was lost) OR
        // whose window expired. Catches the reopen before we'd otherwise
        // terminalise the row (passed/skipped/suppressed/engineer). Generalising
        // this to the in-window retry path (not just window-expired) is what
        // makes re-emit safe: a late reopen always wins over a suppression/quota
        // verdict computed on a later tick.
        if (row.attempts > 0 || windowExpired) {
            const superseding = await this._findSupersedingAlert(row, executor);
            if (superseding.outcome === 'reopened') {
                await this._finalizeAlertStatus(row.original_alert_id, 'resolved', executor);
                await AlertVerification.markReopened(row.id, superseding.alertId, executor);
                logger.info(`alertVerificationService: verification ${row.id} reconciled → reopened (superseding alert ${superseding.alertId} in chain ${row.reopen_chain_id})`);
                return null;
            }
            if (superseding.outcome === 'conflict') {
                // [Step 5] A chain-less alert we tried to adopt was taken into a
                // DIFFERENT chain by a racing verification/replica. Don't claim
                // 'passed' (the fault may persist) — finalize + skip with reason.
                await this._finalizeAlertStatus(row.original_alert_id, 'resolved', executor);
                await AlertVerification.markSkipped(row.id, `adoption conflict for chain ${row.reopen_chain_id}`, executor);
                return null;
            }
        }

        // Window expired
        if (windowExpired) {
            // [AUD-001 PR-C] Lease gate — a slow checker may still bind a reopen
            // to this pending row. Defer terminalisation until the lease ends;
            // push next_dispatch_at to the lease end so the row doesn't shadow
            // other due rows every tick.
            if (leaseActive) {
                await this._deferToLease(row, executor);
                return null;
            }
            // [AUD-001 PR-B] Checked-ack: 'passed' requires PROOF a checker
            // really evaluated the fault (last_checked_at). "Dispatched"
            // (attempts>0) is not enough — the checker swallows errors / can't
            // tell silent-sensor from healthy. attempts>0 without last_checked_at
            // → the checker never completed → 'skipped', not a false 'passed'.
            await this._finalizeAlertStatus(row.original_alert_id, 'resolved', executor);
            if (row.attempts > 0 && row.last_checked_at) {
                await AlertVerification.markPassed(row.id, executor);
                logger.info(`alertVerificationService: verification ${row.id} passed (checked, no reopen within window)`);
            } else if (row.attempts > 0) {
                await AlertVerification.markSkipped(row.id, 'dispatched but checker never completed', executor);
            } else {
                // We never even got to fire — drain was starved.
                await AlertVerification.markSkipped(row.id, `window expired (${row.window_until})`, executor);
            }
            return null;
        }

        // In-window. attempts may be > 0 — PR-C re-dispatches (durable
        // at-least-once delivery); pickDue's next_dispatch_at gate throttles it.

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
                    // [AUD-001 PR-C] Lease-gate terminalisation: a checker still
                    // in flight may produce a reopen that must win over a
                    // suppression verdict. Defer until the lease expires.
                    if (leaseActive) {
                        await this._deferToLease(row, executor);
                        return null;
                    }
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
                // [AUD-001 PR-C] Lease-gate: a late reopen from an in-flight
                // checker must win over an engineer_required verdict. Defer.
                if (leaseActive) {
                    await this._deferToLease(row, executor);
                    return null;
                }
                // [B-020] escalate the alert itself — the operator/UI needs
                // to see engineer_required, not a stuck resolved_verifying.
                await this._finalizeAlertStatus(row.original_alert_id, 'engineer_required', executor);
                await AlertVerification.markEngineerRequired(row.id, executor);
                logger.warn(`alertVerificationService: chain ${row.reopen_chain_id} exceeded ${ruleQuota} reopens/24h — engineer_required`);
                // [AUD-001 PR-B Step 5b] The forwarder needs the full alertData
                // (to match a rule + resolve buildings) and the verificationId
                // (for the deterministic, AlertRequestMap-free event_id). The
                // old payload {reopenChainId,lastAlertId,reopenCount} did NOT
                // match the listener's {alertData,alertId} destructure → the
                // escalation never reached UK. SELECT the alert on the same
                // executor; emit happens after COMMIT.
                const alertRow = await executor.query(
                    'SELECT * FROM infrastructure_alerts WHERE alert_id = $1',
                    [row.original_alert_id]
                );
                return {
                    event: alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED,
                    payload: {
                        alertData: alertRow.rows[0] || null,
                        alertId: row.original_alert_id,
                        verificationId: row.id,
                        reopenChainId: row.reopen_chain_id,
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

        // [AUD-001 PR-C] (re-)dispatch. markDispatched now stamps next_dispatch_at
        // (throttles the re-pick) + dispatch_lease_until (blocks terminalisation
        // while a checker may be running) and is re-callable (no attempts=0
        // guard). The actual emit happens after COMMIT (caller).
        await AlertVerification.markDispatched(row.id, executor);

        logger.info(`alertVerificationService: emitted ${verifyEvent} for verification ${row.id} (chain ${row.reopen_chain_id}, seq→${row.reopen_sequence + 1}, attempt ${row.attempts + 1})`);

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
                previousUkRequestNumber,
                // [AUD-001 PR-B] verificationId → the checker's listener acks via
                // AlertVerification.markChecked when it really evaluated the
                // fault. observationSince = enqueue/resolve moment → clamps the
                // checker's freshness-probe + persistence gate to post-resolve
                // telemetry only (no false reopen on pre-resolve samples).
                verificationId: row.id,
                observationSince: row.created_at
            }
        };
    }

    /**
     * Read max_reopens_per_24h from alert_rules for the given alert_type.
     * Returns 0 if no rule exists (defensive: don't enforce quota with no
     * rule to define it). When multiple severities exist for the type,
     * the most-restrictive (lowest) value wins.
     */
    /**
     * [B-021 W1 + AUD-001 PR-B Step 5] Decide whether a reopen already happened
     * for this verification, reconciled from DURABLE DB state (the ALERT_REOPENED
     * event is ephemeral — a crash between createAlert's emit and the listener
     * loses it). Returns { outcome, alertId }:
     *
     *   1. CHAIN MATCH — a later alert already carries this reopen_chain_id (the
     *      normal reopen path): { outcome:'reopened', alertId }.
     *   2. FALLBACK + ADOPTION — telemetry during grace created a fresh active
     *      alert of the same (infra, type-family) WITHOUT the chain (the checker
     *      hit the dedup index, so the VERIFY-path reopen never inserted). It's
     *      the same physical fault, so adopt it INTO this chain (atomic UPDATE,
     *      guard reopen_chain_id IS NULL). Without adoption the quota — counted
     *      strictly by reopen_chain_id — would reset on the next resolve.
     *        - adoption won  → { outcome:'reopened', alertId }
     *        - lost race but adopted into OUR chain → { outcome:'reopened' }
     *        - adopted into a DIFFERENT chain → { outcome:'conflict' }
     *   3. Nothing → { outcome:'none' }.
     *
     * Runs entirely on `executor` (the drain transaction) so the SELECTs and the
     * adoption UPDATE are one atomic unit.
     */
    async _findSupersedingAlert(row, executor = db) {
        const reopenChainId = row.reopen_chain_id;
        const reopenSequence = row.reopen_sequence;
        if (!reopenChainId) return { outcome: 'none' };

        // 1. Chain match — a later link already exists in this chain.
        const chainMatch = await executor.query(
            `SELECT alert_id FROM infrastructure_alerts
             WHERE reopen_chain_id = $1
               AND reopen_sequence > $2
               AND status IN ('active', 'acknowledged', 'resolved', 'resolved_verifying', 'engineer_required')
             ORDER BY reopen_sequence DESC, alert_id DESC
             LIMIT 1`,
            [reopenChainId, reopenSequence]
        );
        if (chainMatch.rows[0]) {
            return { outcome: 'reopened', alertId: chainMatch.rows[0].alert_id };
        }

        // 2. Fallback — a chain-less alert of the same (infra, type-family)
        // created strictly within the verification window (after resolve/enqueue,
        // before window_until). Transformer severities drift between the two
        // TRANSFORMER_* types, so match the family.
        const family = (reopenChainId && (row.alert_type === 'TRANSFORMER_OVERLOAD' || row.alert_type === 'TRANSFORMER_CRITICAL_OVERLOAD'))
            ? ['TRANSFORMER_OVERLOAD', 'TRANSFORMER_CRITICAL_OVERLOAD']
            : [row.alert_type];
        const fallback = await executor.query(
            `SELECT alert_id FROM infrastructure_alerts
             WHERE infrastructure_type = $1 AND infrastructure_id = $2
               AND type = ANY($3)
               AND reopen_chain_id IS NULL
               AND created_at > $4 AND created_at <= $5
               AND status IN ('active', 'acknowledged', 'resolved', 'resolved_verifying', 'engineer_required')
             ORDER BY created_at DESC, alert_id DESC
             LIMIT 1`,
            [row.infrastructure_type, row.infrastructure_id, family, row.created_at, row.window_until]
        );
        if (!fallback.rows[0]) {
            return { outcome: 'none' };
        }
        const foundId = fallback.rows[0].alert_id;

        // 3. Adopt into this chain (guard IS NULL → idempotent + race-safe).
        const adopt = await executor.query(
            `UPDATE infrastructure_alerts
             SET reopen_chain_id = $1, reopen_sequence = $2, previous_alert_id = $3
             WHERE alert_id = $4 AND reopen_chain_id IS NULL
             RETURNING alert_id`,
            [reopenChainId, reopenSequence + 1, row.original_alert_id, foundId]
        );
        if (adopt.rows[0]) {
            logger.info(`alertVerificationService: adopted chain-less alert ${foundId} into chain ${reopenChainId} (seq ${reopenSequence + 1})`);
            return { outcome: 'reopened', alertId: foundId };
        }

        // Lost the adoption race — re-read to see whose chain won.
        const reread = await executor.query(
            'SELECT reopen_chain_id FROM infrastructure_alerts WHERE alert_id = $1',
            [foundId]
        );
        if (reread.rows[0] && reread.rows[0].reopen_chain_id === reopenChainId) {
            // The winner adopted it into OUR chain — still a valid reopen for us.
            return { outcome: 'reopened', alertId: foundId };
        }
        return { outcome: 'conflict' };
    }

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
     * [AUD-001 PR-C] Defer a verification past its active dispatch lease. Sets
     * next_dispatch_at = dispatch_lease_until so pickDue skips the row until the
     * lease expires (instead of re-selecting it every tick and shadowing other
     * due rows under LIMIT 1). The `status = 'pending'` guard keeps it a no-op
     * if the row terminalised meanwhile. Runs on the drain transaction client.
     */
    async _deferToLease(row, executor = db) {
        await executor.query(
            `UPDATE alert_verifications
             SET next_dispatch_at = dispatch_lease_until
             WHERE id = $1 AND status = 'pending'`,
            [row.id]
        );
        logger.debug(`alertVerificationService: verification ${row.id} deferred — dispatch lease active until ${row.dispatch_lease_until}`);
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

    /**
     * [B-021] ALERT_REOPENED handler — client-scoped + advisory-locked + one
     * transaction. Takes the SAME advisory key as the drain so it can't race
     * _drainOne on the same chain. If the lock is busy (drain in progress), we
     * skip: the window-expired _findSupersedingAlert reconciliation is the
     * durable backstop and will record this reopen from DB state on a later
     * tick — so a missed handler run is no longer a durability hole.
     */
    async _handleReopen(payload) {
        const { alertId, reopenChainId } = payload || {};
        if (!alertId || !reopenChainId) {
            logger.warn(`alertVerificationService: ALERT_REOPENED missing alertId or reopenChainId`);
            return;
        }

        let client;
        try {
            client = await db.getPool().connect();
        } catch (err) {
            logger.error(`alertVerificationService: ALERT_REOPENED connect failed: ${err.message}`);
            return;
        }

        try {
            const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_KEY]);
            const locked = lockResult.rows[0] && lockResult.rows[0].locked === true;
            if (!locked) {
                logger.debug(`alertVerificationService: ALERT_REOPENED skipped (lock busy) chain=${reopenChainId} — _drainOne reconciliation will self-heal`);
                return;
            }
            try {
                // [AR-11] Режим «чужое соединение»: клиент взят выше под
                // advisory-локом, лок снимается в finally НИЖЕ — то есть уже
                // после COMMIT/ROLLBACK, порядок сохранён.
                const reopened = await db.withTransaction(async (tx) => {
                    const pending = await AlertVerification.findPendingByChainId(reopenChainId, tx);
                    if (!pending) return null;
                    // [B-020] finalize-FIRST then markReopened — now atomic via
                    // the transaction (either both land or neither).
                    if (pending.original_alert_id) {
                        await this._finalizeAlertStatus(pending.original_alert_id, 'resolved', tx);
                    }
                    await AlertVerification.markReopened(pending.id, alertId, tx);
                    return pending;
                }, { client, context: 'alertVerificationService ALERT_REOPENED' });

                // Логи — после коммита: сообщать об изменении, которое может
                // быть откачено, нельзя.
                if (!reopened) {
                    logger.debug(`alertVerificationService: ALERT_REOPENED chain ${reopenChainId} has no pending verification`);
                } else {
                    logger.info(`alertVerificationService: verification ${reopened.id} → reopened (new alert_id=${alertId}, chain=${reopenChainId})`);
                }
            } finally {
                await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
                    logger.warn(`alertVerificationService: advisory_unlock failed: ${err.message}`);
                });
            }
        } catch (err) {
            logger.error(`alertVerificationService: ALERT_REOPENED handler failed: ${err.message}`);
        } finally {
            db.releaseClient(client);
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
// This is the FAST PATH of the "did a new alert appear?" reconciliation; the
// durable backstop is the window-expired _findSupersedingAlert check in
// _drainOne (B-021 W1), which re-derives the same outcome from DB state if
// this ephemeral event is ever lost (process crash between createAlert's emit
// and this handler).
//
// Fire-and-forget: errors are logged but don't propagate.
alertEvents.on(alertEvents.EVENTS.ALERT_REOPENED, (payload) => {
    void singleton._handleReopen(payload);
});

module.exports = singleton;
module.exports.AlertVerificationService = AlertVerificationService;
// [B-021] Exported so the system-path resolveAlert (alertService) can take the
// SAME advisory lock and serialise against the drain worker (PR3).
module.exports.ADVISORY_LOCK_KEY = ADVISORY_LOCK_KEY;
