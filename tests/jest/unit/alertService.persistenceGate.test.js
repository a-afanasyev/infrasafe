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
