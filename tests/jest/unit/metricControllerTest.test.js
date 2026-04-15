jest.mock('../../../src/services/metricService', () => ({
    getAllMetrics: jest.fn(),
    getMetricById: jest.fn(),
    getLastMetricsForAllControllers: jest.fn(),
    getMetricsByControllerId: jest.fn(),
    createMetric: jest.fn(),
    processTelemetry: jest.fn(),
    deleteMetric: jest.fn(),
    getAggregatedMetrics: jest.fn(),
    cleanupOldMetrics: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const metricService = require('../../../src/services/metricService');
const {
    getAllMetrics,
    getMetricById,
    getLastMetricsForAllControllers,
    getMetricsByControllerId,
    createMetric,
    receiveTelemetry,
    deleteMetric,
    getAggregatedMetrics,
    cleanupOldMetrics
} = require('../../../src/controllers/metricController');

describe('MetricController', () => {
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

    const mockMetric = {
        metric_id: 1,
        controller_id: 1,
        metric_type: 'temperature',
        value: 22.5,
        timestamp: '2026-04-01T10:00:00Z'
    };

    const mockPaginated = {
        data: [mockMetric],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
    };

    describe('getAllMetrics', () => {
        test('returns paginated list with 200', async () => {
            metricService.getAllMetrics.mockResolvedValue(mockPaginated);

            await getAllMetrics(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockPaginated);
        });

        test('passes parsed query params to service', async () => {
            req.query = { page: '3', limit: '25', sort: 'value', order: 'asc' };
            metricService.getAllMetrics.mockResolvedValue(mockPaginated);

            await getAllMetrics(req, res, next);

            expect(metricService.getAllMetrics).toHaveBeenCalledWith(3, 25, 'value', 'asc');
        });

        test('uses defaults for missing query params', async () => {
            metricService.getAllMetrics.mockResolvedValue(mockPaginated);

            await getAllMetrics(req, res, next);

            expect(metricService.getAllMetrics).toHaveBeenCalledWith(1, 10, 'timestamp', 'desc');
        });

        test('calls next on error', async () => {
            metricService.getAllMetrics.mockRejectedValue(new Error('DB error'));

            await getAllMetrics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getMetricById', () => {
        test('returns metric with 200 when found', async () => {
            req.params.id = '1';
            metricService.getMetricById.mockResolvedValue(mockMetric);

            await getMetricById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockMetric);
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            metricService.getMetricById.mockResolvedValue(null);

            await getMetricById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({ message: 'Metric not found' })
                })
            );
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            metricService.getMetricById.mockRejectedValue(new Error('DB error'));

            await getMetricById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getLastMetricsForAllControllers', () => {
        test('returns metrics with 200', async () => {
            const mockMetrics = [mockMetric];
            metricService.getLastMetricsForAllControllers.mockResolvedValue(mockMetrics);

            await getLastMetricsForAllControllers(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockMetrics);
        });

        test('calls next on error', async () => {
            metricService.getLastMetricsForAllControllers.mockRejectedValue(new Error('Error'));

            await getLastMetricsForAllControllers(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getMetricsByControllerId', () => {
        test('returns metrics with 200', async () => {
            req.params.controllerId = '1';
            req.query = { startDate: '2026-01-01', endDate: '2026-01-31' };
            metricService.getMetricsByControllerId.mockResolvedValue([mockMetric]);

            await getMetricsByControllerId(req, res, next);

            expect(metricService.getMetricsByControllerId).toHaveBeenCalledWith('1', '2026-01-01', '2026-01-31');
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('returns 404 when controller not found', async () => {
            req.params.controllerId = '999';
            req.query = {};
            const error = new Error('Controller not found');
            error.code = 'CONTROLLER_NOT_FOUND';
            metricService.getMetricsByControllerId.mockRejectedValue(error);

            await getMetricsByControllerId(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on generic error', async () => {
            req.params.controllerId = '1';
            req.query = {};
            metricService.getMetricsByControllerId.mockRejectedValue(new Error('DB error'));

            await getMetricsByControllerId(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createMetric', () => {
        test('creates and returns 201', async () => {
            req.body = { controller_id: 1, metric_type: 'temperature', value: 22.5 };
            metricService.createMetric.mockResolvedValue(mockMetric);

            await createMetric(req, res, next);

            expect(metricService.createMetric).toHaveBeenCalledWith(req.body);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(mockMetric);
        });

        test('returns 404 when controller not found', async () => {
            req.body = { controller_id: 999, metric_type: 'temperature', value: 22.5 };
            const error = new Error('Controller not found');
            error.code = 'CONTROLLER_NOT_FOUND';
            metricService.createMetric.mockRejectedValue(error);

            await createMetric(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on generic error', async () => {
            req.body = { controller_id: 1 };
            metricService.createMetric.mockRejectedValue(new Error('Validation error'));

            await createMetric(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('receiveTelemetry', () => {
        test('processes telemetry and returns 201', async () => {
            req.body = { serial_number: 'SN-001', metrics: { temperature: 22.5 } };
            const mockResult = { success: true, metric_id: 1 };
            metricService.processTelemetry.mockResolvedValue(mockResult);

            await receiveTelemetry(req, res, next);

            expect(metricService.processTelemetry).toHaveBeenCalledWith(req.body);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        test('returns 404 when controller not found', async () => {
            req.body = { serial_number: 'UNKNOWN' };
            const error = new Error('Controller not found');
            error.code = 'CONTROLLER_NOT_FOUND';
            metricService.processTelemetry.mockRejectedValue(error);

            await receiveTelemetry(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on generic error', async () => {
            req.body = {};
            metricService.processTelemetry.mockRejectedValue(new Error('Processing error'));

            await receiveTelemetry(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteMetric', () => {
        test('deletes and returns 200 with message', async () => {
            req.params.id = '1';
            metricService.deleteMetric.mockResolvedValue(mockMetric);

            await deleteMetric(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Metric deleted successfully',
                    deleted: mockMetric
                })
            );
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            metricService.deleteMetric.mockResolvedValue(null);

            await deleteMetric(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            metricService.deleteMetric.mockRejectedValue(new Error('DB error'));

            await deleteMetric(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getAggregatedMetrics', () => {
        test('returns aggregated metrics with 200', async () => {
            req.params.controllerId = '1';
            req.query = { timeFrame: '24h' };
            const mockAggregated = { avg: 22.5, min: 20, max: 25 };
            metricService.getAggregatedMetrics.mockResolvedValue(mockAggregated);

            await getAggregatedMetrics(req, res, next);

            expect(metricService.getAggregatedMetrics).toHaveBeenCalledWith('1', '24h');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockAggregated);
        });

        test('uses default timeFrame 1h when not specified', async () => {
            req.params.controllerId = '1';
            req.query = {};
            metricService.getAggregatedMetrics.mockResolvedValue({});

            await getAggregatedMetrics(req, res, next);

            expect(metricService.getAggregatedMetrics).toHaveBeenCalledWith('1', '1h');
        });

        test('calls next on error', async () => {
            req.params.controllerId = '1';
            req.query = {};
            metricService.getAggregatedMetrics.mockRejectedValue(new Error('Error'));

            await getAggregatedMetrics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('cleanupOldMetrics', () => {
        test('cleans up and returns 200', async () => {
            req.query = { daysToKeep: '60' };
            const mockResult = { deleted: 100 };
            metricService.cleanupOldMetrics.mockResolvedValue(mockResult);

            await cleanupOldMetrics(req, res, next);

            expect(metricService.cleanupOldMetrics).toHaveBeenCalledWith(60);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        test('uses default daysToKeep 90 when not specified', async () => {
            req.query = {};
            metricService.cleanupOldMetrics.mockResolvedValue({ deleted: 0 });

            await cleanupOldMetrics(req, res, next);

            expect(metricService.cleanupOldMetrics).toHaveBeenCalledWith(90);
        });

        test('calls next on error', async () => {
            req.query = {};
            metricService.cleanupOldMetrics.mockRejectedValue(new Error('Error'));

            await cleanupOldMetrics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
