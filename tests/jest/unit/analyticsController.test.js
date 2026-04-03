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

            await AnalyticsController.getTransformerLoad(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: loadData
            });
        });

        test('returns 400 when transformerId is missing', async () => {
            req.params = {};

            await AnalyticsController.getTransformerLoad(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });

        test('delegates to next(error) on service error', async () => {
            req.params.transformerId = '1';
            const error = new Error('Service error');
            analyticsService.getTransformerLoad.mockRejectedValue(error);

            await AnalyticsController.getTransformerLoad(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getAllTransformersAnalytics', () => {
        test('returns all transformers analytics', async () => {
            const transformers = [
                { id: 1, load_percent: 50, status: 'active' },
                { id: 2, load_percent: 90, status: 'active' }
            ];
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue(transformers);

            await AnalyticsController.getAllTransformersAnalytics(req, res, next);

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

            await AnalyticsController.getAllTransformersAnalytics(req, res, next);

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

            await AnalyticsController.getAllTransformersAnalytics(req, res, next);

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

            await AnalyticsController.getAllTransformersAnalytics(req, res, next);

            const response = res.json.mock.calls[0][0];
            expect(response.data).toHaveLength(1);
            expect(response.data[0].load_percent).toBe(50);
        });

        test('filters overloaded_only (load_percent >= 80 threshold)', async () => {
            req.query.overloaded_only = 'true';
            const transformers = [
                { id: 1, load_percent: 50 },
                { id: 2, load_percent: 85 }
            ];
            analyticsService.getAllTransformersWithAnalytics.mockResolvedValue(transformers);

            await AnalyticsController.getAllTransformersAnalytics(req, res, next);

            const response = res.json.mock.calls[0][0];
            expect(response.data).toHaveLength(1);
            expect(response.data[0].load_percent).toBe(85);
        });

        test('delegates to next(error) on service error', async () => {
            const error = new Error('fail');
            analyticsService.getAllTransformersWithAnalytics.mockRejectedValue(error);

            await AnalyticsController.getAllTransformersAnalytics(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getOverloadedTransformers', () => {
        test('returns overloaded transformers with default threshold', async () => {
            const data = [{ id: 1, load_percent: 90 }];
            analyticsService.getOverloadedTransformers.mockResolvedValue(data);

            await AnalyticsController.getOverloadedTransformers(req, res, next);

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

            await AnalyticsController.getOverloadedTransformers(req, res, next);

            expect(analyticsService.getOverloadedTransformers).toHaveBeenCalledWith(70);
            expect(res.json.mock.calls[0][0].threshold).toBe(70);
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            analyticsService.getOverloadedTransformers.mockRejectedValue(error);

            await AnalyticsController.getOverloadedTransformers(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('findTransformersInRadius', () => {
        test('returns transformers within radius', async () => {
            req.query = { latitude: '41.3', longitude: '69.2', radius: '3000' };
            const data = [{ id: 1 }];
            analyticsService.findTransformersInRadius.mockResolvedValue(data);

            await AnalyticsController.findTransformersInRadius(req, res, next);

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

            await AnalyticsController.findTransformersInRadius(req, res, next);

            expect(analyticsService.findTransformersInRadius).toHaveBeenCalledWith(41.3, 69.2, 5000);
        });

        test('returns 400 when coordinates missing', async () => {
            req.query = {};

            await AnalyticsController.findTransformersInRadius(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 for invalid coordinates', async () => {
            req.query = { latitude: 'abc', longitude: 'xyz' };

            await AnalyticsController.findTransformersInRadius(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('delegates to next(error) on service error', async () => {
            req.query = { latitude: '41.3', longitude: '69.2' };
            const error = new Error('fail');
            analyticsService.findTransformersInRadius.mockRejectedValue(error);

            await AnalyticsController.findTransformersInRadius(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('findNearestBuildings', () => {
        test('returns nearest buildings with defaults', async () => {
            req.params.transformerId = '1';
            const data = [{ building_id: 1, distance: 500 }];
            analyticsService.findNearestBuildings.mockResolvedValue(data);

            await AnalyticsController.findNearestBuildings(req, res, next);

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

            await AnalyticsController.findNearestBuildings(req, res, next);

            expect(analyticsService.findNearestBuildings).toHaveBeenCalledWith('1', 2000, 10);
        });

        test('delegates to next(error) on error', async () => {
            req.params.transformerId = '1';
            const error = new Error('fail');
            analyticsService.findNearestBuildings.mockRejectedValue(error);

            await AnalyticsController.findNearestBuildings(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getLoadAnalyticsByZone', () => {
        test('returns zone analytics', async () => {
            const data = [{ zone: 'A', avg_load: 60 }];
            analyticsService.getLoadAnalysByZone.mockResolvedValue(data);

            await AnalyticsController.getLoadAnalyticsByZone(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data,
                count: 1
            });
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            analyticsService.getLoadAnalysByZone.mockRejectedValue(error);

            await AnalyticsController.getLoadAnalyticsByZone(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getPeakLoadForecast', () => {
        test('returns forecast with default hours', async () => {
            req.params.transformerId = '1';
            const forecast = { peak_hour: 14, peak_load: 95 };
            analyticsService.getPeakLoadForecast.mockResolvedValue(forecast);

            await AnalyticsController.getPeakLoadForecast(req, res, next);

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

            await AnalyticsController.getPeakLoadForecast(req, res, next);

            expect(analyticsService.getPeakLoadForecast).toHaveBeenCalledWith('1', 48);
        });

        test('returns 400 when hours < 1', async () => {
            req.params.transformerId = '1';
            req.query.hours = '0';

            await AnalyticsController.getPeakLoadForecast(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 when hours > 168', async () => {
            req.params.transformerId = '1';
            req.query.hours = '200';

            await AnalyticsController.getPeakLoadForecast(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('delegates to next(error) on error', async () => {
            req.params.transformerId = '1';
            const error = new Error('fail');
            analyticsService.getPeakLoadForecast.mockRejectedValue(error);

            await AnalyticsController.getPeakLoadForecast(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getTransformerStatistics', () => {
        test('returns statistics', async () => {
            const stats = { total: 10, active: 8 };
            analyticsService.getTransformerStatistics.mockResolvedValue(stats);

            await AnalyticsController.getTransformerStatistics(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: stats
            });
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            analyticsService.getTransformerStatistics.mockRejectedValue(error);

            await AnalyticsController.getTransformerStatistics(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('refreshAnalytics', () => {
        test('refreshes and returns result', async () => {
            const result = { refreshed: true };
            analyticsService.refreshTransformerAnalytics.mockResolvedValue(result);

            await AnalyticsController.refreshAnalytics(req, res, next);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: result
            }));
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            analyticsService.refreshTransformerAnalytics.mockRejectedValue(error);

            await AnalyticsController.refreshAnalytics(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('invalidateCaches', () => {
        test('invalidates caches successfully', async () => {
            analyticsService.invalidateTransformerCaches.mockResolvedValue();

            await AnalyticsController.invalidateCaches(req, res, next);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            analyticsService.invalidateTransformerCaches.mockRejectedValue(error);

            await AnalyticsController.invalidateCaches(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getSystemStatus', () => {
        test('returns system status with circuit breaker info', async () => {
            const cbStatus = { main: 'closed' };
            analyticsService.getCircuitBreakerStatus.mockReturnValue(cbStatus);

            await AnalyticsController.getSystemStatus(req, res, next);

            const response = res.json.mock.calls[0][0];
            expect(response.success).toBe(true);
            expect(response.data.circuit_breakers).toEqual(cbStatus);
            expect(response.data.system_health).toBe('operational');
            expect(response.data.timestamp).toBeDefined();
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            analyticsService.getCircuitBreakerStatus.mockImplementation(() => {
                throw error;
            });

            await AnalyticsController.getSystemStatus(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('resetCircuitBreakers', () => {
        test('resets circuit breakers', async () => {
            analyticsService.resetCircuitBreakers.mockReturnValue();

            await AnalyticsController.resetCircuitBreakers(req, res, next);

            expect(analyticsService.resetCircuitBreakers).toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            analyticsService.resetCircuitBreakers.mockImplementation(() => {
                throw error;
            });

            await AnalyticsController.resetCircuitBreakers(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('updateThresholds', () => {
        test('updates thresholds with valid data', async () => {
            req.body = { thresholds: { warning: 70, critical: 90 } };
            analyticsService.updateThresholds.mockReturnValue();

            await AnalyticsController.updateThresholds(req, res, next);

            expect(analyticsService.updateThresholds).toHaveBeenCalledWith({ warning: 70, critical: 90 });
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: { warning: 70, critical: 90 }
            }));
        });

        test('returns 400 when thresholds missing', async () => {
            req.body = {};

            await AnalyticsController.updateThresholds(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 when thresholds is not an object', async () => {
            req.body = { thresholds: 'invalid' };

            await AnalyticsController.updateThresholds(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('delegates to next(error) on error', async () => {
            req.body = { thresholds: { warning: 70 } };
            const error = new Error('fail');
            analyticsService.updateThresholds.mockImplementation(() => {
                throw error;
            });

            await AnalyticsController.updateThresholds(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
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

            await AnalyticsController.createTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: created
            }));
        });

        test('returns 400 when required field is missing', async () => {
            req.body = { name: 'TP-100' }; // missing id, address, etc.

            await AnalyticsController.createTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('delegates to next(error) on model error', async () => {
            req.body = {
                id: 'T1', name: 'TP-100', address: '123 St',
                latitude: 41.3, longitude: 69.2, capacity_kva: 630
            };
            const error = new Error('fail');
            PowerTransformer.create.mockRejectedValue(error);

            await AnalyticsController.createTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('updateTransformer', () => {
        test('updates transformer', async () => {
            req.params.transformerId = '1';
            req.body = { name: 'Updated' };
            const updated = { id: 1, name: 'Updated' };
            PowerTransformer.update.mockResolvedValue(updated);
            analyticsService.invalidateTransformerCaches.mockResolvedValue();

            await AnalyticsController.updateTransformer(req, res, next);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: updated
            }));
        });

        test('returns 404 when transformer not found', async () => {
            req.params.transformerId = '999';
            req.body = { name: 'X' };
            PowerTransformer.update.mockResolvedValue(null);

            await AnalyticsController.updateTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('delegates to next(error) on error', async () => {
            req.params.transformerId = '1';
            req.body = { name: 'X' };
            const error = new Error('fail');
            PowerTransformer.update.mockRejectedValue(error);

            await AnalyticsController.updateTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('deleteTransformer', () => {
        test('deletes transformer', async () => {
            req.params.transformerId = '1';
            PowerTransformer.delete.mockResolvedValue({ id: 1 });
            analyticsService.invalidateTransformerCaches.mockResolvedValue();

            await AnalyticsController.deleteTransformer(req, res, next);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));
        });

        test('returns 404 when transformer not found', async () => {
            req.params.transformerId = '999';
            PowerTransformer.delete.mockResolvedValue(null);

            await AnalyticsController.deleteTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('delegates to next(error) on error', async () => {
            req.params.transformerId = '1';
            const error = new Error('fail');
            PowerTransformer.delete.mockRejectedValue(error);

            await AnalyticsController.deleteTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });
});
