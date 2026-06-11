// Phase 9.3 (YAGNI-007 / YAGNI-008): globalSearch and exportData stubs
// removed. This suite now covers only getAdminStats.

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const { getAdminStats } = require('../../../src/controllers/admin/adminGeneralController');

describe('adminGeneralController', () => {
    beforeEach(() => jest.clearAllMocks());

    test('getAdminStats returns real counts from database', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ count: '17' }] })
            .mockResolvedValueOnce({ rows: [{ count: '15' }] })
            .mockResolvedValueOnce({ rows: [{ count: '1000' }] })
            .mockResolvedValueOnce({ rows: [{ count: '5' }] });

        const req = {};
        const res = { json: jest.fn() };
        const next = jest.fn();

        await getAdminStats(req, res, next);

        expect(db.query).toHaveBeenCalledTimes(4);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            buildings: expect.objectContaining({ total: 17 }),
            controllers: expect.objectContaining({ total: 15 }),
            metrics: expect.objectContaining({ total: 1000 }),
            alerts: expect.objectContaining({ active: 5 }),
        }));
    });

    // AUD-007: the active-alert count must come from infrastructure_alerts (the
    // live alert system) — the legacy `alerts` table was dropped in migration 028,
    // so the old query returned 0 or errored.
    test('active-alert count queries infrastructure_alerts (active + acknowledged), not legacy alerts', async () => {
        db.query.mockResolvedValue({ rows: [{ count: '0' }] });
        await getAdminStats({}, { json: jest.fn() }, jest.fn());

        const alertSql = db.query.mock.calls
            .map((c) => c[0])
            .find((sql) => /alert/i.test(sql));
        expect(alertSql).toMatch(/infrastructure_alerts/);
        expect(alertSql).not.toMatch(/FROM\s+alerts\b/);
        expect(alertSql).toMatch(/'active'/);
        expect(alertSql).toMatch(/'acknowledged'/);
    });

    test('getAdminStats calls next with error when db.query rejects', async () => {
        db.query.mockRejectedValueOnce(new Error('DB down'));

        const req = {};
        const res = { json: jest.fn() };
        const next = jest.fn();

        await getAdminStats(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toBe('Failed to get stats');
        expect(err.statusCode).toBe(500);
    });

    // AUD-029: the real cause must be logged, not silently swallowed behind the
    // generic 500.
    test('logs the underlying error before delegating to next', async () => {
        db.query.mockRejectedValueOnce(new Error('DB down'));
        await getAdminStats({}, { json: jest.fn() }, jest.fn());
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/DB down/);
    });
});
