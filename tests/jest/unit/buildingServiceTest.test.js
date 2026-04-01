jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/models/Building', () => ({
    findAll: jest.fn(),
    findById: jest.fn(),
    findByIdWithControllers: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteCascade: jest.fn()
}));

jest.mock('../../../src/models/Controller', () => ({
    findByBuildingId: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
    invalidatePattern: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const Building = require('../../../src/models/Building');
const Controller = require('../../../src/models/Controller');
const cacheService = require('../../../src/services/cacheService');

// buildingService is a singleton
let buildingService;

beforeEach(() => {
    jest.clearAllMocks();
    cacheService.get.mockResolvedValue(null);
    cacheService.set.mockResolvedValue(undefined);
    cacheService.invalidate.mockResolvedValue(undefined);
    cacheService.invalidatePattern.mockResolvedValue(undefined);

    jest.isolateModules(() => {
        buildingService = require('../../../src/services/buildingService');
    });
});

describe('BuildingService', () => {
    const mockBuilding = {
        building_id: 1,
        name: 'Building 1',
        address: '123 Main St',
        town: 'Moscow',
        latitude: 55.7558,
        longitude: 37.6173,
        management_company: 'UK-1'
    };

    const mockPaginated = {
        data: [mockBuilding],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
    };

    const mockBuildingWithControllers = {
        ...mockBuilding,
        controllers: [{ controller_id: 1, serial_number: 'SN-001' }]
    };

    describe('getAllBuildings', () => {
        test('returns data from cache when available', async () => {
            cacheService.get.mockResolvedValue(mockPaginated);

            const result = await buildingService.getAllBuildings();

            expect(result).toEqual(mockPaginated);
            expect(Building.findAll).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches on miss', async () => {
            Building.findAll.mockResolvedValue(mockPaginated);

            const result = await buildingService.getAllBuildings(1, 10, 'building_id', 'asc');

            expect(Building.findAll).toHaveBeenCalledWith(1, 10, 'building_id', 'asc');
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(mockPaginated);
        });

        test('uses default parameters', async () => {
            Building.findAll.mockResolvedValue(mockPaginated);

            await buildingService.getAllBuildings();

            expect(Building.findAll).toHaveBeenCalledWith(1, 10, 'building_id', 'asc');
        });

        test('throws on DB error', async () => {
            Building.findAll.mockRejectedValue(new Error('DB error'));

            await expect(buildingService.getAllBuildings()).rejects.toThrow('DB error');
        });
    });

    describe('getBuildingById', () => {
        test('returns data from cache when available', async () => {
            cacheService.get.mockResolvedValue(mockBuildingWithControllers);

            const result = await buildingService.getBuildingById(1);

            expect(result).toEqual(mockBuildingWithControllers);
            expect(Building.findByIdWithControllers).not.toHaveBeenCalled();
        });

        test('fetches from DB with controllers on miss', async () => {
            Building.findByIdWithControllers.mockResolvedValue(mockBuildingWithControllers);

            const result = await buildingService.getBuildingById(1);

            expect(Building.findByIdWithControllers).toHaveBeenCalledWith(1);
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(mockBuildingWithControllers);
        });

        test('returns null when not found', async () => {
            Building.findByIdWithControllers.mockResolvedValue(null);

            const result = await buildingService.getBuildingById(999);

            expect(result).toBeNull();
        });

        test('does not cache null result', async () => {
            Building.findByIdWithControllers.mockResolvedValue(null);

            await buildingService.getBuildingById(999);

            expect(cacheService.set).not.toHaveBeenCalled();
        });

        test('throws on DB error', async () => {
            Building.findByIdWithControllers.mockRejectedValue(new Error('DB error'));

            await expect(buildingService.getBuildingById(1)).rejects.toThrow('DB error');
        });
    });

    describe('createBuilding', () => {
        test('creates building with valid data', async () => {
            const newBuilding = { ...mockBuilding, building_id: 2 };
            Building.create.mockResolvedValue(newBuilding);

            const result = await buildingService.createBuilding({
                name: 'Building 2',
                latitude: 55.7558,
                longitude: 37.6173
            });

            expect(Building.create).toHaveBeenCalled();
            expect(result).toEqual(newBuilding);
        });

        test('invalidates list cache after creation', async () => {
            Building.create.mockResolvedValue(mockBuilding);

            await buildingService.createBuilding({
                name: 'Building',
                latitude: 55.7558,
                longitude: 37.6173
            });

            expect(cacheService.invalidatePattern).toHaveBeenCalled();
        });

        test('throws when latitude is out of range', async () => {
            await expect(buildingService.createBuilding({
                name: 'Bad Building',
                latitude: 100,
                longitude: 37.6173
            })).rejects.toThrow();
        });

        test('throws when longitude is out of range', async () => {
            await expect(buildingService.createBuilding({
                name: 'Bad Building',
                latitude: 55.7558,
                longitude: 200
            })).rejects.toThrow();
        });

        test('throws on DB error', async () => {
            Building.create.mockRejectedValue(new Error('DB error'));

            await expect(buildingService.createBuilding({
                name: 'Building',
                latitude: 55.7558,
                longitude: 37.6173
            })).rejects.toThrow('DB error');
        });
    });

    describe('updateBuilding', () => {
        test('updates building with valid data', async () => {
            const updated = { ...mockBuilding, name: 'Updated Building' };
            Building.update.mockResolvedValue(updated);

            const result = await buildingService.updateBuilding(1, { name: 'Updated Building' });

            expect(Building.update).toHaveBeenCalledWith(1, { name: 'Updated Building' });
            expect(result).toEqual(updated);
        });

        test('returns null when building not found', async () => {
            Building.update.mockResolvedValue(null);

            const result = await buildingService.updateBuilding(999, { name: 'X' });

            expect(result).toBeNull();
        });

        test('invalidates cache after update', async () => {
            const updated = { ...mockBuilding, name: 'Updated' };
            Building.update.mockResolvedValue(updated);

            await buildingService.updateBuilding(1, { name: 'Updated' });

            expect(cacheService.invalidate).toHaveBeenCalled();
            expect(cacheService.invalidatePattern).toHaveBeenCalled();
        });

        test('validates coordinates when provided', async () => {
            await expect(buildingService.updateBuilding(1, {
                latitude: 100
            })).rejects.toThrow();
        });

        test('throws on DB error', async () => {
            Building.update.mockRejectedValue(new Error('DB error'));

            await expect(buildingService.updateBuilding(1, { name: 'X' })).rejects.toThrow('DB error');
        });
    });

    describe('deleteBuilding', () => {
        test('deletes building when no controllers attached', async () => {
            Controller.findByBuildingId.mockResolvedValue([]);
            Building.delete.mockResolvedValue(mockBuilding);

            const result = await buildingService.deleteBuilding(1);

            expect(Building.delete).toHaveBeenCalledWith(1);
            expect(result).toEqual(mockBuilding);
        });

        test('throws BUILDING_HAS_CONTROLLERS when controllers exist', async () => {
            Controller.findByBuildingId.mockResolvedValue([{ controller_id: 1 }]);

            await expect(buildingService.deleteBuilding(1)).rejects.toMatchObject({ code: 'BUILDING_HAS_CONTROLLERS' });
        });

        test('returns null when building not found', async () => {
            Controller.findByBuildingId.mockResolvedValue([]);
            Building.delete.mockResolvedValue(null);

            const result = await buildingService.deleteBuilding(999);

            expect(result).toBeNull();
        });

        test('invalidates cache after deletion', async () => {
            Controller.findByBuildingId.mockResolvedValue([]);
            Building.delete.mockResolvedValue(mockBuilding);

            await buildingService.deleteBuilding(1);

            expect(cacheService.invalidate).toHaveBeenCalled();
            expect(cacheService.invalidatePattern).toHaveBeenCalled();
        });
    });

    describe('deleteBuildingCascade', () => {
        test('deletes building with cascade', async () => {
            Building.deleteCascade.mockResolvedValue(mockBuilding);

            const result = await buildingService.deleteBuildingCascade(1);

            expect(Building.deleteCascade).toHaveBeenCalledWith(1);
            expect(result).toEqual(mockBuilding);
        });

        test('returns null when building not found', async () => {
            Building.deleteCascade.mockResolvedValue(null);

            const result = await buildingService.deleteBuildingCascade(999);

            expect(result).toBeNull();
        });

        test('invalidates cache after cascade deletion', async () => {
            Building.deleteCascade.mockResolvedValue(mockBuilding);

            await buildingService.deleteBuildingCascade(1);

            expect(cacheService.invalidate).toHaveBeenCalled();
            expect(cacheService.invalidatePattern).toHaveBeenCalled();
        });

        test('throws on DB error', async () => {
            Building.deleteCascade.mockRejectedValue(new Error('DB error'));

            await expect(buildingService.deleteBuildingCascade(1)).rejects.toThrow('DB error');
        });
    });

    describe('getBuildingsStatistics', () => {
        test('returns cached data when available', async () => {
            const cachedStats = { total: 5, by_town: { Moscow: 3, SPb: 2 } };
            cacheService.get.mockResolvedValue(cachedStats);

            const result = await buildingService.getBuildingsStatistics();

            expect(result).toEqual(cachedStats);
        });

        test('calculates statistics from DB on cache miss', async () => {
            const buildings = [
                { ...mockBuilding, town: 'Moscow' },
                { ...mockBuilding, building_id: 2, town: 'Moscow' },
                { ...mockBuilding, building_id: 3, town: 'SPb', latitude: null, longitude: null }
            ];
            Building.findAll.mockResolvedValue({ data: buildings });

            const result = await buildingService.getBuildingsStatistics();

            expect(result.total).toBe(3);
            expect(result.by_town['Moscow']).toBe(2);
            expect(result.by_town['SPb']).toBe(1);
            expect(result.with_coordinates).toBe(2);
            expect(result.without_coordinates).toBe(1);
        });

        test('groups by management_company', async () => {
            const buildings = [
                { ...mockBuilding, management_company: 'UK-1' },
                { ...mockBuilding, building_id: 2, management_company: 'UK-1' },
                { ...mockBuilding, building_id: 3, management_company: null }
            ];
            Building.findAll.mockResolvedValue({ data: buildings });

            const result = await buildingService.getBuildingsStatistics();

            expect(result.by_management_company['UK-1']).toBe(2);
        });

        test('caches computed statistics', async () => {
            Building.findAll.mockResolvedValue({ data: [] });

            await buildingService.getBuildingsStatistics();

            expect(cacheService.set).toHaveBeenCalledWith(
                'building:statistics',
                expect.any(Object),
                expect.any(Object)
            );
        });

        test('throws on DB error', async () => {
            Building.findAll.mockRejectedValue(new Error('DB error'));

            await expect(buildingService.getBuildingsStatistics()).rejects.toThrow('DB error');
        });
    });

    describe('validateCoordinates', () => {
        test('throws for latitude > 90', () => {
            expect(() => buildingService.validateCoordinates(91, 0)).toThrow();
        });

        test('throws for latitude < -90', () => {
            expect(() => buildingService.validateCoordinates(-91, 0)).toThrow();
        });

        test('throws for longitude > 180', () => {
            expect(() => buildingService.validateCoordinates(0, 181)).toThrow();
        });

        test('throws for longitude < -180', () => {
            expect(() => buildingService.validateCoordinates(0, -181)).toThrow();
        });

        test('does not throw for valid coordinates', () => {
            expect(() => buildingService.validateCoordinates(55.7558, 37.6173)).not.toThrow();
        });

        test('does not throw for boundary values', () => {
            expect(() => buildingService.validateCoordinates(90, 180)).not.toThrow();
            expect(() => buildingService.validateCoordinates(-90, -180)).not.toThrow();
        });

        test('does not throw when coordinates are undefined', () => {
            expect(() => buildingService.validateCoordinates(undefined, undefined)).not.toThrow();
        });
    });

    describe('calculateDistance', () => {
        test('returns 0 for same coordinates', () => {
            const distance = buildingService.calculateDistance(55.7558, 37.6173, 55.7558, 37.6173);

            expect(distance).toBeCloseTo(0, 1);
        });

        test('calculates distance between two points', () => {
            // Moscow (55.7558, 37.6173) to St. Petersburg (59.9343, 30.3351) ~ 634km
            const distance = buildingService.calculateDistance(55.7558, 37.6173, 59.9343, 30.3351);

            expect(distance).toBeGreaterThan(600000); // > 600km
            expect(distance).toBeLessThan(700000); // < 700km
        });
    });
});
