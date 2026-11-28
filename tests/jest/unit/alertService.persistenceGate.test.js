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
        // [Q-03] Подавление/верификация кортежа — свой describe ниже и
        // tests/jest/db/alertCore (SQL на живой схеме).
        jest.spyOn(alertService, '_isTupleMutedOrVerifying').mockResolvedValue(false);
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

        // [Q-08] Обычный путь — тот же шлюз непрерывной аварии, что и verify:
        // строка {fault_start, last_fault, n} от последнего здорового сэмпла.
        const faultRow = (spanMs, n) => ({
            rows: [{ fault_start: new Date(Date.now() - spanMs).toISOString(), last_fault: new Date().toISOString(), n: String(n) }]
        });

        test('skips alert when fewer than 2 anomalous samples since last healthy', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(baseRule);
            db.query.mockResolvedValueOnce(faultRow(0, 1));

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('skipped by persistence gate')
            );
            // INSERT must NOT have been called
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        test('skips alert when continuous fault has not lasted long enough', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(baseRule);
            db.query.mockResolvedValueOnce(faultRow(5000, 5));

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('continuous fault held 5s, need 15s')
            );
        });

        test('proceeds to INSERT when continuous fault held ≥ min_persistence_seconds', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(baseRule);
            db.query
                .mockResolvedValueOnce(faultRow(20000, 5)) // gate
                .mockResolvedValueOnce({ rows: [{ alert_id: 42, created_at: new Date().toISOString() }] }); // INSERT

            const result = await alertService.createAlert(baseAlert);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(42);
            expect(db.query).toHaveBeenCalledTimes(2);
            expect(db.query.mock.calls[1][0]).toContain('INSERT INTO infrastructure_alerts');
        });

        test('gate is continuous-fault shaped, window starts at NOW() − max(2×min, 600s)', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(baseRule);
            db.query.mockResolvedValueOnce(faultRow(0, 0));
            const before = Date.now();

            await alertService.createAlert(baseAlert);

            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/COALESCE\(h\.last_healthy/i);
            expect(params[0]).toBe(1);
            const windowStartAgo = before - params[1].getTime();
            expect(windowStartAgo).toBeGreaterThanOrEqual(600 * 1000 - 50);
            expect(windowStartAgo).toBeLessThanOrEqual(600 * 1000 + 1000);
        });
    });

    // ────────────────────────────────────────────────────────────────────
    // [AUD-001 PR-B] Verify-mode persistence gate — continuous fault, clamped
    // to post-resolve telemetry (sinceTimestamp). Counts from the first
    // anomalous sample AFTER the last healthy one, not from observationSince.
    // ────────────────────────────────────────────────────────────────────

    describe('verify-mode persistence gate — LEAK_DETECTED', () => {
        const OBS = '2026-06-10T00:00:00Z';
        const leakAlert = {
            type: 'LEAK_DETECTED',
            severity: 'CRITICAL',
            infrastructure_type: 'controller',
            infrastructure_id: 9,
            message: 'leak',
            data: {}
        };
        const rule = { id: 4, alert_type: 'LEAK_DETECTED', min_persistence_seconds: 15, min_affected_buildings: 1 };

        const callVerify = (gateRow) => {
            // ruleSnapshot provided → createAlert does NOT re-read the rule.
            db.query.mockReset();
            db.query.mockResolvedValueOnce({ rows: [gateRow] });           // verify gate
            db.query.mockResolvedValueOnce({ rows: [{ alert_id: 70, created_at: new Date().toISOString() }] }); // INSERT
            return alertService.createAlert(leakAlert, { sinceTimestamp: OBS, ruleSnapshot: rule });
        };

        test('gate query is continuous-fault shaped and clamped to sinceTimestamp', async () => {
            await callVerify({ fault_start: new Date(Date.now() - 20000).toISOString(),
                               last_fault: new Date().toISOString(), n: '3' });
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/last_healthy/i);
            expect(sql).toMatch(/leak_sensor = false/i);
            expect(sql).toMatch(/COALESCE\(h\.last_healthy/i);
            expect(sql).toMatch(/timestamp > \$2/);
            expect(params).toEqual([9, OBS]);
        });

        test('denies reopen when fewer than 2 anomalous samples since last healthy', async () => {
            const r = await callVerify({ fault_start: new Date().toISOString(),
                                         last_fault: new Date().toISOString(), n: '1' });
            expect(r).toBeNull();
            expect(db.query).toHaveBeenCalledTimes(1); // gate only, no INSERT
        });

        test('denies reopen when continuous fault span < min_persistence_seconds', async () => {
            const start = new Date(Date.now() - 5000).toISOString();   // 5s span < 15s
            const r = await callVerify({ fault_start: start, last_fault: new Date().toISOString(), n: '4' });
            expect(r).toBeNull();
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        test('allows reopen when ≥2 samples span ≥ min_persistence_seconds → INSERT', async () => {
            const start = new Date(Date.now() - 30000).toISOString();   // 30s span ≥ 15s
            const r = await callVerify({ fault_start: start, last_fault: new Date().toISOString(), n: '4' });
            expect(r).not.toBeNull();
            expect(r.alert_id).toBe(70);
            expect(db.query).toHaveBeenCalledTimes(2);
            expect(db.query.mock.calls[1][0]).toContain('INSERT INTO infrastructure_alerts');
        });

        test('[C-1] gate CTE returns zero rows → denied (no crash, no INSERT)', async () => {
            db.query.mockReset();
            db.query.mockResolvedValueOnce({ rows: [] }); // empty CTE result (s had no rows)
            const r = await alertService.createAlert(leakAlert, { sinceTimestamp: OBS, ruleSnapshot: rule });
            expect(r).toBeNull();
            expect(db.query).toHaveBeenCalledTimes(1); // gate only
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

        const faultRow = (spanMs, n) => ({
            rows: [{ fault_start: new Date(Date.now() - spanMs).toISOString(), last_fault: new Date().toISOString(), n: String(n) }]
        });

        test('WARNING gate denies when fewer than 2 out-of-range samples since last healthy', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            db.query.mockResolvedValueOnce(faultRow(0, 1));

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('VOLTAGE/WARNING verify: only 1 anomalous samples')
            );
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        test('WARNING gate proceeds when continuous fault held ≥ min_persistence_seconds', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            db.query
                .mockResolvedValueOnce(faultRow(70_000, 5))
                .mockResolvedValueOnce({ rows: [{ alert_id: 401, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert(baseAlert);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(401);
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('WARNING gate passes exactly 4 SQL params (controllerId, windowStart, warn_min, warn_max)', async () => {
            // Regression for the bug found during dev smoke 2026-05-27: the
            // WARNING predicate references only $1..$4, so 6 params make
            // Postgres fail "bind message supplies 6 parameters".
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            db.query.mockResolvedValueOnce(faultRow(0, 0));

            await alertService.createAlert(baseAlert);

            expect(db.query.mock.calls[0][1]).toHaveLength(4);
        });

        test('CRITICAL gate passes exactly 6 SQL params and uses the 2+ phases / deep band predicate', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(critRule);
            db.query
                .mockResolvedValueOnce(faultRow(15_000, 3))
                .mockResolvedValueOnce({ rows: [{ alert_id: 402, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert({ ...baseAlert, severity: 'CRITICAL' });

            expect(result).not.toBeNull();
            const [gateSql, gateParams] = db.query.mock.calls[0];
            expect(gateParams).toHaveLength(6);
            expect(gateSql).toMatch(/>= 2/);
            expect(gateSql).toMatch(/NOT BETWEEN \$5 AND \$6/);
        });

        test('denies when continuous fault held too short', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(warnRule);
            db.query.mockResolvedValueOnce(faultRow(20_000, 2));

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('continuous fault held 20s, need 60s')
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
        const faultRow = (spanMs, n) => ({
            rows: [{ fault_start: new Date(Date.now() - spanMs).toISOString(), last_fault: new Date().toISOString(), n: String(n) }]
        });

        test('denies when fewer than 2 sub-threshold samples since last healthy', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(rule);
            db.query.mockResolvedValueOnce(faultRow(0, 1));

            const result = await alertService.createAlert(baseAlert);

            expect(result).toBeNull();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('HEATING verify: only 1 anomalous samples')
            );
        });

        test('proceeds when continuous fault held ≥ min_persistence_seconds', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(rule);
            db.query
                .mockResolvedValueOnce(faultRow(15_000, 4))
                .mockResolvedValueOnce({ rows: [{ alert_id: 500, created_at: new Date().toISOString() }] });

            const result = await alertService.createAlert(baseAlert);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(500);
            expect(db.query.mock.calls[0][0]).toMatch(/hot_water_in_temp < \$3/);
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
    // [Q-03] Suppression / pending verification of the same tuple
    // ────────────────────────────────────────────────────────────────────

    describe('[Q-03] suppressed or verifying tuple', () => {
        const rule = { id: 4, alert_type: 'LEAK_DETECTED', severity: 'CRITICAL', min_persistence_seconds: 0, min_affected_buildings: 1 };
        const leak = { type: 'LEAK_DETECTED', severity: 'CRITICAL', infrastructure_type: 'controller', infrastructure_id: 3, message: 'leak', data: {} };

        test('ordinary path returns null and does not INSERT', async () => {
            AlertRule.findByTypeAndSeverity.mockResolvedValue(rule);
            alertService._isTupleMutedOrVerifying.mockResolvedValue(true);

            const result = await alertService.createAlert(leak);

            expect(result).toBeNull();
            expect(alertService._isTupleMutedOrVerifying).toHaveBeenCalledWith(leak);
            expect(db.query).not.toHaveBeenCalled();
        });

        test('verify path (sinceTimestamp) and manual path (bypassGates) are not checked', async () => {
            alertService._isTupleMutedOrVerifying.mockResolvedValue(true);
            db.query.mockResolvedValue({ rows: [{ alert_id: 80, created_at: new Date().toISOString() }] });

            const reopened = await alertService.createAlert(leak, { sinceTimestamp: new Date(), ruleSnapshot: rule });
            const manual = await alertService.createAlert(leak, { bypassGates: true });

            expect(reopened).not.toBeNull();
            expect(manual).not.toBeNull();
            expect(alertService._isTupleMutedOrVerifying).not.toHaveBeenCalled();
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
