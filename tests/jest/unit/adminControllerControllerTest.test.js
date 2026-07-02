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
    getOptimizedControllers,
    batchControllersOperation
} = require('../../../src/controllers/admin/adminControllerController');

describe('AdminControllerController', () => {
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

    describe('getOptimizedControllers', () => {
        test('returns paginated controllers with defaults', async () => {
            const mockRows = [{ controller_id: 1, serial_number: 'SN-1' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedControllers(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: mockRows,
                    pagination: expect.objectContaining({
                        total: 1,
                        page: expect.any(Number),
                        limit: expect.any(Number),
                    })
                })
            );
        });

        test('applies status filter', async () => {
            req.query = { status: 'online' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('status');
        });

        test('applies manufacturer filter', async () => {
            req.query = { manufacturer: 'ACME' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('manufacturer');
        });

        test('applies search filter via serial_number ILIKE', async () => {
            req.query = { search: 'SN-' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toMatch(/serial_number ILIKE/);
        });

        test('calls next on DB error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedControllers(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('batchControllersOperation [R2-03: real batch delete, delete-only]', () => {
        test('delete → runs batchDelete and returns affected rowCount', async () => {
            db.query.mockResolvedValue({ rows: [{ controller_id: 1 }, { controller_id: 2 }], rowCount: 2 });
            req.body = { action: 'delete', ids: [1, 2] };
            await batchControllersOperation(req, res, next);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, affected: 2 })
            );
            expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM controllers/);
        });

        test('missing ids → 400 (no longer fakes success)', async () => {
            req.body = { action: 'delete' };
            await batchControllersOperation(req, res, next);
            expect(res.json).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        });

        test('non-delete action → 501 (controllers has no updated_at → delete-only)', async () => {
            req.body = { action: 'update', ids: [1] };
            await batchControllersOperation(req, res, next);
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 501 }));
        });
    });
});
