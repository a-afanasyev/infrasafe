jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const {
    calculatePower,
    getBuildingsPower,
    getBuildingPower,
    getTransformersPower,
    getTransformerPower
} = require('../../../src/services/powerAnalyticsService');

describe('powerAnalyticsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('calculatePower', () => {
        test('calculates power correctly with PF=0.95', () => {
            // P = (V * I * PF) / 1000
            const result = calculatePower(220, 10);
            expect(result).toBeCloseTo((220 * 10 * 0.95) / 1000, 4);
            expect(result).toBeCloseTo(2.09, 2);
        });

        test('returns 0 for zero voltage', () => {
            expect(calculatePower(0, 10)).toBe(0);
        });

        test('returns 0 for zero amperage', () => {
            expect(calculatePower(220, 0)).toBe(0);
        });
    });

    describe('getBuildingsPower', () => {
        const mockRow = {
            building_id: 1,
            building_name: 'Building 1',
            controllers_count: '3',
            avg_voltage_ph1: 220,
            avg_voltage_ph2: 221,
            avg_voltage_ph3: 219,
            total_amperage_ph1: 15,
            total_amperage_ph2: 14,
            total_amperage_ph3: 16,
            last_measurement_time: '2024-01-01T00:00:00Z'
        };

        test('returns mapped building power data', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await getBuildingsPower();

            expect(result).toHaveLength(1);
            const b = result[0];
            expect(b.building_id).toBe(1);
            expect(b.building_name).toBe('Building 1');
            expect(b.controllers_count).toBe(3);
            expect(parseFloat(b.voltage_ph1)).toBeCloseTo(220, 0);
            expect(parseFloat(b.total_power_kw)).toBeGreaterThan(0);
        });

        test('total_power = sum of 3 phases', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await getBuildingsPower();
            const b = result[0];

            const sum = parseFloat(b.power_ph1_kw) + parseFloat(b.power_ph2_kw) + parseFloat(b.power_ph3_kw);
            expect(parseFloat(b.total_power_kw)).toBeCloseTo(sum, 1);
        });

        test('handles null metrics gracefully', async () => {
            const nullRow = {
                ...mockRow,
                avg_voltage_ph1: null,
                total_amperage_ph1: null
            };
            db.query.mockResolvedValue({ rows: [nullRow] });

            const result = await getBuildingsPower();
            expect(parseFloat(result[0].power_ph1_kw)).toBe(0);
        });
    });

    describe('getBuildingPower', () => {
        test('returns single building power', async () => {
            db.query.mockResolvedValue({
                rows: [{
                    building_id: 5, building_name: 'B5', controllers_count: '1',
                    avg_voltage_ph1: 220, avg_voltage_ph2: 220, avg_voltage_ph3: 220,
                    total_amperage_ph1: 10, total_amperage_ph2: 10, total_amperage_ph3: 10,
                    last_measurement_time: null
                }]
            });

            const result = await getBuildingPower(5);

            expect(result).toBeDefined();
            expect(result.building_id).toBe(5);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('HAVING b.building_id = $1'),
                [5]
            );
        });

        test('returns null when building not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await getBuildingPower(999);
            expect(result).toBeNull();
        });
    });

    describe('getTransformersPower', () => {
        const mockTransformerRow = {
            id: 1,
            name: 'Transformer 1',
            capacity_kva: '630',
            buildings_count: '5',
            controllers_count: '10',
            avg_voltage_ph1: 220,
            avg_voltage_ph2: 221,
            avg_voltage_ph3: 219,
            total_amperage_ph1: 100,
            total_amperage_ph2: 95,
            total_amperage_ph3: 105,
            last_measurement_time: '2024-01-01T00:00:00Z'
        };

        test('returns transformer power with load percentage', async () => {
            db.query.mockResolvedValue({ rows: [mockTransformerRow] });

            const result = await getTransformersPower();

            expect(result).toHaveLength(1);
            const t = result[0];
            expect(t.id).toBe(1);
            expect(t.capacity_kva).toBe('630');
            expect(parseFloat(t.load_percent)).toBeGreaterThan(0);
            expect(parseFloat(t.total_power_kw)).toBeGreaterThan(0);
        });

        test('calculates per-phase load percentages', async () => {
            db.query.mockResolvedValue({ rows: [mockTransformerRow] });

            const result = await getTransformersPower();
            const t = result[0];

            expect(parseFloat(t.load_percent_ph1)).toBeGreaterThan(0);
            expect(parseFloat(t.load_percent_ph2)).toBeGreaterThan(0);
            expect(parseFloat(t.load_percent_ph3)).toBeGreaterThan(0);
        });

        test('handles zero capacity without division by zero', async () => {
            const zeroCapacity = { ...mockTransformerRow, capacity_kva: '0' };
            db.query.mockResolvedValue({ rows: [zeroCapacity] });

            const result = await getTransformersPower();
            expect(parseFloat(result[0].load_percent)).toBe(0);
            expect(parseFloat(result[0].load_percent_ph1)).toBe(0);
        });
    });

    describe('getTransformerPower', () => {
        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await getTransformerPower(999);
            expect(result).toBeNull();
        });

        test('passes transformer ID as parameter', async () => {
            db.query.mockResolvedValue({
                rows: [{
                    id: 3, name: 'T3', capacity_kva: '400',
                    buildings_count: '2', controllers_count: '4',
                    avg_voltage_ph1: 220, avg_voltage_ph2: 220, avg_voltage_ph3: 220,
                    total_amperage_ph1: 50, total_amperage_ph2: 50, total_amperage_ph3: 50,
                    last_measurement_time: null
                }]
            });

            const result = await getTransformerPower(3);

            expect(result.id).toBe(3);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('HAVING t.transformer_id = $1'),
                [3]
            );
        });
    });
});
