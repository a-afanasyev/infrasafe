jest.mock('../../../src/services/buildingMetricsService', () => ({
    getBuildingsWithMetrics: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const buildingMetricsService = require('../../../src/services/buildingMetricsService');
const { getBuildingsWithMetrics } = require('../../../src/controllers/buildingMetricsController');

describe('BuildingMetricsController', () => {
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

    describe('getBuildingsWithMetrics', () => {
        test('returns buildings with metrics for authenticated user', async () => {
            req.user = { user_id: 1, username: 'admin' };
            const mockResult = [
                { building_id: 1, name: 'Building 1', metrics: { voltage: 220 } },
                { building_id: 2, name: 'Building 2', metrics: { voltage: 218 } }
            ];
            buildingMetricsService.getBuildingsWithMetrics.mockResolvedValue(mockResult);

            await getBuildingsWithMetrics(req, res, next);

            expect(buildingMetricsService.getBuildingsWithMetrics).toHaveBeenCalledWith(true);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        test('calls service with false for anonymous user', async () => {
            req.user = undefined;
            const mockResult = [
                { building_id: 1, name: 'Building 1' }
            ];
            buildingMetricsService.getBuildingsWithMetrics.mockResolvedValue(mockResult);

            await getBuildingsWithMetrics(req, res, next);

            expect(buildingMetricsService.getBuildingsWithMetrics).toHaveBeenCalledWith(false);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        test('calls service with false when user is null', async () => {
            req.user = null;
            buildingMetricsService.getBuildingsWithMetrics.mockResolvedValue([]);

            await getBuildingsWithMetrics(req, res, next);

            expect(buildingMetricsService.getBuildingsWithMetrics).toHaveBeenCalledWith(false);
        });

        test('returns empty array when no buildings', async () => {
            req.user = { user_id: 1 };
            buildingMetricsService.getBuildingsWithMetrics.mockResolvedValue([]);

            await getBuildingsWithMetrics(req, res, next);

            expect(res.json).toHaveBeenCalledWith([]);
        });

        test('calls next on service error', async () => {
            req.user = { user_id: 1 };
            buildingMetricsService.getBuildingsWithMetrics.mockRejectedValue(new Error('Service error'));

            await getBuildingsWithMetrics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });

        test('does not call res.json on error', async () => {
            req.user = { user_id: 1 };
            buildingMetricsService.getBuildingsWithMetrics.mockRejectedValue(new Error('DB error'));

            await getBuildingsWithMetrics(req, res, next);

            expect(res.json).not.toHaveBeenCalled();
        });
    });
});
