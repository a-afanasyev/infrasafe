jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn(),
    getAllTransformersWithAnalytics: jest.fn(),
    getOverloadedTransformers: jest.fn(),
    findTransformersInRadius: jest.fn(),
    findNearestBuildings: jest.fn(),
    getLoadAnalysByZone: jest.fn(),
    getPeakLoadForecast: jest.fn(),
    getTransformerStatistics: jest.fn(),
    refreshTransformerAnalytics: jest.fn(),
    invalidateTransformerCaches: jest.fn(),
    getCircuitBreakerStatus: jest.fn(),
    resetCircuitBreakers: jest.fn(),
    updateThresholds: jest.fn()
}));

jest.mock('../../../src/models/PowerTransformer', () => ({
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const AnalyticsController = require('../../../src/controllers/analyticsController');
const analyticsService = require('../../../src/services/analyticsService');
const PowerTransformer = require('../../../src/models/PowerTransformer');

describe('AnalyticsController', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { params: {}, query: {}, body: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
    });

    describe('getTransformerLoad', () => {
        test('returns load data for valid transformer', async () => {
            req.params.transformerId = '1';
            const loadData = { load_percent: 75, status: 'normal' };
            analyticsService.getTransformerLoad.mockResolvedValue(loadData);

            await AnalyticsController.getTransformerLoad(req, res);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: loadData
            });
        });

        test('returns 400 when transformerId is missing', async () => {
            req.params = {};

            await AnalyticsController.getTransformerLoad(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });

        test('returns 500 on service error', async () => {
            req.params.transformerId = '1';
            analyticsService.getTransformerLoad.mockRejectedValue(new Error('Service error'));

            await AnalyticsController.getTransformerLoad(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });
    });

    describe('getAllTransformersAnalytics', () => {
        test('returns all transformers analytics', async () => {
            const transformers = [
                { id: 1, load_percent: 50, status: 'active' },
                { id: 2, load_percent: 90, status: 'active' }
            ];
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue(transformers);

            await AnalyticsController.getAllTransformersAnalytics(req, res);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: transformers,
                count: 2
            });
        });

        test('filters by status', async () => {
            req.query.status = 'active';
            const transformers = [
                { id: 1, load_percent: 50, status: 'active' },
                { id: 2, load_percent: 70, status: 'inactive' }
            ];
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue(transformers);

            await AnalyticsController.getAllTransformersAnalytics(req, res);

            const response = res.json.mock.calls[0][0];
            expect(response.data).toHaveLength(1);
            expect(response.data[0].status).toBe('active');
        });

        test('filters by min_load_percent', async () => {
            req.query.min_load_percent = '60';
            const transformers = [
                { id: 1, load_percent: 50 },
                { id: 2, load_percent: 70 }
            ];
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue(transformers);

            await AnalyticsController.getAllTransformersAnalytics(req, res);

            const response = res.json.mock.calls[0][0];
            expect(response.data).toHaveLength(1);
            expect(response.data[0].load_percent).toBe(70);
        });

        test('filters by max_load_percent', async () => {
            req.query.max_load_percent = '60';
            const transformers = [
                { id: 1, load_percent: 50 },
                { id: 2, load_percent: 70 }
            ];
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue(transformers);

            await AnalyticsController.getAllTransformersAnalytics(req, res);

            const response = res.json.mock.calls[0][0];
            expect(response.data).toHaveLength(1);
            expect(response.data[0].load_percent).toBe(50);
        });

        test('filters overloaded_only', async () => {
            req.query.overloaded_only = 'true';
            const transformers = [
                { id: 1, load_percent: 50 },
                { id: 2, load_percent: 85 }
            ];
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue(transformers);

            await AnalyticsController.getAllTransformersAnalytics(req, res);

            const response = res.json.mock.calls[0][0];
            expect(response.data).toHaveLength(1);
            expect(response.data[0].load_percent).toBe(85);
        });

        test('returns 500 on service error', async () => {
            analyticsService.getAllTransformersWithAnalytics.mockRejectedValue(new Error('fail'));

            await AnalyticsController.getAllTransformersAnalytics(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getOverloadedTransformers', () => {
        test('returns overloaded transformers with default threshold', async () => {
            const data = [{ id: 1, load_percent: 90 }];
            analyticsService.getOverloadedTransformers.mockResolvedValue(data);

            await AnalyticsController.getOverloadedTransformers(req, res);

            expect(analyticsService.getOverloadedTransformers).toHaveBeenCalledWith(undefined);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data,
                count: 1,
                threshold: 80
            });
        });

        test('uses custom threshold', async () => {
            req.query.threshold = '70';
            analyticsService.getOverloadedTransformers.mockResolvedValue([]);

            await AnalyticsController.getOverloadedTransformers(req, res);

            expect(analyticsService.getOverloadedTransformers).toHaveBeenCalledWith(70);
            expect(res.json.mock.calls[0][0].threshold).toBe(70);
        });

        test('returns 500 on error', async () => {
            analyticsService.getOverloadedTransformers.mockRejectedValue(new Error('fail'));

            await AnalyticsController.getOverloadedTransformers(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('findTransformersInRadius', () => {
        test('returns transformers within radius', async () => {
            req.query = { latitude: '41.3', longitude: '69.2', radius: '3000' };
            const data = [{ id: 1 }];
            analyticsService.findTransformersInRadius.mockResolvedValue(data);

            await AnalyticsController.findTransformersInRadius(req, res);

            expect(analyticsService.findTransformersInRadius).toHaveBeenCalledWith(41.3, 69.2, 3000);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data,
                count: 1
            }));
        });

        test('uses default radius of 5000', async () => {
            req.query = { latitude: '41.3', longitude: '69.2' };
            analyticsService.findTransformersInRadius.mockResolvedValue([]);

            await AnalyticsController.findTransformersInRadius(req, res);

            expect(analyticsService.findTransformersInRadius).toHaveBeenCalledWith(41.3, 69.2, 5000);
        });

        test('returns 400 when coordinates missing', async () => {
            req.query = {};

            await AnalyticsController.findTransformersInRadius(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 for invalid coordinates', async () => {
            req.query = { latitude: 'abc', longitude: 'xyz' };

            await AnalyticsController.findTransformersInRadius(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 500 on service error', async () => {
            req.query = { latitude: '41.3', longitude: '69.2' };
            analyticsService.findTransformersInRadius.mockRejectedValue(new Error('fail'));

            await AnalyticsController.findTransformersInRadius(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('findNearestBuildings', () => {
        test('returns nearest buildings with defaults', async () => {
            req.params.transformerId = '1';
            const data = [{ building_id: 1, distance: 500 }];
            analyticsService.findNearestBuildings.mockResolvedValue(data);

            await AnalyticsController.findNearestBuildings(req, res);

            expect(analyticsService.findNearestBuildings).toHaveBeenCalledWith('1', 1000, 50);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data,
                count: 1
            }));
        });

        test('uses custom max_distance and limit', async () => {
            req.params.transformerId = '1';
            req.query = { max_distance: '2000', limit: '10' };
            analyticsService.findNearestBuildings.mockResolvedValue([]);

            await AnalyticsController.findNearestBuildings(req, res);

            expect(analyticsService.findNearestBuildings).toHaveBeenCalledWith('1', 2000, 10);
        });

        test('returns 500 on error', async () => {
            req.params.transformerId = '1';
            analyticsService.findNearestBuildings.mockRejectedValue(new Error('fail'));

            await AnalyticsController.findNearestBuildings(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getLoadAnalyticsByZone', () => {
        test('returns zone analytics', async () => {
            const data = [{ zone: 'A', avg_load: 60 }];
            analyticsService.getLoadAnalysByZone.mockResolvedValue(data);

            await AnalyticsController.getLoadAnalyticsByZone(req, res);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data,
                count: 1
            });
        });

        test('returns 500 on error', async () => {
            analyticsService.getLoadAnalysByZone.mockRejectedValue(new Error('fail'));

            await AnalyticsController.getLoadAnalyticsByZone(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getPeakLoadForecast', () => {
        test('returns forecast with default hours', async () => {
            req.params.transformerId = '1';
            const forecast = { peak_hour: 14, peak_load: 95 };
            analyticsService.getPeakLoadForecast.mockResolvedValue(forecast);

            await AnalyticsController.getPeakLoadForecast(req, res);

            expect(analyticsService.getPeakLoadForecast).toHaveBeenCalledWith('1', 24);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: forecast
            });
        });

        test('uses custom hours parameter', async () => {
            req.params.transformerId = '1';
            req.query.hours = '48';
            analyticsService.getPeakLoadForecast.mockResolvedValue({});

            await AnalyticsController.getPeakLoadForecast(req, res);

            expect(analyticsService.getPeakLoadForecast).toHaveBeenCalledWith('1', 48);
        });

        test('returns 400 when hours < 1', async () => {
            req.params.transformerId = '1';
            req.query.hours = '0';

            await AnalyticsController.getPeakLoadForecast(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 when hours > 168', async () => {
            req.params.transformerId = '1';
            req.query.hours = '200';

            await AnalyticsController.getPeakLoadForecast(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 500 on error', async () => {
            req.params.transformerId = '1';
            analyticsService.getPeakLoadForecast.mockRejectedValue(new Error('fail'));

            await AnalyticsController.getPeakLoadForecast(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getTransformerStatistics', () => {
        test('returns statistics', async () => {
            const stats = { total: 10, active: 8 };
            analyticsService.getTransformerStatistics.mockResolvedValue(stats);

            await AnalyticsController.getTransformerStatistics(req, res);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: stats
            });
        });

        test('returns 500 on error', async () => {
            analyticsService.getTransformerStatistics.mockRejectedValue(new Error('fail'));

            await AnalyticsController.getTransformerStatistics(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('refreshAnalytics', () => {
        test('refreshes and returns result', async () => {
            const result = { refreshed: true };
            analyticsService.refreshTransformerAnalytics.mockResolvedValue(result);

            await AnalyticsController.refreshAnalytics(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: result
            }));
        });

        test('returns 500 on error', async () => {
            analyticsService.refreshTransformerAnalytics.mockRejectedValue(new Error('fail'));

            await AnalyticsController.refreshAnalytics(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('invalidateCaches', () => {
        test('invalidates caches successfully', async () => {
            analyticsService.invalidateTransformerCaches.mockResolvedValue();

            await AnalyticsController.invalidateCaches(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        test('returns 500 on error', async () => {
            analyticsService.invalidateTransformerCaches.mockRejectedValue(new Error('fail'));

            await AnalyticsController.invalidateCaches(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getSystemStatus', () => {
        test('returns system status with circuit breaker info', async () => {
            const cbStatus = { main: 'closed' };
            analyticsService.getCircuitBreakerStatus.mockReturnValue(cbStatus);

            await AnalyticsController.getSystemStatus(req, res);

            const response = res.json.mock.calls[0][0];
            expect(response.success).toBe(true);
            expect(response.data.circuit_breakers).toEqual(cbStatus);
            expect(response.data.system_health).toBe('operational');
            expect(response.data.timestamp).toBeDefined();
        });

        test('returns 500 on error', async () => {
            analyticsService.getCircuitBreakerStatus.mockImplementation(() => {
                throw new Error('fail');
            });

            await AnalyticsController.getSystemStatus(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('resetCircuitBreakers', () => {
        test('resets circuit breakers', async () => {
            analyticsService.resetCircuitBreakers.mockReturnValue();

            await AnalyticsController.resetCircuitBreakers(req, res);

            expect(analyticsService.resetCircuitBreakers).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        test('returns 500 on error', async () => {
            analyticsService.resetCircuitBreakers.mockImplementation(() => {
                throw new Error('fail');
            });

            await AnalyticsController.resetCircuitBreakers(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('updateThresholds', () => {
        test('updates thresholds with valid data', async () => {
            req.body = { thresholds: { warning: 70, critical: 90 } };
            analyticsService.updateThresholds.mockReturnValue();

            await AnalyticsController.updateThresholds(req, res);

            expect(analyticsService.updateThresholds).toHaveBeenCalledWith({ warning: 70, critical: 90 });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: { warning: 70, critical: 90 }
            }));
        });

        test('returns 400 when thresholds missing', async () => {
            req.body = {};

            await AnalyticsController.updateThresholds(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 when thresholds is not an object', async () => {
            req.body = { thresholds: 'invalid' };

            await AnalyticsController.updateThresholds(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 500 on error', async () => {
            req.body = { thresholds: { warning: 70 } };
            analyticsService.updateThresholds.mockImplementation(() => {
                throw new Error('fail');
            });

            await AnalyticsController.updateThresholds(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('createTransformer', () => {
        test('creates transformer with valid data', async () => {
            req.body = {
                id: 'T1', name: 'TP-100', address: '123 St',
                latitude: 41.3, longitude: 69.2, capacity_kva: 630
            };
            const created = { ...req.body };
            PowerTransformer.create.mockResolvedValue(created);
            analyticsService.invalidateTransformerCaches.mockResolvedValue();

            await AnalyticsController.createTransformer(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: created
            }));
        });

        test('returns 400 when required field is missing', async () => {
            req.body = { name: 'TP-100' }; // missing id, address, etc.

            await AnalyticsController.createTransformer(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 500 on model error', async () => {
            req.body = {
                id: 'T1', name: 'TP-100', address: '123 St',
                latitude: 41.3, longitude: 69.2, capacity_kva: 630
            };
            PowerTransformer.create.mockRejectedValue(new Error('fail'));

            await AnalyticsController.createTransformer(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('updateTransformer', () => {
        test('updates transformer', async () => {
            req.params.transformerId = '1';
            req.body = { name: 'Updated' };
            const updated = { id: 1, name: 'Updated' };
            PowerTransformer.update.mockResolvedValue(updated);
            analyticsService.invalidateTransformerCaches.mockResolvedValue();

            await AnalyticsController.updateTransformer(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: updated
            }));
        });

        test('returns 404 when transformer not found', async () => {
            req.params.transformerId = '999';
            req.body = { name: 'X' };
            PowerTransformer.update.mockResolvedValue(null);

            await AnalyticsController.updateTransformer(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('returns 500 on error', async () => {
            req.params.transformerId = '1';
            req.body = { name: 'X' };
            PowerTransformer.update.mockRejectedValue(new Error('fail'));

            await AnalyticsController.updateTransformer(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('deleteTransformer', () => {
        test('deletes transformer', async () => {
            req.params.transformerId = '1';
            PowerTransformer.delete.mockResolvedValue({ id: 1 });
            analyticsService.invalidateTransformerCaches.mockResolvedValue();

            await AnalyticsController.deleteTransformer(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        test('returns 404 when transformer not found', async () => {
            req.params.transformerId = '999';
            PowerTransformer.delete.mockResolvedValue(null);

            await AnalyticsController.deleteTransformer(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('returns 500 on error', async () => {
            req.params.transformerId = '1';
            PowerTransformer.delete.mockRejectedValue(new Error('fail'));

            await AnalyticsController.deleteTransformer(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
