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
        test('includes pagination metadata', async () => {
            db.query.mockResolvedValue({ rows: [mockDbRow, mockDbRow] });

            const result = await getBuildingsWithMetrics(true);

            expect(result.pagination).toEqual({
                total: 2,
                page: 1,
                limit: 2,
                totalPages: 1
            });
        });
    });
});
