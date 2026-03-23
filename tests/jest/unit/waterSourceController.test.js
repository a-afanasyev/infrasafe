jest.mock('../../../src/models/ColdWaterSource');
jest.mock('../../../src/models/HeatSource');
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const ColdWaterSource = require('../../../src/models/ColdWaterSource');
const HeatSource = require('../../../src/models/HeatSource');
const coldCtrl = require('../../../src/controllers/coldWaterSourceController');
const heatCtrl = require('../../../src/controllers/heatSourceController');

describe('Water Source Controllers', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { query: {}, params: {}, body: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    const mockSource = { id: 1, name: 'Source 1', status: 'active' };
    const mockPaginated = {
        data: [mockSource],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
    };

    // Test both controllers with same pattern
    const controllers = [
        { name: 'coldWaterSourceController', ctrl: coldCtrl, model: ColdWaterSource },
        { name: 'heatSourceController', ctrl: heatCtrl, model: HeatSource }
    ];

    controllers.forEach(({ name, ctrl, model }) => {
        describe(name, () => {
            describe('getAll', () => {
                test('returns paginated list', async () => {
                    model.findAll.mockResolvedValue(mockPaginated);

                    await ctrl.getAll(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(200);
                    expect(res.json).toHaveBeenCalledWith(mockPaginated);
                });

                test('passes query params to model', async () => {
                    req.query = { page: '2', limit: '5', sort: 'name', order: 'desc' };
                    model.findAll.mockResolvedValue(mockPaginated);

                    await ctrl.getAll(req, res, next);

                    expect(model.findAll).toHaveBeenCalledWith(2, 5, 'name', 'desc');
                });

                test('calls next on error', async () => {
                    model.findAll.mockRejectedValue(new Error('DB error'));

                    await ctrl.getAll(req, res, next);

                    expect(next).toHaveBeenCalledWith(expect.any(Error));
                });
            });

            describe('getById', () => {
                test('returns source when found', async () => {
                    req.params.id = '1';
                    model.findById.mockResolvedValue(mockSource);

                    await ctrl.getById(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(200);
                    expect(res.json).toHaveBeenCalledWith(mockSource);
                });

                test('returns 404 when not found', async () => {
                    req.params.id = '999';
                    model.findById.mockResolvedValue(null);

                    await ctrl.getById(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(404);
                    expect(res.json).toHaveBeenCalledWith(
                        expect.objectContaining({ success: false })
                    );
                });
            });

            describe('create', () => {
                test('creates and returns 201', async () => {
                    req.body = { name: 'New Source' };
                    model.create.mockResolvedValue(mockSource);

                    await ctrl.create(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(201);
                    expect(model.create).toHaveBeenCalledWith(req.body);
                });
            });

            describe('update', () => {
                test('updates existing source', async () => {
                    req.params.id = '1';
                    req.body = { name: 'Updated' };
                    model.update.mockResolvedValue(mockSource);

                    await ctrl.update(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(200);
                    expect(model.update).toHaveBeenCalledWith('1', req.body);
                });

                test('returns 404 for missing source', async () => {
                    req.params.id = '999';
                    model.update.mockResolvedValue(null);

                    await ctrl.update(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(404);
                });
            });

            describe('remove', () => {
                test('deletes and returns success', async () => {
                    req.params.id = '1';
                    model.delete.mockResolvedValue(mockSource);

                    await ctrl.remove(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(200);
                    expect(res.json).toHaveBeenCalledWith(
                        expect.objectContaining({ message: expect.stringContaining('deleted') })
                    );
                });

                test('returns 404 for missing source', async () => {
                    req.params.id = '999';
                    model.delete.mockResolvedValue(null);

                    await ctrl.remove(req, res, next);

                    expect(res.status).toHaveBeenCalledWith(404);
                });
            });
        });
    });
});
