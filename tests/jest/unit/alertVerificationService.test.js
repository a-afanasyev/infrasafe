// [Sprint 10 PR-2] alertVerificationService unit tests
jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/models/AlertVerification', () => ({
    pickDue: jest.fn(),
    markPassed: jest.fn(),
    markReopened: jest.fn(),
    markSuppressed: jest.fn(),
    markEngineerRequired: jest.fn(),
    markSkipped: jest.fn(),
    markDispatched: jest.fn(),
    countRecentReopensForChain: jest.fn(),
    findPendingByChainId: jest.fn()
}));

// [Sprint 10 PR-4] AlertSuppression model exists now — mock it so the
// verifier's conditional require picks up our test double. Default
// isActive=false so existing tests stay unaffected.
jest.mock('../../../src/models/AlertSuppression', () => ({
    isActive: jest.fn().mockResolvedValue(false)
}));

const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const AlertVerification = require('../../../src/models/AlertVerification');
const AlertSuppression = require('../../../src/models/AlertSuppression');
const alertEvents = require('../../../src/events/alertEvents');

// Require the service AFTER mocks are set up; use the class to avoid
// singleton state leak across tests.
const { AlertVerificationService } = require('../../../src/services/alertVerificationService');

describe('alertVerificationService', () => {
    let service;

    beforeEach(() => {
        jest.clearAllMocks();
        // jest.clearAllMocks() resets calls/results but does NOT drain
        // mockResolvedValueOnce queues. A test whose code path never
        // consumes its queued Once value (e.g. the quota=0 path skips
        // countRecentReopensForChain) leaks that value into the next test,
        // causing order-dependent failures. mockReset drains the queues.
        AlertVerification.pickDue.mockReset();
        AlertVerification.countRecentReopensForChain.mockReset();
        service = new AlertVerificationService();
    });

    afterEach(() => {
        // Defensive: stop any timers left around (start() doesn't apply
        // in unit tests because flag defaults to false, but be explicit)
        if (service._timer) clearInterval(service._timer);
        if (service._warmupTimer) clearTimeout(service._warmupTimer);
    });

    describe('isEnabled', () => {
        const originalEnv = process.env.ALERT_VERIFICATION_ENABLED;
        afterEach(() => {
            if (originalEnv === undefined) delete process.env.ALERT_VERIFICATION_ENABLED;
            else process.env.ALERT_VERIFICATION_ENABLED = originalEnv;
        });

        test('false by default (dormant)', () => {
            delete process.env.ALERT_VERIFICATION_ENABLED;
            expect(service.isEnabled()).toBe(false);
        });

        test('true when flag explicitly "true"', () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            expect(service.isEnabled()).toBe(true);
        });

        test('true when flag is "1"', () => {
            process.env.ALERT_VERIFICATION_ENABLED = '1';
            expect(service.isEnabled()).toBe(true);
        });

        test('false on any other value', () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'yes';
            expect(service.isEnabled()).toBe(false);
        });
    });

    describe('intervalMs', () => {
        const originalInterval = process.env.ALERT_VERIFICATION_TICK_MS;
        afterEach(() => {
            if (originalInterval === undefined) delete process.env.ALERT_VERIFICATION_TICK_MS;
            else process.env.ALERT_VERIFICATION_TICK_MS = originalInterval;
        });

        test('default 15000ms', () => {
            delete process.env.ALERT_VERIFICATION_TICK_MS;
            expect(service.intervalMs()).toBe(15000);
        });

        test('clamped to MIN 1000ms', () => {
            process.env.ALERT_VERIFICATION_TICK_MS = '50';
            expect(service.intervalMs()).toBe(1000);
        });

        test('clamped to MAX 300000ms', () => {
            process.env.ALERT_VERIFICATION_TICK_MS = '900000';
            expect(service.intervalMs()).toBe(300000);
        });

        test('honors valid value in range', () => {
            process.env.ALERT_VERIFICATION_TICK_MS = '5000';
            expect(service.intervalMs()).toBe(5000);
        });
    });

    describe('_tick — mutex + advisory lock', () => {
        test('skips when _running already true (no overlap)', async () => {
            service._running = true;
            await service._tick();
            // db.query should NOT be called (advisory_lock request)
            expect(db.query).not.toHaveBeenCalled();
        });

        test('exits quietly when advisory_lock returns false (other replica drained)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ locked: false }] });

            await service._tick();

            // Lock query was made, but no pickDue
            expect(AlertVerification.pickDue).not.toHaveBeenCalled();
        });

        test('runs drain when lock acquired, releases in finally', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ locked: true }] })   // acquire
                .mockResolvedValueOnce({ rows: [{ unlocked: true }] }); // release
            AlertVerification.pickDue.mockResolvedValueOnce(null);

            await service._tick();

            expect(AlertVerification.pickDue).toHaveBeenCalled();
            // First call was acquire, second call is release
            expect(db.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
        });

        test('releases lock even when drain throws', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ locked: true }] })
                .mockResolvedValueOnce({ rows: [{}] });
            AlertVerification.pickDue.mockRejectedValueOnce(new Error('DB down'));

            await service._tick();

            // Even with drain failure, unlock was called
            const unlockCall = db.query.mock.calls.find(c => c[0].includes('pg_advisory_unlock'));
            expect(unlockCall).toBeDefined();
            // _consecutiveFailures incremented
            expect(service._consecutiveFailures).toBe(1);
        });
    });

    describe('_drainOne decision tree', () => {
        // Helper: route db.query by SQL content so individual tests can set
        // up specific responses for _getReopenQuota without race with
        // lock/unlock calls. Lock+unlock always return the standard ack.
        const setupDbQueryRouter = (overrides = {}) => {
            db.query.mockImplementation((sql) => {
                if (sql.includes('pg_try_advisory_lock')) {
                    return Promise.resolve({ rows: [{ locked: true }] });
                }
                if (sql.includes('pg_advisory_unlock')) {
                    return Promise.resolve({ rows: [{}] });
                }
                if (sql.includes('max_reopens_per_24h')) {
                    return Promise.resolve({
                        rows: [{ quota: overrides.quota === undefined ? null : overrides.quota }]
                    });
                }
                return Promise.resolve({ rows: [] });
            });
        };

        const dueRow = {
            id: 1,
            original_alert_id: 21,
            reopen_chain_id: 'chain-uuid',
            reopen_sequence: 1,
            infrastructure_type: 'controller',
            infrastructure_id: 1,
            alert_type: 'LEAK_DETECTED',
            run_at: new Date(Date.now() - 1000).toISOString(),
            window_until: new Date(Date.now() + 60000).toISOString(), // 1 min in future
            attempts: 0
        };

        test('returns quietly when no row due', async () => {
            setupDbQueryRouter();
            AlertVerification.pickDue.mockResolvedValueOnce(null);

            await service._tick();

            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
        });

        test('markSkipped when window_until already passed AND never dispatched (attempts=0)', async () => {
            setupDbQueryRouter();
            const staleRow = {
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(), // 1 min ago
                attempts: 0
            };
            AlertVerification.pickDue.mockResolvedValueOnce(staleRow);

            await service._tick();

            expect(AlertVerification.markSkipped).toHaveBeenCalledWith(1, expect.stringContaining('window expired'));
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
        });

        test('[Sprint 10 PR-3] markPassed when window expired AND already dispatched (attempts>0, sensor recovered)', async () => {
            setupDbQueryRouter();
            const staleDispatchedRow = {
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1
            };
            AlertVerification.pickDue.mockResolvedValueOnce(staleDispatchedRow);

            await service._tick();

            expect(AlertVerification.markPassed).toHaveBeenCalledWith(1);
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('[Sprint 10 PR-3] returns quietly when attempts>0 and still in window (waiting for ALERT_REOPENED)', async () => {
            setupDbQueryRouter();
            const dispatchedRow = {
                ...dueRow,
                attempts: 1   // already dispatched
            };
            AlertVerification.pickDue.mockResolvedValueOnce(dispatchedRow);

            await service._tick();

            // No re-dispatch, no markPassed (window not expired yet)
            expect(AlertVerification.markDispatched).not.toHaveBeenCalled();
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('[Sprint 10 PR-3] bumps attempts via markDispatched after emit', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            expect(AlertVerification.markDispatched).toHaveBeenCalledWith(1);
        });

        test('emits VERIFY_LEAK for LEAK_DETECTED alert', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.VERIFY_LEAK, listener);

            await service._tick();

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                infraType: 'controller',
                infraId: 1,
                alertType: 'LEAK_DETECTED',
                bypassCooldown: true,
                reopenChainId: 'chain-uuid',
                reopenSequence: 2,
                originalAlertId: 21
            }));
        });

        test('emits VERIFY_TRANSFORMER for TRANSFORMER_OVERLOAD alert', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                alert_type: 'TRANSFORMER_OVERLOAD',
                infrastructure_type: 'transformer'
            });
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.VERIFY_TRANSFORMER, listener);

            await service._tick();

            expect(listener).toHaveBeenCalled();
        });

        test('markEngineerRequired when reopen quota exceeded', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(3); // hit quota

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED, listener);

            await service._tick();

            expect(AlertVerification.markEngineerRequired).toHaveBeenCalledWith(1);
            expect(listener).toHaveBeenCalledWith({
                reopenChainId: 'chain-uuid',
                lastAlertId: 21,
                reopenCount: 3
            });
        });

        test('markSkipped when alert_type has no VERIFY mapping', async () => {
            setupDbQueryRouter({ quota: null });
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                alert_type: 'UNKNOWN_TYPE'
            });
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            expect(AlertVerification.markSkipped).toHaveBeenCalledWith(1, expect.stringContaining('no VERIFY mapping'));
        });

        test('does not enforce quota when no rule exists (quota=0)', async () => {
            setupDbQueryRouter({ quota: 0 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.VERIFY_LEAK, listener);

            await service._tick();

            // No countRecentReopens call when quota=0
            expect(AlertVerification.countRecentReopensForChain).not.toHaveBeenCalled();
            expect(listener).toHaveBeenCalled();
        });

        // [Sprint 10 PR-4] Suppression-active path — the AlertSuppression
        // model now exists, so the conditional require hits a real
        // mockable module. When isActive=true, the verifier markSuppressed
        // and does NOT emit a VERIFY event.
        test('markSuppressed + no VERIFY emit when AlertSuppression.isActive=true', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertSuppression.isActive.mockResolvedValueOnce(true);

            const listener = jest.fn();
            alertEvents.on(alertEvents.EVENTS.VERIFY_LEAK, listener);

            await service._tick();
            alertEvents.off(alertEvents.EVENTS.VERIFY_LEAK, listener);

            expect(AlertSuppression.isActive).toHaveBeenCalledWith('controller', 1, 'LEAK_DETECTED');
            expect(AlertVerification.markSuppressed).toHaveBeenCalledWith(1);
            expect(listener).not.toHaveBeenCalled();
            // Quota check also skipped (return-early after suppression)
            expect(AlertVerification.countRecentReopensForChain).not.toHaveBeenCalled();
        });
    });

    // [B-020] Parent-alert status write-back. The verifier's terminal
    // outcomes must transition infrastructure_alerts.status OUT of the
    // transient 'resolved_verifying' state — otherwise the alert orphans
    // there forever (prod alerts 25, 26). Every mark* path must issue an
    // idempotent `UPDATE infrastructure_alerts SET status=$2 WHERE
    // alert_id=$1 AND status='resolved_verifying'`.
    describe('[B-020] parent-alert status write-back', () => {
        const setupDbQueryRouter = (overrides = {}) => {
            db.query.mockImplementation((sql) => {
                if (sql.includes('pg_try_advisory_lock')) {
                    return Promise.resolve({ rows: [{ locked: true }] });
                }
                if (sql.includes('pg_advisory_unlock')) {
                    return Promise.resolve({ rows: [{}] });
                }
                if (sql.includes('max_reopens_per_24h')) {
                    return Promise.resolve({
                        rows: [{ quota: overrides.quota === undefined ? null : overrides.quota }]
                    });
                }
                return Promise.resolve({ rows: [] });
            });
        };

        const baseRow = {
            id: 1,
            original_alert_id: 21,
            reopen_chain_id: 'chain-uuid',
            reopen_sequence: 1,
            infrastructure_type: 'controller',
            infrastructure_id: 1,
            alert_type: 'LEAK_DETECTED',
            run_at: new Date(Date.now() - 1000).toISOString(),
            window_until: new Date(Date.now() + 60000).toISOString(),
            attempts: 0
        };

        // Find the write-back UPDATE among all db.query calls.
        const findFinalizeCall = () =>
            db.query.mock.calls.find((c) => /UPDATE\s+infrastructure_alerts/i.test(c[0]));

        test('passed (window expired, dispatched) → alert status resolved', async () => {
            setupDbQueryRouter();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...baseRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1
            });

            await service._tick();

            const call = findFinalizeCall();
            expect(call).toBeDefined();
            // Idempotency guard — only flip rows still in the transient state
            expect(call[0]).toMatch(/status\s*=\s*'resolved_verifying'/);
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('skipped (window expired, never dispatched) → alert status resolved', async () => {
            setupDbQueryRouter();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...baseRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 0
            });

            await service._tick();

            const call = findFinalizeCall();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('engineer_required (quota exceeded) → alert status engineer_required', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(baseRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(3);

            await service._tick();

            const call = findFinalizeCall();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'engineer_required']);
        });

        test('suppressed → alert status resolved', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(baseRow);
            AlertSuppression.isActive.mockResolvedValueOnce(true);

            await service._tick();

            const call = findFinalizeCall();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('no VERIFY mapping (skipped) → alert status resolved', async () => {
            setupDbQueryRouter({ quota: null });
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...baseRow,
                alert_type: 'UNKNOWN_TYPE'
            });
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            const call = findFinalizeCall();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('happy path (VERIFY emitted, row still pending) does NOT finalize the alert', async () => {
            setupDbQueryRouter({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(baseRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            // Alert is still verifying — must NOT be closed yet.
            expect(findFinalizeCall()).toBeUndefined();
        });

        // [B-020 review] _finalizeAlertStatus guards + error handling.
        test('_finalizeAlertStatus returns early (no db.query) for falsy alertId', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await service._finalizeAlertStatus(null, 'resolved');
            await service._finalizeAlertStatus(0, 'resolved');
            await service._finalizeAlertStatus(undefined, 'resolved');

            expect(db.query).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        test('_finalizeAlertStatus swallows db errors (logs warn, does not throw)', async () => {
            db.query.mockRejectedValueOnce(new Error('connection timeout'));

            // Must not reject — the verification-row transition is the source
            // of truth and must not be blocked by a write-back hiccup.
            await expect(service._finalizeAlertStatus(21, 'resolved')).resolves.toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('finalize alert 21 → resolved failed')
            );
        });
    });

    // [Sprint 10 PR-3] ALERT_REOPENED listener wires the reconciliation:
    // when a checker creates a reopen alert via alertService.createAlert,
    // ALERT_REOPENED fires; this listener finds the matching pending
    // verification by chain_id and markReopened with the new alert_id.
    describe('ALERT_REOPENED listener', () => {
        test('markReopened on listener fire with matching chain_id', async () => {
            AlertVerification.findPendingByChainId.mockResolvedValueOnce({ id: 7 });

            alertEvents.emit(alertEvents.EVENTS.ALERT_REOPENED, {
                alertId: 200,
                reopenChainId: 'chain-uuid-listen',
                reopenSequence: 2,
                previousAlertId: 100
            });

            // Listener is async; wait a tick for the queued microtask.
            await new Promise((r) => setImmediate(r));

            expect(AlertVerification.findPendingByChainId).toHaveBeenCalledWith('chain-uuid-listen');
            expect(AlertVerification.markReopened).toHaveBeenCalledWith(7, 200);
        });

        // [B-020] When the reopen fires, the OLD alert (the one being
        // superseded) must leave 'resolved_verifying' → 'resolved'. The new
        // reopen alert (active) carries the fault forward.
        test('[B-020] markReopened also finalizes the OLD alert → resolved', async () => {
            db.query.mockResolvedValue({ rows: [] });
            AlertVerification.findPendingByChainId.mockResolvedValueOnce({
                id: 7,
                original_alert_id: 100
            });

            alertEvents.emit(alertEvents.EVENTS.ALERT_REOPENED, {
                alertId: 200,
                reopenChainId: 'chain-uuid-wb',
                reopenSequence: 2,
                previousAlertId: 100
            });

            await new Promise((r) => setImmediate(r));

            const call = db.query.mock.calls.find((c) => /UPDATE\s+infrastructure_alerts/i.test(c[0]));
            expect(call).toBeDefined();
            expect(call[0]).toMatch(/status\s*=\s*'resolved_verifying'/);
            expect(call[1]).toEqual([100, 'resolved']);
        });

        // [B-020 review — CRITICAL] The listener must finalize the OLD alert
        // BEFORE marking the verification reopened (finalize-first), matching
        // the crash-safe ordering in _drainOne. If markReopened ran first and
        // the process crashed before finalize, the verification leaves
        // 'pending' (pickDue never re-selects it) while the alert stays stuck
        // in 'resolved_verifying' forever — re-introducing B-020.
        test('[B-020] listener finalizes OLD alert BEFORE markReopened (crash-safe order)', async () => {
            db.query.mockResolvedValue({ rows: [] });
            AlertVerification.findPendingByChainId.mockResolvedValueOnce({
                id: 7,
                original_alert_id: 100
            });

            alertEvents.emit(alertEvents.EVENTS.ALERT_REOPENED, {
                alertId: 200,
                reopenChainId: 'chain-order',
                reopenSequence: 2,
                previousAlertId: 100
            });

            await new Promise((r) => setImmediate(r));

            const updateIdx = db.query.mock.calls.findIndex((c) => /UPDATE\s+infrastructure_alerts/i.test(c[0]));
            expect(updateIdx).toBeGreaterThanOrEqual(0);
            const finalizeOrder = db.query.mock.invocationCallOrder[updateIdx];
            const markReopenedOrder = AlertVerification.markReopened.mock.invocationCallOrder[0];
            expect(finalizeOrder).toBeLessThan(markReopenedOrder);
        });

        test('listener no-ops when no pending verification matches', async () => {
            AlertVerification.findPendingByChainId.mockResolvedValueOnce(null);

            alertEvents.emit(alertEvents.EVENTS.ALERT_REOPENED, {
                alertId: 201,
                reopenChainId: 'orphan-chain',
                reopenSequence: 2
            });

            await new Promise((r) => setImmediate(r));

            expect(AlertVerification.markReopened).not.toHaveBeenCalled();
        });

        test('listener tolerates missing payload fields', async () => {
            // Emit with missing alertId — should log warn and bail
            alertEvents.emit(alertEvents.EVENTS.ALERT_REOPENED, { reopenChainId: 'only-chain' });
            await new Promise((r) => setImmediate(r));
            expect(AlertVerification.findPendingByChainId).not.toHaveBeenCalled();
        });
    });

    describe('start/stop lifecycle', () => {
        const originalEnv = process.env.ALERT_VERIFICATION_ENABLED;
        afterEach(() => {
            if (originalEnv === undefined) delete process.env.ALERT_VERIFICATION_ENABLED;
            else process.env.ALERT_VERIFICATION_ENABLED = originalEnv;
        });

        test('start is no-op when disabled', async () => {
            delete process.env.ALERT_VERIFICATION_ENABLED;
            service.start();
            expect(service._timer).toBeNull();
            await service.stop();
        });

        test('start creates timers when enabled, stop clears them', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            service.start();
            expect(service._timer).not.toBeNull();
            expect(service._warmupTimer).not.toBeNull();
            await service.stop();
            expect(service._timer).toBeNull();
        });

        test('duplicate start is rejected with warning', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            service.start();
            service.start();
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already started'));
            await service.stop();
        });
    });
});
