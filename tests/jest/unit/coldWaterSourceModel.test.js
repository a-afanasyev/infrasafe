jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const ColdWaterSource = require('../../../src/models/ColdWaterSource');

describe('ColdWaterSource Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        id: 1, name: 'Source 1', address: 'Addr 1',
        latitude: 41.3, longitude: 69.2, source_type: 'well',
        capacity_m3_per_hour: 50, operating_pressure_bar: 4,
        installation_date: '2024-01-01', status: 'active',
        maintenance_contact: 'John', notes: 'Test',
        created_at: '2024-01-01', updated_at: '2024-01-01'
    };

    describe('findAll', () => {
        test('returns paginated results', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })
                .mockResolvedValueOnce({ rows: [mockRow, { ...mockRow, id: 2 }] });

            const result = await ColdWaterSource.findAll(1, 10, 'id', 'asc');

            expect(result.data).toHaveLength(2);
            expect(result.pagination).toEqual({
                page: 1, limit: 10, total: 2, totalPages: 1
            });
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('calculates correct offset for page 2', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '20' }] })
                .mockResolvedValueOnce({ rows: [] });

            await ColdWaterSource.findAll(2, 10, 'id', 'asc');

            const selectCall = db.query.mock.calls[1];
            expect(selectCall[1]).toEqual([10, 10]); // limit=10, offset=10
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            // Phase 6: factory-generated models use the entityName 'cold water source'
            // in error messages (previously it was hand-written 'water sources').
            await expect(ColdWaterSource.findAll()).rejects.toThrow('Failed to fetch cold water source');
        });
    });

    describe('findById', () => {
        test('returns source when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await ColdWaterSource.findById(1);

            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(result.name).toBe('Source 1');
            expect(db.query.mock.calls[0][0]).toContain('SELECT * FROM cold_water_sources');
            expect(db.query.mock.calls[0][0]).toContain('WHERE id = $1');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await ColdWaterSource.findById(999);
            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(ColdWaterSource.findById(1)).rejects.toThrow('Failed to fetch cold water source');
        });
    });

    describe('create', () => {
        test('creates and returns new source', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await ColdWaterSource.create(mockRow);

            expect(result).toBeDefined();
            expect(result.name).toBe('Source 1');
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO cold_water_sources');
        });

        test('defaults status to active', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await ColdWaterSource.create({ ...mockRow, status: undefined });

            // Phase 6: createColumns order is [id, name, address, latitude,
            // longitude, source_type, capacity_m3_per_hour,
            // operating_pressure_bar, installation_date, status, ...].
            // status is index 9.
            const params = db.query.mock.calls[0][1];
            expect(params[9]).toBe('active');
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(ColdWaterSource.create(mockRow)).rejects.toThrow('Failed to create cold water source');
        });
    });

    describe('update', () => {
        test('updates and returns source', async () => {
            const updated = { ...mockRow, name: 'Updated' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await ColdWaterSource.update(1, updated);

            expect(result.name).toBe('Updated');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE cold_water_sources');
            // Phase 6: buildUpdateQuery emits SET $1..$N-1, WHERE id = $N
            // (id is appended LAST to params). The value of the last param
            // is the id.
            const params = db.query.mock.calls[0][1];
            expect(params[params.length - 1]).toBe(1);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await ColdWaterSource.update(999, mockRow);
            expect(result).toBeNull();
        });
    });

    describe('delete', () => {
        test('deletes and returns removed source', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await ColdWaterSource.delete(1);

            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM cold_water_sources');
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await ColdWaterSource.delete(999);
            expect(result).toBeNull();
        });
    });
});
