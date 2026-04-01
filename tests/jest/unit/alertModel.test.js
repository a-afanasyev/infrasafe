jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/utils/queryValidation', () => ({
    validateSortOrder: jest.fn().mockReturnValue({ validSort: 'created_at', validOrder: 'DESC' })
}));

const db = require('../../../src/config/database');
const Alert = require('../../../src/models/Alert');

describe('Alert Model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockAlert = {
        alert_id: 1,
        metric_id: 10,
        alert_type_id: 2,
        severity: 'critical',
        status: 'active',
        created_at: '2024-01-01',
        resolved_at: null,
        type_name: 'Temperature',
        controller_id: 5,
        controller_serial: 'SN-001',
        building_name: 'Building A'
    };

    describe('findAll', () => {
        test('returns paginated results with status "all"', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [mockAlert] })           // data query
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });     // count query

            const result = await Alert.findAll(1, 10, 'all', 'created_at', 'desc');

            expect(result.data).toHaveLength(1);
            expect(result.data[0].alert_id).toBe(1);
            expect(result.pagination).toEqual({
                total: 1,
                page: 1,
                limit: 10,
                totalPages: 1
            });
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('filters by status when not "all"', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [mockAlert] })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await Alert.findAll(1, 10, 'active', 'created_at', 'desc');

            // The data query should include WHERE with the status param
            const dataCall = db.query.mock.calls[0];
            expect(dataCall[0]).toContain('WHERE a.status = $1');
            expect(dataCall[1][0]).toBe('active');

            // The count query should also filter
            const countCall = db.query.mock.calls[1];
            expect(countCall[0]).toContain('WHERE status = $1');
        });

        test('calculates correct offset for page 2', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '25' }] });

            const result = await Alert.findAll(2, 10, 'all', 'created_at', 'desc');

            // offset should be 10 for page 2, limit 10
            const dataCall = db.query.mock.calls[0];
            expect(dataCall[1]).toEqual([10, 10]); // limit, offset
            expect(result.pagination.totalPages).toBe(3);
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Alert.findAll()).rejects.toThrow('Failed to fetch alerts');
        });
    });

    describe('findById', () => {
        test('returns alert when found', async () => {
            db.query.mockResolvedValue({ rows: [mockAlert] });

            const result = await Alert.findById(1);

            expect(result).toBeDefined();
            expect(result.alert_id).toBe(1);
            expect(result.building_name).toBe('Building A');
            expect(db.query).toHaveBeenCalledTimes(1);
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Alert.findById(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Alert.findById(1)).rejects.toThrow('Failed to fetch alert');
        });
    });

    describe('create', () => {
        test('creates and returns new alert', async () => {
            db.query.mockResolvedValue({ rows: [mockAlert] });

            const result = await Alert.create({
                metric_id: 10,
                alert_type_id: 2,
                severity: 'critical',
                status: 'active'
            });

            expect(result).toBeDefined();
            expect(result.alert_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('INSERT INTO alerts');
            expect(db.query.mock.calls[0][1]).toEqual([10, 2, 'critical', 'active']);
        });

        test('defaults status to active when not provided', async () => {
            db.query.mockResolvedValue({ rows: [mockAlert] });

            await Alert.create({
                metric_id: 10,
                alert_type_id: 2,
                severity: 'warning'
            });

            const params = db.query.mock.calls[0][1];
            expect(params[3]).toBe('active');
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('duplicate'));

            await expect(Alert.create({
                metric_id: 10, alert_type_id: 2, severity: 'info'
            })).rejects.toThrow('Failed to create alert');
        });
    });

    describe('updateStatus', () => {
        test('updates status and returns alert', async () => {
            const updated = { ...mockAlert, status: 'acknowledged' };
            db.query.mockResolvedValue({ rows: [updated] });

            const result = await Alert.updateStatus(1, 'acknowledged');

            expect(result.status).toBe('acknowledged');
            expect(db.query.mock.calls[0][0]).toContain('UPDATE alerts SET status = $1');
            expect(db.query.mock.calls[0][1]).toEqual(['acknowledged', 1]);
        });

        test('adds resolved_at when status is resolved', async () => {
            const resolved = { ...mockAlert, status: 'resolved', resolved_at: '2024-01-02' };
            db.query.mockResolvedValue({ rows: [resolved] });

            await Alert.updateStatus(1, 'resolved');

            expect(db.query.mock.calls[0][0]).toContain('resolved_at = NOW()');
        });

        test('returns null when alert not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Alert.updateStatus(999, 'resolved');

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Alert.updateStatus(1, 'active')).rejects.toThrow('Failed to update alert status');
        });
    });

    describe('delete', () => {
        test('deletes and returns removed alert', async () => {
            db.query.mockResolvedValue({ rows: [mockAlert] });

            const result = await Alert.delete(1);

            expect(result).toBeDefined();
            expect(result.alert_id).toBe(1);
            expect(db.query.mock.calls[0][0]).toContain('DELETE FROM alerts');
            expect(db.query.mock.calls[0][1]).toEqual([1]);
        });

        test('returns null when alert not found', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const result = await Alert.delete(999);

            expect(result).toBeNull();
        });

        test('throws on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(Alert.delete(1)).rejects.toThrow('Failed to delete alert');
        });
    });
});
