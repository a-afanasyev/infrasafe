jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const { getAdminStats, exportData, globalSearch } = require('../../../src/controllers/admin/adminGeneralController');

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

    describe('globalSearch', () => {
        test('returns search results stub with query params', async () => {
            const req = { query: { query: 'test', type: 'buildings', limit: 10 } };
            const res = { json: jest.fn() };
            const next = jest.fn();

            await globalSearch(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                results: [],
                total: 0,
                query: 'test',
                type: 'buildings',
                message: 'Search completed (stub)'
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('uses defaults when no params provided', async () => {
            const req = { query: {} };
            const res = { json: jest.fn() };
            const next = jest.fn();

            await globalSearch(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'all' })
            );
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('error paths', () => {
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

        test('exportData calls next with error when res.status throws', async () => {
            const req = {};
            const res = { status: jest.fn(() => { throw new Error('status broke'); }) };
            const next = jest.fn();

            await exportData(req, res, next);

            expect(next).toHaveBeenCalledTimes(1);
            const err = next.mock.calls[0][0];
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toBe('Export failed');
            expect(err.statusCode).toBe(500);
        });
    });
});
