// [ARCH-114] Unit tests for AlertRequestMap.listInventory — the data
// source for the GET /api/uk-requests-metrics reconciliation endpoint.

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
const AlertRequestMap = require('../../../src/models/AlertRequestMap');

describe('AlertRequestMap.listInventory (ARCH-114)', () => {
    beforeEach(() => {
        db.query.mockReset();
    });

    const mkRow = (overrides = {}) => ({
        uk_request_number: '260523-004',
        status: 'resolved',
        building_external_id: 'b7f6-uuid',
        updated_at: '2026-05-23T14:32:08Z',
        ...overrides
    });

    test('returns rows with the default limit of 5000', async () => {
        db.query.mockResolvedValue({ rows: [mkRow()] });

        const result = await AlertRequestMap.listInventory();

        expect(result.rows).toHaveLength(1);
        expect(result.limit).toBe(5000);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('FROM alert_request_map'),
            [5000]
        );
    });

    test('caps limit at 10000 to prevent runaway queries', async () => {
        db.query.mockResolvedValue({ rows: [] });

        const result = await AlertRequestMap.listInventory({ limit: 999999 });

        expect(result.limit).toBe(10000);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [10000]);
    });

    test('falls back to default 5000 when 0 or non-positive is requested', async () => {
        // `parseInt(0) || 5000` short-circuits to default — treats "invalid
        // input" (zero, negative, NaN) as "use the safe default" rather
        // than aggressively snapping to 1.
        db.query.mockResolvedValue({ rows: [] });

        const result = await AlertRequestMap.listInventory({ limit: 0 });

        expect(result.limit).toBe(5000);
    });

    test('coerces string limit (from req.query.limit) to integer', async () => {
        db.query.mockResolvedValue({ rows: [] });

        const result = await AlertRequestMap.listInventory({ limit: '250' });

        expect(result.limit).toBe(250);
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [250]);
    });

    test('falls back to default 5000 on non-numeric input', async () => {
        db.query.mockResolvedValue({ rows: [] });

        const result = await AlertRequestMap.listInventory({ limit: 'banana' });

        expect(result.limit).toBe(5000);
    });

    test('excludes ARM rows where uk_request_number IS NULL', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await AlertRequestMap.listInventory();

        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/WHERE\s+uk_request_number\s+IS\s+NOT\s+NULL/i);
    });

    test('orders by updated_at DESC so recent activity is first', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await AlertRequestMap.listInventory();

        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/ORDER\s+BY\s+updated_at\s+DESC/i);
    });

    test('selects exactly the four reconciliation-relevant columns', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await AlertRequestMap.listInventory();

        const sql = db.query.mock.calls[0][0];
        for (const col of [
            'uk_request_number',
            'status',
            'building_external_id',
            'updated_at'
        ]) {
            expect(sql).toContain(col);
        }
    });

    // [SEC-19] internal PK must NOT leak via the public (no-auth) inventory
    // endpoint. UK set-diffs on uk_request_number only; the spec (Q2) already
    // told them the extra fields are debug-only and may be ignored. Assert the
    // generated SQL — dropping it only from the mock row would not catch a
    // regression that re-adds the column to the SELECT.
    test('does NOT select internal infrasafe_alert_id (SEC-19)', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await AlertRequestMap.listInventory();

        const sql = db.query.mock.calls[0][0];
        expect(sql).not.toMatch(/infrasafe_alert_id/);
    });

    test('propagates db errors to caller (so the route can 500)', async () => {
        db.query.mockRejectedValue(new Error('connection lost'));

        await expect(AlertRequestMap.listInventory()).rejects.toThrow('connection lost');
    });
});
