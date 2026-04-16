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
const Transformer = require('../../../src/models/Transformer');

describe('Transformer Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        transformer_id: 1,
        name: 'TP-100',
        power_kva: 630,
        voltage_kv: 10,
        latitude: 41.3,
        longitude: 69.2,
        location: 'Zone A',
        status: 'active',
        manufacturer: 'ABB',
        model: 'TRF-630',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        primary_buildings: ['Building A'],
        backup_buildings: ['Building B']
    };

    describe('findAll', () => {
        test('returns paginated results with building lists', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })
                .mockResolvedValueOnce({ rows: [mockRow, { ...mockRow, transformer_id: 2 }] });

            const result = await Transformer.findAll(1, 10);

            expect(result.data).toHaveLength(2);
            expect(result.data[0].transformer_id).toBe(1);
            expect(result.data[0].primary_buildings).toEqual(['Building A']);
            expect(result.pagination).toEqual({
                page: 1,
                limit: 10,
                total: 2,
                totalPages: 1
            });
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('applies name filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await Transformer.findAll(1, 10, { name: 'TP' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('t.name ILIKE $1');
            expect(countCall[1][0]).toBe('%TP%');
        });

        test('applies power_kva filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await Transformer.findAll(1, 10, { power_kva: 500 });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('t.power_kva >= $1');
            expect(countCall[1][0]).toBe(500);
        });

        test('applies voltage_kv filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await Transformer.findAll(1, 10, { voltage_kv: 10 });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('t.voltage_kv = $1');
            expect(countCall[1][0]).toBe(10);
        });

        test('applies multiple filters simultaneously', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await Transformer.findAll(1, 10, { name: 'TP', power_kva: 500, voltage_kv: 10 });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('t.name ILIKE $1');
            expect(countCall[0]).toContain('t.power_kva >= $2');
            expect(countCall[0]).toContain('t.voltage_kv = $3');
        });

        test('calculates correct offset for page 2', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '15' }] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await Transformer.findAll(2, 10);

            const dataCall = db.query.mock.calls[1];
            expect(dataCall[1]).toEqual([10, 10]); // limit=10, offset=10
            expect(result.pagination.totalPages).toBe(2);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Transformer.findAll()).rejects.toThrow('Failed to fetch transformers');
        });
    });

    describe('findById', () => {
        test('returns transformer when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Transformer.findById(1);

            expect(result).toBeDefined();
            expect(result.transformer_id).toBe(1);
            expect(result.name).toBe('TP-100');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM transformers WHERE transformer_id = $1',
                [1]
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Transformer.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Transformer.findById(1)).rejects.toThrow('Failed to fetch transformer');
        });
    });

    describe('create', () => {
        test('creates and returns new transformer', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Transformer.create({
                name: 'TP-100',
                power_kva: 630,
                voltage_kv: 10
            });

            expect(result).toBeDefined();
            expect(result.name).toBe('TP-100');
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO transformers');
            expect(db.query.mock.calls[0][1]).toEqual(['TP-100', 630, 10]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(
                Transformer.create({ name: 'X', power_kva: 100, voltage_kv: 10 })
            ).rejects.toThrow('Failed to create transformer');
        });
    });

    describe('update', () => {
        test('updates and returns transformer', async () => {
            const updated = { ...mockRow, name: 'TP-200' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await Transformer.update(1, { name: 'TP-200' });

            expect(result.name).toBe('TP-200');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE transformers');
        });

        test('only updates provided fields', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Transformer.update(1, { name: 'New', power_kva: 1000 });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('name = $1');
            expect(query).toContain('power_kva = $2');
            expect(db.query.mock.calls[0][1]).toEqual(['New', 1000, 1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Transformer.update(999, { name: 'X' });

            expect(result).toBeNull();
        });

        test('throws when no fields to update', async () => {
            await expect(Transformer.update(1, {})).rejects.toThrow('Failed to update transformer');
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Transformer.update(1, { name: 'X' })).rejects.toThrow('Failed to update transformer');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed transformer', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Transformer.delete(1);

            expect(result).toBeDefined();
            expect(result.transformer_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM transformers');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Transformer.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Transformer.delete(1)).rejects.toThrow('Failed to delete transformer');
        });
    });

    describe('findByBuildingId', () => {
        test('returns transformers for given building', async () => {
            db.query.mockResolvedValue({ rows: [mockRow, { ...mockRow, transformer_id: 2 }] });

            const result = await Transformer.findByBuildingId(1);

            expect(result).toHaveLength(2);
            expect(result[0].transformer_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('b.building_id = $1');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns empty array when no transformers found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Transformer.findByBuildingId(999);

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Transformer.findByBuildingId(1)).rejects.toThrow('Failed to fetch transformers by building');
        });
    });
});
