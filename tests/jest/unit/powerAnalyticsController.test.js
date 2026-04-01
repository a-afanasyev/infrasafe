jest.mock('../../../src/services/powerAnalyticsService', () => ({
    getBuildingsPower: jest.fn(),
    getBuildingPower: jest.fn(),
    getTransformersPower: jest.fn(),
    getTransformerPower: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const powerAnalyticsService = require('../../../src/services/powerAnalyticsService');
const {
    getBuildingsPower,
    getBuildingPower,
    getLinesPower,
    getLinePower,
    getTransformersPower,
    getTransformerPower,
    getPhaseImbalanceAnalysis,
    refreshPowerViews
} = require('../../../src/controllers/powerAnalyticsController');

describe('PowerAnalyticsController', () => {
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

    describe('getBuildingsPower', () => {
        test('returns all buildings power data', async () => {
            const buildings = [{ building_id: 1, total_power: 50 }];
            powerAnalyticsService.getBuildingsPower.mockResolvedValue(buildings);

            await getBuildingsPower(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: buildings,
                count: 1
            });
        });

        test('returns empty array when no data', async () => {
            powerAnalyticsService.getBuildingsPower.mockResolvedValue([]);

            await getBuildingsPower(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: [],
                count: 0
            });
        });

        test('calls next on error', async () => {
            powerAnalyticsService.getBuildingsPower.mockRejectedValue(new Error('DB error'));

            await getBuildingsPower(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getBuildingPower', () => {
        test('returns power data for specific building', async () => {
            req.params.buildingId = '1';
            const data = { building_id: 1, total_power: 50 };
            powerAnalyticsService.getBuildingPower.mockResolvedValue(data);

            await getBuildingPower(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(powerAnalyticsService.getBuildingPower).toHaveBeenCalledWith('1');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data
            });
        });

        test('returns 404 when building not found', async () => {
            req.params.buildingId = '999';
            powerAnalyticsService.getBuildingPower.mockResolvedValue(null);

            await getBuildingPower(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });

        test('calls next on error', async () => {
            req.params.buildingId = '1';
            powerAnalyticsService.getBuildingPower.mockRejectedValue(new Error('fail'));

            await getBuildingPower(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getLinesPower', () => {
        test.todo('returns real lines power data when implemented');
    });

    describe('getLinePower', () => {
        test.todo('returns real line power data when implemented');
    });

    describe('getTransformersPower', () => {
        test('returns all transformers power data', async () => {
            const transformers = [{ transformer_id: 1, total_power: 100 }];
            powerAnalyticsService.getTransformersPower.mockResolvedValue(transformers);

            await getTransformersPower(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: transformers,
                count: 1
            });
        });

        test('returns empty array when no data', async () => {
            powerAnalyticsService.getTransformersPower.mockResolvedValue([]);

            await getTransformersPower(req, res, next);

            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: [],
                count: 0
            });
        });

        test('calls next on error', async () => {
            powerAnalyticsService.getTransformersPower.mockRejectedValue(new Error('DB error'));

            await getTransformersPower(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getTransformerPower', () => {
        test('returns power data for specific transformer', async () => {
            req.params.transformerId = '1';
            const data = { transformer_id: 1, total_power: 100 };
            powerAnalyticsService.getTransformerPower.mockResolvedValue(data);

            await getTransformerPower(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(powerAnalyticsService.getTransformerPower).toHaveBeenCalledWith('1');
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data
            });
        });

        test('returns 404 when transformer not found', async () => {
            req.params.transformerId = '999';
            powerAnalyticsService.getTransformerPower.mockResolvedValue(null);

            await getTransformerPower(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });

        test('calls next on error', async () => {
            req.params.transformerId = '1';
            powerAnalyticsService.getTransformerPower.mockRejectedValue(new Error('fail'));

            await getTransformerPower(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getPhaseImbalanceAnalysis', () => {
        test.todo('returns real phase imbalance analysis when implemented');
    });

    describe('refreshPowerViews', () => {
        test('returns success message', async () => {
            await refreshPowerViews(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                message: 'Power calculation is performed in real-time, no refresh needed'
            });
        });
    });
});
