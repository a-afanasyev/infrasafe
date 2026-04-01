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
    getOptimizedTransformers,
    createTransformer,
    getTransformerById,
    updateTransformer,
    deleteTransformer,
    batchTransformersOperation
} = require('../../../src/controllers/admin/adminTransformerController');

describe('AdminTransformerController', () => {
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

    describe('getOptimizedTransformers', () => {
        test('returns paginated transformers with default params', async () => {
            const mockRows = [{ transformer_id: 1, name: 'TP-100', building_name: 'B1' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedTransformers(req, res, next);

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
            req.query = { search: 'TP' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedTransformers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('ILIKE');
        });

        test('applies power_min filter', async () => {
            req.query = { power_min: '100' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedTransformers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('power_kva >=');
        });

        test('applies power_max filter', async () => {
            req.query = { power_max: '1000' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedTransformers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('power_kva <=');
        });

        test('applies voltage_kv filter', async () => {
            req.query = { voltage_kv: '10' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedTransformers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('voltage_kv');
        });

        test('applies building_id filter', async () => {
            req.query = { building_id: '5' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedTransformers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('building_id');
        });

        test('joins with buildings table', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedTransformers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('LEFT JOIN buildings');
            expect(dataQuery).toContain('building_name');
        });

        test('calls next on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedTransformers(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createTransformer', () => {
        test('creates and returns 201 with valid data', async () => {
            req.body = { name: 'TP-200', power_kva: 630, voltage_kv: 10, building_id: 1 };
            const mockResult = { transformer_id: 1, ...req.body };
            db.query.mockResolvedValue({ rows: [mockResult] });

            await createTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockResult,
                    message: 'Transformer created successfully'
                })
            );
        });

        test('returns 400 when name is missing', async () => {
            req.body = { power_kva: 630, voltage_kv: 10 };

            await createTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('required'),
                    statusCode: 400
                })
            );
        });

        test('returns 400 when power_kva is missing', async () => {
            req.body = { name: 'TP-200', voltage_kv: 10 };

            await createTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when voltage_kv is missing', async () => {
            req.body = { name: 'TP-200', power_kva: 630 };

            await createTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('calls next on database error', async () => {
            req.body = { name: 'TP-200', power_kva: 630, voltage_kv: 10 };
            db.query.mockRejectedValue(new Error('DB error'));

            await createTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getTransformerById', () => {
        test('returns transformer when found', async () => {
            req.params.id = '1';
            const mockTransformer = { transformer_id: 1, name: 'TP-100' };
            db.query.mockResolvedValue({ rows: [mockTransformer] });

            await getTransformerById(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockTransformer
                })
            );
        });

        test('calls next with 404 when not found', async () => {
            req.params.id = '999';
            db.query.mockResolvedValue({ rows: [] });

            await getTransformerById(req, res, next);

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

            await getTransformerById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateTransformer', () => {
        test('updates and returns transformer', async () => {
            req.params.id = '1';
            req.body = { name: 'TP-300' };
            const mockUpdated = { transformer_id: 1, name: 'TP-300' };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateTransformer(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockUpdated,
                    message: 'Transformer updated successfully'
                })
            );
        });

        test('calls next with 400 when no fields to update', async () => {
            req.params.id = '1';
            req.body = {};

            await updateTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('No fields'),
                    statusCode: 400
                })
            );
        });

        test('calls next with 404 when transformer not found', async () => {
            req.params.id = '999';
            req.body = { name: 'Updated' };
            db.query.mockResolvedValue({ rows: [] });

            await updateTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('can update multiple fields', async () => {
            req.params.id = '1';
            req.body = { name: 'TP-300', power_kva: 1000, voltage_kv: 6 };
            const mockUpdated = { transformer_id: 1, ...req.body };
            db.query.mockResolvedValue({ rows: [mockUpdated] });

            await updateTransformer(req, res, next);

            const queryCall = db.query.mock.calls[0];
            expect(queryCall[0]).toContain('name');
            expect(queryCall[0]).toContain('power_kva');
            expect(queryCall[0]).toContain('voltage_kv');
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            req.body = { name: 'X' };
            db.query.mockRejectedValue(new Error('DB error'));

            await updateTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteTransformer', () => {
        test('deletes and returns success', async () => {
            req.params.id = '1';
            db.query.mockResolvedValue({ rows: [{ transformer_id: 1 }] });

            await deleteTransformer(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Transformer deleted successfully'
                })
            );
        });

        test('calls next with 404 when not found', async () => {
            req.params.id = '999';
            db.query.mockResolvedValue({ rows: [] });

            await deleteTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 404 })
            );
        });

        test('calls next on database error', async () => {
            req.params.id = '1';
            db.query.mockRejectedValue(new Error('DB error'));

            await deleteTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('batchTransformersOperation', () => {
        test('batch delete calls adminService.batchDelete', async () => {
            req.body = { action: 'delete', ids: [1, 2, 3] };
            adminService.batchDelete.mockResolvedValue({ rows: [{ transformer_id: 1 }, { transformer_id: 2 }, { transformer_id: 3 }] });

            await batchTransformersOperation(req, res, next);

            expect(adminService.batchDelete).toHaveBeenCalledWith('transformers', 'transformer_id', [1, 2, 3]);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 3
                })
            );
        });

        test('batch update_voltage calls adminService.batchUpdateColumn', async () => {
            req.body = { action: 'update_voltage', ids: [1, 2], data: { voltage_kv: 6 } };
            adminService.batchUpdateColumn.mockResolvedValue({ rows: [{ transformer_id: 1 }, { transformer_id: 2 }] });

            await batchTransformersOperation(req, res, next);

            expect(adminService.batchUpdateColumn).toHaveBeenCalledWith(
                'transformers', 'transformer_id', [1, 2], 'voltage_kv', 6
            );
        });

        test('batch update_power calls adminService.batchUpdateColumn', async () => {
            req.body = { action: 'update_power', ids: [1], data: { power_kva: 1000 } };
            adminService.batchUpdateColumn.mockResolvedValue({ rows: [{ transformer_id: 1 }] });

            await batchTransformersOperation(req, res, next);

            expect(adminService.batchUpdateColumn).toHaveBeenCalledWith(
                'transformers', 'transformer_id', [1], 'power_kva', 1000
            );
        });

        test('returns 400 when action is missing', async () => {
            req.body = { ids: [1] };

            await batchTransformersOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when ids is missing', async () => {
            req.body = { action: 'delete' };

            await batchTransformersOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 when ids is not an array', async () => {
            req.body = { action: 'delete', ids: 'not-array' };

            await batchTransformersOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 for unknown action', async () => {
            req.body = { action: 'unknown_action', ids: [1] };

            await batchTransformersOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    statusCode: 400,
                    message: expect.stringContaining('Unknown action')
                })
            );
        });

        test('returns 400 for update_voltage without data', async () => {
            req.body = { action: 'update_voltage', ids: [1] };

            await batchTransformersOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('returns 400 for update_power without data', async () => {
            req.body = { action: 'update_power', ids: [1] };

            await batchTransformersOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ statusCode: 400 })
            );
        });

        test('calls next on adminService error', async () => {
            req.body = { action: 'delete', ids: [1] };
            adminService.batchDelete.mockRejectedValue(new Error('DB error'));

            await batchTransformersOperation(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
