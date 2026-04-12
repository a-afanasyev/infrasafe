jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/utils/queryValidation', () => ({
    validateSortOrder: jest.fn().mockReturnValue({ validSort: 'building_id', validOrder: 'asc' })
}));

const db = require('../../../src/config/database');
const Building = require('../../../src/models/Building');

describe('Building Model — branch coverage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockBuilding = {
        building_id: 1,
        name: 'Test Building',
        address: '123 Main St',
        town: 'Tashkent',
        latitude: 41.3,
        longitude: 69.3,
        management_company: 'MC',
        region: 'Tashkent',
        has_hot_water: true,
        primary_transformer_id: null,
        backup_transformer_id: null,
        primary_line_id: null,
        backup_line_id: null,
        cold_water_line_id: null,
        hot_water_line_id: null,
        cold_water_supplier_id: null,
        hot_water_supplier_id: null
    };

    const buildingData = {
        name: 'Test Building',
        address: '123 Main St',
        town: 'Tashkent',
        latitude: 41.3,
        longitude: 69.3,
        management_company: 'MC',
        region: 'Tashkent',
        has_hot_water: true,
        primary_transformer_id: null,
        backup_transformer_id: null,
        primary_line_id: null,
        backup_line_id: null,
        cold_water_line_id: null,
        hot_water_line_id: null,
        cold_water_supplier_id: null,
        hot_water_supplier_id: null
    };

    // ── findAll ──────────────────────────────────────────────

    describe('findAll', () => {
        test('throws "Failed to fetch buildings" on db error', async () => {
            db.query.mockRejectedValue(new Error('connection lost'));

            await expect(Building.findAll()).rejects.toThrow('Failed to fetch buildings');
        });
    });

    // ── findById ─────────────────────────────────────────────

    describe('findById', () => {
        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Building.findById(999);

            expect(result).toBeNull();
        });

        test('throws "Failed to fetch building" on db error', async () => {
            db.query.mockRejectedValue(new Error('connection reset'));

            await expect(Building.findById(1)).rejects.toThrow('Failed to fetch building');
        });
    });

    // ── findByIdWithControllers ──────────────────────────────

    describe('findByIdWithControllers', () => {
        test('returns building with controllers when found', async () => {
            const buildingWithControllers = {
                ...mockBuilding,
                controllers: []
            };
            db.query.mockResolvedValue({ rows: [buildingWithControllers] });

            const result = await Building.findByIdWithControllers(1);

            expect(result).toBeDefined();
            expect(result.building_id).toBe(1);
            expect(result.controllers).toEqual([]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Building.findByIdWithControllers(999);

            expect(result).toBeNull();
        });

        test('throws "Failed to fetch building with controllers" on db error', async () => {
            db.query.mockRejectedValue(new Error('timeout'));

            await expect(Building.findByIdWithControllers(1)).rejects.toThrow(
                'Failed to fetch building with controllers'
            );
        });
    });

    // ── create ───────────────────────────────────────────────

    describe('create', () => {
        test('throws "Failed to create building" on db error', async () => {
            db.query.mockRejectedValue(new Error('unique violation'));

            await expect(Building.create(buildingData)).rejects.toThrow(
                'Failed to create building'
            );
        });
    });

    // ── update ───────────────────────────────────────────────

    describe('update', () => {
        test('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Building.update(999, buildingData);

            expect(result).toBeNull();
        });

        test('throws "Failed to update building" on db error', async () => {
            db.query.mockRejectedValue(new Error('deadlock'));

            await expect(Building.update(1, buildingData)).rejects.toThrow(
                'Failed to update building'
            );
        });
    });

    // ── delete ───────────────────────────────────────────────

    describe('delete', () => {
        test('throws "Failed to delete building" on db error', async () => {
            db.query.mockRejectedValue(new Error('foreign key'));

            await expect(Building.delete(1)).rejects.toThrow('Failed to delete building');
        });
    });

    // ── findByExternalId ─────────────────────────────────────

    describe('findByExternalId', () => {
        test('throws "Failed to find building by external_id" on db error', async () => {
            db.query.mockRejectedValue(new Error('invalid uuid'));

            await expect(
                Building.findByExternalId('bad-uuid')
            ).rejects.toThrow('Failed to find building by external_id');
        });
    });

    // ── softDelete ───────────────────────────────────────────

    describe('softDelete', () => {
        test('throws "Failed to soft-delete building" on db error', async () => {
            db.query.mockRejectedValue(new Error('connection refused'));

            await expect(Building.softDelete(1)).rejects.toThrow(
                'Failed to soft-delete building'
            );
        });
    });
});
