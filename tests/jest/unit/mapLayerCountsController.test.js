// [B-024] Unit tests for the public map-layer-counts controller.

jest.mock('../../../src/models/MapLayerCounts', () => ({
    getCounts: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const MapLayerCounts = require('../../../src/models/MapLayerCounts');
const { getMapLayerCounts } = require('../../../src/controllers/mapLayerCountsController');

const mkRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('mapLayerCountsController.getMapLayerCounts (B-024)', () => {
    beforeEach(() => {
        MapLayerCounts.getCounts.mockReset();
    });

    test('responds 200 with { data: <counts> }', async () => {
        const counts = {
            buildings: 17, controllers: 12, transformers: 8, power_lines: 5,
            water_sources: 3, water_lines: 6, heat_sources: 2, alerts_active: 4
        };
        MapLayerCounts.getCounts.mockResolvedValue(counts);
        const res = mkRes();

        await getMapLayerCounts({}, res);

        expect(res.status).not.toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ data: counts });
    });

    test('[R2-05] delegates model errors to next() (errorHandler emits the canonical, message-hidden 500)', async () => {
        MapLayerCounts.getCounts.mockRejectedValue(new Error('connection refused'));
        const res = mkRes();
        const next = jest.fn();

        await getMapLayerCounts({}, res, next);

        // No inline error JSON — the controller hands off to the error middleware,
        // which produces { success:false, error:{ message, status } } and hides
        // the 500 detail (covered by errorHandler's own tests).
        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(res.status).not.toHaveBeenCalledWith(500);
    });
});
