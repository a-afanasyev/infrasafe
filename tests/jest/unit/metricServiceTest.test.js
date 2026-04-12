jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/models/Metric', () => ({
    findAll: jest.fn(),
    findById: jest.fn(),
    findByControllerId: jest.fn(),
    findLastForAllControllers: jest.fn(),
    create: jest.fn(),
    delete: jest.fn()
}));

jest.mock('../../../src/models/Controller', () => ({
    findById: jest.fn(),
    findBySerialNumber: jest.fn(),
    updateStatus: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
    invalidatePattern: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const Metric = require('../../../src/models/Metric');
const Controller = require('../../../src/models/Controller');
const cacheService = require('../../../src/services/cacheService');

// metricService is a singleton
let metricService;

beforeEach(() => {
    jest.clearAllMocks();
    cacheService.get.mockResolvedValue(null);
    cacheService.set.mockResolvedValue(undefined);
    cacheService.invalidate.mockResolvedValue(undefined);
    cacheService.invalidatePattern.mockResolvedValue(undefined);

    jest.isolateModules(() => {
        metricService = require('../../../src/services/metricService');
    });
});

describe('MetricService', () => {
    const mockMetric = {
        metric_id: 1,
        controller_id: 1,
        timestamp: '2026-01-01T00:00:00Z',
        voltage: 220,
        amperage: 10
    };

    const mockPaginated = {
        data: [mockMetric],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
    };

    const mockController = {
        controller_id: 1,
        serial_number: 'SN-001',
        status: 'online'
    };

    describe('getAllMetrics', () => {
        test('returns data from cache when available', async () => {
            cacheService.get.mockResolvedValue(mockPaginated);

            const result = await metricService.getAllMetrics();

            expect(result).toEqual(mockPaginated);
            expect(Metric.findAll).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches on miss', async () => {
            Metric.findAll.mockResolvedValue(mockPaginated);

            const result = await metricService.getAllMetrics(1, 10, 'timestamp', 'desc');

            expect(Metric.findAll).toHaveBeenCalledWith(1, 10, 'timestamp', 'desc');
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(mockPaginated);
        });

        test('uses default parameters', async () => {
            Metric.findAll.mockResolvedValue(mockPaginated);

            await metricService.getAllMetrics();

            expect(Metric.findAll).toHaveBeenCalledWith(1, 10, 'timestamp', 'desc');
        });

        test('throws on DB error', async () => {
            Metric.findAll.mockRejectedValue(new Error('DB error'));

            await expect(metricService.getAllMetrics()).rejects.toThrow('DB error');
        });
    });

    describe('getMetricById', () => {
        test('returns data from cache when available', async () => {
            cacheService.get.mockResolvedValue(mockMetric);

            const result = await metricService.getMetricById(1);

            expect(result).toEqual(mockMetric);
            expect(Metric.findById).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches on miss', async () => {
            Metric.findById.mockResolvedValue(mockMetric);

            const result = await metricService.getMetricById(1);

            expect(Metric.findById).toHaveBeenCalledWith(1);
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(mockMetric);
        });

        test('returns null when not found', async () => {
            Metric.findById.mockResolvedValue(null);

            const result = await metricService.getMetricById(999);

            expect(result).toBeNull();
        });

        test('does not cache null result', async () => {
            Metric.findById.mockResolvedValue(null);

            await metricService.getMetricById(999);

            expect(cacheService.set).not.toHaveBeenCalled();
        });

        test('throws on DB error', async () => {
            Metric.findById.mockRejectedValue(new Error('DB error'));

            await expect(metricService.getMetricById(1)).rejects.toThrow('DB error');
        });
    });

    describe('createMetric', () => {
        test('creates metric with valid data', async () => {
            const metricData = { controller_id: 1, voltage: 220, amperage: 10 };
            Controller.findById.mockResolvedValue(mockController);
            Metric.create.mockResolvedValue({ metric_id: 2, ...metricData });
            Controller.updateStatus.mockResolvedValue({});

            const result = await metricService.createMetric(metricData);

            expect(Metric.create).toHaveBeenCalledWith(expect.objectContaining(metricData));
            expect(result).toHaveProperty('metric_id', 2);
        });

        test('updates controller status to online after creating metric', async () => {
            const metricData = { controller_id: 1, voltage: 220 };
            Controller.findById.mockResolvedValue(mockController);
            Metric.create.mockResolvedValue({ metric_id: 2, ...metricData });
            Controller.updateStatus.mockResolvedValue({});

            await metricService.createMetric(metricData);

            expect(Controller.updateStatus).toHaveBeenCalledWith(1, 'online');
        });

        test('throws CONTROLLER_NOT_FOUND when controller does not exist', async () => {
            Controller.findById.mockResolvedValue(null);

            await expect(metricService.createMetric({ controller_id: 999, voltage: 220 })).rejects.toMatchObject({ code: 'CONTROLLER_NOT_FOUND' });
        });

        test('throws when controller_id is missing', async () => {
            await expect(metricService.createMetric({})).rejects.toThrow();
        });

        test('invalidates caches after creation', async () => {
            const metricData = { controller_id: 1, voltage: 220 };
            Controller.findById.mockResolvedValue(mockController);
            Metric.create.mockResolvedValue({ metric_id: 2, ...metricData });
            Controller.updateStatus.mockResolvedValue({});

            await metricService.createMetric(metricData);

            expect(cacheService.invalidatePattern).toHaveBeenCalled();
            expect(cacheService.invalidate).toHaveBeenCalled();
        });

        test('detects anomalies when voltage is out of range', async () => {
            const metricData = { controller_id: 1, voltage: 300 };
            Controller.findById.mockResolvedValue(mockController);
            Metric.create.mockResolvedValue({ metric_id: 2, ...metricData, anomalies: ['voltage_out_of_range:300'] });
            Controller.updateStatus.mockResolvedValue({});

            const result = await metricService.createMetric(metricData);

            // The create is called with the data that includes anomalies
            expect(Metric.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    anomalies: expect.arrayContaining([expect.stringContaining('voltage_out_of_range')])
                })
            );
        });
    });

    describe('processTelemetry', () => {
        test('processes telemetry data successfully', async () => {
            const telemetryData = {
                serial_number: 'SN-001',
                timestamp: '2026-01-01T00:00:00Z',
                metrics: { voltage: 220, amperage: 10 }
            };
            Controller.findBySerialNumber.mockResolvedValue(mockController);
            Controller.findById.mockResolvedValue(mockController);
            Metric.create.mockResolvedValue({ metric_id: 3, controller_id: 1, voltage: 220, amperage: 10 });
            Controller.updateStatus.mockResolvedValue({});

            const result = await metricService.processTelemetry(telemetryData);

            expect(result).toHaveProperty('controller_id', 1);
            expect(result).toHaveProperty('metric');
        });

        test('throws CONTROLLER_NOT_FOUND when serial number not found', async () => {
            Controller.findBySerialNumber.mockResolvedValue(null);

            await expect(metricService.processTelemetry({ serial_number: 'UNKNOWN', metrics: {} })).rejects.toMatchObject({ code: 'CONTROLLER_NOT_FOUND' });
        });

        test('throws when serial_number is missing', async () => {
            await expect(
                metricService.processTelemetry({ metrics: {} })
            ).rejects.toThrow();
        });
    });

    describe('getMetricsByControllerId', () => {
        test('returns metrics for existing controller', async () => {
            const metrics = [mockMetric];
            Controller.findById.mockResolvedValue(mockController);
            Metric.findByControllerId.mockResolvedValue(metrics);

            const result = await metricService.getMetricsByControllerId(1);

            expect(result).toEqual(metrics);
        });

        test('throws CONTROLLER_NOT_FOUND when controller does not exist', async () => {
            Controller.findById.mockResolvedValue(null);

            await expect(metricService.getMetricsByControllerId(999)).rejects.toMatchObject({ code: 'CONTROLLER_NOT_FOUND' });
        });

        test('returns cached data when available', async () => {
            Controller.findById.mockResolvedValue(mockController);
            const cached = [mockMetric];
            cacheService.get.mockResolvedValue(cached);

            const result = await metricService.getMetricsByControllerId(1);

            expect(result).toEqual(cached);
            expect(Metric.findByControllerId).not.toHaveBeenCalled();
        });

        test('passes date filters to model', async () => {
            Controller.findById.mockResolvedValue(mockController);
            Metric.findByControllerId.mockResolvedValue([]);

            await metricService.getMetricsByControllerId(1, '2026-01-01', '2026-12-31');

            expect(Metric.findByControllerId).toHaveBeenCalledWith(1, '2026-01-01', '2026-12-31');
        });
    });

    describe('getAggregatedMetrics', () => {
        test('returns cached data when available', async () => {
            const cached = { count: 5, voltage: { avg: 220 } };
            cacheService.get.mockResolvedValue(cached);

            const result = await metricService.getAggregatedMetrics(1, '1h');

            expect(result).toEqual(cached);
        });

        test('returns empty aggregation when no metrics exist', async () => {
            Controller.findById.mockResolvedValue(mockController);
            Metric.findByControllerId.mockResolvedValue([]);

            const result = await metricService.getAggregatedMetrics(1, '1h');

            expect(result.count).toBe(0);
        });

        test('throws CONTROLLER_NOT_FOUND for missing controller', async () => {
            Controller.findById.mockResolvedValue(null);

            await expect(metricService.getAggregatedMetrics(999, '1h')).rejects.toMatchObject({ code: 'CONTROLLER_NOT_FOUND' });
        });
    });

    describe('deleteMetric', () => {
        test('deletes metric and returns result', async () => {
            Metric.delete.mockResolvedValue(mockMetric);

            const result = await metricService.deleteMetric(1);

            expect(Metric.delete).toHaveBeenCalledWith(1);
            expect(result).toEqual(mockMetric);
        });

        test('returns null when metric not found', async () => {
            Metric.delete.mockResolvedValue(null);

            const result = await metricService.deleteMetric(999);

            expect(result).toBeNull();
        });

        test('invalidates caches after deletion', async () => {
            Metric.delete.mockResolvedValue(mockMetric);

            await metricService.deleteMetric(1);

            expect(cacheService.invalidatePattern).toHaveBeenCalled();
        });

        test('throws on DB error', async () => {
            Metric.delete.mockRejectedValue(new Error('DB error'));

            await expect(metricService.deleteMetric(1)).rejects.toThrow('DB error');
        });
    });

    describe('validateMetricData', () => {
        test('throws when controller_id is missing', () => {
            expect(() => metricService.validateMetricData({})).toThrow();
        });

        test('throws when numeric field is not a number', () => {
            expect(() => metricService.validateMetricData({
                controller_id: 1,
                voltage: 'not-a-number'
            })).toThrow();
        });

        test('throws when timestamp is invalid', () => {
            expect(() => metricService.validateMetricData({
                controller_id: 1,
                timestamp: 'not-a-date'
            })).toThrow();
        });

        test('passes with valid data', () => {
            expect(() => metricService.validateMetricData({
                controller_id: 1,
                voltage: 220,
                amperage: 10,
                timestamp: '2026-01-01T00:00:00Z'
            })).not.toThrow();
        });
    });

    describe('detectAnomalies', () => {
        test('detects voltage out of range', () => {
            const anomalies = metricService.detectAnomalies({ voltage: 300 });

            expect(anomalies).toContainEqual(expect.stringContaining('voltage_out_of_range'));
        });

        test('detects amperage out of range', () => {
            const anomalies = metricService.detectAnomalies({ amperage: 150 });

            expect(anomalies).toContainEqual(expect.stringContaining('amperage_out_of_range'));
        });

        test('detects temperature out of range', () => {
            const anomalies = metricService.detectAnomalies({ temperature: 100 });

            expect(anomalies).toContainEqual(expect.stringContaining('temperature_out_of_range'));
        });

        test('detects humidity out of range', () => {
            const anomalies = metricService.detectAnomalies({ humidity: 110 });

            expect(anomalies).toContainEqual(expect.stringContaining('humidity_out_of_range'));
        });

        test('returns empty array when all values are normal', () => {
            const anomalies = metricService.detectAnomalies({
                voltage: 220,
                amperage: 10,
                temperature: 25,
                humidity: 50
            });

            expect(anomalies).toHaveLength(0);
        });

        test('returns empty array when no thresholded fields present', () => {
            const anomalies = metricService.detectAnomalies({ controller_id: 1 });

            expect(anomalies).toHaveLength(0);
        });
    });

    describe('aggregateMetrics', () => {
        test('returns empty aggregation for empty array', () => {
            const result = metricService.aggregateMetrics([]);

            expect(result.count).toBe(0);
            expect(result.voltage).toBeNull();
        });

        test('returns empty aggregation for null', () => {
            const result = metricService.aggregateMetrics(null);

            expect(result.count).toBe(0);
        });

        test('aggregates metrics correctly', () => {
            const metrics = [
                { voltage: 220, amperage: 10, timestamp: '2026-01-01T12:00:00Z' },
                { voltage: 230, amperage: 15, timestamp: '2026-01-01T11:00:00Z' }
            ];

            const result = metricService.aggregateMetrics(metrics);

            expect(result.count).toBe(2);
            expect(result.voltage.min).toBe(220);
            expect(result.voltage.max).toBe(230);
            expect(result.voltage.avg).toBe(225);
            expect(result.amperage.min).toBe(10);
            expect(result.amperage.max).toBe(15);
        });
    });

    describe('getLastMetricsForAllControllers', () => {
        test('returns data from cache when available', async () => {
            const cachedMetrics = [mockMetric];
            cacheService.get.mockResolvedValue(cachedMetrics);

            const result = await metricService.getLastMetricsForAllControllers();

            expect(result).toEqual(cachedMetrics);
            expect(Metric.findLastForAllControllers).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches on miss', async () => {
            const metrics = [mockMetric];
            Metric.findLastForAllControllers.mockResolvedValue(metrics);

            const result = await metricService.getLastMetricsForAllControllers();

            expect(Metric.findLastForAllControllers).toHaveBeenCalled();
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(metrics);
        });

        test('throws on DB error', async () => {
            Metric.findLastForAllControllers.mockRejectedValue(new Error('DB error'));

            await expect(metricService.getLastMetricsForAllControllers()).rejects.toThrow('DB error');
        });
    });

    describe('getAggregatedMetrics - timeFrame variants', () => {
        beforeEach(() => {
            Controller.findById.mockResolvedValue(mockController);
            Metric.findByControllerId.mockResolvedValue([]);
        });

        test('uses 24h time frame', async () => {
            const result = await metricService.getAggregatedMetrics(1, '24h');

            expect(result.count).toBe(0);
            expect(Metric.findByControllerId).toHaveBeenCalled();
        });

        test('uses 7d time frame', async () => {
            const result = await metricService.getAggregatedMetrics(1, '7d');

            expect(result.count).toBe(0);
            expect(Metric.findByControllerId).toHaveBeenCalled();
        });

        test('uses default (1h) time frame for unknown value', async () => {
            const result = await metricService.getAggregatedMetrics(1, 'unknown');

            expect(result.count).toBe(0);
            expect(Metric.findByControllerId).toHaveBeenCalled();
        });
    });

    describe('cleanupOldMetrics', () => {
        test('returns cleanup result with default 30 days', async () => {
            const result = await metricService.cleanupOldMetrics();

            expect(result.message).toContain('30 дней');
            expect(result.cutoffDate).toBeTruthy();
        });

        test('returns cleanup result with custom days', async () => {
            const result = await metricService.cleanupOldMetrics(7);

            expect(result.message).toContain('7 дней');
            expect(result.cutoffDate).toBeTruthy();
        });

        test('returns valid ISO date string as cutoffDate', async () => {
            const result = await metricService.cleanupOldMetrics(10);

            expect(() => new Date(result.cutoffDate)).not.toThrow();
            expect(isNaN(Date.parse(result.cutoffDate))).toBe(false);
        });
    });

    describe('updateThresholds', () => {
        test('updates voltage thresholds', () => {
            const result = metricService.updateThresholds({
                voltage: { min: 210, max: 240 }
            });

            expect(result.voltage).toEqual({ min: 210, max: 240 });
            // Other thresholds should remain unchanged
            expect(result.amperage).toBeDefined();
        });

        test('merges new thresholds with existing ones', () => {
            const originalAmperage = { ...metricService.thresholds.amperage };

            metricService.updateThresholds({ voltage: { min: 190, max: 260 } });

            expect(metricService.thresholds.amperage).toEqual(originalAmperage);
        });

        test('returns the updated thresholds', () => {
            const result = metricService.updateThresholds({
                temperature: { min: -20, max: 60 }
            });

            expect(result.temperature).toEqual({ min: -20, max: 60 });
        });
    });

    describe('invalidateMetricCaches - error path', () => {
        test('does not throw when cache invalidation fails', async () => {
            cacheService.invalidatePattern.mockRejectedValue(new Error('Cache error'));

            await expect(metricService.invalidateMetricCaches(1)).resolves.not.toThrow();
        });

        test('does not throw when invalidate fails without controllerId', async () => {
            cacheService.invalidatePattern.mockRejectedValue(new Error('Cache error'));

            await expect(metricService.invalidateMetricCaches()).resolves.not.toThrow();
        });
    });

    describe('createMetric - controller status update error', () => {
        test('continues even when controller status update fails', async () => {
            const metricData = { controller_id: 1, voltage: 220 };
            Controller.findById.mockResolvedValue(mockController);
            Metric.create.mockResolvedValue({ metric_id: 2, ...metricData });
            Controller.updateStatus.mockRejectedValue(new Error('Status update failed'));

            const result = await metricService.createMetric(metricData);

            // Should still return the created metric despite status update failure
            expect(result).toHaveProperty('metric_id', 2);
        });
    });
});
