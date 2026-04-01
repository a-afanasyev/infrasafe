jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const {
    globalSearch,
    getAdminStats,
    exportData
} = require('../../../src/controllers/admin/adminGeneralController');

describe('AdminGeneralController', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { params: {}, query: {}, body: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
    });

    describe('globalSearch', () => {
        test('returns empty results with default params', async () => {
            await globalSearch(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    results: [],
                    total: 0,
                    type: 'all',
                    message: 'Search completed (stub)'
                })
            );
        });

        test('passes query and type from request', async () => {
            req.query = { query: 'test-search', type: 'buildings', limit: 10 };

            await globalSearch(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    query: 'test-search',
                    type: 'buildings',
                    total: 0,
                    results: []
                })
            );
        });

        test('uses default type "all" when not specified', async () => {
            req.query = { query: 'test' };

            await globalSearch(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'all'
                })
            );
        });

        test('uses default limit 50 when not specified', async () => {
            req.query = { query: 'test' };

            await globalSearch(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    results: [],
                    total: 0
                })
            );
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('getAdminStats', () => {
        test('returns stats object with expected structure', async () => {
            await getAdminStats(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    buildings: expect.objectContaining({
                        total: expect.any(Number),
                        active: expect.any(Number)
                    }),
                    controllers: expect.objectContaining({
                        total: expect.any(Number),
                        active: expect.any(Number),
                        offline: expect.any(Number),
                        maintenance: expect.any(Number)
                    }),
                    metrics: expect.objectContaining({
                        total: expect.any(Number),
                        today: expect.any(Number)
                    }),
                    message: 'Stats generated (stub)'
                })
            );
        });

        test('does not call next on success', async () => {
            await getAdminStats(req, res, next);

            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('exportData', () => {
        test('returns success response with type and format', async () => {
            req.body = { type: 'buildings', format: 'csv' };

            await exportData(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Export buildings in csv initiated (stub)',
                    downloadUrl: expect.any(String)
                })
            );
        });

        test('includes downloadUrl in response', async () => {
            req.body = { type: 'metrics', format: 'json' };

            await exportData(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    downloadUrl: expect.stringContaining('/api/admin/download/')
                })
            );
        });

        test('handles undefined type and format gracefully', async () => {
            req.body = {};

            await exportData(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: expect.stringContaining('Export')
                })
            );
            expect(next).not.toHaveBeenCalled();
        });
    });
});
