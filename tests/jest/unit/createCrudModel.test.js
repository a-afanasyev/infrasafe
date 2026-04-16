jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));

const db = require('../../../src/config/database');
const { createCrudModel } = require('../../../src/models/factories/createCrudModel');

const VALID_CFG = {
    tableName: 'cold_water_sources',
    idColumn: 'id',
    entityName: 'cold water source',
    entityType: 'water_sources',
    fields: ['id', 'name', 'status'],
    createColumns: ['id', 'name', 'status'],
    updateColumns: ['name', 'status'],
    defaults: { status: 'active' },
};

describe('createCrudModel — factory-time validation', () => {
    test('throws on invalid tableName', () => {
        expect(() => createCrudModel({ ...VALID_CFG, tableName: 'users; DROP' }))
            .toThrow(/invalid tableName/);
        expect(() => createCrudModel({ ...VALID_CFG, tableName: '' }))
            .toThrow(/invalid tableName/);
        expect(() => createCrudModel({ ...VALID_CFG, tableName: 'a.b' }))
            .toThrow(/invalid tableName/);
    });

    test('throws on invalid idColumn', () => {
        expect(() => createCrudModel({ ...VALID_CFG, idColumn: 'id; --' }))
            .toThrow(/invalid idColumn/);
    });

    test('throws on empty / non-array fields', () => {
        expect(() => createCrudModel({ ...VALID_CFG, fields: [] }))
            .toThrow(/fields array is required/);
        expect(() => createCrudModel({ ...VALID_CFG, fields: null }))
            .toThrow(/fields array is required/);
    });

    test('throws when any allowed column fails IDENT_RE', () => {
        expect(() => createCrudModel({
            ...VALID_CFG,
            updateColumns: ['name', 'status; DROP'],
        })).toThrow(/invalid column/);
    });

    test('rejects unicode homoglyphs in column names', () => {
        expect(() => createCrudModel({
            ...VALID_CFG,
            fields: ['id', 'nаme'],  // Cyrillic 'а'
        })).toThrow(/invalid column/);
    });
});

describe('createCrudModel — generated model behavior', () => {
    const Model = createCrudModel(VALID_CFG);

    beforeEach(() => jest.clearAllMocks());

    test('findAll returns { data, pagination } with totalPages', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ count: '7' }] })
            .mockResolvedValueOnce({ rows: [{ id: 1, name: 'a', status: 'active' }] });
        const result = await Model.findAll(1, 3, 'id', 'asc');
        expect(result.pagination).toEqual({ page: 1, limit: 3, total: 7, totalPages: 3 });
        expect(result.data[0]).toBeInstanceOf(Model);
    });

    test('findAll returns totalPages=1 when total=0 (Math.max guard)', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ count: '0' }] })
            .mockResolvedValueOnce({ rows: [] });
        const result = await Model.findAll(1, 10);
        expect(result.pagination.totalPages).toBe(1);
    });

    test('create applies default for omitted value', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 1, name: 'X', status: 'active' }] });
        await Model.create({ id: 1, name: 'X' });
        const params = db.query.mock.calls[0][1];
        expect(params).toEqual([1, 'X', 'active']);
    });

    test('create sends null for missing non-default columns', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 1, name: null, status: 'active' }] });
        await Model.create({ id: 1 });  // no name
        const params = db.query.mock.calls[0][1];
        expect(params).toEqual([1, null, 'active']);
    });

    test('update throws 400 "No valid fields" when no updatable fields provided', async () => {
        await expect(Model.update(1, { id: 99 }))  // id is not in updateColumns
            .rejects.toMatchObject({ statusCode: 400 });
    });

    test('update places id as the last parameter', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 5, name: 'new' }] });
        await Model.update(5, { name: 'new' });
        const params = db.query.mock.calls[0][1];
        expect(params[params.length - 1]).toBe(5);
    });

    test('delete returns null when row missing', async () => {
        db.query.mockResolvedValue({ rows: [] });
        const result = await Model.delete(999);
        expect(result).toBeNull();
    });

    test('instance constructor copies known fields only', () => {
        const inst = new Model({ id: 1, name: 'x', status: 'a', secret: 'nope', created_at: '2025-01-01' });
        expect(inst.id).toBe(1);
        expect(inst.name).toBe('x');
        expect(inst.status).toBe('a');
        expect(inst.created_at).toBe('2025-01-01');
        expect(inst.secret).toBeUndefined();
    });
});
