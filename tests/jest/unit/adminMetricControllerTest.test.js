jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/controllers/metricController', () => ({
    createMetric: jest.fn(),
    getMetricById: jest.fn(),
    updateMetric: jest.fn(),
    deleteMetric: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const metricController = require('../../../src/controllers/metricController');
const {
    getOptimizedMetrics,
    createMetric,
    getMetricById,
    updateMetric,
    deleteMetric,
    batchMetricsOperation
} = require('../../../src/controllers/admin/adminMetricController');

describe('AdminMetricController', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { params: {}, query: {}, body: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    describe('getOptimizedMetrics', () => {
        test('returns paginated metrics with default params', async () => {
            const mockRows = [{ metric_id: 1, controller_id: 1, timestamp: '2026-01-01' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedMetrics(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: mockRows,
                    pagination: expect.objectContaining({
                        total: 1,
                        page: expect.any(Number),
                        limit: expect.any(Number),
                        totalPages: expect.any(Number)
                    })
                })
            );
        });

        test('applies controller_id filter', async () => {
            req.query = { controller_id: '5' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedMetrics(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('controller_id');
        });

        test('applies start_date filter', async () => {
            req.query = { start_date: '2026-01-01' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedMetrics(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('timestamp >=');
        });

        test('applies end_date filter', async () => {
            req.query = { end_date: '2026-12-31' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedMetrics(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('timestamp <=');
        });

        test('applies multiple filters together', async () => {
            req.query = { controller_id: '1', start_date: '2026-01-01', end_date: '2026-12-31' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedMetrics(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('WHERE');
            expect(dataQuery).toContain('AND');
        });

        test('respects page and limit params', async () => {
            req.query = { page: '2', limit: '20' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '50' }] });

            await getOptimizedMetrics(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    pagination: expect.objectContaining({
                        page: 2,
                        limit: 20
                    })
                })
            );
        });

        test('calls next on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedMetrics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('CRUD delegation', () => {
        test('createMetric delegates to metricController', async () => {
            metricController.createMetric.mockResolvedValue(undefined);

            await createMetric(req, res, next);

            expect(metricController.createMetric).toHaveBeenCalledWith(req, res, next);
        });

        test('getMetricById delegates to metricController', async () => {
            metricController.getMetricById.mockResolvedValue(undefined);

            await getMetricById(req, res, next);

            expect(metricController.getMetricById).toHaveBeenCalledWith(req, res, next);
        });

        test('updateMetric delegates to metricController', async () => {
            metricController.updateMetric.mockResolvedValue(undefined);

            await updateMetric(req, res, next);

            expect(metricController.updateMetric).toHaveBeenCalledWith(req, res, next);
        });

        test('deleteMetric delegates to metricController', async () => {
            metricController.deleteMetric.mockResolvedValue(undefined);

            await deleteMetric(req, res, next);

            expect(metricController.deleteMetric).toHaveBeenCalledWith(req, res, next);
        });
    });

    describe('batchMetricsOperation', () => {
        test('returns success with stub message', async () => {
            req.body = { action: 'delete' };

            await batchMetricsOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 0,
                    message: expect.stringContaining('delete')
                })
            );
        });

        test('includes action name in message', async () => {
            req.body = { action: 'archive' };

            await batchMetricsOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('archive')
                })
            );
        });

        test('returns affected 0 as stub', async () => {
            req.body = { action: 'cleanup', ids: [1, 2, 3] };

            await batchMetricsOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    affected: 0
                })
            );
        });
    });
});
