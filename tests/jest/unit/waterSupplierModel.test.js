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
const WaterSupplier = require('../../../src/models/WaterSupplier');

describe('WaterSupplier Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        supplier_id: 1,
        name: 'Supplier 1',
        supplier_type: 'cold_water',
        company_name: 'AquaCo',
        contact_person: 'John',
        phone: '+998901234567',
        email: 'john@aquaco.com',
        address: '123 Water St',
        contract_number: 'C-001',
        service_area: 'Zone A',
        tariff_per_m3: 2.5,
        status: 'active',
        notes: 'Test supplier',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        connected_buildings: ['Building A']
    };

    describe('findAll', () => {
        test('returns paginated results', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '2' }] })
                .mockResolvedValueOnce({ rows: [mockRow, { ...mockRow, supplier_id: 2 }] });

            const result = await WaterSupplier.findAll(1, 10);

            expect(result.data).toHaveLength(2);
            expect(result.data[0].supplier_id).toBe(1);
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

            await WaterSupplier.findAll(1, 10, { name: 'Supplier' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('ws.name ILIKE $1');
            expect(countCall[1][0]).toBe('%Supplier%');
        });

        test('applies type filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await WaterSupplier.findAll(1, 10, { type: 'cold_water' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('ws.supplier_type = $1');
            expect(countCall[1][0]).toBe('cold_water');
        });

        test('applies status filter', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await WaterSupplier.findAll(1, 10, { status: 'active' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('ws.status = $1');
            expect(countCall[1][0]).toBe('active');
        });

        test('applies multiple filters simultaneously', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] })
                .mockResolvedValueOnce({ rows: [mockRow] });

            await WaterSupplier.findAll(1, 10, { name: 'S', type: 'cold_water', status: 'active' });

            const countCall = db.query.mock.calls[0];
            expect(countCall[0]).toContain('ws.name ILIKE $1');
            expect(countCall[0]).toContain('ws.supplier_type = $2');
            expect(countCall[0]).toContain('ws.status = $3');
        });

        test('calculates correct offset for page 2', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ count: '15' }] })
                .mockResolvedValueOnce({ rows: [] });

            const result = await WaterSupplier.findAll(2, 10);

            const dataCall = db.query.mock.calls[1];
            expect(dataCall[1]).toEqual([10, 10]); // limit=10, offset=10
            expect(result.pagination.totalPages).toBe(2);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterSupplier.findAll()).rejects.toThrow('Failed to fetch water suppliers');
        });
    });

    describe('findById', () => {
        test('returns supplier when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterSupplier.findById(1);

            expect(result).toBeDefined();
            expect(result.supplier_id).toBe(1);
            expect(result.name).toBe('Supplier 1');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterSupplier.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterSupplier.findById(1)).rejects.toThrow('Failed to fetch water supplier');
        });
    });

    describe('create', () => {
        test('creates and returns new supplier', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterSupplier.create(mockRow);

            expect(result).toBeDefined();
            expect(result.name).toBe('Supplier 1');
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO water_suppliers');
        });

        test('passes all fields to query', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await WaterSupplier.create(mockRow);

            const params = db.query.mock.calls[0][1];
            expect(params).toContain('Supplier 1');
            expect(params).toContain('cold_water');
            expect(params).toContain('AquaCo');
            expect(params).toContain(2.5);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(WaterSupplier.create(mockRow)).rejects.toThrow('Failed to create water supplier');
        });
    });

    describe('update', () => {
        test('updates and returns supplier', async () => {
            const updated = { ...mockRow, name: 'Updated Supplier' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await WaterSupplier.update(1, updated);

            expect(result.name).toBe('Updated Supplier');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE water_suppliers');
        });

        test('passes id as last parameter', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await WaterSupplier.update(1, mockRow);

            const params = db.query.mock.calls[0][1];
            expect(params[params.length - 1]).toBe(1);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterSupplier.update(999, mockRow);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterSupplier.update(1, mockRow)).rejects.toThrow('Failed to update water supplier');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed supplier', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterSupplier.delete(1);

            expect(result).toBeDefined();
            expect(result.supplier_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM water_suppliers');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterSupplier.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterSupplier.delete(1)).rejects.toThrow('Failed to delete water supplier');
        });
    });

    describe('findByBuildingId', () => {
        test('returns suppliers for given building', async () => {
            db.query.mockResolvedValue({ rows: [mockRow, { ...mockRow, supplier_id: 2 }] });

            const result = await WaterSupplier.findByBuildingId(1);

            expect(result).toHaveLength(2);
            expect(result[0].supplier_id).toBe(1);
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns empty array when no suppliers found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterSupplier.findByBuildingId(999);

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterSupplier.findByBuildingId(1)).rejects.toThrow('Failed to fetch water suppliers by building');
        });
    });

    describe('findByType', () => {
        test('returns suppliers of given type', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await WaterSupplier.findByType('cold_water');

            expect(result).toHaveLength(1);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('WHERE supplier_type = $1 AND status = $2'),
                ['cold_water', 'active']
            );
        });

        test('returns empty array when none found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await WaterSupplier.findByType('hot_water');

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(WaterSupplier.findByType('cold_water')).rejects.toThrow('Failed to fetch water suppliers by type');
        });
    });
});
