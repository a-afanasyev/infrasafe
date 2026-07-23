'use strict';

// [UK building reconcile — 2026-07-23] Unit tests for the buildings inventory
// mirror: GET /api/uk-buildings-metrics. Root cause it fixes: the anonymous
// /buildings-metrics projection strips external_id (P-PENTEST-3), so UK's
// building set-diff saw no hashes at all and "repaired" every building
// forever. This endpoint serves the external_id inventory behind the same
// x-service-token as /uk-requests-metrics.

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const db = require('../../../src/config/database');
const Building = require('../../../src/models/Building');
const { getBuildingsInventory } = require('../../../src/controllers/ukBuildingsMetricsController');

const mkRes = () => {
    const res = {};
    res.json = jest.fn().mockReturnValue(res);
    res.status = jest.fn().mockReturnValue(res);
    return res;
};

describe('Building.listUkInventory', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('selects external_id + uk_deleted_at for buildings with external_id only', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await Building.listUkInventory();

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain('external_id');
        expect(sql).toContain('uk_deleted_at');
        expect(sql).toMatch(/WHERE\s+external_id\s+IS\s+NOT\s+NULL/i);
        expect(params).toEqual([5000]);
    });

    test('caps limit at 10000 (mirror of listInventory bounds)', async () => {
        db.query.mockResolvedValue({ rows: [] });

        const { limit } = await Building.listUkInventory({ limit: 999999 });

        expect(limit).toBe(10000);
        expect(db.query.mock.calls[0][1]).toEqual([10000]);
    });

    test('propagates db errors', async () => {
        db.query.mockRejectedValue(new Error('connection lost'));

        await expect(Building.listUkInventory()).rejects.toThrow('connection lost');
    });
});

describe('ukBuildingsMetricsController.getBuildingsInventory', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns the same envelope shape as the requests inventory', async () => {
        const rows = [
            { external_id: '3f2a9c1e-1111-2222-3333-b6c4d5e6f7a8', uk_deleted_at: null },
            { external_id: '9c1e3f2a-4444-5555-6666-d5e6f7a8b6c4', uk_deleted_at: '2026-07-01T00:00:00Z' }
        ];
        db.query.mockResolvedValue({ rows });

        const req = { query: {} };
        const res = mkRes();

        await getBuildingsInventory(req, res);

        expect(res.json).toHaveBeenCalledWith({
            data: rows,
            total: 2,
            limit: 5000
        });
        expect(res.status).not.toHaveBeenCalled();
    });

    test('routes errors to next() for the canonical error envelope', async () => {
        db.query.mockRejectedValue(new Error('boom'));

        const req = { query: {} };
        const res = mkRes();
        const next = jest.fn();

        await getBuildingsInventory(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(res.json).not.toHaveBeenCalled();
    });
});
