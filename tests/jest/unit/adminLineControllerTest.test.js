jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/services/adminService', () => ({
    batchDelete: jest.fn(),
    batchUpdateColumn: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const adminService = require('../../../src/services/adminService');
const {
    getOptimizedLines,
    createLine,
    getLineById,
    updateLine,
    deleteLine,
    batchLinesOperation
} = require('../../../src/controllers/admin/adminLineController');

describe('AdminLineController', () => {
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

    describe('getOptimizedLines', () => {
        test('returns paginated lines with default params', async () => {
            const mockRows = [{ line_id: 1, name: 'Line Alpha', transformer_name: 'TP-1' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedLines(req, res, next);

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
            req.query = { search: 'Alpha' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('ILIKE');
        });

        test('applies voltage_min filter', async () => {
            req.query = { voltage_min: '6' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('voltage_kv >=');
        });

        test('applies voltage_max filter', async () => {
            req.query = { voltage_max: '35' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('voltage_kv <=');
        });

        test('applies length_min and length_max filters', async () => {
            req.query = { length_min: '1', length_max: '10' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('length_km >=');
            expect(dataQuery).toContain('length_km <=');
        });

        test('applies transformer_id filter', async () => {
            req.query = { transformer_id: '3' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('transformer_id');
        });

        test('joins with transformers table', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedLines(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('LEFT JOIN transformers');
            expect(dataQuery).toContain('transformer_name');
        });

        test('calls next on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedLines(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createLine', () => {
        test('creates and returns 201 with valid data', async () => {
            req.body = { name: 'New Line', voltage_kv: 10, length_km: 5.5, transformer_id: 1 };
            const mockResult = { line_id: 1, ...req.body };
            db.query.mockResolvedValue({ rows: [mockResult] });

            await createLine(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockResult,
                    message: 'Line created successfully'
                })
            );
        });

        test('returns 400 when name is missing', async () => {
            req.body = { voltage_kv: 10, length_km: 5 };

            await createLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when voltage_kv is missing', async () => {
            req.body = { name: 'Line', length_km: 5 };

            await createLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when length_km is missing', async () => {
            req.body = { name: 'Line', voltage_kv: 10 };

            await createLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('calls next on database error', async () => {
            req.body = { name: 'Line', voltage_kv: 10, length_km: 5 };
            db.query.mockRejectedValue(new Error('DB error'));

            await createLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getLineById', () => {
        test('returns line when found', async () => {
            req.params.id = '1';
            const mockLine = { line_id: 1, name: 'Line Alpha' };
            db.query.mockResolvedValue({ rows: [mockLine] });

            await getLineById(req, res, next);

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

            await getLineById(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            db.query.mockRejectedValue(new Error('DB error'));

            await getLineById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateLine', () => {
        test('updates and returns line', async () => {
            req.params.id = '1';
            req.body = { name: 'Updated Line' };
            const mockUpdated = { line_id: 1, name: 'Updated Line' };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateLine(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockUpdated,
                    message: 'Line updated successfully'
                })
            );
        });

        test('calls next with 400 when no fields to update', async () => {
            req.params.id = '1';
            req.body = {};

            await updateLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('calls next with 404 when line not found', async () => {
            req.params.id = '999';
            req.body = { name: 'Updated' };
            db.query.mockResolvedValue({ rows: [] });

            await updateLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('can update multiple fields', async () => {
            req.params.id = '1';
            req.body = { name: 'Updated', voltage_kv: 6, length_km: 10 };
            db.query.mockResolvedValue({ rows: [{ line_id: 1, ...req.body }] });

            await updateLine(req, res, next);

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('name');
            expect(queryCall[0]).toContain('voltage_kv');
            expect(queryCall[0]).toContain('length_km');
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            req.body = { name: 'X' };
            db.query.mockRejectedValue(new Error('DB error'));

            await updateLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteLine', () => {
        test('deletes and returns success', async () => {
            req.params.id = '1';
            db.query.mockResolvedValue({ rows: [{ line_id: 1 }] });

            await deleteLine(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Line deleted successfully'
                })
            );
        });

        test('calls next with 404 when not found', async () => {
            req.params.id = '999';
            db.query.mockResolvedValue({ rows: [] });

            await deleteLine(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            db.query.mockRejectedValue(new Error('DB error'));

            await deleteLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('batchLinesOperation', () => {
        test('batch delete calls adminService.batchDelete', async () => {
            req.body = { action: 'delete', ids: [1, 2] };
            adminService.batchDelete.mockResolvedValue({ rows: [{ line_id: 1 }, { line_id: 2 }] });

            await batchLinesOperation(req, res, next);

            expect(adminService.batchDelete).toHaveBeenCalledWith('lines', 'line_id', [1, 2]);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 2
                })
            );
        });

        test('batch update_voltage calls adminService.batchUpdateColumn', async () => {
            req.body = { action: 'update_voltage', ids: [1], data: { voltage_kv: 35 } };
            adminService.batchUpdateColumn.mockResolvedValue({ rows: [{ line_id: 1 }] });

            await batchLinesOperation(req, res, next);

            expect(adminService.batchUpdateColumn).toHaveBeenCalledWith(
                'lines', 'line_id', [1], 'voltage_kv', 35
            );
        });

        test('batch set_maintenance calls adminService.batchUpdateColumn', async () => {
            req.body = { action: 'set_maintenance', ids: [1, 2], data: { maintenance_date: '2026-05-01' } };
            adminService.batchUpdateColumn.mockResolvedValue({ rows: [{ line_id: 1 }, { line_id: 2 }] });

            await batchLinesOperation(req, res, next);

            expect(adminService.batchUpdateColumn).toHaveBeenCalledWith(
                'lines', 'line_id', [1, 2], 'maintenance_date', '2026-05-01'
            );
        });

        test('returns 400 when action is missing', async () => {
            req.body = { ids: [1] };

            await batchLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when ids is missing', async () => {
            req.body = { action: 'delete' };

            await batchLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when ids is not array', async () => {
            req.body = { action: 'delete', ids: 'not-array' };

            await batchLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 for unknown action', async () => {
            req.body = { action: 'unknown', ids: [1] };

            await batchLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    statusCode: 400,
                    message: expect.stringContaining('Unknown action')
                })
            );
        });

        test('returns 400 for update_voltage without data', async () => {
            req.body = { action: 'update_voltage', ids: [1] };

            await batchLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 for set_maintenance without data', async () => {
            req.body = { action: 'set_maintenance', ids: [1] };

            await batchLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('calls next on adminService error', async () => {
            req.body = { action: 'delete', ids: [1] };
            adminService.batchDelete.mockRejectedValue(new Error('DB error'));

            await batchLinesOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
