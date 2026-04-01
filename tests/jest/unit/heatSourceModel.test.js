jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/utils/queryValidation', () => ({
    validateSortOrder: jest.fn().mockReturnValue({ validSort: 'id', validOrder: 'ASC' })
}));

const db = require('../../../src/config/database');
const HeatSource = require('../../../src/models/HeatSource');

describe('HeatSource Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        id: 1,
        name: 'Heat Source Alpha',
        address: '456 Heat St',
        latitude: 41.3,
        longitude: 69.2,
        source_type: 'boiler',
        capacity_mw: 50,
        fuel_type: 'gas',
        installation_date: '2020-01-01',
        status: 'active',
        maintenance_contact: 'Jane Doe',
        notes: 'Test heat source',
        created_at: '2024-01-01',
        updated_at: '2024-01-01'
    };

    describe('findAll', () => {
        test('returns paginated results', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })
                .mockResolvedValueOnce({ rows: [mockRow, { ...mockRow, id: 2 }] });

            const result = await HeatSource.findAll(1, 10, 'id', 'asc');

            expect(result.data).toHaveLength(2);
            expect(result.data[0].id).toBe(1);
            expect(result.data[0].name).toBe('Heat Source Alpha');
            expect(result.pagination).toEqual({
                page: 1,
                limit: 10,
                total: 2,
                totalPages: 1
            });
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('calculates correct offset for page 2', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '15' }] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await HeatSource.findAll(2, 10);

            const dataCall = db.query.mock.calls[1];
            expect(dataCall[1]).toEqual([10, 10]); // limit=10, offset=10
            expect(result.pagination.totalPages).toBe(2);
        });

        test('returns empty data when no heat sources exist', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '0' }] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await HeatSource.findAll();

            expect(result.data).toEqual([]);
            expect(result.pagination.total).toBe(0);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(HeatSource.findAll()).rejects.toThrow('Failed to fetch heat sources');
        });
    });

    describe('findById', () => {
        test('returns heat source when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await HeatSource.findById(1);

            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.name).toBe('Heat Source Alpha');
            expect(result.source_type).toBe('boiler');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM heat_sources WHERE id = $1',
                [1]
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await HeatSource.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(HeatSource.findById(1)).rejects.toThrow('Failed to fetch heat source');
        });
    });

    describe('create', () => {
        test('creates and returns new heat source', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await HeatSource.create(mockRow);

            expect(result).toBeDefined();
            expect(result.name).toBe('Heat Source Alpha');
            expect(result.id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO heat_sources');
        });

        test('defaults status to active when not provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await HeatSource.create({ ...mockRow, status: undefined });

            const params = db.query.mock.calls[0][1];
            expect(params[9]).toBe('active'); // status param
        });

        test('passes all fields correctly', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await HeatSource.create(mockRow);

            const params = db.query.mock.calls[0][1];
            expect(params[0]).toBe(1);                    // id
            expect(params[1]).toBe('Heat Source Alpha');   // name
            expect(params[2]).toBe('456 Heat St');         // address
            expect(params[3]).toBe(41.3);                  // latitude
            expect(params[4]).toBe(69.2);                  // longitude
            expect(params[5]).toBe('boiler');              // source_type
            expect(params[6]).toBe(50);                    // capacity_mw
            expect(params[7]).toBe('gas');                 // fuel_type
            expect(params[8]).toBe('2020-01-01');          // installation_date
            expect(params[9]).toBe('active');              // status
            expect(params[10]).toBe('Jane Doe');           // maintenance_contact
            expect(params[11]).toBe('Test heat source');   // notes
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(HeatSource.create(mockRow)).rejects.toThrow('Failed to create heat source');
        });
    });

    describe('update', () => {
        test('updates and returns heat source', async () => {
            const updated = { ...mockRow, name: 'Updated Source' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await HeatSource.update(1, updated);

            expect(result.name).toBe('Updated Source');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE heat_sources');
            expect(db.query.mock.calls[0][1][0]).toBe(1); // id param
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await HeatSource.update(999, mockRow);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(HeatSource.update(1, mockRow)).rejects.toThrow('Failed to update heat source');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed heat source', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await HeatSource.delete(1);

            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM heat_sources');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await HeatSource.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(HeatSource.delete(1)).rejects.toThrow('Failed to delete heat source');
        });
    });
});
