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
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const {
    getOptimizedMetrics,
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
        test('returns paginated metrics with defaults', async () => {
            const mockRows = [{ metric_id: 1, controller_id: 10 }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedMetrics(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: mockRows,
                    pagination: expect.objectContaining({ total: 1 })
                })
            );
        });

        test('default limit is 100 (metrics-specific)', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedMetrics(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    pagination: expect.objectContaining({ limit: 100 })
                })
            );
        });

        test('applies controller_id filter', async () => {
            req.query = { controller_id: '5' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedMetrics(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('controller_id');
        });

        test('applies start_date / end_date as timestamp range', async () => {
            req.query = { start_date: '2025-01-01', end_date: '2025-12-31' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedMetrics(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toMatch(/timestamp\s*>=/);
            expect(dataQuery).toMatch(/timestamp\s*<=/);
        });

        test('calls next on DB error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedMetrics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('batchMetricsOperation', () => {
        test('returns success with affected 0', async () => {
            req.body = { action: 'delete' };
            await batchMetricsOperation(req, res, next);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, affected: 0 })
            );
        });
    });
});
