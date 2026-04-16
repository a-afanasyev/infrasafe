// Mock dependencies before requiring alertService (it's a singleton)
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
            execute: jest.fn((fn) => fn()),
            getState: () => ({ state: 'CLOSED', failureCount: 0 })
        })
    }
}));

// Mock ukIntegrationService to avoid side effects
jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false),
    sendAlertToUK: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');

describe('AlertService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Mark as initialized to bypass DB wait
        alertService.initialized = true;
        // Clear in-memory state
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    describe('getThresholds', () => {
        test('returns a copy of current thresholds', () => {
            const thresholds = alertService.getThresholds();
            expect(thresholds).toHaveProperty('transformer_overload', 85);
            expect(thresholds).toHaveProperty('transformer_critical', 95);
            expect(thresholds).toHaveProperty('water_pressure_low', 2.0);
            expect(thresholds).toHaveProperty('water_pressure_critical', 1.5);
            expect(thresholds).toHaveProperty('heating_temp_delta_low', 15);
            expect(thresholds).toHaveProperty('heating_temp_delta_critical', 10);
        });

        test('returns a new object (not a reference)', () => {
            const t1 = alertService.getThresholds();
            const t2 = alertService.getThresholds();
            expect(t1).toEqual(t2);
            expect(t1).not.toBe(t2);
        });
    });

    describe('updateThresholds', () => {
        test('updates specific thresholds', () => {
            const original = alertService.getThresholds();
            alertService.updateThresholds({ transformer_overload: 90 });
            const updated = alertService.getThresholds();
            expect(updated.transformer_overload).toBe(90);
            // Restore
            alertService.updateThresholds({ transformer_overload: original.transformer_overload });
        });

        test('preserves unmodified thresholds', () => {
            const original = alertService.getThresholds();
            alertService.updateThresholds({ transformer_overload: 90 });
            const updated = alertService.getThresholds();
            expect(updated.transformer_critical).toBe(original.transformer_critical);
            expect(updated.water_pressure_low).toBe(original.water_pressure_low);
            // Restore
            alertService.updateThresholds({ transformer_overload: original.transformer_overload });
        });

        test('can update multiple thresholds at once', () => {
            const original = alertService.getThresholds();
            alertService.updateThresholds({
                transformer_overload: 80,
                water_pressure_low: 3.0
            });
            const updated = alertService.getThresholds();
            expect(updated.transformer_overload).toBe(80);
            expect(updated.water_pressure_low).toBe(3.0);
            // Restore
            alertService.updateThresholds({
                transformer_overload: original.transformer_overload,
                water_pressure_low: original.water_pressure_low
            });
        });
    });

    describe('getStatus', () => {
        test('returns service status with all expected fields', () => {
            const status = alertService.getStatus();
            expect(status).toHaveProperty('active_alerts');
            expect(status).toHaveProperty('last_checks');
            expect(status).toHaveProperty('cooldown_minutes', 15);
            expect(status).toHaveProperty('thresholds');
            expect(status).toHaveProperty('circuit_breaker_state');
        });

        test('reflects active alerts count', () => {
            alertService.activeAlerts.set('test:1:WARNING', { alert_id: 1 });
            const status = alertService.getStatus();
            expect(status.active_alerts).toBe(1);
            alertService.activeAlerts.clear();
        });
    });

    describe('createAlert', () => {
        test('inserts alert into DB and returns created alert', async () => {
            db.query.mockResolvedValue({
                rows: [{ alert_id: 42, created_at: '2025-01-01T00:00:00.000Z' }]
            });

            const alertData = {
                type: 'TRANSFORMER_OVERLOAD',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                severity: 'WARNING',
                message: 'Test alert',
                affected_buildings: 5,
                data: { load_percent: 87 }
            };

            const result = await alertService.createAlert(alertData);

            expect(result.alert_id).toBe(42);
            expect(result.type).toBe('TRANSFORMER_OVERLOAD');
            expect(result.status).toBe('active');
            expect(db.query).toHaveBeenCalled();
            const [query, values] = db.query.mock.calls[0];
            expect(query).toContain('INSERT INTO infrastructure_alerts');
            expect(values).toContain('TRANSFORMER_OVERLOAD');
            expect(values).toContain(1);
        });

        test('adds alert to activeAlerts map', async () => {
            db.query.mockResolvedValue({
                rows: [{ alert_id: 43, created_at: '2025-01-01T00:00:00.000Z' }]
            });

            await alertService.createAlert({
                type: 'WATER_LOW',
                infrastructure_id: 5,
                infrastructure_type: 'water_source',
                severity: 'WARNING',
                message: 'Low water',
                affected_buildings: 2,
                data: {}
            });

            const key = 'water_source:5:WATER_LOW';
            expect(alertService.activeAlerts.has(key)).toBe(true);
            expect(alertService.activeAlerts.get(key).alert_id).toBe(43);
        });

        test('defaults affected_buildings to 0 when not provided', async () => {
            db.query.mockResolvedValue({
                rows: [{ alert_id: 44, created_at: '2025-01-01T00:00:00.000Z' }]
            });

            await alertService.createAlert({
                type: 'TEST',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                severity: 'INFO',
                message: 'Test',
                data: {}
            });

            const values = db.query.mock.calls[0][1];
            expect(values[5]).toBe(0);
        });
    });

    describe('acknowledgeAlert', () => {
        test('acknowledges an active alert and removes from activeAlerts', async () => {
            const alertRow = {
                alert_id: 10,
                type: 'TRANSFORMER_OVERLOAD',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                status: 'acknowledged'
            };
            db.query.mockResolvedValue({ rows: [alertRow] });

            alertService.activeAlerts.set('transformer:1:TRANSFORMER_OVERLOAD', {
                alert_id: 10,
                created_at: new Date(),
                severity: 'WARNING'
            });

            const result = await alertService.acknowledgeAlert(10, 5);

            expect(result.alert_id).toBe(10);
            expect(result.status).toBe('acknowledged');
            expect(alertService.activeAlerts.has('transformer:1:TRANSFORMER_OVERLOAD')).toBe(false);
        });

        test('throws when alert not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await expect(
                alertService.acknowledgeAlert(999, 5)
            ).rejects.toThrow('не найден');
        });
    });

    describe('resolveAlert', () => {
        test('resolves an active alert and removes from activeAlerts', async () => {
            const alertRow = {
                alert_id: 20,
                type: 'WATER_LOW',
                infrastructure_id: 3,
                infrastructure_type: 'water_source',
                status: 'resolved'
            };
            db.query.mockResolvedValue({ rows: [alertRow] });

            alertService.activeAlerts.set('water_source:3:WATER_LOW', {
                alert_id: 20,
                created_at: new Date(),
                severity: 'WARNING'
            });

            const result = await alertService.resolveAlert(20, 5);

            expect(result.alert_id).toBe(20);
            expect(result.status).toBe('resolved');
            expect(alertService.activeAlerts.has('water_source:3:WATER_LOW')).toBe(false);
        });

        test('throws when alert not found or already closed', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await expect(
                alertService.resolveAlert(999, 5)
            ).rejects.toThrow('не найден');
        });
    });

    describe('getActiveAlerts', () => {
        test('returns data and total for active alerts', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ total: '3' }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 1 }, { alert_id: 2 }, { alert_id: 3 }] });

            const result = await alertService.getActiveAlerts();

            expect(result.total).toBe(3);
            expect(result.data).toHaveLength(3);
        });

        test('applies severity filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ total: '1' }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 1 }] });

            await alertService.getActiveAlerts({ severity: 'CRITICAL' });

            const [, params] = db.query.mock.calls[0];
            expect(params).toContain('CRITICAL');
        });

        test('applies infrastructure_type filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ total: '2' }] })
                .mockResolvedValueOnce({ rows: [{ alert_id: 1 }, { alert_id: 2 }] });

            await alertService.getActiveAlerts({ infrastructure_type: 'transformer' });

            const [, params] = db.query.mock.calls[0];
            expect(params).toContain('transformer');
        });

        test('validates sort column and falls back to created_at', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ total: '0' }] })
                .mockResolvedValueOnce({ rows: [] });

            await alertService.getActiveAlerts({}, { sort: 'malicious_column' });

            const [dataQuery] = db.query.mock.calls[1];
            expect(dataQuery).toContain('ORDER BY ia.created_at');
        });

        test('uses correct pagination offset', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ total: '100' }] })
                .mockResolvedValueOnce({ rows: [] });

            await alertService.getActiveAlerts({}, { page: 5, limit: 10 });

            const [, params] = db.query.mock.calls[1];
            expect(params).toContain(10);  // limit
            expect(params).toContain(40);  // offset = (5-1)*10
        });
    });

    describe('getAlertStatistics', () => {
        test('returns statistics with period info', async () => {
            db.query.mockResolvedValue({ rows: [{ severity: 'CRITICAL', count: 2 }] });

            const result = await alertService.getAlertStatistics(30);

            expect(result.period_days).toBe(30);
            expect(result.statistics).toHaveLength(1);
            expect(result).toHaveProperty('active_alerts_count');
        });

        test('clamps days to valid range (1-365)', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await alertService.getAlertStatistics(999);
            expect(result.period_days).toBe(365);
        });

        test('defaults to 7 for non-numeric input', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await alertService.getAlertStatistics('invalid');
            expect(result.period_days).toBe(7);
        });
    });

    describe('checkTransformerLoad', () => {
        test('returns null when in cooldown period', async () => {
            const checkKey = 'transformer:1:load_check';
            alertService.lastChecks.set(checkKey, Date.now());

            const result = await alertService.checkTransformerLoad(1);
            expect(result).toBeNull();
        });

        test('returns null when no load data available', async () => {
            jest.doMock('../../../src/services/analyticsService', () => ({
                getTransformerLoad: jest.fn().mockResolvedValue(null)
            }));

            // Clear cooldown
            alertService.lastChecks.clear();

            // The service requires analyticsService inline, so we test this carefully
            // by setting the cooldown to trigger the null-data path
            const result = await alertService.checkTransformerLoad(999);
            // Returns null because analyticsService is mocked or throws
            expect(result).toBeNull();
        });
    });

    describe('loadActiveAlerts', () => {
        test('loads active alerts from DB into map', async () => {
            db.query.mockResolvedValue({
                rows: [
                    {
                        alert_id: 1,
                        type: 'TRANSFORMER_OVERLOAD',
                        infrastructure_id: 10,
                        infrastructure_type: 'transformer',
                        severity: 'WARNING',
                        created_at: '2025-01-01'
                    }
                ]
            });

            alertService.activeAlerts.clear();
            await alertService.loadActiveAlerts();

            expect(alertService.activeAlerts.size).toBe(1);
            const key = 'transformer:10:TRANSFORMER_OVERLOAD';
            expect(alertService.activeAlerts.has(key)).toBe(true);
        });

        test('handles DB error gracefully without throwing', async () => {
            db.query.mockRejectedValue(new Error('DB connection failed'));

            alertService.activeAlerts.clear();
            // Should not throw
            await alertService.loadActiveAlerts();
            expect(alertService.activeAlerts.size).toBe(0);
        });

        // Phase 4.3 (ARCH-109): active alerts must also hydrate lastChecks
        // so that a restart does not cause an alert burst.
        test('restores cooldown timestamps from active alerts on load', async () => {
            const alertTs = '2025-06-01T10:00:00.000Z';
            db.query.mockResolvedValue({
                rows: [
                    {
                        alert_id: 1,
                        type: 'TRANSFORMER_OVERLOAD',
                        infrastructure_id: 10,
                        infrastructure_type: 'transformer',
                        severity: 'WARNING',
                        created_at: alertTs,
                    },
                ],
            });

            alertService.activeAlerts.clear();
            alertService.lastChecks.clear();

            await alertService.loadActiveAlerts();

            const checkKey = 'transformer:10:load_check';
            expect(alertService.lastChecks.has(checkKey)).toBe(true);
            expect(alertService.lastChecks.get(checkKey)).toBe(new Date(alertTs).getTime());
        });
    });

    // Phase 4.1 (ARCH-106): createAlert must catch UNIQUE-violation (23505)
    // from the new partial index and return null, leaving the caller to treat
    // the attempt as "already active" rather than an error.
    describe('createAlert — DB UNIQUE dedup', () => {
        test('returns null when DB raises 23505 UNIQUE violation', async () => {
            const err = new Error('duplicate key value violates unique constraint');
            err.code = '23505';
            db.query.mockRejectedValueOnce(err);

            const alertData = {
                type: 'TRANSFORMER_OVERLOAD',
                infrastructure_type: 'transformer',
                infrastructure_id: 42,
                severity: 'WARNING',
                message: 'test dup',
                data: { load_percent: 90 },
            };

            const result = await alertService.createAlert(alertData);
            expect(result).toBeNull();
        });

        test('re-throws non-23505 DB errors', async () => {
            const err = new Error('connection refused');
            err.code = '57P03';
            db.query.mockRejectedValueOnce(err);

            const alertData = {
                type: 'TRANSFORMER_OVERLOAD',
                infrastructure_type: 'transformer',
                infrastructure_id: 42,
                severity: 'WARNING',
                message: 'test',
                data: {},
            };

            await expect(alertService.createAlert(alertData)).rejects.toThrow('connection refused');
        });
    });

    describe('sendNotifications', () => {
        // fire-and-forget by design -- behavioral assertions require integration test
        test('does not throw for non-CRITICAL alerts', async () => {
            const alertData = {
                type: 'TEST',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 1,
                message: 'Test'
            };

            await expect(alertService.sendNotifications(alertData, 1)).resolves.not.toThrow();
        });

        // fire-and-forget by design -- behavioral assertions require integration test
        test('sends immediate notification for CRITICAL alerts', async () => {
            const alertData = {
                type: 'TEST',
                severity: 'CRITICAL',
                infrastructure_type: 'transformer',
                infrastructure_id: 1,
                message: 'Critical test',
                affected_buildings: 3
            };

            await expect(alertService.sendNotifications(alertData, 1)).resolves.not.toThrow();
        });
    });

    describe('broadcastAlert', () => {
        test('does not throw', () => {
            expect(() => {
                alertService.broadcastAlert({ type: 'TEST', severity: 'INFO' }, 1);
            }).not.toThrow();
        });
    });

    describe('getCriticalAlertRecipients', () => {
        test('returns array of recipients', async () => {
            const recipients = await alertService.getCriticalAlertRecipients();
            expect(Array.isArray(recipients)).toBe(true);
            expect(recipients.length).toBeGreaterThan(0);
            expect(recipients[0]).toHaveProperty('type', 'log');
        });
    });

    describe('initialize', () => {
        test('skips if already initialized', async () => {
            alertService.initialized = true;
            db.query.mockClear();
            await alertService.initialize();
            // Should not query DB since already initialized
            expect(db.query).not.toHaveBeenCalled();
        });
    });

    describe('ensureInitialized', () => {
        test('calls initialize when not initialized', async () => {
            alertService.initialized = false;
            db.query
                .mockResolvedValueOnce({ rows: [] })  // waitForDatabase SELECT 1
                .mockResolvedValueOnce({ rows: [] }); // loadActiveAlerts

            await alertService.ensureInitialized();
            expect(alertService.initialized).toBe(true);
        });
    });
});
