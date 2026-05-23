// [Sprint 10 PR-3] alertService.createAlert reopen path tests
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

jest.mock('../../../src/services/analyticsService', () => ({}));

jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn().mockResolvedValue(null)
}));

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');
const alertEvents = require('../../../src/events/alertEvents');

describe('alertService.createAlert — Sprint 10 PR-3 reopen path', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    const baseAlertData = {
        type: 'LEAK_DETECTED',
        severity: 'WARNING',
        infrastructure_type: 'controller',
        infrastructure_id: 1,
        message: 'Reopen test',
        data: {}
    };

    test('emits ALERT_REOPENED when reopen_chain_id is present', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ alert_id: 100, created_at: new Date().toISOString() }]
        });

        const listener = jest.fn();
        alertEvents.once(alertEvents.EVENTS.ALERT_REOPENED, listener);

        await alertService.createAlert({
            ...baseAlertData,
            reopen_chain_id: 'chain-uuid-abc',
            reopen_sequence: 2,
            previous_alert_id: 99,
            previous_uk_request_number: '260523-004'
        }, { bypassGates: true });

        expect(listener).toHaveBeenCalledWith({
            alertId: 100,
            reopenChainId: 'chain-uuid-abc',
            reopenSequence: 2,
            previousAlertId: 99
        });
    });

    test('does NOT emit ALERT_REOPENED for ordinary alert (no chain_id)', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ alert_id: 101, created_at: new Date().toISOString() }]
        });

        const listener = jest.fn();
        alertEvents.on(alertEvents.EVENTS.ALERT_REOPENED, listener);

        await alertService.createAlert(baseAlertData, { bypassGates: true });

        alertEvents.off(alertEvents.EVENTS.ALERT_REOPENED, listener);
        expect(listener).not.toHaveBeenCalled();
    });

    test('persists reopen_chain_id + reopen_sequence + previous fields to INSERT', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ alert_id: 102, created_at: new Date().toISOString() }]
        });

        await alertService.createAlert({
            ...baseAlertData,
            reopen_chain_id: 'chain-uuid-xyz',
            reopen_sequence: 3,
            previous_alert_id: 99,
            previous_uk_request_number: '260523-004'
        }, { bypassGates: true });

        const [, values] = db.query.mock.calls[0];
        // Position 7: reopen_chain_id, 8: reopen_sequence, 9: previous_alert_id, 10: previous_uk_request_number
        expect(values[7]).toBe('chain-uuid-xyz');
        expect(values[8]).toBe(3);
        expect(values[9]).toBe(99);
        expect(values[10]).toBe('260523-004');
    });

    test('defaults reopen_sequence to 1 when not provided', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ alert_id: 103, created_at: new Date().toISOString() }]
        });

        await alertService.createAlert(baseAlertData, { bypassGates: true });

        const [, values] = db.query.mock.calls[0];
        expect(values[7]).toBeNull();   // no chain
        expect(values[8]).toBe(1);      // default sequence
        expect(values[9]).toBeNull();   // no previous alert
        expect(values[10]).toBeNull();  // no previous UK number
    });

    test('return value includes reopen fields', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{ alert_id: 104, created_at: '2026-05-23T15:00:00Z' }]
        });

        const result = await alertService.createAlert({
            ...baseAlertData,
            reopen_chain_id: 'chain-uuid-ret',
            reopen_sequence: 2
        }, { bypassGates: true });

        expect(result.alert_id).toBe(104);
        expect(result.reopen_chain_id).toBe('chain-uuid-ret');
        expect(result.reopen_sequence).toBe(2);
    });
});
