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
        safeRollback: jest.requireActual('../../../src/config/database').safeRollback,
        releaseClient: jest.requireActual('../../../src/config/database').releaseClient,
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
    markChecked: jest.fn(),
    countRecentReopensForChain: jest.fn(),
    findPendingByChainId: jest.fn(),
    // [AUD-001 PR-C] engineer-sweep + ack helpers
    pickUnnotifiedEngineer: jest.fn(),
    deferEngineerNotifications: jest.fn(),
    markUkNotified: jest.fn()
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
        // [AUD-001 PR-C] sweep runs every tick after the drain — default to an
        // empty working set so existing drain tests are unaffected.
        AlertVerification.pickUnnotifiedEngineer.mockReset();
        AlertVerification.pickUnnotifiedEngineer.mockResolvedValue([]);
        AlertVerification.deferEngineerNotifications.mockReset();
        AlertVerification.deferEngineerNotifications.mockResolvedValue(0);
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
            // [AUD-001 PR-B Step 5b] engineer branch SELECTs the full alert row.
            if (/SELECT\s+\*\s+FROM\s+infrastructure_alerts\s+WHERE\s+alert_id/i.test(sql)) {
                return Promise.resolve({ rows: [overrides.alertRow || { alert_id: 21, type: 'LEAK_DETECTED', severity: 'CRITICAL', infrastructure_type: 'controller', infrastructure_id: 1 }] });
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

        test('[Sprint 10 PR-3 + AUD-001] markPassed when window expired, dispatched AND checked (last_checked_at set)', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1,
                last_checked_at: new Date().toISOString()  // checker really ran
            });

            await service._tick();

            expect(AlertVerification.markPassed).toHaveBeenCalledWith(1, db.__mockClient);
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('[AUD-001] window expired, dispatched but NEVER checked (last_checked_at NULL) → skipped, not passed', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1,
                last_checked_at: null  // dispatched but the checker never completed
            });

            await service._tick();

            expect(AlertVerification.markSkipped).toHaveBeenCalledWith(1, 'dispatched but checker never completed', db.__mockClient);
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
        });

        test('[AUD-001 PR-C] RE-dispatches when attempts>0 and still in window (durable re-emit, no superseding/suppression/quota)', async () => {
            routeClient(); // quota null → no quota; no superseding; not suppressed
            AlertVerification.pickDue.mockResolvedValueOnce({ ...dueRow, attempts: 1 });

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.VERIFY_LEAK, listener);

            await service._tick();

            // PR-C drops the single-dispatch guard: an in-window dispatched row is
            // re-emitted (the previous emit may have been lost). next_dispatch_at
            // throttles the cadence; reconcile-first protects against double reopen.
            expect(AlertVerification.markDispatched).toHaveBeenCalledWith(1, db.__mockClient);
            expect(listener).toHaveBeenCalled();
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('[AUD-001 PR-C] reconcile-first on retry: attempts>0 in-window + superseding chain alert → markReopened, NO re-dispatch/suppression/quota', async () => {
            routeClient({ superseding: 55, quota: 3 });
            AlertVerification.pickDue.mockResolvedValueOnce({ ...dueRow, attempts: 1 });

            await service._tick();

            expect(AlertVerification.markReopened).toHaveBeenCalledWith(1, 55, db.__mockClient);
            expect(AlertVerification.markDispatched).not.toHaveBeenCalled();
            expect(AlertVerification.markSuppressed).not.toHaveBeenCalled();
            expect(AlertVerification.markEngineerRequired).not.toHaveBeenCalled();
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
            // [AUD-001 PR-B Step 5b] payload now carries alertData + alertId +
            // verificationId so the forwarder can match a rule, resolve
            // buildings, and build the deterministic event_id.
            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                alertData: expect.objectContaining({ alert_id: 21 }),
                alertId: 21,
                verificationId: 1,
                reopenChainId: 'chain-uuid',
                reopenCount: 3
            }));
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
            attempts: 1,
            last_checked_at: new Date().toISOString()  // [AUD-001] checked → eligible for 'passed'
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

        test('_findSupersedingAlert returns {outcome:none} for falsy chain id (no query)', async () => {
            const r = await service._findSupersedingAlert({ reopen_chain_id: null }, db.__mockClient);
            expect(r).toEqual({ outcome: 'none' });
            expect(db.__mockClient.query).not.toHaveBeenCalled();
        });
    });

    // [AUD-001 PR-B Step 5] Fallback + adoption: telemetry during grace creates
    // a chain-less alert of the same (infra, type) that the VERIFY-path reopen
    // couldn't insert (dedup). Adopt it into the chain so the quota stays right.
    describe('[AUD-001 PR-B Step 5] superseding fallback + adoption', () => {
        const expired = {
            ...dueRow,
            created_at: new Date(Date.now() - 120000).toISOString(),
            window_until: new Date(Date.now() - 60000).toISOString(),
            attempts: 1,
            last_checked_at: new Date().toISOString()
        };

        // Routes: chain SELECT (no chain match) → fallback SELECT (a chain-less
        // alert) → adoption UPDATE (RETURNING). `adoptReturns` controls whether
        // we win the adoption; `rereadChain` is the chain on lost-race re-read.
        const routeFallback = ({ fallbackId, adoptWon = true, rereadChain }) => {
            let sawChainSelect = false;
            db.__mockClient.query.mockImplementation((sql) => {
                if (/pg_try_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{ locked: true }] });
                if (/pg_advisory_unlock/.test(sql)) return Promise.resolve({ rows: [{}] });
                if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return Promise.resolve({ rows: [] });
                // First "SELECT alert_id" = chain match (empty); second = fallback.
                if (/SELECT\s+alert_id\s+FROM\s+infrastructure_alerts/i.test(sql)) {
                    if (!sawChainSelect) { sawChainSelect = true; return Promise.resolve({ rows: [] }); }
                    return Promise.resolve({ rows: fallbackId ? [{ alert_id: fallbackId }] : [] });
                }
                if (/UPDATE\s+infrastructure_alerts\s+SET\s+reopen_chain_id/i.test(sql)) {
                    return Promise.resolve({ rows: adoptWon ? [{ alert_id: fallbackId }] : [] });
                }
                if (/SELECT\s+reopen_chain_id\s+FROM\s+infrastructure_alerts/i.test(sql)) {
                    return Promise.resolve({ rows: [{ reopen_chain_id: rereadChain }] });
                }
                if (/UPDATE\s+infrastructure_alerts/i.test(sql)) return Promise.resolve({ rows: [] }); // finalize
                return Promise.resolve({ rows: [] });
            });
        };

        test('chain-less alert in window → adopted (UPDATE) + markReopened', async () => {
            routeFallback({ fallbackId: 88, adoptWon: true });
            AlertVerification.pickDue.mockResolvedValueOnce(expired);

            await service._tick();

            const adoptCall = db.__mockClient.query.mock.calls.find((c) => /UPDATE\s+infrastructure_alerts\s+SET\s+reopen_chain_id/i.test(c[0]));
            expect(adoptCall).toBeDefined();
            expect(AlertVerification.markReopened).toHaveBeenCalledWith(1, 88, db.__mockClient);
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
        });

        test('chain-less alert OUTSIDE window → not adopted → passed (checked)', async () => {
            // Fallback SELECT returns [] because created_at>window_until is in the
            // SQL predicate; emulate by returning no fallback row.
            routeFallback({ fallbackId: null });
            AlertVerification.pickDue.mockResolvedValueOnce(expired);

            await service._tick();

            expect(AlertVerification.markReopened).not.toHaveBeenCalled();
            expect(AlertVerification.markPassed).toHaveBeenCalledWith(1, db.__mockClient);
        });

        test('lost adoption race into a DIFFERENT chain → conflict → markSkipped (not passed)', async () => {
            routeFallback({ fallbackId: 88, adoptWon: false, rereadChain: 'some-other-chain' });
            AlertVerification.pickDue.mockResolvedValueOnce(expired);

            await service._tick();

            expect(AlertVerification.markReopened).not.toHaveBeenCalled();
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
            expect(AlertVerification.markSkipped).toHaveBeenCalledWith(1, expect.stringContaining('adoption conflict'), db.__mockClient);
        });

        test('lost adoption race but into OUR chain → still markReopened', async () => {
            routeFallback({ fallbackId: 88, adoptWon: false, rereadChain: 'chain-uuid' });
            AlertVerification.pickDue.mockResolvedValueOnce(expired);

            await service._tick();

            expect(AlertVerification.markReopened).toHaveBeenCalledWith(1, 88, db.__mockClient);
        });

        test('transformer family match: fallback SELECT uses both TRANSFORMER_* types', async () => {
            routeFallback({ fallbackId: 88, adoptWon: true });
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...expired, alert_type: 'TRANSFORMER_CRITICAL_OVERLOAD'
            });

            await service._tick();

            const fallbackCall = db.__mockClient.query.mock.calls.find(
                (c) => /SELECT\s+alert_id\s+FROM\s+infrastructure_alerts/i.test(c[0]) && /type = ANY/i.test(c[0])
            );
            expect(fallbackCall).toBeDefined();
            expect(fallbackCall[1]).toContainEqual(['TRANSFORMER_OVERLOAD', 'TRANSFORMER_CRITICAL_OVERLOAD']);
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

    // [AUD-001 PR-C] Dispatch-lease gate: while dispatch_lease_until is in the
    // future a (possibly slow) checker may still create a reopen that must bind
    // to this pending row — so ANY terminalisation is deferred (next_dispatch_at
    // pushed to the lease end) rather than executed.
    describe('[AUD-001 PR-C] dispatch-lease gate', () => {
        const findClientDefer = () =>
            db.__mockClient.query.mock.calls.find((c) =>
                /UPDATE\s+alert_verifications\s+SET\s+next_dispatch_at\s*=\s*dispatch_lease_until/i.test(c[0]));

        const leaseFuture = () => new Date(Date.now() + 120000).toISOString();
        const leasePast = () => new Date(Date.now() - 1000).toISOString();

        test('window expired + lease ACTIVE → defer (next_dispatch_at=lease), NOT passed/skipped', async () => {
            routeClient(); // no superseding
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1,
                last_checked_at: new Date().toISOString(),
                dispatch_lease_until: leaseFuture()
            });

            await service._tick();

            expect(findClientDefer()).toBeDefined();
            expect(AlertVerification.markPassed).not.toHaveBeenCalled();
            expect(AlertVerification.markSkipped).not.toHaveBeenCalled();
        });

        test('window expired + lease EXPIRED + checked → passed (terminalises normally)', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow,
                window_until: new Date(Date.now() - 60000).toISOString(),
                attempts: 1,
                last_checked_at: new Date().toISOString(),
                dispatch_lease_until: leasePast()
            });

            await service._tick();

            expect(findClientDefer()).toBeUndefined();
            expect(AlertVerification.markPassed).toHaveBeenCalledWith(1, db.__mockClient);
        });

        test('in-window suppression + lease ACTIVE → defer, NOT suppressed', async () => {
            routeClient({ quota: 3 });
            AlertSuppression.isActive.mockResolvedValueOnce(true);
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow, attempts: 1, dispatch_lease_until: leaseFuture()
            });

            await service._tick();

            expect(findClientDefer()).toBeDefined();
            expect(AlertVerification.markSuppressed).not.toHaveBeenCalled();
        });

        test('in-window quota hit + lease ACTIVE → defer, NOT engineer_required', async () => {
            routeClient({ quota: 3 });
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(3);
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow, attempts: 1, dispatch_lease_until: leaseFuture()
            });

            await service._tick();

            expect(findClientDefer()).toBeDefined();
            expect(AlertVerification.markEngineerRequired).not.toHaveBeenCalled();
        });

        test('in-window quota hit + lease EXPIRED → engineer_required (terminalises)', async () => {
            routeClient({ quota: 3 });
            AlertVerification.countRecentReopensForChain.mockResolvedValueOnce(3);
            AlertVerification.pickDue.mockResolvedValueOnce({
                ...dueRow, attempts: 1, dispatch_lease_until: leasePast()
            });

            await service._tick();

            expect(findClientDefer()).toBeUndefined();
            expect(AlertVerification.markEngineerRequired).toHaveBeenCalledWith(1, db.__mockClient);
        });
    });

    // [AUD-001 PR-C] Engineer-escalation sweep — at-least-once (re)delivery of
    // ALERT_ENGINEER_REQUIRED for engineer_required rows UK hasn't acked.
    describe('[AUD-001 PR-C] engineer-escalation sweep', () => {
        test('picks unnotified engineer rows, defers them, emits ALERT_ENGINEER_REQUIRED with alertData', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null); // no due verification — isolate the sweep
            AlertVerification.pickUnnotifiedEngineer.mockResolvedValueOnce([
                { id: 9, original_alert_id: 21, reopen_chain_id: 'chain-eng' }
            ]);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED, listener);

            await service._tick();

            // fair-rotation defer BEFORE emit (300s), under the lock
            expect(AlertVerification.deferEngineerNotifications).toHaveBeenCalledWith([9], 300, db.__mockClient);
            // emit carries the alertData (forwarder needs it) + verificationId
            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                alertData: expect.objectContaining({ alert_id: 21 }),
                alertId: 21,
                verificationId: 9
            }));
        });

        test('no unnotified engineer rows → no defer, no emit', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null);
            AlertVerification.pickUnnotifiedEngineer.mockResolvedValueOnce([]);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED, listener);

            await service._tick();

            expect(AlertVerification.deferEngineerNotifications).not.toHaveBeenCalled();
            expect(listener).not.toHaveBeenCalled();
        });

        test('sweep emit happens AFTER the advisory lock is released', async () => {
            routeClient();
            AlertVerification.pickDue.mockResolvedValueOnce(null);
            AlertVerification.pickUnnotifiedEngineer.mockResolvedValueOnce([
                { id: 9, original_alert_id: 21, reopen_chain_id: 'chain-eng' }
            ]);
            const emitSpy = jest.spyOn(alertEvents, 'emit');

            await service._tick();

            const unlockIdx = db.__mockClient.query.mock.calls.findIndex((c) => /pg_advisory_unlock/.test(c[0]));
            const unlockOrder = db.__mockClient.query.mock.invocationCallOrder[unlockIdx];
            const emitIdx = emitSpy.mock.calls.findIndex((c) => c[0] === alertEvents.EVENTS.ALERT_ENGINEER_REQUIRED);
            const emitOrder = emitSpy.mock.invocationCallOrder[emitIdx];

            expect(emitOrder).toBeGreaterThan(unlockOrder);
            emitSpy.mockRestore();
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
