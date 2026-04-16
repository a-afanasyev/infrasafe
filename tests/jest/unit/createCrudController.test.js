jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const { createCrudController } = require('../../../src/controllers/factories/createCrudController');

function makeModel(overrides = {}) {
    return {
        findAll:  jest.fn().mockResolvedValue({ data: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 1 } }),
        findById: jest.fn().mockResolvedValue(null),
        create:   jest.fn().mockResolvedValue({ id: 1 }),
        update:   jest.fn().mockResolvedValue(null),
        delete:   jest.fn().mockResolvedValue(null),
        ...overrides,
    };
}

function makeRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('createCrudController — factory-time validation', () => {
    test('throws when Model is missing', () => {
        expect(() => createCrudController({
            notFoundMessage: 'X not found', logLabel: 'x',
        })).toThrow(/Model with static CRUD/);
    });

    test('throws when Model lacks CRUD methods', () => {
        expect(() => createCrudController({
            Model: {},
            notFoundMessage: 'X not found', logLabel: 'x',
        })).toThrow(/Model with static CRUD/);
    });

    test('doneMsg falls back by stripping " not found" suffix', () => {
        const Model = makeModel({
            delete: jest.fn().mockResolvedValue({ id: 1 }),
        });
        const ctrl = createCrudController({
            Model, notFoundMessage: 'Widget not found', logLabel: 'widget',
        });
        const res = makeRes();
        return ctrl.remove({ params: { id: 1 } }, res, jest.fn()).then(() => {
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Widget deleted successfully' })
            );
        });
    });
});

describe('createCrudController — handlers', () => {
    let Model, ctrl, res, next;

    beforeEach(() => {
        Model = makeModel();
        ctrl = createCrudController({
            Model, notFoundMessage: 'Widget not found',
            logLabel: 'widget', deletedMessage: 'Widget wiped',
        });
        res = makeRes();
        next = jest.fn();
    });

    test('getAll returns 200 with the model result', async () => {
        Model.findAll.mockResolvedValue({ data: [{ id: 1 }], pagination: { total: 1 } });
        await ctrl.getAll({ query: { page: '2', limit: '5', sort: 'id', order: 'desc' } }, res, next);
        expect(Model.findAll).toHaveBeenCalledWith(2, 5, 'id', 'desc');
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('getById returns 404 when model returns null', async () => {
        Model.findById.mockResolvedValue(null);
        await ctrl.getById({ params: { id: 99 } }, res, next);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('getById returns 200 with the entity when found', async () => {
        Model.findById.mockResolvedValue({ id: 3 });
        await ctrl.getById({ params: { id: 3 } }, res, next);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ id: 3 });
    });

    test('create returns 201', async () => {
        Model.create.mockResolvedValue({ id: 1, name: 'x' });
        await ctrl.create({ body: { name: 'x' } }, res, next);
        expect(res.status).toHaveBeenCalledWith(201);
    });

    test('update returns 404 when model returns null', async () => {
        Model.update.mockResolvedValue(null);
        await ctrl.update({ params: { id: 99 }, body: {} }, res, next);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('remove returns 200 with the deleted entity + custom message', async () => {
        Model.delete.mockResolvedValue({ id: 1 });
        await ctrl.remove({ params: { id: 1 } }, res, next);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'Widget wiped', deleted: { id: 1 } })
        );
    });

    test('propagates model errors via next()', async () => {
        const boom = new Error('boom');
        Model.findById.mockRejectedValue(boom);
        await ctrl.getById({ params: { id: 1 } }, res, next);
        expect(next).toHaveBeenCalledWith(boom);
    });
});
