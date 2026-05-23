// [Sprint 10 PR-3] alertService.resolveAlert system-path vs manual-path tests
jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));

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
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
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
            // 1st query: SELECT existing alert
            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            // 2nd query: UPDATE infrastructure_alerts
            db.query.mockResolvedValueOnce({
                rows: [{ ...baseAlert, status: 'resolved_verifying', resolved_at: new Date().toISOString() }]
            });
            AlertVerification.enqueue.mockResolvedValueOnce({ id: 1 });

            await alertService.resolveAlert(21, null);

            // UPDATE was called with status='resolved_verifying'
            const updateCall = db.query.mock.calls.find(c => c[0].includes('UPDATE infrastructure_alerts'));
            expect(updateCall[1]).toEqual([21, null, 'resolved_verifying']);
            // Enqueue happened with grace+window from rule
            expect(AlertVerification.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({
                    original_alert_id: 21,
                    infrastructure_type: 'controller',
                    infrastructure_id: 1,
                    alert_type: 'LEAK_DETECTED',
                    reopen_sequence: 1
                })
            );
        });

        test('reuses existing reopen_chain_id when alert already part of chain', async () => {
            const chainedAlert = { ...baseAlert, reopen_chain_id: 'existing-uuid', reopen_sequence: 2 };
            db.query.mockResolvedValueOnce({ rows: [chainedAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            db.query.mockResolvedValueOnce({ rows: [chainedAlert] });
            AlertVerification.enqueue.mockResolvedValueOnce({ id: 2 });

            await alertService.resolveAlert(21, null);

            expect(AlertVerification.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({
                    reopen_chain_id: 'existing-uuid',
                    reopen_sequence: 2
                })
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
            expect(updateCall[1]).toEqual([21, null, 'resolved']);
            expect(AlertVerification.enqueue).not.toHaveBeenCalled();
        });

        test('resolves directly when rule has grace=0 (verification disabled per rule)', async () => {
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
            expect(updateCall[1][2]).toBe('resolved');
            expect(AlertVerification.enqueue).not.toHaveBeenCalled();
        });

        test('clears lastChecks cooldown so checker can re-evaluate', async () => {
            alertService.lastChecks.set('controller:1:load_check', Date.now());

            db.query.mockResolvedValueOnce({ rows: [baseAlert] });
            AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(ruleWithVerification);
            db.query.mockResolvedValueOnce({ rows: [{ ...baseAlert, status: 'resolved_verifying' }] });
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
            expect(updateCall[1]).toEqual([21, 42, 'resolved']);
            // AlertRule NOT consulted for manual path
            expect(AlertRule.findByTypeAndSeverity).not.toHaveBeenCalled();
            expect(AlertVerification.enqueue).not.toHaveBeenCalled();
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
