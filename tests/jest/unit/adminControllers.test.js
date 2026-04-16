jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

// Mock the delegated controllers
jest.mock('../../../src/controllers/buildingController', () => ({
    createBuilding: jest.fn(),
    getBuildingById: jest.fn(),
    updateBuilding: jest.fn(),
    deleteBuilding: jest.fn()
}));

jest.mock('../../../src/controllers/controllerController', () => ({
    createController: jest.fn(),
    getControllerById: jest.fn(),
    updateController: jest.fn(),
    deleteController: jest.fn()
}));

jest.mock('../../../src/controllers/metricController', () => ({
    createMetric: jest.fn(),
    getMetricById: jest.fn(),
    updateMetric: jest.fn(),
    deleteMetric: jest.fn()
}));

// Mock services used by admin controllers
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const adminIndex = require('../../../src/controllers/admin');

describe('Admin Controllers (barrel export)', () => {
    test('exports all expected building methods', () => {
        expect(adminIndex.getOptimizedBuildings).toBeDefined();
        expect(adminIndex.createBuilding).toBeDefined();
        expect(adminIndex.getBuildingById).toBeDefined();
        expect(adminIndex.updateBuilding).toBeDefined();
        expect(adminIndex.deleteBuilding).toBeDefined();
        expect(adminIndex.batchBuildingsOperation).toBeDefined();
    });

    test('exports all expected controller methods', () => {
        expect(adminIndex.getOptimizedControllers).toBeDefined();
        expect(adminIndex.createController).toBeDefined();
        expect(adminIndex.batchControllersOperation).toBeDefined();
    });

    test('exports all expected metric methods', () => {
        expect(adminIndex.getOptimizedMetrics).toBeDefined();
        expect(adminIndex.createMetric).toBeDefined();
        expect(adminIndex.batchMetricsOperation).toBeDefined();
    });

    test('exports all expected transformer methods', () => {
        expect(adminIndex.getOptimizedTransformers).toBeDefined();
        expect(adminIndex.createTransformer).toBeDefined();
        expect(adminIndex.batchTransformersOperation).toBeDefined();
    });

    test('exports all expected line methods', () => {
        expect(adminIndex.getOptimizedLines).toBeDefined();
        expect(adminIndex.createLine).toBeDefined();
        expect(adminIndex.batchLinesOperation).toBeDefined();
    });

    test('exports all expected water line methods', () => {
        expect(adminIndex.getOptimizedWaterLines).toBeDefined();
        expect(adminIndex.createWaterLine).toBeDefined();
        expect(adminIndex.batchWaterLinesOperation).toBeDefined();
    });

    test('exports water source methods', () => {
        expect(adminIndex.getOptimizedColdWaterSources).toBeDefined();
        expect(adminIndex.createColdWaterSource).toBeDefined();
        expect(adminIndex.getColdWaterSourceById).toBeDefined();
        expect(adminIndex.updateColdWaterSource).toBeDefined();
        expect(adminIndex.deleteColdWaterSource).toBeDefined();
    });

    test('exports heat source methods', () => {
        expect(adminIndex.getOptimizedHeatSources).toBeDefined();
        expect(adminIndex.createHeatSource).toBeDefined();
        expect(adminIndex.getHeatSourceById).toBeDefined();
        expect(adminIndex.updateHeatSource).toBeDefined();
        expect(adminIndex.deleteHeatSource).toBeDefined();
    });

    test('exports general admin methods', () => {
        // Phase 9.3: globalSearch and exportData stubs removed (YAGNI-007/008).
        expect(adminIndex.getAdminStats).toBeDefined();
        expect(adminIndex.globalSearch).toBeUndefined();
        expect(adminIndex.exportData).toBeUndefined();
    });
});

describe('adminBuildingController', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { query: {}, params: {}, body: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    describe('getOptimizedBuildings', () => {
        test('returns paginated buildings', async () => {
            const mockRows = [{ building_id: 1, name: 'B1' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })       // data
                .mockResolvedValueOnce({ rows: [{ count: '1' }] }); // count

            await adminIndex.getOptimizedBuildings(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.any(Array),
                    pagination: expect.objectContaining({
                        total: expect.any(Number),
                        page: expect.any(Number)
                    })
                })
            );
        });

        test('applies search filter', async () => {
            req.query = { search: 'Test' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await adminIndex.getOptimizedBuildings(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('ILIKE');
        });

        test('calls next on error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await adminIndex.getOptimizedBuildings(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('batchBuildingsOperation', () => {
        test('returns success response', async () => {
            req.body = { action: 'delete', ids: [1, 2, 3] };

            await adminIndex.batchBuildingsOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 3
                })
            );
        });
    });

    describe('CRUD delegation', () => {
        test('createBuilding delegates to buildingController', async () => {
            const buildingController = require('../../../src/controllers/buildingController');
            buildingController.createBuilding.mockResolvedValue(undefined);

            await adminIndex.createBuilding(req, res, next);

            expect(buildingController.createBuilding).toHaveBeenCalledWith(req, res, next);
        });
    });
});
