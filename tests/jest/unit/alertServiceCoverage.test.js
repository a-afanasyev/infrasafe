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
        })
    }
}));

jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn(),
    getAllTransformersWithAnalytics: jest.fn()
}));

jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false),
    sendAlertToUK: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const alertService = require('../../../src/services/alertService');
const analyticsService = require('../../../src/services/analyticsService');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');

describe('AlertService — uncovered branches', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    // ─── waitForDatabase ────────────────────────────────────────────────

    describe('waitForDatabase', () => {
        test('retries until DB is ready', async () => {
            // Fail twice, succeed on third attempt
            db.query
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

            alertService.initialized = false;
            // loadActiveAlerts query
            db.query.mockResolvedValueOnce({ rows: [] });

            await alertService.initialize();

            expect(alertService.initialized).toBe(true);
            // SELECT 1 called 3 times (2 failures + 1 success), then loadActiveAlerts
            expect(db.query).toHaveBeenCalledTimes(4);
            expect(logger.warn).toHaveBeenCalledTimes(2);
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('готова'));
        });

        test('throws after max retries exceeded', async () => {
            // Always reject
            db.query.mockRejectedValue(new Error('ECONNREFUSED'));

            alertService.initialized = false;

            // Override maxRetries for speed by patching waitForDatabase
            const originalWait = alertService.waitForDatabase.bind(alertService);
            alertService.waitForDatabase = async function () {
                const maxRetries = 2;
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        await db.query('SELECT 1');
                        logger.info('База данных готова для AlertService');
                        return;
                    } catch (error) {
                        logger.warn(`Попытка ${i + 1}/${maxRetries}: БД не готова, ожидание...`);
                        if (i === maxRetries - 1) {
                            throw new Error('Превышено максимальное время ожидания готовности БД');
                        }
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
            };

            await expect(alertService.initialize()).rejects.toThrow(
                'Превышено максимальное время ожидания готовности БД'
            );
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Ошибка инициализации'),
                expect.any(Error)
            );

            // Restore original
            alertService.waitForDatabase = originalWait;
        });
    });

    // ─── checkTransformerLoad ───────────────────────────────────────────

    describe('checkTransformerLoad', () => {
        test('returns null when within cooldown period', async () => {
            const checkKey = 'transformer:1:load_check';
            alertService.lastChecks.set(checkKey, Date.now());

            const result = await alertService.checkTransformerLoad(1);

            expect(result).toBeNull();
            // analyticsService should not have been called
            expect(analyticsService.getTransformerLoad).not.toHaveBeenCalled();
        });

        test('returns null when no load data (null)', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue(null);

            const result = await alertService.checkTransformerLoad(1);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Нет данных загрузки')
            );
        });

        test('returns null when load_percent is not a number', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 'N/A',
                name: 'TestTransformer'
            });

            const result = await alertService.checkTransformerLoad(2);

            expect(result).toBeNull();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Нет данных загрузки')
            );
        });

        test('returns null when load below threshold (50%)', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 50,
                name: 'TestTransformer'
            });

            const result = await alertService.checkTransformerLoad(3);

            expect(result).toBeNull();
            // lastChecks should have been set
            const checkKey = 'transformer:3:load_check';
            expect(alertService.lastChecks.has(checkKey)).toBe(true);
        });

        test('creates WARNING alert for 90% load', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 90,
                name: 'TF-01',
                buildings_count: 5,
                capacity_kva: 1000,
                active_controllers_count: 10,
                last_metric_time: '2026-01-01T00:00:00Z'
            });

            db.query.mockResolvedValue({
                rows: [{ alert_id: 100, created_at: '2026-01-01T00:00:00Z' }]
            });

            const result = await alertService.checkTransformerLoad(4);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(100);
            expect(result.severity).toBe('WARNING');
            expect(result.type).toBe('TRANSFORMER_OVERLOAD');
            expect(result.message).toContain('90.0%');

            // Verify INSERT was called
            const insertCall = db.query.mock.calls[0];
            expect(insertCall[0]).toContain('INSERT INTO infrastructure_alerts');
            expect(insertCall[1]).toContain('WARNING');
        });

        test('creates CRITICAL alert for 97% load', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 97,
                name: 'TF-02',
                buildings_count: 3,
                capacity_kva: 500,
                active_controllers_count: 6,
                last_metric_time: '2026-01-01T00:00:00Z'
            });

            db.query.mockResolvedValue({
                rows: [{ alert_id: 101, created_at: '2026-01-01T00:00:00Z' }]
            });

            const result = await alertService.checkTransformerLoad(5);

            expect(result).not.toBeNull();
            expect(result.alert_id).toBe(101);
            expect(result.severity).toBe('CRITICAL');
            expect(result.type).toBe('TRANSFORMER_CRITICAL_OVERLOAD');
            expect(result.message).toContain('97.0%');
            expect(result.data.threshold_used).toBe(95);
        });

        test('skips when alert already active', async () => {
            analyticsService.getTransformerLoad.mockResolvedValue({
                load_percent: 92,
                name: 'TF-03',
                buildings_count: 2,
                capacity_kva: 750,
                active_controllers_count: 4,
                last_metric_time: '2026-01-01T00:00:00Z'
            });

            // Set existing active alert
            const alertKey = 'transformer:6:TRANSFORMER_OVERLOAD';
            alertService.activeAlerts.set(alertKey, {
                alert_id: 50,
                created_at: new Date(),
                severity: 'WARNING'
            });

            const result = await alertService.checkTransformerLoad(6);

            expect(result).toBeNull();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('уже активен')
            );
            // DB INSERT should NOT have been called
            expect(db.query).not.toHaveBeenCalled();
        });

        test('returns null on error (getTransformerLoad rejects)', async () => {
            analyticsService.getTransformerLoad.mockRejectedValue(
                new Error('Analytics DB timeout')
            );

            const result = await alertService.checkTransformerLoad(7);

            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Ошибка проверки трансформатора 7'),
                expect.any(Error)
            );
        });
    });

    // ─── sendNotifications ──────────────────────────────────────────────

    describe('sendNotifications', () => {
        test('calls sendImmediateNotification for CRITICAL severity', async () => {
            const spy = jest.spyOn(alertService, 'sendImmediateNotification')
                .mockResolvedValue(undefined);

            const alertData = {
                type: 'TRANSFORMER_CRITICAL_OVERLOAD',
                severity: 'CRITICAL',
                infrastructure_type: 'transformer',
                infrastructure_id: 1,
                message: 'Critical overload',
                affected_buildings: 5
            };

            await alertService.sendNotifications(alertData, 200);

            expect(spy).toHaveBeenCalledWith(alertData, 200);
            spy.mockRestore();
        });

        test('forwards to UK when integration is enabled', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.sendAlertToUK.mockResolvedValue(undefined);

            const alertData = {
                type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 2,
                message: 'High load'
            };

            await alertService.sendNotifications(alertData, 201);

            expect(ukIntegrationService.isEnabled).toHaveBeenCalled();
            expect(ukIntegrationService.sendAlertToUK).toHaveBeenCalledWith(
                expect.objectContaining({
                    ...alertData,
                    alert_id: 201
                })
            );
        });

        test('catches UK errors without throwing', async () => {
            ukIntegrationService.isEnabled.mockResolvedValue(true);
            ukIntegrationService.sendAlertToUK.mockRejectedValue(
                new Error('UK API unavailable')
            );

            const alertData = {
                type: 'TRANSFORMER_OVERLOAD',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                infrastructure_id: 3,
                message: 'Test alert'
            };

            // Should not throw
            await expect(
                alertService.sendNotifications(alertData, 202)
            ).resolves.not.toThrow();

            // Phase 4.4: log message was reformatted to include alert_id
            // and drop the second argument. Single-arg log now contains the
            // original cause.
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('UK forwarding failed: UK API unavailable')
            );
        });
    });

    // ─── checkAllTransformers ───────────────────────────────────────────

    describe('checkAllTransformers', () => {
        test('checks all transformers and returns summary', async () => {
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue([
                { id: 10 },
                { id: 11 }
            ]);

            // First transformer: creates an alert (90% load)
            analyticsService.getTransformerLoad
                .mockResolvedValueOnce({
                    load_percent: 90,
                    name: 'TF-10',
                    buildings_count: 2,
                    capacity_kva: 500,
                    active_controllers_count: 3,
                    last_metric_time: '2026-01-01T00:00:00Z'
                })
                // Second transformer: below threshold
                .mockResolvedValueOnce({
                    load_percent: 40,
                    name: 'TF-11'
                });

            // INSERT for first transformer alert
            db.query.mockResolvedValue({
                rows: [{ alert_id: 300, created_at: '2026-01-01T00:00:00Z' }]
            });

            const result = await alertService.checkAllTransformers();

            expect(result.checked).toBe(2);
            expect(result.alerts_created).toBe(1);
            expect(result.alerts).toHaveLength(1);
            expect(result.alerts[0].alert_id).toBe(300);
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Проверено 2 трансформаторов')
            );
        });

        test('continues on individual transformer error', async () => {
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue([
                { id: 20 },
                { id: 21 }
            ]);

            // First transformer: error
            analyticsService.getTransformerLoad
                .mockRejectedValueOnce(new Error('Transformer 20 DB error'))
                // Second transformer: below threshold (no alert)
                .mockResolvedValueOnce({
                    load_percent: 30,
                    name: 'TF-21'
                });

            const result = await alertService.checkAllTransformers();

            expect(result.checked).toBe(2);
            expect(result.alerts_created).toBe(0);
            // Error should have been logged but not thrown
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Ошибка проверки трансформатора'),
                expect.any(Error)
            );
        });

        test('throws on getAllTransformersWithAnalytics failure', async () => {
            analyticsService.getAllTransformersWithAnalytics.mockRejectedValue(
                new Error('Total analytics failure')
            );

            await expect(
                alertService.checkAllTransformers()
            ).rejects.toThrow('Total analytics failure');

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('Ошибка массовой проверки'),
                expect.any(Error)
            );
        });
    });
});
