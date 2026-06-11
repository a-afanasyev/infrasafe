// PR-3 (AUD-006) Step B0 + helpers: the activeAlerts map becomes a dedup SET
// that carries status (active|acknowledged) so escalate-in-place can find and
// upgrade an alert that was acknowledged. Plus SEVERITY_RANK, _findActiveAlert,
// and _evaluateGates (wrapping the persistence + affected-buildings gates).

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
jest.mock('../../../src/services/analyticsService', () => ({ getTransformerLoad: jest.fn() }));
jest.mock('../../../src/services/ukIntegrationService', () => ({ isEnabled: jest.fn().mockResolvedValue(false) }));
jest.mock('../../../src/services/uk/alertForwarder', () => ({
    resolveBuildingIds: jest.fn().mockResolvedValue([]),
    enqueueEscalation: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn(),
    findPolicyByTypeAndSeverity: jest.fn()
}));

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');

describe('[AUD-006 B0] activeAlerts dedup-set invariant', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        alertService.initialized = true;
    });

    test('SEVERITY_RANK orders INFO < WARNING < CRITICAL', () => {
        expect(alertService.SEVERITY_RANK.INFO).toBeLessThan(alertService.SEVERITY_RANK.WARNING);
        expect(alertService.SEVERITY_RANK.WARNING).toBeLessThan(alertService.SEVERITY_RANK.CRITICAL);
    });

    test('createAlert stores the in-memory entry with status="active"', async () => {
        db.query.mockResolvedValue({ rows: [{ alert_id: 77, created_at: new Date() }] });
        await alertService.createAlert({
            type: 'VOLTAGE_ANOMALY', severity: 'WARNING',
            infrastructure_id: 5, infrastructure_type: 'controller',
            message: 'm', affected_buildings: 1, data: {}
        }, { bypassGates: true });

        const entry = alertService.activeAlerts.get('controller:5:VOLTAGE_ANOMALY');
        expect(entry).toMatchObject({ alert_id: 77, severity: 'WARNING', status: 'active' });
    });

    test('loadActiveAlerts loads active AND acknowledged, carrying status', async () => {
        db.query.mockResolvedValue({
            rows: [
                { alert_id: 1, type: 'VOLTAGE_ANOMALY', infrastructure_id: 5, infrastructure_type: 'controller', severity: 'WARNING', created_at: new Date(), status: 'acknowledged' }
            ]
        });
        await alertService.loadActiveAlerts();

        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/status\s+IN\s*\(\s*'active'\s*,\s*'acknowledged'\s*\)/i);
        const entry = alertService.activeAlerts.get('controller:5:VOLTAGE_ANOMALY');
        expect(entry.status).toBe('acknowledged');
    });

    test('_findActiveAlert queries active+acknowledged, newest first', async () => {
        db.query.mockResolvedValue({ rows: [{ alert_id: 88, created_at: new Date(), severity: 'WARNING', status: 'acknowledged' }] });
        const found = await alertService._findActiveAlert('controller', 5, 'VOLTAGE_ANOMALY');

        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/status\s+IN\s*\(\s*'active'\s*,\s*'acknowledged'\s*\)/i);
        expect(sql).toMatch(/ORDER BY created_at DESC/i);
        expect(sql).toMatch(/LIMIT 1/i);
        expect(found).toMatchObject({ alert_id: 88, severity: 'WARNING' });
    });

    test('_findActiveAlert returns null when nothing open', async () => {
        db.query.mockResolvedValue({ rows: [] });
        expect(await alertService._findActiveAlert('controller', 5, 'VOLTAGE_ANOMALY')).toBeNull();
    });

    test('_evaluateGates allows when both persistence + buildings gates pass', async () => {
        jest.spyOn(alertService, '_checkPersistenceGate').mockResolvedValue({ allowed: true, reason: 'ok' });
        jest.spyOn(alertService, '_checkAffectedBuildingsGate').mockResolvedValue({ allowed: true, reason: 'ok' });
        const r = await alertService._evaluateGates({ type: 'VOLTAGE_ANOMALY', severity: 'CRITICAL' }, { id: 1 });
        expect(r.allowed).toBe(true);
        alertService._checkPersistenceGate.mockRestore();
        alertService._checkAffectedBuildingsGate.mockRestore();
    });

    test('_evaluateGates denies when the persistence gate denies (and short-circuits buildings)', async () => {
        const persist = jest.spyOn(alertService, '_checkPersistenceGate').mockResolvedValue({ allowed: false, reason: 'not persistent' });
        const buildings = jest.spyOn(alertService, '_checkAffectedBuildingsGate').mockResolvedValue({ allowed: true });
        const r = await alertService._evaluateGates({ type: 'VOLTAGE_ANOMALY', severity: 'CRITICAL' }, { id: 1 });
        expect(r.allowed).toBe(false);
        expect(buildings).not.toHaveBeenCalled();
        persist.mockRestore();
        buildings.mockRestore();
    });
});
