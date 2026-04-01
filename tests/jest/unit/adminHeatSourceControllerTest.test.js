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
    getOptimizedHeatSources,
    createHeatSource,
    getHeatSourceById,
    updateHeatSource,
    deleteHeatSource
} = require('../../../src/controllers/admin/adminHeatSourceController');

describe('AdminHeatSourceController', () => {
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

    describe('getOptimizedHeatSources', () => {
        test('returns paginated heat sources with default params', async () => {
            const mockRows = [{ id: 'hs-1', name: 'Boiler 1' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedHeatSources(req, res, next);

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
            req.query = { search: 'Boiler' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedHeatSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('ILIKE');
        });

        test('applies source_type filter', async () => {
            req.query = { source_type: 'boiler' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedHeatSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('source_type');
        });

        test('applies status filter', async () => {
            req.query = { status: 'active' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedHeatSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('status');
        });

        test('applies multiple filters together', async () => {
            req.query = { search: 'Boiler', source_type: 'boiler', status: 'active' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedHeatSources(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('WHERE');
            expect(dataQuery).toContain('AND');
        });

        test('calls next on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedHeatSources(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createHeatSource', () => {
        test('creates and returns 201 with valid data', async () => {
            req.body = {
                name: 'Boiler 1',
                latitude: 41.3,
                longitude: 69.2,
                source_type: 'boiler'
            };
            const mockResult = { id: 'hs-1', ...req.body };
            db.query.mockResolvedValue({ rows: [mockResult] });

            await createHeatSource(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockResult,
                    message: 'Heat source created successfully'
                })
            );
        });

        test('returns 400 when name is missing', async () => {
            req.body = { latitude: 41.3, longitude: 69.2, source_type: 'boiler' };

            await createHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('required'),
                    statusCode: 400
                })
            );
        });

        test('returns 400 when latitude is missing', async () => {
            req.body = { name: 'Boiler', longitude: 69.2, source_type: 'boiler' };

            await createHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when longitude is missing', async () => {
            req.body = { name: 'Boiler', latitude: 41.3, source_type: 'boiler' };

            await createHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when source_type is missing', async () => {
            req.body = { name: 'Boiler', latitude: 41.3, longitude: 69.2 };

            await createHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('calls next on database error', async () => {
            req.body = { name: 'Boiler', latitude: 41.3, longitude: 69.2, source_type: 'boiler' };
            db.query.mockRejectedValue(new Error('DB error'));

            await createHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getHeatSourceById', () => {
        test('returns heat source when found', async () => {
            req.params.id = 'hs-1';
            const mockSource = { id: 'hs-1', name: 'Boiler 1' };
            db.query.mockResolvedValue({ rows: [mockSource] });

            await getHeatSourceById(req, res, next);

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

            await getHeatSourceById(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('not found'),
                    statusCode: 404
                })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = 'hs-1';
            db.query.mockRejectedValue(new Error('DB error'));

            await getHeatSourceById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateHeatSource', () => {
        test('updates and returns heat source', async () => {
            req.params.id = 'hs-1';
            req.body = { name: 'Updated Boiler' };
            const mockUpdated = { id: 'hs-1', name: 'Updated Boiler' };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateHeatSource(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockUpdated,
                    message: 'Heat source updated successfully'
                })
            );
        });

        test('calls next with 400 when no fields to update', async () => {
            req.params.id = 'hs-1';
            req.body = {};

            await updateHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('No fields'),
                    statusCode: 400
                })
            );
        });

        test('calls next with 404 when heat source not found', async () => {
            req.params.id = 'missing';
            req.body = { name: 'Updated' };
            db.query.mockResolvedValue({ rows: [] });

            await updateHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('can update multiple fields', async () => {
            req.params.id = 'hs-1';
            req.body = { name: 'Updated', capacity_mw: 50, fuel_type: 'gas' };
            const mockUpdated = { id: 'hs-1', ...req.body };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateHeatSource(req, res, next);

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('name');
            expect(queryCall[0]).toContain('capacity_mw');
            expect(queryCall[0]).toContain('fuel_type');
        });

        test('calls next on database error', async () => {
            req.params.id = 'hs-1';
            req.body = { name: 'X' };
            db.query.mockRejectedValue(new Error('DB error'));

            await updateHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteHeatSource', () => {
        test('deletes and returns success', async () => {
            req.params.id = 'hs-1';
            db.query.mockResolvedValue({ rows: [{ id: 'hs-1' }] });

            await deleteHeatSource(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Heat source deleted successfully'
                })
            );
        });

        test('calls next with 404 when not found', async () => {
            req.params.id = 'missing';
            db.query.mockResolvedValue({ rows: [] });

            await deleteHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = 'hs-1';
            db.query.mockRejectedValue(new Error('DB error'));

            await deleteHeatSource(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
