jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const { getAdminStats, exportData } = require('../../../src/controllers/admin/adminGeneralController');

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
        }));
        expect(res.json.mock.calls[0][0].message).toBeUndefined();
    });

    test('exportData returns 501', async () => {
        const req = { body: { type: 'buildings', format: 'csv' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await exportData(req, res, next);

        expect(res.status).toHaveBeenCalledWith(501);
    });
});
