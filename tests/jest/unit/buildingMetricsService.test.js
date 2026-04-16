jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const { getBuildingsWithMetrics } = require('../../../src/services/buildingMetricsService');

describe('buildingMetricsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockDbRow = {
        building_id: 1,
        building_name: 'Building 1',
        address: 'Test Address',
        town: 'Tashkent',
        latitude: '41.3111',
        longitude: '69.2797',
        region: 'Yunusabad',
        management_company: 'MC1',
        has_hot_water: true,
        controller_id: 10,
        controller_serial: 'SN001',
        controller_status: 'online',
        timestamp: '2024-01-01T00:00:00Z',
        electricity_ph1: '220.5',
        electricity_ph2: '221.0',
        electricity_ph3: '219.8',
        amperage_ph1: '15.2',
        amperage_ph2: '14.8',
        amperage_ph3: '15.5',
        cold_water_pressure: '3.5',
        cold_water_temp: '12.0',
        hot_water_in_pressure: '4.0',
        hot_water_out_pressure: '3.8',
        hot_water_in_temp: '65.0',
        hot_water_out_temp: '58.0',
        air_temp: '22.5',
        humidity: '45.0',
        leak_sensor: false
    };

    describe('authenticated access', () => {
        test('returns full metrics for authenticated user', async () => {
            db.query.mockResolvedValue({ rows: [mockDbRow] });

            const result = await getBuildingsWithMetrics(true);

            expect(result.data).toHaveLength(1);
            const building = result.data[0];

            // Full data present
            expect(building.controller_id).toBe(10);
            expect(building.controller_serial).toBe('SN001');
            expect(building.electricity_ph1).toBe(220.5);
            expect(building.amperage_ph1).toBe(15.2);
            expect(building.cold_water_pressure).toBe(3.5);
            expect(building.air_temp).toBe(22.5);
            expect(building.latitude).toBe(41.3111);
            expect(building.longitude).toBe(69.2797);
        });

        test('parses string values to floats', async () => {
            db.query.mockResolvedValue({ rows: [mockDbRow] });

            const result = await getBuildingsWithMetrics(true);
            const b = result.data[0];

            expect(typeof b.electricity_ph1).toBe('number');
            expect(typeof b.latitude).toBe('number');
            expect(typeof b.humidity).toBe('number');
        });

        test('returns null for missing numeric values', async () => {
            const sparse = { ...mockDbRow, electricity_ph1: null, latitude: null };
            db.query.mockResolvedValue({ rows: [sparse] });

            const result = await getBuildingsWithMetrics(true);
            expect(result.data[0].electricity_ph1).toBeNull();
            expect(result.data[0].latitude).toBeNull();
        });
    });

    describe('anonymous access', () => {
        test('returns truncated data for anonymous user', async () => {
            db.query.mockResolvedValue({ rows: [mockDbRow] });

            const result = await getBuildingsWithMetrics(false);

            const building = result.data[0];
            expect(building.building_id).toBe(1);
            expect(building.building_name).toBe('Building 1');
            expect(building.has_controller).toBe(true);
            expect(building.latitude).toBe(41.3111);

            // Sensitive data NOT present
            expect(building.controller_id).toBeUndefined();
            expect(building.electricity_ph1).toBeUndefined();
            expect(building.amperage_ph1).toBeUndefined();
            expect(building.cold_water_pressure).toBeUndefined();
        });

        test('has_controller is false when no controller', async () => {
            const noCtrl = { ...mockDbRow, controller_id: null };
            db.query.mockResolvedValue({ rows: [noCtrl] });

            const result = await getBuildingsWithMetrics(false);
            expect(result.data[0].has_controller).toBe(false);
        });
    });

    describe('pagination', () => {
        test('includes pagination metadata with default limit', async () => {
            db.query.mockResolvedValue({ rows: [mockDbRow, mockDbRow] });

            const result = await getBuildingsWithMetrics(true);

            expect(result.pagination).toEqual({
                total: 2,
                page: 1,
                limit: 5000,
                totalPages: 1
            });
        });

        test('respects explicit limit option', async () => {
            db.query.mockResolvedValue({ rows: [mockDbRow] });

            const result = await getBuildingsWithMetrics(true, { limit: 100 });

            expect(result.pagination.limit).toBe(100);
        });
    });

    describe('bbox helpers', () => {
        const { parseBbox, parseLimit, DEFAULT_LIMIT, MAX_LIMIT } = require('../../../src/services/buildingMetricsService');

        test('parseBbox returns null when unset', () => {
            expect(parseBbox(null)).toBeNull();
            expect(parseBbox(undefined)).toBeNull();
            expect(parseBbox('')).toBeNull();
        });

        test('parseBbox parses 4 comma-separated values', () => {
            expect(parseBbox('41.2,69.1,41.4,69.4')).toEqual({
                latMin: 41.2, lngMin: 69.1, latMax: 41.4, lngMax: 69.4
            });
        });

        test('parseBbox throws when fewer than 4 parts', () => {
            expect(() => parseBbox('1,2,3')).toThrow(/4 comma-separated/);
        });

        test('parseBbox throws on invalid numbers', () => {
            expect(() => parseBbox('a,b,c,d')).toThrow(/finite numbers/);
        });

        test('parseBbox throws on inverted ranges', () => {
            expect(() => parseBbox('50,10,40,20')).toThrow(/latitude/);
            expect(() => parseBbox('40,30,50,20')).toThrow(/longitude/);
        });

        test('parseLimit clamps to MAX_LIMIT and defaults', () => {
            expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
            expect(parseLimit('abc')).toBe(DEFAULT_LIMIT);
            expect(parseLimit(-5)).toBe(DEFAULT_LIMIT);
            expect(parseLimit(100)).toBe(100);
            expect(parseLimit(999999)).toBe(MAX_LIMIT);
        });

        test('service query uses 5-param array (bbox nullable + limit)', async () => {
            db.query.mockResolvedValue({ rows: [] });
            await getBuildingsWithMetrics(true, {
                bbox: { latMin: 41, lngMin: 69, latMax: 42, lngMax: 70 },
                limit: 500
            });
            const [, params] = db.query.mock.calls[0];
            expect(params).toEqual([41, 42, 69, 70, 500]);
        });

        test('service query passes nulls when bbox omitted', async () => {
            db.query.mockResolvedValue({ rows: [] });
            await getBuildingsWithMetrics(true);
            const [, params] = db.query.mock.calls[0];
            expect(params).toEqual([null, null, null, null, 5000]);
        });
    });
});
