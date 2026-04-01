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
const Metric = require('../../../src/models/Metric');

describe('Metric Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockRow = {
        metric_id: 1,
        controller_id: 10,
        timestamp: '2024-01-01T00:00:00Z',
        electricity_ph1: 220,
        electricity_ph2: 221,
        electricity_ph3: 219,
        amperage_ph1: 5,
        amperage_ph2: 6,
        amperage_ph3: 5.5,
        cold_water_pressure: 3.2,
        cold_water_temp: 12,
        hot_water_in_pressure: 4.0,
        hot_water_out_pressure: 3.8,
        hot_water_in_temp: 65,
        hot_water_out_temp: 55,
        air_temp: 22,
        humidity: 45,
        leak_sensor: false,
        controller_serial: 'SN-001'
    };

    describe('findAll', () => {
        test('returns paginated results with defaults', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [mockRow] })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            const result = await Metric.findAll();

            expect(result.data).toHaveLength(1);
            expect(result.pagination).toEqual({
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1
            });
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('uses custom page and limit', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '25' }] });

            const result = await Metric.findAll(3, 5, 'timestamp', 'desc');

            expect(result.pagination.page).toBe(3);
            expect(result.pagination.limit).toBe(5);
            expect(result.pagination.totalPages).toBe(5);

            const metricsCall = db.query.mock.calls[0];
            expect(metricsCall[1]).toEqual([5, 10]); // limit=5, offset=10
        });

        test('defaults invalid sort column to timestamp', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await Metric.findAll(1, 10, 'malicious_column', 'desc');

            // Should not throw; uses safe default
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('defaults invalid order to desc', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await Metric.findAll(1, 10, 'timestamp', 'INVALID');

            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Metric.findAll()).rejects.toThrow('Failed to fetch metrics');
        });
    });

    describe('findById', () => {
        test('returns metric when found', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Metric.findById(1);

            expect(result).toBeDefined();
            expect(result.metric_id).toBe(1);
            expect(result.electricity_ph1).toBe(220);
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Metric.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Metric.findById(1)).rejects.toThrow('Failed to fetch metric');
        });
    });

    describe('findByControllerId', () => {
        test('returns metrics for controller without date filters', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Metric.findByControllerId(10);

            expect(result).toHaveLength(1);
            expect(db.query.mock.calls[0][1]).toEqual([10]);
        });

        test('applies both start and end date filters', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Metric.findByControllerId(10, '2024-01-01', '2024-01-31');

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('BETWEEN $2 AND $3');
            expect(db.query.mock.calls[0][1]).toEqual([10, '2024-01-01', '2024-01-31']);
        });

        test('applies only start date filter', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Metric.findByControllerId(10, '2024-01-01', null);

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('timestamp >= $2');
            expect(db.query.mock.calls[0][1]).toEqual([10, '2024-01-01']);
        });

        test('applies only end date filter', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Metric.findByControllerId(10, null, '2024-01-31');

            const query = db.query.mock.calls[0][0];
            expect(query).toContain('timestamp <= $2');
            expect(db.query.mock.calls[0][1]).toEqual([10, '2024-01-31']);
        });

        test('returns empty array when none found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Metric.findByControllerId(999);

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Metric.findByControllerId(10)).rejects.toThrow('Failed to fetch metrics for controller');
        });
    });

    describe('findLastForAllControllers', () => {
        test('returns latest metrics for all controllers', async () => {
            const rows = [
                { ...mockRow, controller_serial: 'SN-001', building_name: 'B1', building_id: 1 },
                { ...mockRow, metric_id: 2, controller_id: 20, controller_serial: 'SN-002', building_name: 'B2', building_id: 2 }
            ];
            db.query.mockResolvedValue({ rows });

            const result = await Metric.findLastForAllControllers();

            expect(result).toHaveLength(2);
            expect(result[0].controller_serial).toBe('SN-001');
            expect(result[1].building_name).toBe('B2');
        });

        test('returns empty array when no data', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Metric.findLastForAllControllers();

            expect(result).toEqual([]);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Metric.findLastForAllControllers()).rejects.toThrow('Failed to fetch latest metrics');
        });
    });

    describe('create', () => {
        test('creates and returns new metric', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Metric.create({
                controller_id: 10,
                timestamp: '2024-01-01T00:00:00Z',
                electricity_ph1: 220,
                electricity_ph2: 221,
                electricity_ph3: 219,
                amperage_ph1: 5,
                amperage_ph2: 6,
                amperage_ph3: 5.5,
                cold_water_pressure: 3.2,
                cold_water_temp: 12,
                hot_water_in_pressure: 4.0,
                hot_water_out_pressure: 3.8,
                hot_water_in_temp: 65,
                hot_water_out_temp: 55,
                air_temp: 22,
                humidity: 45,
                leak_sensor: false
            });

            expect(result).toBeDefined();
            expect(result.metric_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO metrics');
        });

        test('uses current timestamp when none provided', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            await Metric.create({ controller_id: 10 });

            const params = db.query.mock.calls[0][1];
            // Second param is the timestamp; should be an ISO string
            expect(params[1]).toBeDefined();
            expect(typeof params[1]).toBe('string');
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('FK violation'));

            await expect(Metric.create({ controller_id: 999 })).rejects.toThrow('Failed to create metric');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed metric', async () => {
            db.query.mockResolvedValue({ rows: [mockRow] });

            const result = await Metric.delete(1);

            expect(result).toBeDefined();
            expect(result.metric_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM metrics');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Metric.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Metric.delete(1)).rejects.toThrow('Failed to delete metric');
        });
    });
});
