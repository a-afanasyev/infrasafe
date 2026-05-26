// Mock dependencies before requiring alertService (singleton)
jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

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
        createDatabaseBreaker: () => ({
            execute: (fn) => fn(),
            getState: () => 'CLOSED'
        }),
        createAnalyticsBreaker: () => ({
            execute: (fn) => fn(),
            getState: () => 'CLOSED'
        })
    }
}));

jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn()
}));

jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../../src/services/uk/alertForwarder', () => ({
    resolveBuildingIds: jest.fn()
}));

jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn()
}));

const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const alertService = require('../../../src/services/alertService');
const AlertRule = require('../../../src/models/AlertRule');
const alertForwarder = require('../../../src/services/uk/alertForwarder');

describe('AlertService — Sprint 10 persistence + buildings gates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    // ────────────────────────────────────────────────────────────────────
    // Persistence gate — LEAK_DETECTED
    // ────────────────────────────────────────────────────────────────────

    describe('persistence gate — LEAK_DETECTED via controller', () => {
        const baseAlert = {
            type: 'LEAK_DETECTED',
            severity: 'WARNING',
            infrastructure_type: 'controller',
            infrastructure_id: 1,
            message: 'Leak detected',
            data: {}
        };
        const baseRule = {
            id: 4,
            alert_type: 'LEAK_DETECTED',
            severity: 'WARNING',
            min_persistence_seconds: 15,
            min_affected_buildings: 1
        };

        test('skips alert when fewer than 2 leak samples in window', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(baseRule);
            // First db.query is the gate's COUNT — return 1 sample
            db.query.mockResolvedValueOnce({ rows: [{ samples: '1', first_seen: new Date().toISOString() }] });

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('skipped by persistence gate')
            );
            // INSERT must NOT have been called
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        test('skips alert when condition has not lasted long enough', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(baseRule);
            // 5 samples but first_seen 5 seconds ago — less than 15s persistence
            const firstSeen = new Date(Date.now() - 5000).toISOString();
            db.query.mockResolvedValueOnce({ rows: [{ samples: '5', first_seen: firstSeen }] });

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('condition observed for 5s, need 15s')
            );
        });

        test('proceeds to INSERT when condition has persisted ≥ min_persistence_seconds', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(baseRule);
            // 5 samples, first_seen 20 seconds ago — exceeds 15s persistence
            const firstSeen = new Date(Date.now() - 20000).toISOString();
            db.query
                .mockResolvedValueOnce({ rows: [{ samples: '5', first_seen: firstSeen }] }) // gate COUNT
                .mockResolvedValueOnce({ rows: [{ alert_id: 42, created_at: new Date().toISOString() }] }); // INSERT

            const result = await alertService.createAlert(baseAlert);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(42);
            expect(db.query).toHaveBeenCalledTimes(2);
            expect(db.query.mock.calls[1][0]).toContain('INSERT INTO infrastructure_alerts');
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // [B-005 / Sprint 11] Persistence gate — VOLTAGE_ANOMALY
    // ────────────────────────────────────────────────────────────────────

    describe('persistence gate — VOLTAGE_ANOMALY via controller', () => {
        const warnRule = {
            id: 5,
            alert_type: 'VOLTAGE_ANOMALY',
            severity: 'WARNING',
            min_persistence_seconds: 60,
            min_affected_buildings: 1
        };
        const critRule = {
            id: 5,
            alert_type: 'VOLTAGE_ANOMALY',
            severity: 'CRITICAL',
            min_persistence_seconds: 10,
            min_affected_buildings: 1
        };
        const baseAlert = {
            type: 'VOLTAGE_ANOMALY',
            severity: 'WARNING',
            infrastructure_type: 'controller',
            infrastructure_id: 1,
            message: 'Voltage anomaly',
            data: {}
        };

        test('WARNING gate denies when fewer than 2 out-of-range samples in window', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            db.query.mockResolvedValueOnce({
                rows: [{ samples: '1', first_seen: new Date().toISOString() }]
            });

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('VOLTAGE persistence (WARNING): only 1 samples')
            );
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        test('WARNING gate proceeds when ≥2 samples spanning ≥ min_persistence_seconds', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            const firstSeen = new Date(Date.now() - 70_000).toISOString();
            db.query
                .mockResolvedValueOnce({ rows: [{ samples: '5', first_seen: firstSeen }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 401, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert(baseAlert);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(401);
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('WARNING gate passes exactly 4 SQL params (controllerId, lookback, warn_min, warn_max)', async () => {
            // Regression for the bug found during dev smoke 2026-05-27:
            // earlier version always passed 6 params, but the WARNING
            // filterClause only references $1..$4 → Postgres errored
            // "bind message supplies 6 parameters, but prepared statement
            // requires 4". CRITICAL branch uses $5/$6 for the deep-band
            // check, so it gets all 6.
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            const firstSeen = new Date(Date.now() - 70_000).toISOString();
            db.query
                .mockResolvedValueOnce({ rows: [{ samples: '3', first_seen: firstSeen }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 403, created_at: new Date().toISOString() }] });

            await alertService.createAlert(baseAlert);

            const gateParams = db.query.mock.calls[0][1];
            expect(gateParams).toHaveLength(4);
        });

        test('CRITICAL gate passes exactly 6 SQL params (adds crit_min, crit_max)', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(critRule);
            const firstSeen = new Date(Date.now() - 15_000).toISOString();
            db.query
                .mockResolvedValueOnce({ rows: [{ samples: '3', first_seen: firstSeen }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 404, created_at: new Date().toISOString() }] });

            await alertService.createAlert({ ...baseAlert, severity: 'CRITICAL' });

            const gateParams = db.query.mock.calls[0][1];
            expect(gateParams).toHaveLength(6);
        });

        test('CRITICAL gate uses different predicate than WARNING (2+ phases or deep band)', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(critRule);
            const firstSeen = new Date(Date.now() - 15_000).toISOString();
            db.query
                .mockResolvedValueOnce({ rows: [{ samples: '3', first_seen: firstSeen }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 402, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert({
                ...baseAlert, severity: 'CRITICAL'
            });

            expect(result).not.toBeNull();
            // First call is the gate SELECT — verify CRITICAL filter clause was used
            const gateSql = db.query.mock.calls[0][0];
            expect(gateSql).toMatch(/CASE WHEN electricity_ph1 NOT BETWEEN/);
            expect(gateSql).toMatch(/>= 2/); // 2+ phases predicate
            expect(gateSql).toMatch(/electricity_ph1 NOT BETWEEN \$5 AND \$6/); // deep band
        });

        test('denies when 2 samples landed but condition observed for too short', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            const firstSeen = new Date(Date.now() - 20_000).toISOString();
            db.query.mockResolvedValueOnce({
                rows: [{ samples: '2', first_seen: firstSeen }]
            });

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('condition observed for 20s, need 60s')
            );
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // [B-005 / Sprint 11] Persistence gate — HEATING_FAILURE
    // ────────────────────────────────────────────────────────────────────

    describe('persistence gate — HEATING_FAILURE via controller', () => {
        const rule = {
            id: 6,
            alert_type: 'HEATING_FAILURE',
            severity: 'CRITICAL',
            min_persistence_seconds: 10,
            min_affected_buildings: 1
        };
        const baseAlert = {
            type: 'HEATING_FAILURE',
            severity: 'CRITICAL',
            infrastructure_type: 'controller',
            infrastructure_id: 1,
            message: 'Heating failure',
            data: {}
        };

        test('denies when fewer than 2 sub-threshold samples in window', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(rule);
            db.query.mockResolvedValueOnce({
                rows: [{ samples: '1', first_seen: new Date().toISOString() }]
            });

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('HEATING persistence: only 1 sub-threshold samples')
            );
        });

        test('proceeds when ≥2 samples spanning ≥ min_persistence_seconds', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(rule);
            const firstSeen = new Date(Date.now() - 15_000).toISOString();
            db.query
                .mockResolvedValueOnce({ rows: [{ samples: '4', first_seen: firstSeen }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 500, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert(baseAlert);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(500);
            // Verify the gate SQL uses the hot_water_in_temp predicate
            const gateSql = db.query.mock.calls[0][0];
            expect(gateSql).toMatch(/hot_water_in_temp < \$3/);
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // Persistence gate — fail-open for non-LEAK types in v1
    // ────────────────────────────────────────────────────────────────────

    describe('persistence gate — TRANSFORMER_OVERLOAD fail-open in v1', () => {
        test('proceeds to INSERT without querying metrics (no v1 persistence check)', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                id: 1,
                alert_type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                min_persistence_seconds: 60,
                min_affected_buildings: 1
            });
            // Only one db.query call expected — the INSERT (no metric COUNT for TRANSFORMER)
            db.query.mockResolvedValueOnce({ rows: [{ alert_id: 99, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert({
                type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 5,
                message: 'Transformer overload',
                data: { load_percent: 87 }
            });

            expect(result).not.toBeNull();
            expect(db.query).toHaveBeenCalledTimes(1);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO infrastructure_alerts');
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // Affected-buildings gate
    // ────────────────────────────────────────────────────────────────────

    describe('affected-buildings gate', () => {
        test('skips when fewer buildings affected than min_affected_buildings', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                id: 1,
                alert_type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                min_persistence_seconds: 0,  // disable persistence
                min_affected_buildings: 3
            });
            alertForwarder.resolveBuildingIds.mockResolvedValue([
                { building_id: 1, external_id: 'uuid-1' }
            ]);

            const result = await alertService.createAlert({
                type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 5,
                message: 'Single building blip',
                data: {}
            });

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('1 buildings affected, need 3')
            );
        });

        test('proceeds when buildings ≥ min', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                id: 1,
                alert_type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                min_persistence_seconds: 0,
                min_affected_buildings: 2
            });
            alertForwarder.resolveBuildingIds.mockResolvedValue([
                { building_id: 1, external_id: 'uuid-1' },
                { building_id: 2, external_id: 'uuid-2' }
            ]);
            db.query.mockResolvedValueOnce({ rows: [{ alert_id: 50, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert({
                type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 5,
                message: 'Multi-building',
                data: {}
            });

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(50);
        });

        test('default min=1 is no-op (existing single-building alerts unaffected)', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                id: 1,
                alert_type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                min_persistence_seconds: 0,
                min_affected_buildings: 1  // default
            });
            db.query.mockResolvedValueOnce({ rows: [{ alert_id: 51, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert({
                type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 5,
                message: 'Test',
                data: {}
            });

            expect(result).not.toBeNull();
            // resolveBuildingIds NOT called — min=1 short-circuits
            expect(alertForwarder.resolveBuildingIds).not.toHaveBeenCalled();
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // No rule → no gate (preserves existing behavior)
    // ────────────────────────────────────────────────────────────────────

    describe('no matching AlertRule', () => {
        test('proceeds to INSERT (no rule → no gate)', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(null);
            db.query.mockResolvedValueOnce({ rows: [{ alert_id: 60, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert({
                type: 'UNCATALOGED_TYPE',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 1,
                message: 'No rule for this',
                data: {}
            });

            expect(result).not.toBeNull();
            expect(db.query).toHaveBeenCalledTimes(1); // just INSERT
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // bypassGates option (manual operator route)
    // ────────────────────────────────────────────────────────────────────

    describe('bypassGates option', () => {
        test('skips both gates when bypassGates=true (manual creation)', async () => {
            // Even if rule says persistence required, bypass means no check
            db.query.mockResolvedValueOnce({ rows: [{ alert_id: 70, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert({
                type: 'LEAK_DETECTED',
                severity: 'WARNING',
                infrastructure_type: 'controller',
                infrastructure_id: 1,
                message: 'Manual escalation by operator',
                data: {}
            }, { bypassGates: true });

            expect(result).not.toBeNull();
            // AlertRule.findByTypeAndSeverity NOT called
            expect(AlertRule.findByTypeAndSeverity).not.toHaveBeenCalled();
            // only the INSERT query
            expect(db.query).toHaveBeenCalledTimes(1);
        });
    });
});
