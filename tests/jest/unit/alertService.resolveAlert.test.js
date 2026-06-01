// [Sprint 10 PR-3] alertService.resolveAlert system-path vs manual-path tests
// [B-021 PR3] verifying path runs under a checked-out client (advisory lock +
// transaction), so those tests assert on the CLIENT mock. Non-verifying /
// manual / not-found paths stay on db.query.
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

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/utils/circuitBreaker', () => ({
    CircuitBreakerFactory: {
        createDatabaseBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' }),
        createAnalyticsBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' })
    }
}));

jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn()
}));

jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn()
}));

jest.mock('../../../src/models/AlertVerification', () => ({
    enqueue: jest.fn(),
    findPendingByChainId: jest.fn(),
    markReopened: jest.fn()
}));

jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByAlertId: jest.fn().mockResolvedValue([])
}));

const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');
const AlertVerification = require('../../../src/models/AlertVerification');
const alertService = require('../../../src/services/alertService');

describe('alertService.resolveAlert — Sprint 10 PR-3 system vs manual path', () => {
    const originalVerifyEnv = process.env.ALERT_VERIFICATION_ENABLED;

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockReset();
        db.__mockClient.query.mockReset();
        db.__mockClient.release.mockClear();
        db.__mockPool.connect.mockClear();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    // Route the verifying-path CLIENT query (lock/txn/UPDATE/backfills).
    // `updateRows` is what the UPDATE→resolved_verifying returns.
    const routeClient = (updateRows) => {
        db.__mockClient.query.mockImplementation((sql) => {
            if (/pg_advisory_unlock/.test(sql)) return Promise.resolve({ rows: [{}] });
            if (/pg_advisory_lock/.test(sql)) return Promise.resolve({ rows: [{}] });
            if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return Promise.resolve({ rows: [] });
            if (/UPDATE\s+infrastructure_alerts\s+SET\s+status/i.test(sql)) {
                return Promise.resolve({ rows: updateRows });
            }
            if (/UPDATE\s+infrastructure_alerts/i.test(sql)) return Promise.resolve({ rows: [] }); // backfills
            return Promise.resolve({ rows: [] });
        });
    };
    const clientCalls = () => db.__mockClient.query.mock.calls.map((c) => c[0]);
    const findClientUpdate = () =>
        db.__mockClient.query.mock.calls.find((c) => /UPDATE\s+infrastructure_alerts\s+SET\s+status/i.test(c[0]));

    afterEach(() => {
        if (originalVerifyEnv === undefined) {
            delete process.env.ALERT_VERIFICATION_ENABLED;
        } else {
            process.env.ALERT_VERIFICATION_ENABLED = originalVerifyEnv;
        }
    });

    const baseAlert = {
        alert_id: 21,
        type: 'LEAK_DETECTED',
        infrastructure_id: 1,
        infrastructure_type: 'controller',
        severity: 'WARNING',
        status: 'active',
        reopen_chain_id: null,
        reopen_sequence: 1
    };

    const ruleWithVerification = {
        id: 4,
        alert_type: 'LEAK_DETECTED',
        severity: 'WARNING',
        verification_grace_seconds: 300,
        verification_window_seconds: 600
    };

    describe('System-initiated resolve (userId === null)', () => {
        test('uses resolved_verifying status + enqueues verification when rule has grace > 0', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            // SELECT existing alert (db.query — read, before lock)
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            // verifying path runs on the client (lock + txn)
            routeClient([{ ...baseAlert, status: 'resolved_verifying', resolved_at: new Date().toISOString() }]);
            AlertVerification.enqueue.mockResolvedValueOnce({ id: 1 });

            await alertService.resolveAlert(21, null);

            // UPDATE→resolved_verifying happened on the client
            const updateCall = findClientUpdate();
            expect(updateCall).toBeDefined();
            expect(updateCall[1]).toEqual([21, null]);
            expect(updateCall[0]).toMatch(/status\s*=\s*'resolved_verifying'/);
            // Enqueue happened with grace+window from rule, on the SAME client
            expect(AlertVerification.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({
                    original_alert_id: 21,
                    infrastructure_type: 'controller',
                    infrastructure_id: 1,
                    alert_type: 'LEAK_DETECTED',
                    reopen_sequence: 1
                }),
                db.__mockClient
            );
        });

        test('[B-021 PR3] verifying resolve takes the advisory lock + wraps in a transaction on one client', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            routeClient([{ ...baseAlert, status: 'resolved_verifying' }]);
            AlertVerification.enqueue.mockResolvedValueOnce({ id: 1 });

            await alertService.resolveAlert(21, null);

            const calls = clientCalls();
            expect(db.__mockPool.connect).toHaveBeenCalledTimes(1);
            expect(calls.some((s) => /pg_advisory_lock/.test(s) && !/unlock/.test(s))).toBe(true);
            expect(calls.some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
            expect(calls.some((s) => /^\s*BEGIN/.test(s))).toBe(true);
            expect(calls.some((s) => /^\s*COMMIT/.test(s))).toBe(true);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
        });

        test('[B-021 PR3] enqueue failure → ROLLBACK, no orphan, resolve rejects', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            routeClient([{ ...baseAlert, status: 'resolved_verifying' }]);
            AlertVerification.enqueue.mockRejectedValueOnce(new Error('enqueue boom'));

            await expect(alertService.resolveAlert(21, null)).rejects.toThrow('enqueue boom');

            const calls = clientCalls();
            expect(calls.some((s) => /^\s*ROLLBACK/.test(s))).toBe(true);
            expect(calls.some((s) => /^\s*COMMIT/.test(s))).toBe(false);
            expect(calls.some((s) => /pg_advisory_unlock/.test(s))).toBe(true);
            expect(db.__mockClient.release).toHaveBeenCalledTimes(1);
        });

        test('reuses existing reopen_chain_id when alert already part of chain', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            const chainedAlert = { ...baseAlert, reopen_chain_id: 'existing-uuid', reopen_sequence: 2 };
            db.query.mockResolvedValueOnce({ rows: [chainedAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            routeClient([chainedAlert]);
            AlertVerification.enqueue.mockResolvedValueOnce({ id: 2 });

            await alertService.resolveAlert(21, null);

            expect(AlertVerification.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({
                    reopen_chain_id: 'existing-uuid',
                    reopen_sequence: 2
                }),
                db.__mockClient
            );
        });

        test('resolves directly (no verification) when no matching rule', async () => {
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(null);
            db.query.mockResolvedValueOnce({
                rows: [{ ...baseAlert, status: 'resolved' }]
            });

            await alertService.resolveAlert(21, null);

            const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE infrastructure_alerts'));
            expect(updateCall[1]).toEqual([21, null]);
            expect(updateCall[0]).toMatch(/status\s*=\s*'resolved'/);
            expect(AlertVerification.enqueue).not.toHaveBeenCalled();
            // Non-verifying path must NOT check out a client.
            expect(db.__mockPool.connect).not.toHaveBeenCalled();
        });

        test('[hotfix 2026-05-24] resolves directly when ALERT_VERIFICATION_ENABLED is false, even when rule wants verification', async () => {
            // Default env: ALERT_VERIFICATION_ENABLED unset → treated as false.
            // Worker is dormant, so the gate must close even if the rule has
            // verification_grace_seconds > 0. Otherwise the alert gets stuck
            // in resolved_verifying forever.
            delete process.env.ALERT_VERIFICATION_ENABLED;
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            // AlertRule.findByTypeAndSeverity must NOT be called when env-gate
            // short-circuits — the gate sits BEFORE the rule lookup.
            db.query.mockResolvedValueOnce({ rows: [{ ...baseAlert, status: 'resolved' }] });

            await alertService.resolveAlert(21, null);

            const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE infrastructure_alerts'));
            expect(updateCall[1]).toEqual([21, null]);
            expect(updateCall[0]).toMatch(/status\s*=\s*'resolved'/);
            expect(AlertRule.findByTypeAndSeverity).not.toHaveBeenCalled();
            expect(AlertVerification.enqueue).not.toHaveBeenCalled();
        });

        test('resolves directly when rule has grace=0 (verification disabled per rule)', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true'; // env on, but rule says no
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({
                ...ruleWithVerification,
                verification_grace_seconds: 0
            });
            db.query.mockResolvedValueOnce({
                rows: [{ ...baseAlert, status: 'resolved' }]
            });

            await alertService.resolveAlert(21, null);

            const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE infrastructure_alerts'));
            expect(updateCall[1]).toEqual([21, null]);
            expect(updateCall[0]).toMatch(/status\s*=\s*'resolved'/);
            expect(AlertVerification.enqueue).not.toHaveBeenCalled();
        });

        test('clears lastChecks cooldown so checker can re-evaluate', async () => {
            process.env.ALERT_VERIFICATION_ENABLED = 'true';
            alertService.lastChecks.set('controller:1:load_check', Date.now());

            // Re-arm query mocks AFTER seeding the lastChecks — full mock state
            // is reset by beforeEach but mockResolvedValueOnce queue from earlier
            // sibling tests can leak if other tests in this describe set
            // mockResolvedValue (catch-all). Use a clean .mockReset() + per-call
            // mockResolvedValueOnce to be deterministic.
            db.query.mockReset();
            AlertRule.findByTypeAndSeverity.mockReset();
            AlertVerification.enqueue.mockReset();

            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            // [B-021 PR3] verifying path on the client; lastChecks.delete fires
            // post-commit.
            routeClient([{ ...baseAlert, status: 'resolved_verifying' }]);
            AlertVerification.enqueue.mockResolvedValueOnce({ id: 1 });

            await alertService.resolveAlert(21, null);

            expect(alertService.lastChecks.has('controller:1:load_check')).toBe(false);
        });
    });

    describe('Manual resolve (userId provided)', () => {
        test('always uses resolved status (no verification)', async () => {
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            db.query.mockResolvedValueOnce({
                rows: [{ ...baseAlert, status: 'resolved' }]
            });

            await alertService.resolveAlert(21, 42); // operator user_id=42

            const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE infrastructure_alerts'));
            expect(updateCall[1]).toEqual([21, 42]);
            expect(updateCall[0]).toMatch(/status\s*=\s*'resolved'/);
            // AlertRule NOT consulted for manual path; no client checkout.
            expect(AlertRule.findByTypeAndSeverity).not.toHaveBeenCalled();
            expect(AlertVerification.enqueue).not.toHaveBeenCalled();
            expect(db.__mockPool.connect).not.toHaveBeenCalled();
        });
    });

    describe('Race / not-found handling', () => {
        test('throws when alert does not exist', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            await expect(alertService.resolveAlert(999, null)).rejects.toThrow('не найден или уже закрыт');
        });

        test('throws on UPDATE race (someone else closed in between)', async () => {
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(null);
            db.query.mockResolvedValueOnce({ rows: [] }); // UPDATE returned 0 rows

            await expect(alertService.resolveAlert(21, null)).rejects.toThrow('не найден или уже закрыт');
        });
    });
});
