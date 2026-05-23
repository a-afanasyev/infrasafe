// [Sprint 10 PR-4] AlertSuppression model unit tests
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
const AlertSuppression = require('../../../src/models/AlertSuppression');

describe('AlertSuppression model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isActive', () => {
        test('returns true when an active row matches the tuple', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

            const result = await AlertSuppression.isActive('controller', 1, 'LEAK_DETECTED');

            expect(result).toBe(true);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain('cleared_at IS NULL');
            expect(sql).toContain('suppress_until > NOW()');
            expect(params).toEqual(['controller', 1, 'LEAK_DETECTED']);
        });

        test('returns false when no active row', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            const result = await AlertSuppression.isActive('controller', 1, 'LEAK_DETECTED');
            expect(result).toBe(false);
        });

        test('fail-open on DB error (returns false, logs error)', async () => {
            db.query.mockRejectedValueOnce(new Error('connection lost'));
            const result = await AlertSuppression.isActive('controller', 1, 'LEAK_DETECTED');
            expect(result).toBe(false);
        });
    });

    describe('create', () => {
        const validData = {
            infrastructure_type: 'controller',
            infrastructure_id: 1,
            alert_type: 'LEAK_DETECTED',
            duration_hours: 4,
            reason: 'faulty_sensor',
            comment: 'Sensor stuck on',
            suppressed_by: 42
        };

        test('inserts row with computed suppress_until', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, ...validData }] });

            const result = await AlertSuppression.create(validData);

            expect(result.id).toBe(1);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain("NOW() + ($4::int * INTERVAL '1 hour')");
            expect(params[0]).toBe('controller');
            expect(params[1]).toBe(1);
            expect(params[2]).toBe('LEAK_DETECTED');
            expect(params[3]).toBe(4);
            expect(params[4]).toBe('faulty_sensor');
            expect(params[5]).toBe('Sensor stuck on');
            expect(params[6]).toBe(42);
        });

        test('rejects missing required fields', async () => {
            await expect(AlertSuppression.create({})).rejects.toThrow('infrastructure_type/id and alert_type are required');
        });

        test('rejects invalid duration_hours (<=0)', async () => {
            await expect(AlertSuppression.create({ ...validData, duration_hours: 0 })).rejects.toThrow('positive number');
            await expect(AlertSuppression.create({ ...validData, duration_hours: -5 })).rejects.toThrow('positive number');
        });

        test('rejects duration > 24h cap', async () => {
            await expect(AlertSuppression.create({ ...validData, duration_hours: 25 })).rejects.toThrow('exceeds cap');
            await expect(AlertSuppression.create({ ...validData, duration_hours: 48 })).rejects.toThrow('exceeds cap');
        });

        test('accepts duration exactly at 24h cap', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });
            await expect(AlertSuppression.create({ ...validData, duration_hours: 24 })).resolves.toBeDefined();
        });

        test('rejects invalid reason', async () => {
            await expect(AlertSuppression.create({ ...validData, reason: 'invalid_reason' })).rejects.toThrow('reason must be one of');
        });

        test('accepts all VALID_REASONS', async () => {
            for (const reason of AlertSuppression.VALID_REASONS) {
                db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
                await expect(AlertSuppression.create({ ...validData, reason })).resolves.toBeDefined();
            }
        });

        test('defaults comment to null and suppressed_by to null', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

            await AlertSuppression.create({
                infrastructure_type: 'controller',
                infrastructure_id: 1,
                alert_type: 'LEAK_DETECTED',
                duration_hours: 4,
                reason: 'faulty_sensor'
            });

            const params = db.query.mock.calls[0][1];
            expect(params[5]).toBeNull(); // comment
            expect(params[6]).toBeNull(); // suppressed_by
        });
    });

    describe('clear', () => {
        test('updates cleared_at + cleared_by, returns updated row', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1, cleared_at: '2026-05-23T18:00:00Z', cleared_by: 42 }] });

            const result = await AlertSuppression.clear(1, 42);

            expect(result.cleared_by).toBe(42);
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain('cleared_at = NOW()');
            expect(sql).toContain('cleared_at IS NULL'); // idempotent guard
            expect(params).toEqual([1, 42]);
        });

        test('returns null when row already cleared (idempotent)', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            const result = await AlertSuppression.clear(99, 42);
            expect(result).toBeNull();
        });

        test('accepts null clearedBy', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
            await AlertSuppression.clear(1, null);
            expect(db.query.mock.calls[0][1]).toEqual([1, null]);
        });

        test('throws when id missing', async () => {
            await expect(AlertSuppression.clear(null, 42)).rejects.toThrow('id is required');
        });
    });

    describe('list', () => {
        test('no filters returns all (ORDER BY created_at DESC)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
            const result = await AlertSuppression.list();
            expect(result).toHaveLength(2);
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('ORDER BY created_at DESC');
            expect(sql).toContain('LIMIT 100');
        });

        test('active=true filters to currently-active', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            await AlertSuppression.list({ active: true });
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('cleared_at IS NULL AND suppress_until > NOW()');
        });

        test('active=false filters to inactive', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            await AlertSuppression.list({ active: false });
            const sql = db.query.mock.calls[0][0];
            expect(sql).toContain('cleared_at IS NOT NULL OR suppress_until <= NOW()');
        });

        test('combines infraType + infraId + alertType filters', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            await AlertSuppression.list({
                infraType: 'controller',
                infraId: 1,
                alertType: 'LEAK_DETECTED'
            });
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toContain('infrastructure_type = $1');
            expect(sql).toContain('infrastructure_id = $2');
            expect(sql).toContain('alert_type = $3');
            expect(params).toEqual(['controller', 1, 'LEAK_DETECTED']);
        });

        test('limit clamped to MAX 500', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            await AlertSuppression.list({ limit: 9999 });
            expect(db.query.mock.calls[0][0]).toContain('LIMIT 500');
        });
    });

    describe('findById', () => {
        test('returns row by id', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ id: 5 }] });
            const result = await AlertSuppression.findById(5);
            expect(result.id).toBe(5);
        });

        test('returns null when not found', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });
            const result = await AlertSuppression.findById(999);
            expect(result).toBeNull();
        });
    });

    describe('exported constants', () => {
        test('MAX_SUPPRESSION_HOURS = 24', () => {
            expect(AlertSuppression.MAX_SUPPRESSION_HOURS).toBe(24);
        });

        test('VALID_REASONS contains 5 enum values', () => {
            expect(AlertSuppression.VALID_REASONS).toEqual(
                expect.arrayContaining(['faulty_sensor', 'under_repair', 'planned_maintenance', 'known_issue', 'other'])
            );
            expect(AlertSuppression.VALID_REASONS).toHaveLength(5);
        });
    });
});
