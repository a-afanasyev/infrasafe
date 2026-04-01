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
    getOptimizedWaterLines,
    createWaterLine,
    getWaterLineById,
    updateWaterLine,
    deleteWaterLine,
    batchWaterLinesOperation
} = require('../../../src/controllers/admin/adminWaterLineController');

describe('AdminWaterLineController', () => {
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

    describe('getOptimizedWaterLines', () => {
        test('returns paginated water lines with default params', async () => {
            const mockRows = [{ line_id: 1, name: 'WL-1', connected_buildings_count: '0' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedWaterLines(req, res, next);

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
            req.query = { search: 'main' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedWaterLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('ILIKE');
        });

        test('applies status filter', async () => {
            req.query = { status: 'active' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedWaterLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('status');
        });

        test('applies material filter', async () => {
            req.query = { material: 'steel' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedWaterLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('material');
        });

        test('applies diameter_min filter', async () => {
            req.query = { diameter_min: '100' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedWaterLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('diameter_mm >=');
        });

        test('applies diameter_max filter', async () => {
            req.query = { diameter_max: '500' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedWaterLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('diameter_mm <=');
        });

        test('joins with buildings table', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedWaterLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('LEFT JOIN buildings');
            expect(dataQuery).toContain('connected_buildings');
        });

        test('calls next on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedWaterLines(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createWaterLine', () => {
        test('creates and returns 201 with valid data', async () => {
            req.body = { name: 'WL-New', diameter_mm: 200, material: 'steel' };
            const mockResult = { line_id: 1, ...req.body };
            db.query.mockResolvedValue({ rows: [mockResult] });

            await createWaterLine(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockResult,
                    message: 'Water line created successfully'
                })
            );
        });

        test('returns 400 when name is missing', async () => {
            req.body = { diameter_mm: 200, material: 'steel' };

            await createWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('required'),
                    statusCode: 400
                })
            );
        });

        test('returns 400 when diameter_mm is missing', async () => {
            req.body = { name: 'WL-New', material: 'steel' };

            await createWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when material is missing', async () => {
            req.body = { name: 'WL-New', diameter_mm: 200 };

            await createWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('calls next on database error', async () => {
            req.body = { name: 'WL-New', diameter_mm: 200, material: 'steel' };
            db.query.mockRejectedValue(new Error('DB error'));

            await createWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getWaterLineById', () => {
        test('returns water line when found', async () => {
            req.params.id = '1';
            const mockLine = { line_id: 1, name: 'WL-1', connected_buildings_count: '2' };
            db.query.mockResolvedValue({ rows: [mockLine] });

            await getWaterLineById(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockLine
                })
            );
        });

        test('calls next with 404 when not found', async () => {
            req.params.id = '999';
            db.query.mockResolvedValue({ rows: [] });

            await getWaterLineById(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('not found'),
                    statusCode: 404
                })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            db.query.mockRejectedValue(new Error('DB error'));

            await getWaterLineById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateWaterLine', () => {
        test('updates and returns water line', async () => {
            req.params.id = '1';
            req.body = { name: 'WL-Updated' };
            const mockUpdated = { line_id: 1, name: 'WL-Updated' };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateWaterLine(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockUpdated,
                    message: 'Water line updated successfully'
                })
            );
        });

        test('calls next with 400 when no fields to update', async () => {
            req.params.id = '1';
            req.body = {};

            await updateWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('No fields'),
                    statusCode: 400
                })
            );
        });

        test('calls next with 404 when water line not found', async () => {
            req.params.id = '999';
            req.body = { name: 'Updated' };
            db.query.mockResolvedValue({ rows: [] });

            await updateWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('can update multiple fields', async () => {
            req.params.id = '1';
            req.body = { name: 'Updated', diameter_mm: 300, material: 'copper' };
            const mockUpdated = { line_id: 1, ...req.body };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateWaterLine(req, res, next);

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('name');
            expect(queryCall[0]).toContain('diameter_mm');
            expect(queryCall[0]).toContain('material');
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            req.body = { name: 'X' };
            db.query.mockRejectedValue(new Error('DB error'));

            await updateWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteWaterLine', () => {
        test('deletes and returns success when no connected buildings', async () => {
            req.params.id = '1';
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // check query
                .mockResolvedValueOnce({ rows: [{ line_id: 1 }] }); // delete query

            await deleteWaterLine(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Water line deleted successfully'
                })
            );
        });

        test('calls next with 400 when connected buildings exist', async () => {
            req.params.id = '1';
            db.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });

            await deleteWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('connected buildings'),
                    statusCode: 400
                })
            );
        });

        test('calls next with 404 when water line not found', async () => {
            req.params.id = '999';
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '0' }] })
                .mockResolvedValueOnce({ rows: [] });

            await deleteWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            db.query.mockRejectedValue(new Error('DB error'));

            await deleteWaterLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('batchWaterLinesOperation', () => {
        test('batch delete calls pool.query with correct params', async () => {
            req.body = { action: 'delete', ids: [1, 2, 3] };
            db.query
                .mockResolvedValueOnce({ rows: [] }) // check connected buildings
                .mockResolvedValueOnce({ rows: [{ line_id: 1 }, { line_id: 2 }, { line_id: 3 }] }); // delete

            await batchWaterLinesOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 3
                })
            );
        });

        test('batch delete fails when connected buildings exist', async () => {
            req.body = { action: 'delete', ids: [1, 2] };
            db.query.mockResolvedValueOnce({ rows: [{ building_id: 5 }] });

            await batchWaterLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('connected buildings'),
                    statusCode: 400
                })
            );
        });

        test('batch update_status updates status', async () => {
            req.body = { action: 'update_status', ids: [1, 2], data: { status: 'maintenance' } };
            db.query.mockResolvedValue({ rows: [{ line_id: 1 }, { line_id: 2 }] });

            await batchWaterLinesOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 2
                })
            );
        });

        test('batch update_status requires data.status', async () => {
            req.body = { action: 'update_status', ids: [1] };

            await batchWaterLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('batch set_maintenance works', async () => {
            req.body = { action: 'set_maintenance', ids: [1] };
            db.query.mockResolvedValue({ rows: [{ line_id: 1 }] });

            await batchWaterLinesOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 1
                })
            );
        });

        test('returns 400 when action is missing', async () => {
            req.body = { ids: [1] };

            await batchWaterLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when ids is missing', async () => {
            req.body = { action: 'delete' };

            await batchWaterLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when ids is not an array', async () => {
            req.body = { action: 'delete', ids: 'not-array' };

            await batchWaterLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 for unknown action', async () => {
            req.body = { action: 'unknown_action', ids: [1] };

            await batchWaterLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    statusCode: 400,
                    message: expect.stringContaining('Unknown action')
                })
            );
        });

        test('calls next on database error', async () => {
            req.body = { action: 'delete', ids: [1] };
            db.query.mockRejectedValue(new Error('DB error'));

            await batchWaterLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
