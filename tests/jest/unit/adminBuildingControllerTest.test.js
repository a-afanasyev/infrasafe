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
    getOptimizedBuildings,
    batchBuildingsOperation
} = require('../../../src/controllers/admin/adminBuildingController');

describe('AdminBuildingController', () => {
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

    describe('getOptimizedBuildings', () => {
        test('returns paginated buildings with default params', async () => {
            const mockRows = [{ building_id: 1, name: 'Building 1' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedBuildings(req, res, next);

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

        test('applies search filter with ILIKE', async () => {
            req.query = { search: 'Test' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedBuildings(req, res, next);

            // find the data query (contains LIMIT/OFFSET; count does not)
            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('ILIKE');
        });

        test('applies town filter', async () => {
            req.query = { town: 'Moscow' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedBuildings(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('town');
        });

        test('applies region filter', async () => {
            req.query = { region: 'Central' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedBuildings(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('region');
        });

        test('applies management_company filter', async () => {
            req.query = { management_company: 'UK-1' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedBuildings(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('management_company');
        });

        test('applies multiple filters together', async () => {
            req.query = { search: 'Test', town: 'Moscow', region: 'Central' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedBuildings(req, res, next);

            const dataQuery = db.query.mock.calls.find(c => /LIMIT/.test(c[0]))[0];
            expect(dataQuery).toContain('WHERE');
            expect(dataQuery).toContain('AND');
        });

        test('respects page and limit params', async () => {
            req.query = { page: '2', limit: '20' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '50' }] });

            await getOptimizedBuildings(req, res, next);

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

            await getOptimizedBuildings(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // CRUD delegation block removed in Phase 5: proxies were dead-path
    // and admin routes now call buildingController directly.

    describe('batchBuildingsOperation [R2-03: real batch delete]', () => {
        test('delete → runs batchDelete and returns affected rowCount', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 1 }, { building_id: 2 }, { building_id: 3 }], rowCount: 3 });
            req.body = { action: 'delete', ids: [1, 2, 3] };

            await batchBuildingsOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, affected: 3 })
            );
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/DELETE FROM buildings/);
            expect(params).toEqual([[1, 2, 3]]);
        });

        test('missing ids → 400 (no longer fakes success)', async () => {
            req.body = { action: 'delete' };

            await batchBuildingsOperation(req, res, next);

            expect(res.json).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        });

        test('non-integer ids → 400', async () => {
            req.body = { action: 'delete', ids: [1, 'evil'] };

            await batchBuildingsOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
        });

        test('unimplemented action → 501 (not a fake success)', async () => {
            req.body = { action: 'update', ids: [1] };

            await batchBuildingsOperation(req, res, next);

            expect(res.json).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 501 }));
        });
    });
});
