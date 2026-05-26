// [B-005 / Sprint 11] Unit tests for alertService.checkVoltage — the
// VOLTAGE_ANOMALY auto-trigger entry point invoked via the VOLTAGE_CHECK
// event from metricService.createMetric.
//
// Coverage:
// 1. Dedup short-circuit when a VOLTAGE_ANOMALY alert is already active.
// 2. Cooldown short-circuit when checkVoltage fired successfully recently.
// 3. Severity is sourced from _classifyVoltageSeverity (CRITICAL > WARNING).
// 4. No-anomaly (classifier returns null) → no createAlert call, cooldown
//    NOT bumped so the next metric can re-check immediately.
// 5. createAlert is called with the canonical alertData shape.
// 6. Cooldown bumped only on successful createAlert (mirror checkLeak — see
//    commit e15436f). Gate denial leaves cooldown unset.
// 7. Errors from createAlert / classifier are swallowed and return null.

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

describe('alertService.checkVoltage (B-005 VOLTAGE auto-trigger)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        alertService.initialized = true;
    });

    test('short-circuits when VOLTAGE alert already active for controller', async () => {
        alertService.activeAlerts.set('controller:42:VOLTAGE_ANOMALY', {
            alert_id: 99, severity: 'WARNING'
        });
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity')
            .mockResolvedValue('WARNING');
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkVoltage(42);

        expect(result).toBeNull();
        expect(createSpy).not.toHaveBeenCalled();
        expect(alertService.lastChecks.has('controller:42:voltage_check')).toBe(true);

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });

    test('short-circuits when cooldown is still active', async () => {
        alertService.lastChecks.set('controller:42:voltage_check', Date.now() - 5 * 60 * 1000);
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity');
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkVoltage(42);

        expect(result).toBeNull();
        expect(classifySpy).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });

    test('returns null without bumping cooldown when classifier finds no anomaly', async () => {
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity')
            .mockResolvedValue(null);
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkVoltage(7);

        expect(result).toBeNull();
        expect(createSpy).not.toHaveBeenCalled();
        // Cooldown must NOT be bumped — next metric should re-check
        expect(alertService.lastChecks.has('controller:7:voltage_check')).toBe(false);

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });

    test('calls createAlert with WARNING severity when classifier returns WARNING', async () => {
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity')
            .mockResolvedValue('WARNING');
        const createSpy = jest.spyOn(alertService, 'createAlert')
            .mockResolvedValue({ alert_id: 123 });

        await alertService.checkVoltage(7);

        expect(createSpy).toHaveBeenCalledTimes(1);
        const [alertData] = createSpy.mock.calls[0];
        expect(alertData.type).toBe('VOLTAGE_ANOMALY');
        expect(alertData.severity).toBe('WARNING');
        expect(alertData.infrastructure_id).toBe(7);
        expect(alertData.infrastructure_type).toBe('controller');
        expect(alertData.data.source).toBe('auto_voltage_check');
        expect(alertData.data.classified_severity).toBe('WARNING');
        expect(alertData.message).toMatch(/контроллере 7/);

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });

    test('calls createAlert with CRITICAL severity when classifier returns CRITICAL', async () => {
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity')
            .mockResolvedValue('CRITICAL');
        const createSpy = jest.spyOn(alertService, 'createAlert')
            .mockResolvedValue({ alert_id: 200 });

        await alertService.checkVoltage(8);

        const [alertData] = createSpy.mock.calls[0];
        expect(alertData.severity).toBe('CRITICAL');
        expect(alertData.message).toMatch(/Критическая/);

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });

    test('bumps cooldown only on successful createAlert', async () => {
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity')
            .mockResolvedValue('WARNING');
        const createSpy = jest.spyOn(alertService, 'createAlert')
            .mockResolvedValue({ alert_id: 201 });

        const result = await alertService.checkVoltage(11);

        expect(result).toEqual({ alert_id: 201 });
        const cooldownAt = alertService.lastChecks.get('controller:11:voltage_check');
        expect(cooldownAt).toBeGreaterThan(Date.now() - 1000);
        expect(cooldownAt).toBeLessThanOrEqual(Date.now());

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });

    test('does NOT bump cooldown when createAlert returns null (persistence gate denial)', async () => {
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity')
            .mockResolvedValue('WARNING');
        const createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue(null);

        const result = await alertService.checkVoltage(11);

        expect(result).toBeNull();
        // Critical invariant — same as checkLeak commit e15436f
        expect(alertService.lastChecks.has('controller:11:voltage_check')).toBe(false);

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });

    test('swallows errors and returns null without bumping cooldown', async () => {
        const classifySpy = jest.spyOn(alertService, '_classifyVoltageSeverity')
            .mockRejectedValue(new Error('boom'));
        const createSpy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkVoltage(13);

        expect(result).toBeNull();
        expect(createSpy).not.toHaveBeenCalled();
        expect(alertService.lastChecks.has('controller:13:voltage_check')).toBe(false);

        classifySpy.mockRestore();
        createSpy.mockRestore();
    });
});
