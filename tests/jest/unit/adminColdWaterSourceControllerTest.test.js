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
    getOptimizedColdWaterSources,
    createColdWaterSource,
    getColdWaterSourceById,
    updateColdWaterSource,
    deleteColdWaterSource
} = require('../../../src/controllers/admin/adminColdWaterSourceController');

describe('AdminColdWaterSourceController', () => {
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

    describe('getOptimizedColdWaterSources', () => {
        test('returns paginated sources with default params', async () => {
            const mockRows = [{ id: 'src-1', name: 'Source 1' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedColdWaterSources(req, res, next);

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
            req.query = { search: 'Well' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedColdWaterSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('ILIKE');
        });

        test('applies source_type filter', async () => {
            req.query = { source_type: 'well' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedColdWaterSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('source_type');
        });

        test('applies status filter', async () => {
            req.query = { status: 'active' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedColdWaterSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('status');
        });

        test('applies multiple filters together', async () => {
            req.query = { search: 'Well', source_type: 'well', status: 'active' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedColdWaterSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('WHERE');
            expect(dataQuery).toContain('AND');
        });

        test('calls next on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedColdWaterSources(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createColdWaterSource', () => {
        test('creates and returns 201 with valid data', async () => {
            req.body = { name: 'New Source', source_type: 'well', status: 'active' };
            const mockResult = { id: 'src-1', ...req.body };
            db.query.mockResolvedValue({ rows: [mockResult] });

            await createColdWaterSource(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockResult,
                    message: 'Cold water source created successfully'
                })
            );
        });

        test('returns 400 when name is missing', async () => {
            req.body = { source_type: 'well' };

            await createColdWaterSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('required'),
                    statusCode: 400
                })
            );
        });

        test('calls next on database error', async () => {
            req.body = { name: 'Source' };
            db.query.mockRejectedValue(new Error('DB error'));

            await createColdWaterSource(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getColdWaterSourceById', () => {
        test('returns source when found', async () => {
            req.params.id = 'src-1';
            const mockSource = { id: 'src-1', name: 'Source 1' };
            db.query.mockResolvedValue({ rows: [mockSource] });

            await getColdWaterSourceById(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockSource
                })
            );
        });

        test('calls next with 404 when not found', async () => {
            req.params.id = 'missing';
            db.query.mockResolvedValue({ rows: [] });

            await getColdWaterSourceById(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('not found'),
                    statusCode: 404
                })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = 'src-1';
            db.query.mockRejectedValue(new Error('DB error'));

            await getColdWaterSourceById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateColdWaterSource', () => {
        test('updates and returns source', async () => {
            req.params.id = 'src-1';
            req.body = { name: 'Updated Source' };
            const mockUpdated = { id: 'src-1', name: 'Updated Source' };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateColdWaterSource(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockUpdated,
                    message: 'Cold water source updated successfully'
                })
            );
        });

        test('calls next with 400 when no fields to update', async () => {
            req.params.id = 'src-1';
            req.body = {};

            await updateColdWaterSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('No fields'),
                    statusCode: 400
                })
            );
        });

        test('calls next with 404 when source not found', async () => {
            req.params.id = 'missing';
            req.body = { name: 'Updated' };
            db.query.mockResolvedValue({ rows: [] });

            await updateColdWaterSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('can update multiple fields', async () => {
            req.params.id = 'src-1';
            req.body = { name: 'Updated', capacity_m3_per_hour: 100, status: 'maintenance' };
            const mockUpdated = { id: 'src-1', ...req.body };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateColdWaterSource(req, res, next);

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('name');
            expect(queryCall[0]).toContain('capacity_m3_per_hour');
            expect(queryCall[0]).toContain('status');
        });

        test('calls next on database error', async () => {
            req.params.id = 'src-1';
            req.body = { name: 'X' };
            db.query.mockRejectedValue(new Error('DB error'));

            await updateColdWaterSource(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteColdWaterSource', () => {
        test('deletes and returns success', async () => {
            req.params.id = 'src-1';
            db.query.mockResolvedValue({ rows: [{ id: 'src-1' }] });

            await deleteColdWaterSource(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Cold water source deleted successfully'
                })
            );
        });

        test('calls next with 404 when not found', async () => {
            req.params.id = 'missing';
            db.query.mockResolvedValue({ rows: [] });

            await deleteColdWaterSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = 'src-1';
            db.query.mockRejectedValue(new Error('DB error'));

            await deleteColdWaterSource(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
