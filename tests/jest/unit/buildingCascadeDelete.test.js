/**
 * Tests for Building.deleteCascade and BuildingService.deleteBuildingCascade
 */

// Mock database
jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn()
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock cache service
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
    invalidatePattern: jest.fn()
}));

// Mock Controller model for buildingService.deleteBuilding dependency
jest.mock('../../../src/models/Controller', () => ({
    findByBuildingId: jest.fn()
}));

const db = require('../../../src/config/database');
const Building = require('../../../src/models/Building');
const buildingService = require('../../../src/services/buildingService');

describe('Building.deleteCascade', () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };
        db.getPool.mockReturnValue({
            connect: jest.fn().mockResolvedValue(mockClient)
        });
    });

    it('should delete alerts, metrics, controllers, and building in a transaction', async () => {
        const deletedBuilding = { building_id: 5, name: 'Test Building', address: 'Test Address' };

        // BEGIN
        mockClient.query.mockResolvedValueOnce({});
        // DELETE FROM alerts (legacy)
        mockClient.query.mockResolvedValueOnce({ rowCount: 2 });
        // DELETE FROM infrastructure_alerts
        mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
        // DELETE FROM metrics
        mockClient.query.mockResolvedValueOnce({ rowCount: 10 });
        // DELETE FROM controllers
        mockClient.query.mockResolvedValueOnce({ rowCount: 3 });
        // DELETE FROM buildings RETURNING *
        mockClient.query.mockResolvedValueOnce({ rows: [deletedBuilding], rowCount: 1 });
        // COMMIT
        mockClient.query.mockResolvedValueOnce({});

        const result = await Building.deleteCascade(5);

        expect(result).toEqual(deletedBuilding);
        expect(mockClient.query).toHaveBeenCalledTimes(7);

        // Verify transaction boundaries
        expect(mockClient.query.mock.calls[0][0]).toBe('BEGIN');
        expect(mockClient.query.mock.calls[6][0]).toBe('COMMIT');

        // Verify correct order: alerts -> infrastructure_alerts -> metrics -> controllers -> building
        expect(mockClient.query.mock.calls[1][0]).toMatch(/DELETE FROM alerts/);
        expect(mockClient.query.mock.calls[2][0]).toMatch(/DELETE FROM infrastructure_alerts/);
        expect(mockClient.query.mock.calls[3][0]).toMatch(/DELETE FROM metrics/);
        expect(mockClient.query.mock.calls[4][0]).toMatch(/DELETE FROM controllers/);
        expect(mockClient.query.mock.calls[5][0]).toMatch(/DELETE FROM buildings/);

        // All queries use the same building ID
        expect(mockClient.query.mock.calls[1][1]).toEqual([5]);
        expect(mockClient.query.mock.calls[5][1]).toEqual([5]);

        // Client released
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should rollback and release client on error', async () => {
        // BEGIN
        mockClient.query.mockResolvedValueOnce({});
        // DELETE FROM alerts succeeds
        mockClient.query.mockResolvedValueOnce({ rowCount: 0 });
        // DELETE FROM infrastructure_alerts fails
        mockClient.query.mockRejectedValueOnce(new Error('DB connection lost'));
        // ROLLBACK
        mockClient.query.mockResolvedValueOnce({});

        await expect(Building.deleteCascade(5)).rejects.toThrow('Failed to cascade-delete building');

        // Verify ROLLBACK was called
        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');

        // Client still released
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should return null when building does not exist', async () => {
        // BEGIN
        mockClient.query.mockResolvedValueOnce({});
        // DELETE FROM alerts
        mockClient.query.mockResolvedValueOnce({ rowCount: 0 });
        // DELETE FROM infrastructure_alerts
        mockClient.query.mockResolvedValueOnce({ rowCount: 0 });
        // DELETE FROM metrics
        mockClient.query.mockResolvedValueOnce({ rowCount: 0 });
        // DELETE FROM controllers
        mockClient.query.mockResolvedValueOnce({ rowCount: 0 });
        // DELETE FROM buildings RETURNING * (no rows)
        mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        // COMMIT
        mockClient.query.mockResolvedValueOnce({});

        const result = await Building.deleteCascade(999);

        expect(result).toBeNull();
        expect(mockClient.query.mock.calls[6][0]).toBe('COMMIT');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid building ID', async () => {
        await expect(Building.deleteCascade('abc')).rejects.toThrow('Invalid building ID');
        expect(db.getPool).not.toHaveBeenCalled();
    });
});

describe('BuildingService.deleteBuildingCascade', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should call Building.deleteCascade and invalidate cache', async () => {
        const mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };
        db.getPool.mockReturnValue({
            connect: jest.fn().mockResolvedValue(mockClient)
        });

        const deletedBuilding = { building_id: 7, name: 'Building 7' };

        mockClient.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({ rowCount: 0 }) // alerts
            .mockResolvedValueOnce({ rowCount: 0 }) // infrastructure_alerts
            .mockResolvedValueOnce({ rowCount: 5 }) // metrics
            .mockResolvedValueOnce({ rowCount: 2 }) // controllers
            .mockResolvedValueOnce({ rows: [deletedBuilding], rowCount: 1 }) // building
            .mockResolvedValueOnce({}); // COMMIT

        const cacheService = require('../../../src/services/cacheService');

        const result = await buildingService.deleteBuildingCascade(7);

        expect(result).toEqual(deletedBuilding);
        // Cache invalidation should have been called
        expect(cacheService.invalidate).toHaveBeenCalled();
    });
});
