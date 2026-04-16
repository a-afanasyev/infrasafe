// Phase 9.3 (YAGNI-007 / YAGNI-008): globalSearch and exportData stubs
// removed. This suite now covers only getAdminStats.

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
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
});
