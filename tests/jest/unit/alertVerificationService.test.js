// [Sprint 10 PR-2] alertVerificationService unit tests
// [B-021] Worker drain is now client-scoped: _tick checks out one client via
// db.getPool().connect(), takes the advisory lock on it, and _drainOne wraps
// pick + finalize + mark* in BEGIN/COMMIT on that same client. Tests for the
// drain path therefore assert on the CLIENT mock (db.__mockClient.query), not
// db.query. The ALERT_REOPENED listener + standalone _finalizeAlertStatus are
// still pool-based (executor === db) and assert on db.query.
jest.mock('../../../src/config/database', () => {
    const mockClient = { query: jest.fn(), release: jest.fn() };
    const mockPool = { connect: jest.fn(() => Promise.resolve(mockClient)) };
    return {
        query: jest.fn(),
        getPool: jest.fn(() => mockPool),
        __mockClient: mockClient,
        __mockPool: mockPool
    };
});

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
        // clearAllMocks resets calls but NOT mockImplementation / Once queues.
        // Reset the routers + the query mocks so a previous test's impl can't
        // leak in (order-dependent failures).
        AlertVerification.pickDue.mockReset();
        AlertVerification.countRecentReopensForChain.mockReset();
        // Drain mockResolvedValueOnce queues too — a test whose lock-denied /
        // early-return path never consumes a queued Once would otherwise leak
        // it into the next test (order-dependent failures).
        AlertVerification.findPendingByChainId.mockReset();
        AlertVerification.markReopened.mockReset();
        db.query.mockReset();
        db.__mockClient.query.mockReset();
        db.__mockClient.release.mockClear();
        // connect() keeps its factory impl (returns the shared mock client);
        // mockClear keeps the impl, only clears call history.
        db.__mockPool.connect.mockClear();
        service = new AlertVerificationService();
    });

    afterEach(() => {
        if (service._timer) clearInterval(service._timer);
        if (service._warmupTimer) clearTimeout(service._warmupTimer);
    });

    // Route the CLIENT query mock by SQL content (lock/unlock/txn/quota/etc).
    const routeClient = (overrides = {}) => {
        db.__mockClient.query.mockImplementation((sql) => {
            if (/pg_try_advisory_lock/.test(sql)) {
                return Promise.resolve({ rows: [{ locked: overrides.locked !== false }] });
            }
            if (/pg_advisory_unlock/.test(sql)) return Promise.resolve({ rows: [{}] });
            if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return Promise.resolve({ rows: [] });
            if (/max_reopens_per_24h/.test(sql)) {
                return Promise.resolve({ rows: [{ quota: overrides.quota === undefined ? null : overrides.quota }] });
            }
            if (/previous_uk_request_number/.test(sql)) {
                return Promise.resolve({ rows: [{ previous_uk_request_number: null }] });
            }
            // [B-021 W1] superseding-alert lookup in the reopen chain.
            if (/SELECT\s+alert_id\s+FROM\s+infrastructure_alerts/i.test(sql)) {
                return Promise.resolve({ rows: overrides.superseding ? [{ alert_id: overrides.superseding }] : [] });
            }
            if (/UPDATE\s+infrastructure_alerts/i.test(sql)) return Promise.resolve({ rows: [] });
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
        window_until: new Date(Date.now() + 60000).toISOString(),
        attempts: 0
    };

    const clientCalls = () => db.__mockClient.query.mock.calls.map((c) => c[0]);
    const findClientFinalize = () =>
        db.__mockClient.query.mock.calls.find((c) => /UPDATE\s+infrastructure_alerts/i.test(c[0]));

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

    describe('[B-021] _tick — client-scoped lock + lifecycle', () => {
        test('skips when _running already true (no checkout)', async () => {
            service._running = true;
            await service._tick();
            expect(db.getPool).not.toHaveBeenCalled();
            expect(db.__mockPool.connect).not.toHaveBeenCalled();
        });

        test('checks out exactly one client and releases it', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null);

            await service._tick();

            expect(db.__mockPool.connect).toHaveBeenCalledTimes(1);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
        });

        test('acquire AND unlock issued on the SAME client', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null);

            await service._tick();

            const calls = clientCalls();
            expect(calls.some((s) => /pg_try_advisory_lock/.test(s))).toBe(true);
            expect(calls.some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
            // db.query (pool wrapper) must NOT be used for the lock anymore.
            expect(db.query).not.toHaveBeenCalled();
        });

        test('exits quietly + releases client when advisory lock denied (other replica)', async () => {
            routeClient({ locked: false });

            await service._tick();

            expect(AlertVerification.pickDue).not.toHaveBeenCalled();
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
            // No BEGIN when lock not acquired.
            expect(clientCalls().some((s) => /^\s*BEGIN/.test(s))).toBe(false);
        });

        test('releases client + unlock even when drain throws; records failure', async () => {
            routeClient();
            AlertVerification.pickDue.mockRejectedValueOnce(new Error('DB down'));

            await service._tick();

            expect(clientCalls().some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
            expect(service._consecutiveFailures).toBe(1);
        });

        test('records failure + no client release when connect() throws', async () => {
            db.__mockPool.connect.mockRejectedValueOnce(new Error('pool exhausted'));

            await service._tick();

            expect(service._consecutiveFailures).toBe(1);
            expect(db.__mockClient.release).not.toHaveBeenCalled();
            expect(service._running).toBe(false);
        });
    });

    describe('[B-021] _drainOne transaction + emit ordering', () => {
        test('wraps the drain in BEGIN…COMMIT on the client', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null);

            await service._tick();

            const calls = clientCalls();
            expect(calls.some((s) => /^\s*BEGIN/.test(s))).toBe(true);
            expect(calls.some((s) => /^\s*COMMIT/.test(s))).toBe(true);
            expect(calls.some((s) => /^\s*ROLLBACK/.test(s))).toBe(false);
        });

        test('ROLLBACK (not COMMIT) when a write throws mid-drain', async () => {
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);
            AlertVerification.markDispatched.mockRejectedValueOnce(new Error('write fail'));

            await service._tick();

            const calls = clientCalls();
            expect(calls.some((s) => /^\s*ROLLBACK/.test(s))).toBe(true);
            expect(calls.some((s) => /^\s*COMMIT/.test(s))).toBe(false);
            expect(service._consecutiveFailures).toBe(1);
        });

        test('finalize failure inside txn → ROLLBACK, mark* NOT applied (row stays pending)', async () => {
            db.__mockClient.query.mockImplementation((sql) => {
                if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
                if (/pg_advisory_unlock/.test(sql)) return Promise.resolve({ rows: [{}] });
                if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return Promise.resolve({ rows: [] });
                if (/UPDATE\s+infrastructure_alerts/i.test(sql)) return Promise.reject(new Error('finalize boom'));
                return Promise.resolve({ rows: [] });
            });
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1
            });

            await service._tick();

            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
            expect(clientCalls().some((s) => /^\s*ROLLBACK/.test(s))).toBe(true);
        });

        test('VERIFY_* emitted only AFTER COMMIT', async () => {
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);
            const emitSpy = jest.spyOn(alertEvents, 'emit');

            await service._tick();

            const commitIdx = db.__mockClient.query.mock.calls.findIndex((c) => /^\s*COMMIT/.test(c[0]));
            const commitOrder = db.__mockClient.query.mock.invocationCallOrder[commitIdx];
            const emitIdx = emitSpy.mock.calls.findIndex((c) => c[0] === alertEvents.EVENTS.VERIFY_LEAK);
            const emitOrder = emitSpy.mock.invocationCallOrder[emitIdx];

            expect(commitIdx).toBeGreaterThanOrEqual(0);
            expect(emitIdx).toBeGreaterThanOrEqual(0);
            expect(emitOrder).toBeGreaterThan(commitOrder);
            emitSpy.mockRestore();
        });

        test('pickDue is invoked with the transaction client (executor)', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null);

            await service._tick();

            expect(AlertVerification.pickDue).toHaveBeenCalledWith(db.__mockClient);
        });
    });

    describe('_drainOne decision tree', () => {
        test('returns quietly when no row due', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null);

            await service._tick();

            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
        });

        test('markSkipped when window_until already passed AND never dispatched (attempts=0)', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 0
            });

            await service._tick();

            expect(AlertVerification.markSkipped).toHaveBeenCalledWith(1, expect.stringContaining('window expired'), db.__mockClient);
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
        });

        test('[Sprint 10 PR-3] markPassed when window expired AND already dispatched (attempts>0)', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1
            });

            await service._tick();

            expect(AlertVerification.markPassed).toHaveBeenCalledWith(1, db.__mockClient);
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('[Sprint 10 PR-3] returns quietly when attempts>0 and still in window', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({ ...dueRow, attempts: 1 });

            await service._tick();

            expect(AlertVerification.markDispatched).not.toHaveBeenCalled();
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('[Sprint 10 PR-3] bumps attempts via markDispatched after emit', async () => {
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            expect(AlertVerification.markDispatched).toHaveBeenCalledWith(1, db.__mockClient);
        });

        test('emits VERIFY_LEAK for LEAK_DETECTED alert', async () => {
            routeClient({ quota: 3 });
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
            routeClient({ quota: 3 });
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
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(3);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED, listener);

            await service._tick();

            expect(AlertVerification.markEngineerRequired).toHaveBeenCalledWith(1, db.__mockClient);
            expect(listener).toHaveBeenCalledWith({
                reopenChainId: 'chain-uuid',
                lastAlertId: 21,
                reopenCount: 3
            });
        });

        test('markSkipped when alert_type has no VERIFY mapping', async () => {
            routeClient({ quota: null });
            AlertVerification.pickDue.mockResolvedValueOnce({ ...dueRow, alert_type: 'UNKNOWN_TYPE' });
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            expect(AlertVerification.markSkipped).toHaveBeenCalledWith(1, expect.stringContaining('no VERIFY mapping'), db.__mockClient);
        });

        test('does not enforce quota when no rule exists (quota=0)', async () => {
            routeClient({ quota: 0 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.VERIFY_LEAK, listener);

            await service._tick();

            expect(AlertVerification.countRecentReopensForChain).not.toHaveBeenCalled();
            expect(listener).toHaveBeenCalled();
        });

        test('markSuppressed + no VERIFY emit when AlertSuppression.isActive=true', async () => {
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(dueRow);
            AlertSuppression.isActive.mockResolvedValueOnce(true);

            const listener = jest.fn();
            alertEvents.on(alertEvents.EVENTS.VERIFY_LEAK, listener);

            await service._tick();
            alertEvents.off(alertEvents.EVENTS.VERIFY_LEAK, listener);

            expect(AlertSuppression.isActive).toHaveBeenCalledWith('controller', 1, 'LEAK_DETECTED');
            expect(AlertVerification.markSuppressed).toHaveBeenCalledWith(1, db.__mockClient);
            expect(listener).not.toHaveBeenCalled();
            expect(AlertVerification.countRecentReopensForChain).not.toHaveBeenCalled();
        });
    });

    // [B-021 W1] Reopen reconciliation from durable DB state. When the window
    // expired but a later alert exists in the same reopen_chain_id, the
    // ephemeral ALERT_REOPENED event was lost — record the reopen from the DB
    // instead of blindly marking passed.
    describe('[B-021 W1] reopen reconciliation from DB', () => {
        const expiredDispatched = {
            ...dueRow,
            window_until: new Date(Date.now() - 60000).toISOString(),
            attempts: 1
        };

        test('superseding alert in chain → markReopened (NOT markPassed) + finalize resolved', async () => {
            routeClient({ superseding: 99 });
            AlertVerification.pickDue.mockResolvedValueOnce(expiredDispatched);

            await service._tick();

            expect(AlertVerification.markReopened).toHaveBeenCalledWith(1, 99, db.__mockClient);
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
            const call = findClientFinalize();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('no superseding alert → markPassed (unchanged behaviour)', async () => {
            routeClient(); // superseding undefined → lookup returns []
            AlertVerification.pickDue.mockResolvedValueOnce(expiredDispatched);

            await service._tick();

            expect(AlertVerification.markPassed).toHaveBeenCalledWith(1, db.__mockClient);
            expect(AlertVerification.markReopened).not.toHaveBeenCalled();
        });

        test('reconciliation applies to attempts=0 expired branch too (superseding → reopened)', async () => {
            routeClient({ superseding: 77 });
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 0
            });

            await service._tick();

            expect(AlertVerification.markReopened).toHaveBeenCalledWith(1, 77, db.__mockClient);
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('_findSupersedingAlert returns null for falsy chain id (no query)', async () => {
            const r = await service._findSupersedingAlert(null, 1, db.__mockClient);
            expect(r).toBeNull();
            expect(db.__mockClient.query).not.toHaveBeenCalled();
        });
    });

    // [B-020] Parent-alert status write-back. The verifier's terminal
    // outcomes must transition infrastructure_alerts.status OUT of the
    // transient 'resolved_verifying' state — now atomically with the
    // verification mark* inside the drain transaction (on the client).
    describe('[B-020] parent-alert status write-back', () => {
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

        test('passed (window expired, dispatched) → alert status resolved', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...baseRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1
            });

            await service._tick();

            const call = findClientFinalize();
            expect(call).toBeDefined();
            expect(call[0]).toMatch(/status\s*=\s*'resolved_verifying'/);
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('skipped (window expired, never dispatched) → alert status resolved', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...baseRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 0
            });

            await service._tick();

            const call = findClientFinalize();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('engineer_required (quota exceeded) → alert status engineer_required', async () => {
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(baseRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(3);

            await service._tick();

            const call = findClientFinalize();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'engineer_required']);
        });

        test('suppressed → alert status resolved', async () => {
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(baseRow);
            AlertSuppression.isActive.mockResolvedValueOnce(true);

            await service._tick();

            const call = findClientFinalize();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('no VERIFY mapping (skipped) → alert status resolved', async () => {
            routeClient({ quota: null });
            AlertVerification.pickDue.mockResolvedValueOnce({ ...baseRow, alert_type: 'UNKNOWN_TYPE' });
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            const call = findClientFinalize();
            expect(call).toBeDefined();
            expect(call[1]).toEqual([21, 'resolved']);
        });

        test('happy path (VERIFY emitted, row still pending) does NOT finalize the alert', async () => {
            routeClient({ quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce(baseRow);
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(0);

            await service._tick();

            expect(findClientFinalize()).toBeUndefined();
        });

        // _finalizeAlertStatus standalone (executor === db, pool wrapper):
        // legacy/non-txn semantics — swallow on error, never throw.
        test('_finalizeAlertStatus returns early (no query) for falsy alertId', async () => {
            await service._finalizeAlertStatus(null, 'resolved');
            await service._finalizeAlertStatus(0, 'resolved');
            await service._finalizeAlertStatus(undefined, 'resolved');

            expect(db.query).not.toHaveBeenCalled();
            expect(db.__mockClient.query).not.toHaveBeenCalled();
            expect(logger.warn).not.toHaveBeenCalled();
        });

        test('_finalizeAlertStatus swallows db errors on the pool path (logs warn, no throw)', async () => {
            db.query.mockRejectedValueOnce(new Error('connection timeout'));

            await expect(service._finalizeAlertStatus(21, 'resolved')).resolves.toBeUndefined();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('finalize alert 21 → resolved failed')
            );
        });

        test('[B-021] _finalizeAlertStatus PROPAGATES on the transaction path (executor=client)', async () => {
            const client = { query: jest.fn().mockRejectedValueOnce(new Error('boom')) };

            await expect(service._finalizeAlertStatus(21, 'resolved', client)).rejects.toThrow('boom');
        });
    });

    // [B-021] ALERT_REOPENED handler — now client-scoped + advisory-locked +
    // transactional. Behaviour tested via service._handleReopen directly
    // (deterministic); one emit-wiring test confirms the listener calls it.
    describe('[B-021] ALERT_REOPENED handler (_handleReopen)', () => {
        test('emit wiring: listener invokes the handler (findPendingByChainId called)', async () => {
            routeClient();
            AlertVerification.findPendingByChainId.mockResolvedValueOnce({ id: 7, original_alert_id: 100 });

            alertEvents.emit(alertEvents.EVENTS.ALERT_REOPENED, {
                alertId: 200,
                reopenChainId: 'chain-wiring',
                reopenSequence: 2,
                previousAlertId: 100
            });
            await new Promise((r) => setImmediate(r));

            expect(AlertVerification.findPendingByChainId).toHaveBeenCalledWith('chain-wiring', db.__mockClient);
        });

        test('markReopened on matching chain_id, on the locked client', async () => {
            routeClient();
            AlertVerification.findPendingByChainId.mockResolvedValueOnce({ id: 7, original_alert_id: 100 });

            await service._handleReopen({ alertId: 200, reopenChainId: 'chain-uuid-listen' });

            expect(AlertVerification.markReopened).toHaveBeenCalledWith(7, 200, db.__mockClient);
            // lock + unlock on the client; wrapped in a transaction.
            const calls = clientCalls();
            expect(calls.some((s) => /pg_try_advisory_lock/.test(s))).toBe(true);
            expect(calls.some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
            expect(calls.some((s) => /^\s*COMMIT/.test(s))).toBe(true);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
        });

        test('[B-020] finalizes the OLD alert → resolved BEFORE markReopened', async () => {
            routeClient();
            AlertVerification.findPendingByChainId.mockResolvedValueOnce({ id: 7, original_alert_id: 100 });

            await service._handleReopen({ alertId: 200, reopenChainId: 'chain-order' });

            const call = findClientFinalize();
            expect(call).toBeDefined();
            expect(call[0]).toMatch(/status\s*=\s*'resolved_verifying'/);
            expect(call[1]).toEqual([100, 'resolved']);

            const updateIdx = db.__mockClient.query.mock.calls.findIndex((c) => /UPDATE\s+infrastructure_alerts/i.test(c[0]));
            const finalizeOrder = db.__mockClient.query.mock.invocationCallOrder[updateIdx];
            const markReopenedOrder = AlertVerification.markReopened.mock.invocationCallOrder[0];
            expect(finalizeOrder).toBeLessThan(markReopenedOrder);
        });

        test('lock busy → skips (no writes); reconciliation is the backstop', async () => {
            routeClient({ locked: false });

            await service._handleReopen({ alertId: 200, reopenChainId: 'chain-busy' });

            expect(AlertVerification.findPendingByChainId).not.toHaveBeenCalled();
            expect(AlertVerification.markReopened).not.toHaveBeenCalled();
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
        });

        test('no pending verification → COMMIT, no markReopened, client released', async () => {
            routeClient();
            AlertVerification.findPendingByChainId.mockResolvedValueOnce(null);

            await service._handleReopen({ alertId: 201, reopenChainId: 'orphan-chain' });

            expect(AlertVerification.markReopened).not.toHaveBeenCalled();
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
        });

        test('tolerates missing payload fields (no checkout)', async () => {
            await service._handleReopen({ reopenChainId: 'only-chain' });
            expect(db.__mockPool.connect).not.toHaveBeenCalled();
            expect(AlertVerification.findPendingByChainId).not.toHaveBeenCalled();
        });

        test('markReopened failure → ROLLBACK, unlock, release, no throw', async () => {
            routeClient();
            AlertVerification.findPendingByChainId.mockResolvedValueOnce({ id: 7, original_alert_id: 100 });
            AlertVerification.markReopened.mockRejectedValueOnce(new Error('write fail'));

            await expect(service._handleReopen({ alertId: 200, reopenChainId: 'chain-fail' })).resolves.toBeUndefined();

            const calls = clientCalls();
            expect(calls.some((s) => /^\s*ROLLBACK/.test(s))).toBe(true);
            expect(calls.some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
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
