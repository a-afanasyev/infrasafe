// [B-024] Unit tests for MapLayerCounts.getCounts — the data source for the
// public GET /api/map-layer-counts endpoint that lets anonymous map visitors
// see object counts for auth-gated layers (whose detail endpoints 401) instead
// of a wall of (0).

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
const MapLayerCounts = require('../../../src/models/MapLayerCounts');

describe('MapLayerCounts.getCounts (B-024)', () => {
    beforeEach(() => {
        db.query.mockReset();
    });

    // pg returns count(*) as a bigint string — the model must coerce to Number.
    const mkRow = (overrides = {}) => ({
        buildings: '17',
        controllers: '12',
        transformers: '8',
        power_lines: '5',
        water_sources: '3',
        water_lines: '6',
        heat_sources: '2',
        alerts_active: '4',
        ...overrides
    });

    test('returns all layer counts coerced to integers', async () => {
        db.query.mockResolvedValue({ rows: [mkRow()] });

        const result = await MapLayerCounts.getCounts();

        expect(result).toEqual({
            buildings: 17,
            controllers: 12,
            transformers: 8,
            power_lines: 5,
            water_sources: 3,
            water_lines: 6,
            heat_sources: 2,
            alerts_active: 4
        });
        // Every value must be a real Number, not a bigint string.
        Object.values(result).forEach(v => expect(typeof v).toBe('number'));
    });

    test('queries the correct tables and the active-alert filter', async () => {
        db.query.mockResolvedValue({ rows: [mkRow()] });

        await MapLayerCounts.getCounts();

        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/FROM buildings/);
        expect(sql).toMatch(/FROM controllers/);
        expect(sql).toMatch(/FROM transformers/);
        expect(sql).toMatch(/FROM lines/);
        expect(sql).toMatch(/FROM cold_water_sources/);
        expect(sql).toMatch(/FROM water_lines/);
        expect(sql).toMatch(/FROM heat_sources/);
        expect(sql).toMatch(/FROM infrastructure_alerts/);
        expect(sql).toMatch(/status\s*=\s*'active'/);
    });

    test('defaults missing/NULL counts to 0', async () => {
        db.query.mockResolvedValue({
            rows: [{ buildings: '17' }] // other columns absent
        });

        const result = await MapLayerCounts.getCounts();

        expect(result.buildings).toBe(17);
        expect(result.transformers).toBe(0);
        expect(result.alerts_active).toBe(0);
    });

    test('propagates DB errors to the caller', async () => {
        db.query.mockRejectedValue(new Error('connection refused'));

        await expect(MapLayerCounts.getCounts()).rejects.toThrow('connection refused');
    });
});
