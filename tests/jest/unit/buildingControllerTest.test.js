'use strict';

jest.mock('../../../src/services/buildingService', () => ({
    getAllBuildings: jest.fn(),
    getBuildingById: jest.fn(),
    createBuilding: jest.fn(),
    updateBuilding: jest.fn(),
    deleteBuilding: jest.fn(),
    deleteBuildingCascade: jest.fn(),
    findBuildingsInRadius: jest.fn(),
    getBuildingsStatistics: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const buildingService = require('../../../src/services/buildingService');
const buildingController = require('../../../src/controllers/buildingController');

describe('buildingController', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            query: {},
            params: {},
            body: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    // -------------------------------------------------------------------------
    // getAllBuildings
    // -------------------------------------------------------------------------
    describe('getAllBuildings', () => {
        it('returns paginated buildings with default params', async () => {
            const mockResult = {
                data: [{ building_id: 1, name: 'Building A' }],
                pagination: { page: 1, limit: 10, total: 1 }
            };
            buildingService.getAllBuildings.mockResolvedValue(mockResult);

            await buildingController.getAllBuildings(req, res, next);

            expect(buildingService.getAllBuildings).toHaveBeenCalledWith(1, 10, 'building_id', 'asc');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        it('passes custom query params to service', async () => {
            req.query = { page: '3', limit: '25', sort: 'name', order: 'desc' };
            buildingService.getAllBuildings.mockResolvedValue({ data: [], pagination: {} });

            await buildingController.getAllBuildings(req, res, next);

            expect(buildingService.getAllBuildings).toHaveBeenCalledWith(3, 25, 'name', 'desc');
        });

        it('calls next on error', async () => {
            buildingService.getAllBuildings.mockRejectedValue(new Error('DB error'));

            await buildingController.getAllBuildings(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // -------------------------------------------------------------------------
    // getBuildingById
    // -------------------------------------------------------------------------
    describe('getBuildingById', () => {
        it('returns building when found', async () => {
            const mockBuilding = { building_id: 5, name: 'Building E' };
            req.params.id = '5';
            buildingService.getBuildingById.mockResolvedValue(mockBuilding);

            await buildingController.getBuildingById(req, res, next);

            expect(buildingService.getBuildingById).toHaveBeenCalledWith('5');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockBuilding);
        });

        it('returns 404 when building not found', async () => {
            req.params.id = '999';
            buildingService.getBuildingById.mockResolvedValue(null);

            await buildingController.getBuildingById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({ message: 'Building not found' })
                })
            );
        });

        it('calls next on error', async () => {
            req.params.id = '1';
            buildingService.getBuildingById.mockRejectedValue(new Error('DB error'));

            await buildingController.getBuildingById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // -------------------------------------------------------------------------
    // createBuilding
    // -------------------------------------------------------------------------
    describe('createBuilding', () => {
        it('creates building and returns 201', async () => {
            const newBuilding = { building_id: 10, name: 'New Building' };
            req.body = { name: 'New Building', latitude: 41.3, longitude: 69.2 };
            buildingService.createBuilding.mockResolvedValue(newBuilding);

            await buildingController.createBuilding(req, res, next);

            expect(buildingService.createBuilding).toHaveBeenCalledWith(req.body);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(newBuilding);
        });

        it('calls next on validation error', async () => {
            req.body = { name: 'Invalid', latitude: 999 };
            buildingService.createBuilding.mockRejectedValue(new Error('Invalid latitude'));

            await buildingController.createBuilding(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // -------------------------------------------------------------------------
    // updateBuilding
    // -------------------------------------------------------------------------
    describe('updateBuilding', () => {
        it('updates building and returns 200', async () => {
            const updated = { building_id: 5, name: 'Updated' };
            req.params.id = '5';
            req.body = { name: 'Updated' };
            buildingService.updateBuilding.mockResolvedValue(updated);

            await buildingController.updateBuilding(req, res, next);

            expect(buildingService.updateBuilding).toHaveBeenCalledWith('5', { name: 'Updated' });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(updated);
        });

        it('returns 404 when building not found', async () => {
            req.params.id = '999';
            req.body = { name: 'Ghost' };
            buildingService.updateBuilding.mockResolvedValue(null);

            await buildingController.updateBuilding(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({ message: 'Building not found' })
                })
            );
        });

        it('calls next on error', async () => {
            req.params.id = '1';
            req.body = { name: 'Fail' };
            buildingService.updateBuilding.mockRejectedValue(new Error('DB error'));

            await buildingController.updateBuilding(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // -------------------------------------------------------------------------
    // deleteBuilding
    // -------------------------------------------------------------------------
    describe('deleteBuilding', () => {
        it('deletes building without cascade', async () => {
            req.params.id = '5';
            req.query = {};
            buildingService.deleteBuilding.mockResolvedValue({ building_id: 5 });

            await buildingController.deleteBuilding(req, res, next);

            expect(buildingService.deleteBuilding).toHaveBeenCalledWith('5');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Building deleted successfully'
                })
            );
        });

        it('deletes building with cascade=true', async () => {
            req.params.id = '5';
            req.query = { cascade: 'true' };
            buildingService.deleteBuildingCascade.mockResolvedValue({ building_id: 5, controllers: 3 });

            await buildingController.deleteBuilding(req, res, next);

            expect(buildingService.deleteBuildingCascade).toHaveBeenCalledWith('5');
            expect(buildingService.deleteBuilding).not.toHaveBeenCalled();
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Building and all related data deleted successfully'
                })
            );
        });

        it('returns 404 when building not found for deletion', async () => {
            req.params.id = '999';
            req.query = {};
            buildingService.deleteBuilding.mockResolvedValue(null);

            await buildingController.deleteBuilding(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('returns 400 when building has controllers (BUILDING_HAS_CONTROLLERS)', async () => {
            req.params.id = '5';
            req.query = {};
            const error = new Error('Cannot delete building with attached controllers');
            error.code = 'BUILDING_HAS_CONTROLLERS';
            buildingService.deleteBuilding.mockRejectedValue(error);

            await buildingController.deleteBuilding(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({
                        message: 'Cannot delete building with attached controllers'
                    })
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        it('calls next on generic error', async () => {
            req.params.id = '5';
            req.query = {};
            buildingService.deleteBuilding.mockRejectedValue(new Error('Unknown error'));

            await buildingController.deleteBuilding(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // -------------------------------------------------------------------------
    // findBuildingsInRadius
    // -------------------------------------------------------------------------
    describe('findBuildingsInRadius', () => {
        it('returns buildings in radius', async () => {
            req.query = { latitude: '41.3', longitude: '69.2', radius: '500' };
            const mockResult = {
                center: { latitude: 41.3, longitude: 69.2 },
                radius: 500,
                buildings: [{ building_id: 1 }]
            };
            buildingService.findBuildingsInRadius.mockResolvedValue(mockResult);

            await buildingController.findBuildingsInRadius(req, res, next);

            expect(buildingService.findBuildingsInRadius).toHaveBeenCalledWith(41.3, 69.2, 500);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        it('uses default radius of 1000 when not specified', async () => {
            req.query = { latitude: '41.3', longitude: '69.2' };
            buildingService.findBuildingsInRadius.mockResolvedValue({ buildings: [] });

            await buildingController.findBuildingsInRadius(req, res, next);

            expect(buildingService.findBuildingsInRadius).toHaveBeenCalledWith(41.3, 69.2, 1000);
        });

        it('returns 400 when latitude is missing', async () => {
            req.query = { longitude: '69.2' };

            await buildingController.findBuildingsInRadius(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({
                        message: 'Latitude and longitude are required'
                    })
                })
            );
        });

        it('returns 400 when longitude is missing', async () => {
            req.query = { latitude: '41.3' };

            await buildingController.findBuildingsInRadius(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('calls next on service error', async () => {
            req.query = { latitude: '41.3', longitude: '69.2' };
            buildingService.findBuildingsInRadius.mockRejectedValue(new Error('Service error'));

            await buildingController.findBuildingsInRadius(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    // -------------------------------------------------------------------------
    // getBuildingsStatistics
    // -------------------------------------------------------------------------
    describe('getBuildingsStatistics', () => {
        it('returns building statistics', async () => {
            const mockStats = {
                total: 17,
                by_town: { 'Ташкент': 17 },
                with_coordinates: 15,
                without_coordinates: 2
            };
            buildingService.getBuildingsStatistics.mockResolvedValue(mockStats);

            await buildingController.getBuildingsStatistics(req, res, next);

            expect(buildingService.getBuildingsStatistics).toHaveBeenCalledTimes(1);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockStats);
        });

        it('calls next on error', async () => {
            buildingService.getBuildingsStatistics.mockRejectedValue(new Error('DB error'));

            await buildingController.getBuildingsStatistics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
