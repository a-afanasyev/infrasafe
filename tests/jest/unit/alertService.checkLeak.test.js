// [B-005 / 2026-05-26] Unit tests for alertService.checkLeak — the
// LEAK_DETECTED auto-trigger entry point invoked via the LEAK_CHECK
// event from metricService.createMetric.
//
// What we want to verify:
// 1. In-memory dedup short-circuit when a LEAK alert is already active
//    for the controller (fast path, no createAlert call).
// 2. Cooldown short-circuit when checkLeak fired successfully recently
//    (15 min default — mirror of checkTransformerLoad).
// 3. Cooldown is bumped ONLY on successful createAlert. A persistence-
//    gate denial (createAlert returns null) leaves cooldown untouched
//    so the next telemetry sample can re-check — this is the bug
//    fixed by commit e15436f.
// 4. createAlert is called with the canonical alertData shape
//    (type=LEAK_DETECTED, severity=CRITICAL, infrastructure_type=
//    controller, source=auto_leak_check).

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

describe('alertService.checkLeak (B-005 LEAK auto-trigger)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Clean per-test state on the singleton.
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        alertService.initialized = true; // bypass DB-warmup in ensureInitialized
    });

    test('short-circuits when LEAK alert already active for controller (in-memory dedup)', async () => {
        alertService.activeAlerts.set('controller:42:LEAK_DETECTED', {
            alert_id: 99, created_at: new Date(), severity: 'CRITICAL'
        });
        const spy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkLeak(42);

        expect(result).toBeNull();
        expect(spy).not.toHaveBeenCalled();
        // Cooldown bumped (fast-path also marks lastChecks so a hot loop
        // of telemetry doesn't keep hitting the activeAlerts lookup).
        expect(alertService.lastChecks.has('controller:42:leak_check')).toBe(true);

        spy.mockRestore();
    });

    test('short-circuits when cooldown is still active (15min default)', async () => {
        // Last check 5 minutes ago — well inside the 15-min cooldown.
        alertService.lastChecks.set('controller:42:leak_check', Date.now() - 5 * 60 * 1000);
        const spy = jest.spyOn(alertService, 'createAlert');

        const result = await alertService.checkLeak(42);

        expect(result).toBeNull();
        expect(spy).not.toHaveBeenCalled();

        spy.mockRestore();
    });

    test('calls createAlert with canonical LEAK_DETECTED CRITICAL payload', async () => {
        const spy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 123 });

        await alertService.checkLeak(7);

        expect(spy).toHaveBeenCalledTimes(1);
        const [alertData] = spy.mock.calls[0];
        expect(alertData.type).toBe('LEAK_DETECTED');
        expect(alertData.severity).toBe('CRITICAL');
        expect(alertData.infrastructure_id).toBe(7);
        expect(alertData.infrastructure_type).toBe('controller');
        expect(alertData.affected_buildings).toBe(1);
        expect(alertData.data.source).toBe('auto_leak_check');
        expect(alertData.data.controller_id).toBe(7);
        expect(alertData.message).toMatch(/контроллера 7/);

        spy.mockRestore();
    });

    test('bumps cooldown when createAlert returns an alert (success)', async () => {
        const spy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 200 });

        const result = await alertService.checkLeak(11);

        expect(result).toEqual({ alert_id: 200 });
        const cooldownAt = alertService.lastChecks.get('controller:11:leak_check');
        expect(cooldownAt).toBeGreaterThan(Date.now() - 1000); // freshly set
        expect(cooldownAt).toBeLessThanOrEqual(Date.now());

        spy.mockRestore();
    });

    test('does NOT bump cooldown when createAlert returns null (persistence-gate denial — commit e15436f)', async () => {
        // Simulate persistence-gate denial: createAlert returns null because
        // not enough samples accumulated in the lookback window yet.
        const spy = jest.spyOn(alertService, 'createAlert').mockResolvedValue(null);

        const result = await alertService.checkLeak(11);

        expect(result).toBeNull();
        // Critical invariant: cooldown must stay UNSET so the next telemetry
        // sample triggers another check (and the gate can pass once enough
        // samples land in the window). The pre-fix version set cooldown here
        // and masked the gate from ever passing.
        expect(alertService.lastChecks.has('controller:11:leak_check')).toBe(false);

        spy.mockRestore();
    });

    test('swallows errors from createAlert and returns null (does not propagate to telemetry endpoint)', async () => {
        const spy = jest.spyOn(alertService, 'createAlert').mockRejectedValue(new Error('boom'));

        const result = await alertService.checkLeak(13);

        expect(result).toBeNull();
        // Cooldown not bumped on error either — same reasoning as gate denial.
        expect(alertService.lastChecks.has('controller:13:leak_check')).toBe(false);

        spy.mockRestore();
    });
});
