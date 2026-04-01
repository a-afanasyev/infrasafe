jest.mock('../../../src/models/Line');
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const Line = require('../../../src/models/Line');
const {
    getAllLines,
    getLineById,
    createLine,
    updateLine,
    deleteLine,
    getLinesByTransformer
} = require('../../../src/controllers/lineController');

describe('LineController', () => {
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

    const mockLine = {
        line_id: 1,
        name: 'Line Alpha',
        voltage_kv: 10,
        length_km: 5.5
    };

    const mockPaginated = {
        data: [mockLine],
        pagination: { page: 1, limit: 10, total: 1, pages: 1 }
    };

    describe('getAllLines', () => {
        test('returns paginated list with 200', async () => {
            Line.findAll.mockResolvedValue(mockPaginated);

            await getAllLines(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: mockPaginated.data,
                pagination: mockPaginated.pagination
            });
        });

        test('passes query params as filters', async () => {
            req.query = { page: '2', limit: '5', name: 'Alpha', voltage_kv: '10', transformer_id: '3' };
            Line.findAll.mockResolvedValue(mockPaginated);

            await getAllLines(req, res, next);

            expect(Line.findAll).toHaveBeenCalledWith(2, 5, {
                name: 'Alpha',
                voltage_kv: 10,
                transformer_id: 3
            });
        });

        test('defaults page to 1 and limit to 10', async () => {
            Line.findAll.mockResolvedValue(mockPaginated);

            await getAllLines(req, res, next);

            expect(Line.findAll).toHaveBeenCalledWith(1, 10, {});
        });

        test('calls next on error', async () => {
            Line.findAll.mockRejectedValue(new Error('DB error'));

            await getAllLines(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getLineById', () => {
        test('returns line when found', async () => {
            req.params.id = '1';
            Line.findById.mockResolvedValue(mockLine);

            await getLineById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: mockLine
            });
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            Line.findById.mockResolvedValue(null);

            await getLineById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            Line.findById.mockRejectedValue(new Error('DB error'));

            await getLineById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createLine', () => {
        test('creates and returns 201', async () => {
            req.body = { name: 'New Line', voltage_kv: 10, length_km: 3 };
            Line.create.mockResolvedValue(mockLine);

            await createLine(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(Line.create).toHaveBeenCalledWith(req.body);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: mockLine
            }));
        });

        test('calls next on error', async () => {
            req.body = { name: 'X' };
            Line.create.mockRejectedValue(new Error('DB error'));

            await createLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateLine', () => {
        test('updates and returns 200', async () => {
            req.params.id = '1';
            req.body = { name: 'Updated Line' };
            Line.update.mockResolvedValue({ ...mockLine, name: 'Updated Line' });

            await updateLine(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(Line.update).toHaveBeenCalledWith('1', req.body);
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            req.body = { name: 'X' };
            Line.update.mockResolvedValue(null);

            await updateLine(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            req.body = { name: 'X' };
            Line.update.mockRejectedValue(new Error('DB error'));

            await updateLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteLine', () => {
        test('deletes and returns 200', async () => {
            req.params.id = '1';
            Line.delete.mockResolvedValue(mockLine);

            await deleteLine(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                data: mockLine
            }));
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            Line.delete.mockResolvedValue(null);

            await deleteLine(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            Line.delete.mockRejectedValue(new Error('DB error'));

            await deleteLine(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getLinesByTransformer', () => {
        test('returns lines for transformer', async () => {
            req.params.transformerId = '5';
            Line.findByTransformerId.mockResolvedValue([mockLine]);

            await getLinesByTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(Line.findByTransformerId).toHaveBeenCalledWith('5');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: [mockLine]
            });
        });

        test('returns empty array when no lines', async () => {
            req.params.transformerId = '999';
            Line.findByTransformerId.mockResolvedValue([]);

            await getLinesByTransformer(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: []
            });
        });

        test('calls next on error', async () => {
            req.params.transformerId = '5';
            Line.findByTransformerId.mockRejectedValue(new Error('DB error'));

            await getLinesByTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
