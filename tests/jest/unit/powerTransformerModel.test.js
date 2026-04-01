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
const PowerTransformer = require('../../../src/models/PowerTransformer');

describe('PowerTransformer Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        id: 1,
        name: 'Transformer Alpha',
        address: '123 Main St',
        latitude: 41.3,
        longitude: 69.2,
        capacity_kva: 1000,
        voltage_primary: 10,
        voltage_secondary: 0.4,
        installation_date: '2020-01-01',
        manufacturer: 'ABB',
        model: 'TM-1000',
        status: 'active',
        maintenance_contact: 'John Doe',
        notes: 'Test transformer',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        buildings_count: '3',
        controllers_count: '5'
    };

    describe('create', () => {
        test('creates and returns new transformer', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await PowerTransformer.create(mockRow);

            expect(result).toBeDefined();
            expect(result.name).toBe('Transformer Alpha');
            expect(result.id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO power_transformers');
        });

        test('defaults status to active when not provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await PowerTransformer.create({ ...mockRow, status: undefined });

            const params = db.query.mock.calls[0][1];
            expect(params[11]).toBe('active');
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate key'));

            await expect(PowerTransformer.create(mockRow)).rejects.toThrow('duplicate key');
        });
    });

    describe('findAll', () => {
        test('returns all transformers with counts', async () => {
            db.query.mockResolvedValue({ rows: [mockRow, { ...mockRow, id: 2, name: 'Beta' }] });

            const result = await PowerTransformer.findAll();

            expect(result).toHaveLength(2);
            expect(result[0].buildings_count).toBe(3);
            expect(result[0].controllers_count).toBe(5);
        });

        test('applies status filter', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await PowerTransformer.findAll({ status: 'active' });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('pt.status = $1');
            expect(db.query.mock.calls[0][1]).toContain('active');
        });

        test('applies capacity_min filter', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await PowerTransformer.findAll({ capacity_min: 500 });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('pt.capacity_kva >= $1');
        });

        test('applies capacity_max filter', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await PowerTransformer.findAll({ capacity_max: 2000 });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('pt.capacity_kva <= $1');
        });

        test('applies multiple filters', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await PowerTransformer.findAll({ status: 'active', capacity_min: 500, capacity_max: 2000 });

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('pt.status = $1');
            expect(query).toContain('pt.capacity_kva >= $2');
            expect(query).toContain('pt.capacity_kva <= $3');
            expect(db.query.mock.calls[0][1]).toEqual(['active', 500, 2000]);
        });

        test('returns empty array when no transformers', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await PowerTransformer.findAll();

            expect(result).toEqual([]);
        });
    });

    describe('findById', () => {
        test('returns transformer with counts when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await PowerTransformer.findById(1);

            expect(result).toBeDefined();
            expect(result.name).toBe('Transformer Alpha');
            expect(result.buildings_count).toBe(3);
            expect(result.controllers_count).toBe(5);
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await PowerTransformer.findById(999);

            expect(result).toBeNull();
        });
    });

    describe('update', () => {
        test('updates and returns transformer', async () => {
            const updated = { ...mockRow, name: 'Updated' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await PowerTransformer.update(1, { name: 'Updated' });

            expect(result.name).toBe('Updated');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE power_transformers');
        });

        test('only updates provided fields', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await PowerTransformer.update(1, { name: 'New Name', status: 'maintenance' });

            const params = db.query.mock.calls[0][1];
            expect(params).toEqual(['New Name', 'maintenance', 1]);
        });

        test('throws when no update data provided', async () => {
            await expect(PowerTransformer.update(1, {})).rejects.toThrow('Нет данных для обновления');
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await PowerTransformer.update(999, { name: 'X' });

            expect(result).toBeNull();
        });
    });

    describe('delete', () => {
        test('deletes transformer when no linked buildings', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '0' }] })  // check buildings
                .mockResolvedValueOnce({ rows: [mockRow] });          // delete

            const result = await PowerTransformer.delete(1);

            expect(result).toBe(true);
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('throws when linked buildings exist', async () => {
            db.query.mockResolvedValue({ rows: [{ count: '3' }] });

            await expect(PowerTransformer.delete(1)).rejects.toThrow(
                'Нельзя удалить трансформатор, к которому привязаны здания'
            );
        });

        test('returns false when transformer not found', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '0' }] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await PowerTransformer.delete(999);

            expect(result).toBe(false);
        });
    });

    describe('getLoadAnalytics', () => {
        test('returns analytics for transformer', async () => {
            const analytics = { id: 1, load_percent: 75 };
            db.query.mockResolvedValue({ rows: [analytics] });

            const result = await PowerTransformer.getLoadAnalytics(1);

            expect(result).toEqual(analytics);
            expect(db.query.mock.calls[0][0]).toContain('mv_transformer_load_realtime');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await PowerTransformer.getLoadAnalytics(999);

            expect(result).toBeNull();
        });
    });

    describe('getAllWithLoadAnalytics', () => {
        test('returns all transformers with load analytics', async () => {
            const rows = [
                { id: 1, name: 'T1', load_percent: 90 },
                { id: 2, name: 'T2', load_percent: 50 }
            ];
            db.query.mockResolvedValue({ rows });

            const result = await PowerTransformer.getAllWithLoadAnalytics();

            expect(result).toHaveLength(2);
            expect(result[0].load_percent).toBe(90);
            expect(db.query.mock.calls[0][0]).toContain('ORDER BY load_percent DESC');
        });
    });

    describe('findNearestBuildings', () => {
        test('returns nearest buildings to transformer', async () => {
            const buildings = [{ building_id: 1, distance: 100 }];
            db.query.mockResolvedValue({ rows: buildings });

            const result = await PowerTransformer.findNearestBuildings(1, 1000, 50);

            expect(result).toEqual(buildings);
            expect(db.query.mock.calls[0][0]).toContain('find_nearest_buildings_to_transformer');
            expect(db.query.mock.calls[0][1]).toEqual([1, 1000, 50]);
        });

        test('uses default parameters', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await PowerTransformer.findNearestBuildings(1);

            expect(db.query.mock.calls[0][1]).toEqual([1, 1000, 50]);
        });
    });

    describe('getOverloadedTransformers', () => {
        test('returns overloaded transformers', async () => {
            const rows = [{ id: 1, load_percent: 95 }];
            db.query.mockResolvedValue({ rows });

            const result = await PowerTransformer.getOverloadedTransformers(80);

            expect(result).toEqual(rows);
            expect(db.query.mock.calls[0][0]).toContain('load_percent >= $1');
            expect(db.query.mock.calls[0][1]).toEqual([80]);
        });

        test('uses default threshold of 80', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await PowerTransformer.getOverloadedTransformers();

            expect(db.query.mock.calls[0][1]).toEqual([80]);
        });
    });

    describe('findInRadius', () => {
        test('returns transformers within radius', async () => {
            const rows = [{
                ...mockRow,
                distance_meters: '150.5'
            }];
            db.query.mockResolvedValue({ rows });

            const result = await PowerTransformer.findInRadius(41.3, 69.2, 5000);

            expect(result).toHaveLength(1);
            expect(result[0].distance_meters).toBe(150.5);
            expect(db.query.mock.calls[0][1]).toEqual([41.3, 69.2, 5000]);
        });

        test('uses default radius of 5000', async () => {
            db.query.mockResolvedValue({ rows: [] });

            await PowerTransformer.findInRadius(41.3, 69.2);

            expect(db.query.mock.calls[0][1]).toEqual([41.3, 69.2, 5000]);
        });
    });

    describe('getStatistics', () => {
        test('returns aggregate statistics', async () => {
            const stats = {
                total_count: '10',
                active_count: '8',
                maintenance_count: '1',
                inactive_count: '1',
                avg_capacity: '750',
                total_capacity: '7500',
                min_capacity: '250',
                max_capacity: '2000'
            };
            db.query.mockResolvedValue({ rows: [stats] });

            const result = await PowerTransformer.getStatistics();

            expect(result).toEqual(stats);
            expect(db.query.mock.calls[0][0]).toContain('COUNT(*)');
        });
    });
});
