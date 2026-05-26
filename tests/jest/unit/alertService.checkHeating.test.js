// [B-005 / Sprint 11] Unit tests for alertService.checkHeating — the
// HEATING_FAILURE auto-trigger entry point invoked via the HEATING_CHECK
// event from metricService.createMetric.
//
// Coverage:
// 1. Dedup short-circuit when HEATING_FAILURE alert is already active.
// 2. Cooldown short-circuit when checkHeating fired successfully recently.
// 3. No-anomaly (no sub-threshold samples) → no createAlert call,
//    cooldown NOT bumped.
// 4. createAlert called with canonical CRITICAL HEATING_FAILURE payload.
// 5. Cooldown bumped only on successful createAlert (mirror checkLeak —
//    commit e15436f invariant).
// 6. Errors from preliminary predicate / createAlert swallowed, returns null.

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
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
jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false)
}));
jest.mock('../../../src/services/uk/alertForwarder', () => ({
    resolveBuildingIds: jest.fn().mockResolvedValue(['b-1'])
}));
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn()
}));

const alertService = require('../../../src/services/alertService');

describe('alertService.checkHeating (B-005 HEATING auto-trigger)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        alertService.initialized = true;
    });

    test('short-circuits when HEATING alert already active for controller', async () => {
        alertService.activeAlerts.set('controller:42:HEATING_FAILURE', {
            alert_id: 99, severity: 'CRITICAL'
        });
        const predicateSpy = jest.spyOn(alertService, '_hasRecentHeatingAnomaly')
            .mockResolvedValue(true);
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkHeating(42);

        expect(result).toBeNull();
        expect(createSpy).not.toHaveBeenCalled();
        expect(alertService.lastChecks.has('controller:42:heating_check')).toBe(true);

        predicateSpy.mockRestore();
        createSpy.mockRestore();
    });

    test('short-circuits when cooldown is still active', async () => {
        alertService.lastChecks.set('controller:42:heating_check', Date.now() - 5 * 60 * 1000);
        const predicateSpy = jest.spyOn(alertService, '_hasRecentHeatingAnomaly');
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkHeating(42);

        expect(result).toBeNull();
        expect(predicateSpy).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();

        predicateSpy.mockRestore();
        createSpy.mockRestore();
    });

    test('returns null without bumping cooldown when predicate finds no anomaly', async () => {
        const predicateSpy = jest.spyOn(alertService, '_hasRecentHeatingAnomaly')
            .mockResolvedValue(false);
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkHeating(7);

        expect(result).toBeNull();
        expect(createSpy).not.toHaveBeenCalled();
        expect(alertService.lastChecks.has('controller:7:heating_check')).toBe(false);

        predicateSpy.mockRestore();
        createSpy.mockRestore();
    });

    test('calls createAlert with canonical HEATING_FAILURE CRITICAL payload', async () => {
        const predicateSpy = jest.spyOn(alertService, '_hasRecentHeatingAnomaly')
            .mockResolvedValue(true);
        const createSpy = jest.spyOn(alertService, 'createAlert')
            .mockResolvedValue({ alert_id: 333 });

        await alertService.checkHeating(7);

        expect(createSpy).toHaveBeenCalledTimes(1);
        const [alertData] = createSpy.mock.calls[0];
        expect(alertData.type).toBe('HEATING_FAILURE');
        expect(alertData.severity).toBe('CRITICAL');
        expect(alertData.infrastructure_id).toBe(7);
        expect(alertData.infrastructure_type).toBe('controller');
        expect(alertData.affected_buildings).toBe(1);
        expect(alertData.data.source).toBe('auto_heating_check');
        expect(alertData.data.controller_id).toBe(7);
        expect(alertData.message).toMatch(/контроллере 7/);

        predicateSpy.mockRestore();
        createSpy.mockRestore();
    });

    test('bumps cooldown only on successful createAlert', async () => {
        const predicateSpy = jest.spyOn(alertService, '_hasRecentHeatingAnomaly')
            .mockResolvedValue(true);
        const createSpy = jest.spyOn(alertService, 'createAlert')
            .mockResolvedValue({ alert_id: 334 });

        const result = await alertService.checkHeating(11);

        expect(result).toEqual({ alert_id: 334 });
        const cooldownAt = alertService.lastChecks.get('controller:11:heating_check');
        expect(cooldownAt).toBeGreaterThan(Date.now() - 1000);
        expect(cooldownAt).toBeLessThanOrEqual(Date.now());

        predicateSpy.mockRestore();
        createSpy.mockRestore();
    });

    test('does NOT bump cooldown when createAlert returns null (gate denial)', async () => {
        const predicateSpy = jest.spyOn(alertService, '_hasRecentHeatingAnomaly')
            .mockResolvedValue(true);
        const createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue(null);

        const result = await alertService.checkHeating(11);

        expect(result).toBeNull();
        expect(alertService.lastChecks.has('controller:11:heating_check')).toBe(false);

        predicateSpy.mockRestore();
        createSpy.mockRestore();
    });

    test('swallows errors and returns null without bumping cooldown', async () => {
        const predicateSpy = jest.spyOn(alertService, '_hasRecentHeatingAnomaly')
            .mockRejectedValue(new Error('db down'));
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkHeating(13);

        expect(result).toBeNull();
        expect(createSpy).not.toHaveBeenCalled();
        expect(alertService.lastChecks.has('controller:13:heating_check')).toBe(false);

        predicateSpy.mockRestore();
        createSpy.mockRestore();
    });
});
