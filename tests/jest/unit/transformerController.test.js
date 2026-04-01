jest.mock('../../../src/models/Transformer');
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const Transformer = require('../../../src/models/Transformer');
const {
    getAllTransformers,
    getTransformerById,
    createTransformer,
    updateTransformer,
    deleteTransformer,
    getTransformersByBuilding
} = require('../../../src/controllers/transformerController');

describe('TransformerController', () => {
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

    const mockTransformer = {
        transformer_id: 1,
        name: 'TP-100',
        power_kva: 630,
        voltage_kv: 10
    };

    const mockPaginated = {
        data: [mockTransformer],
        pagination: { page: 1, limit: 10, total: 1, pages: 1 }
    };

    describe('getAllTransformers', () => {
        test('returns paginated list with 200', async () => {
            Transformer.findAll.mockResolvedValue(mockPaginated);

            await getAllTransformers(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: mockPaginated.data,
                pagination: mockPaginated.pagination
            });
        });

        test('passes query params as filters', async () => {
            req.query = { page: '2', limit: '5', name: 'TP', power_kva: '500', voltage_kv: '10' };
            Transformer.findAll.mockResolvedValue(mockPaginated);

            await getAllTransformers(req, res, next);

            expect(Transformer.findAll).toHaveBeenCalledWith(2, 5, {
                name: 'TP',
                power_kva: 500,
                voltage_kv: 10
            });
        });

        test('passes building_id filter when provided', async () => {
            req.query = { building_id: '3' };
            Transformer.findAll.mockResolvedValue(mockPaginated);

            await getAllTransformers(req, res, next);

            expect(Transformer.findAll).toHaveBeenCalledWith(1, 10, {
                building_id: 3
            });
        });

        test('calls next on error', async () => {
            Transformer.findAll.mockRejectedValue(new Error('DB error'));

            await getAllTransformers(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getTransformerById', () => {
        test('returns transformer when found', async () => {
            req.params.id = '1';
            Transformer.findById.mockResolvedValue(mockTransformer);

            await getTransformerById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: mockTransformer
            });
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            Transformer.findById.mockResolvedValue(null);

            await getTransformerById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            Transformer.findById.mockRejectedValue(new Error('DB error'));

            await getTransformerById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createTransformer', () => {
        test('creates and returns 201', async () => {
            req.body = { name: 'TP-200', power_kva: 1000, voltage_kv: 10 };
            Transformer.create.mockResolvedValue(mockTransformer);

            await createTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(Transformer.create).toHaveBeenCalledWith(req.body);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: mockTransformer
            }));
        });

        test('calls next on error', async () => {
            req.body = { name: 'X' };
            Transformer.create.mockRejectedValue(new Error('DB error'));

            await createTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateTransformer', () => {
        test('updates and returns 200', async () => {
            req.params.id = '1';
            req.body = { name: 'TP-300' };
            Transformer.update.mockResolvedValue({ ...mockTransformer, name: 'TP-300' });

            await updateTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(Transformer.update).toHaveBeenCalledWith('1', req.body);
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            req.body = { name: 'X' };
            Transformer.update.mockResolvedValue(null);

            await updateTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            req.body = { name: 'X' };
            Transformer.update.mockRejectedValue(new Error('DB error'));

            await updateTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteTransformer', () => {
        test('deletes and returns 200', async () => {
            req.params.id = '1';
            Transformer.delete.mockResolvedValue(mockTransformer);

            await deleteTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: mockTransformer
            }));
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            Transformer.delete.mockResolvedValue(null);

            await deleteTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            Transformer.delete.mockRejectedValue(new Error('DB error'));

            await deleteTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getTransformersByBuilding', () => {
        test('returns transformers for building', async () => {
            req.params.buildingId = '10';
            Transformer.findByBuildingId.mockResolvedValue([mockTransformer]);

            await getTransformersByBuilding(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(Transformer.findByBuildingId).toHaveBeenCalledWith('10');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: [mockTransformer]
            });
        });

        test('returns empty array when no transformers', async () => {
            req.params.buildingId = '999';
            Transformer.findByBuildingId.mockResolvedValue([]);

            await getTransformersByBuilding(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: []
            });
        });

        test('calls next on error', async () => {
            req.params.buildingId = '10';
            Transformer.findByBuildingId.mockRejectedValue(new Error('DB error'));

            await getTransformersByBuilding(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
