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
const Line = require('../../../src/models/Line');

describe('Line Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        line_id: 1,
        name: 'Line Alpha',
        voltage_kv: 10,
        length_km: 5.5,
        transformer_id: 1,
        main_path: null,
        branches: null,
        cable_type: 'underground',
        commissioning_year: 2020,
        created_at: '2024-01-01',
        updated_at: '2024-01-01'
    };

    describe('findAll', () => {
        test('returns paginated results', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })
                .mockResolvedValueOnce({ rows: [mockRow, { ...mockRow, line_id: 2 }] });

            const result = await Line.findAll(1, 10);

            expect(result.data).toHaveLength(2);
            expect(result.data[0].line_id).toBe(1);
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

            await Line.findAll(1, 10, { name: 'Alpha' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('name ILIKE $1');
            expect(countCall[1][0]).toBe('%Alpha%');
        });

        test('applies voltage_kv filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await Line.findAll(1, 10, { voltage_kv: 10 });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('voltage_kv = $1');
            expect(countCall[1][0]).toBe(10);
        });

        test('applies transformer_id filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await Line.findAll(1, 10, { transformer_id: 1 });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('transformer_id = $1');
            expect(countCall[1][0]).toBe(1);
        });

        test('calculates correct offset for page 2', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '15' }] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await Line.findAll(2, 10);

            const dataCall = db.query.mock.calls[1];
            expect(dataCall[1]).toEqual([10, 10]); // limit=10, offset=10
            expect(result.pagination.totalPages).toBe(2);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Line.findAll()).rejects.toThrow('Failed to fetch lines');
        });
    });

    describe('findById', () => {
        test('returns line when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Line.findById(1);

            expect(result).toBeDefined();
            expect(result.line_id).toBe(1);
            expect(result.name).toBe('Line Alpha');
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM lines WHERE line_id = $1',
                [1]
            );
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Line.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Line.findById(1)).rejects.toThrow('Failed to fetch line');
        });
    });

    describe('create', () => {
        test('creates and returns new line', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Line.create({
                name: 'Line Alpha',
                voltage_kv: 10,
                length_km: 5.5
            });

            expect(result).toBeDefined();
            expect(result.name).toBe('Line Alpha');
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO lines');
        });

        test('includes optional fields when provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Line.create({
                name: 'Line Alpha',
                voltage_kv: 10,
                length_km: 5.5,
                transformer_id: 1,
                cable_type: 'underground',
                commissioning_year: 2020
            });

            const params = db.query.mock.calls[0][1];
            expect(params).toContain('Line Alpha');
            expect(params).toContain(10);
            expect(params).toContain(5.5);
            expect(params).toContain(1);
            expect(params).toContain('underground');
            expect(params).toContain(2020);
        });

        test('serializes main_path and branches to JSON', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const mainPath = [[41.3, 69.2], [41.4, 69.3]];
            const branches = [[[41.3, 69.2]]];

            await Line.create({
                name: 'Line',
                main_path: mainPath,
                branches: branches
            });

            const params = db.query.mock.calls[0][1];
            expect(params).toContain(JSON.stringify(mainPath));
            expect(params).toContain(JSON.stringify(branches));
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(Line.create({ name: 'X' })).rejects.toThrow('Failed to create line');
        });
    });

    describe('create with optional coordinate fields', () => {
        test('includes coordinate fields when provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Line.create({
                name: 'Line Alpha',
                voltage_kv: 10,
                length_km: 5.5,
                cable_type: 'underground',
                commissioning_year: 2020,
                latitude_start: 41.3,
                longitude_start: 69.2,
                latitude_end: 41.4,
                longitude_end: 69.3
            });

            const query = db.query.mock.calls[0][0];
            const params = db.query.mock.calls[0][1];
            expect(query).toContain('latitude_start');
            expect(query).toContain('longitude_start');
            expect(query).toContain('latitude_end');
            expect(query).toContain('longitude_end');
            expect(params).toContain(41.3);
            expect(params).toContain(69.2);
            expect(params).toContain(41.4);
            expect(params).toContain(69.3);
        });

        test('omits coordinate fields when not provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Line.create({
                name: 'Line Alpha',
                voltage_kv: 10,
                length_km: 5.5
            });

            const query = db.query.mock.calls[0][0];
            expect(query).not.toContain('latitude_start');
            expect(query).not.toContain('longitude_start');
            expect(query).not.toContain('latitude_end');
            expect(query).not.toContain('longitude_end');
        });
    });

    describe('update', () => {
        test('updates and returns line', async () => {
            const updated = { ...mockRow, name: 'Updated Line' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await Line.update(1, { name: 'Updated Line' });

            expect(result.name).toBe('Updated Line');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE lines');
        });

        test('only updates provided fields', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Line.update(1, { name: 'New Name', voltage_kv: 20 });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('name = $1');
            expect(query).toContain('voltage_kv = $2');
            expect(db.query.mock.calls[0][1]).toEqual(['New Name', 20, 1]);
        });

        test('returns null when line not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Line.update(999, { name: 'X' });

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Line.update(1, { name: 'X' })).rejects.toThrow('Failed to update line');
        });
    });

    describe('update with optional fields', () => {
        test('updates only provided fields including coordinates', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Line.update(1, {
                latitude_start: 41.3,
                longitude_start: 69.2,
                latitude_end: 41.4,
                longitude_end: 69.3,
                cable_type: 'overhead',
                commissioning_year: 2022,
                main_path: [[41.3, 69.2], [41.4, 69.3]],
                branches: [[[41.3, 69.2]]]
            });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('latitude_start');
            expect(query).toContain('longitude_start');
            expect(query).toContain('latitude_end');
            expect(query).toContain('longitude_end');
            expect(query).toContain('cable_type');
            expect(query).toContain('commissioning_year');
            expect(query).toContain('main_path');
            expect(query).toContain('branches');
        });

        test('updates voltage_kv and length_km when provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Line.update(1, {
                voltage_kv: 35,
                length_km: 12.5,
                transformer_id: 3
            });

            const query = db.query.mock.calls[0][0];
            const params = db.query.mock.calls[0][1];
            expect(query).toContain('voltage_kv');
            expect(query).toContain('length_km');
            expect(query).toContain('transformer_id');
            expect(params).toContain(35);
            expect(params).toContain(12.5);
            expect(params).toContain(3);
        });
    });

    describe('delete', () => {
        test('deletes and returns removed line', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Line.delete(1);

            expect(result).toBeDefined();
            expect(result.line_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM lines');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when line not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Line.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Line.delete(1)).rejects.toThrow('Failed to delete line');
        });
    });

    describe('findByTransformerId', () => {
        test('returns lines for given transformer', async () => {
            db.query.mockResolvedValue({ rows: [mockRow, { ...mockRow, line_id: 2 }] });

            const result = await Line.findByTransformerId(1);

            expect(result).toHaveLength(2);
            expect(result[0].line_id).toBe(1);
            expect(db.query).toHaveBeenCalledWith(
                'SELECT * FROM lines WHERE transformer_id = $1',
                [1]
            );
        });

        test('returns empty array when no lines found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Line.findByTransformerId(999);

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Line.findByTransformerId(1)).rejects.toThrow('Failed to fetch lines by transformer');
        });
    });
});
