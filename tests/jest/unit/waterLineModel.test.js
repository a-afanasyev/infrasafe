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
const WaterLine = require('../../../src/models/WaterLine');

describe('WaterLine Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        line_id: 1,
        name: 'Water Line 1',
        description: 'Main water supply',
        diameter_mm: 200,
        material: 'steel',
        pressure_bar: 6,
        installation_date: '2020-01-01',
        status: 'active',
        latitude_start: 41.3,
        longitude_start: 69.2,
        latitude_end: 41.4,
        longitude_end: 69.3,
        main_path: null,
        branches: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        connected_buildings: ['Building A', 'Building B']
    };

    describe('findAll', () => {
        test('returns paginated results', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })
                .mockResolvedValueOnce({ rows: [mockRow, { ...mockRow, line_id: 2 }] });

            const result = await WaterLine.findAll(1, 10);

            expect(result.data).toHaveLength(2);
            expect(result.data[0].line_id).toBe(1);
            expect(result.pagination).toEqual({
                page: 1,
                limit: 10,
                total: 2,
                pages: 1
            });
        });

        test('applies name filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await WaterLine.findAll(1, 10, { name: 'Water' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('wl.name ILIKE $1');
            expect(countCall[1][0]).toBe('%Water%');
        });

        test('applies status filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await WaterLine.findAll(1, 10, { status: 'active' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('wl.status = $1');
            expect(countCall[1][0]).toBe('active');
        });

        test('applies material filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await WaterLine.findAll(1, 10, { material: 'steel' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('wl.material = $1');
            expect(countCall[1][0]).toBe('steel');
        });

        test('calculates correct offset for page 3', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '30' }] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await WaterLine.findAll(3, 10);

            const dataCall = db.query.mock.calls[1];
            expect(dataCall[1]).toEqual([10, 20]); // limit=10, offset=20
            expect(result.pagination.pages).toBe(3);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterLine.findAll()).rejects.toThrow('Failed to fetch water lines');
        });
    });

    describe('findById', () => {
        test('returns water line when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterLine.findById(1);

            expect(result).toBeDefined();
            expect(result.line_id).toBe(1);
            expect(result.name).toBe('Water Line 1');
            expect(result.connected_buildings).toEqual(['Building A', 'Building B']);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterLine.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterLine.findById(1)).rejects.toThrow('Failed to fetch water line');
        });
    });

    describe('create', () => {
        test('creates and returns new water line', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterLine.create({
                name: 'Water Line 1',
                diameter_mm: 200,
                material: 'steel'
            });

            expect(result).toBeDefined();
            expect(result.name).toBe('Water Line 1');
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO water_lines');
        });

        test('includes optional fields when provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await WaterLine.create({
                name: 'WL',
                description: 'desc',
                diameter_mm: 100,
                material: 'copper',
                pressure_bar: 5,
                status: 'active'
            });

            const params = db.query.mock.calls[0][1];
            expect(params).toContain('WL');
            expect(params).toContain('desc');
            expect(params).toContain(100);
            expect(params).toContain('copper');
            expect(params).toContain(5);
            expect(params).toContain('active');
        });

        test('serializes main_path and branches to JSON', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const mainPath = [[41.3, 69.2]];
            const branches = [[[41.3, 69.2]]];

            await WaterLine.create({
                name: 'WL',
                main_path: mainPath,
                branches: branches
            });

            const params = db.query.mock.calls[0][1];
            expect(params).toContain(JSON.stringify(mainPath));
            expect(params).toContain(JSON.stringify(branches));
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(WaterLine.create({ name: 'X' })).rejects.toThrow('Failed to create water line');
        });
    });

    describe('update', () => {
        test('updates and returns water line', async () => {
            const updated = { ...mockRow, name: 'Updated WL' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await WaterLine.update(1, { name: 'Updated WL' });

            expect(result.name).toBe('Updated WL');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE water_lines');
        });

        test('only updates provided fields', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await WaterLine.update(1, { name: 'New', diameter_mm: 300 });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('name = $1');
            expect(query).toContain('diameter_mm = $2');
            expect(db.query.mock.calls[0][1]).toEqual(['New', 300, 1]);
        });

        test('returns null when water line not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterLine.update(999, { name: 'X' });

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterLine.update(1, { name: 'X' })).rejects.toThrow('Failed to update water line');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed water line', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterLine.delete(1);

            expect(result).toBeDefined();
            expect(result.line_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM water_lines');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when water line not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterLine.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterLine.delete(1)).rejects.toThrow('Failed to delete water line');
        });
    });

    describe('findSuppliersForLine', () => {
        test('returns suppliers for given line', async () => {
            const suppliers = [{ supplier_id: 1, name: 'Supplier A' }];
            db.query.mockResolvedValue({ rows: suppliers });

            const result = await WaterLine.findSuppliersForLine(1);

            expect(result).toEqual(suppliers);
            expect(db.query.mock.calls[0][0]).toContain('water_suppliers');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns empty array when no suppliers found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterLine.findSuppliersForLine(999);

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterLine.findSuppliersForLine(1)).rejects.toThrow('Failed to fetch suppliers for line');
        });
    });

    describe('findByBuildingId', () => {
        test('returns water line for given building', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterLine.findByBuildingId(1);

            expect(result).toBeDefined();
            expect(result.line_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('buildings b');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when no water line found for building', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterLine.findByBuildingId(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterLine.findByBuildingId(1)).rejects.toThrow('Failed to fetch water line by building');
        });
    });
});
