jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/models/Controller', () => ({
    findAll: jest.fn(),
    findById: jest.fn(),
    findByBuildingId: jest.fn(),
    findBySerialNumber: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    delete: jest.fn()
}));

jest.mock('../../../src/models/Metric', () => ({
    findByControllerId: jest.fn()
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

const Controller = require('../../../src/models/Controller');
const Metric = require('../../../src/models/Metric');
const cacheService = require('../../../src/services/cacheService');
const controllerService = require('../../../src/services/controllerService');

describe('ControllerService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cacheService.get.mockResolvedValue(null);
        cacheService.set.mockResolvedValue(undefined);
        cacheService.invalidate.mockResolvedValue(undefined);
        cacheService.invalidatePattern.mockResolvedValue(undefined);
    });

    const mockController = {
        controller_id: 1,
        serial_number: 'SN-001',
        status: 'online',
        building_id: 1
    };

    const mockPaginated = {
        data: [mockController],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 }
    };

    describe('getAllControllers', () => {
        test('returns data from cache when available', async () => {
            cacheService.get.mockResolvedValue(mockPaginated);

            const result = await controllerService.getAllControllers();

            expect(result).toEqual(mockPaginated);
            expect(Controller.findAll).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches when cache miss', async () => {
            Controller.findAll.mockResolvedValue(mockPaginated);

            const result = await controllerService.getAllControllers(1, 10, 'controller_id', 'asc');

            expect(Controller.findAll).toHaveBeenCalledWith(1, 10, 'controller_id', 'asc');
            expect(cacheService.set).toHaveBeenCalledWith(
                expect.stringContaining('controller:list:'),
                mockPaginated,
                expect.any(Object)
            );
            expect(result).toEqual(mockPaginated);
        });

        test('uses default parameters', async () => {
            Controller.findAll.mockResolvedValue(mockPaginated);

            await controllerService.getAllControllers();

            expect(Controller.findAll).toHaveBeenCalledWith(1, 10, 'controller_id', 'asc');
        });

        test('throws on DB error', async () => {
            Controller.findAll.mockRejectedValue(new Error('DB error'));

            await expect(controllerService.getAllControllers()).rejects.toThrow('DB error');
        });
    });

    describe('getControllerById', () => {
        test('returns data from cache when available', async () => {
            cacheService.get.mockResolvedValue(mockController);

            const result = await controllerService.getControllerById(1);

            expect(result).toEqual(mockController);
            expect(Controller.findById).not.toHaveBeenCalled();
        });

        test('fetches from DB when cache miss', async () => {
            Controller.findById.mockResolvedValue(mockController);

            const result = await controllerService.getControllerById(1);

            expect(Controller.findById).toHaveBeenCalledWith(1);
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(mockController);
        });

        test('returns null when not found', async () => {
            Controller.findById.mockResolvedValue(null);

            const result = await controllerService.getControllerById(999);

            expect(result).toBeNull();
        });

        test('does not cache null result', async () => {
            Controller.findById.mockResolvedValue(null);

            await controllerService.getControllerById(999);

            expect(cacheService.set).not.toHaveBeenCalled();
        });

        test('throws on DB error', async () => {
            Controller.findById.mockRejectedValue(new Error('DB error'));

            await expect(controllerService.getControllerById(1)).rejects.toThrow('DB error');
        });
    });

    describe('getControllersByBuildingId', () => {
        test('returns data from cache when available', async () => {
            const mockControllers = [mockController];
            cacheService.get.mockResolvedValue(mockControllers);

            const result = await controllerService.getControllersByBuildingId(1);

            expect(result).toEqual(mockControllers);
            expect(Controller.findByBuildingId).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches when cache miss', async () => {
            const mockControllers = [mockController];
            Controller.findByBuildingId.mockResolvedValue(mockControllers);

            const result = await controllerService.getControllersByBuildingId(1);

            expect(Controller.findByBuildingId).toHaveBeenCalledWith(1);
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(mockControllers);
        });

        test('throws on DB error', async () => {
            Controller.findByBuildingId.mockRejectedValue(new Error('DB error'));

            await expect(controllerService.getControllersByBuildingId(1)).rejects.toThrow();
        });
    });

    describe('getControllerMetrics', () => {
        test('returns metrics when controller exists', async () => {
            Controller.findById.mockResolvedValue(mockController);
            const mockMetrics = [{ metric_id: 1, value: 22.5 }];
            Metric.findByControllerId.mockResolvedValue(mockMetrics);

            const result = await controllerService.getControllerMetrics(1, '2026-01-01', '2026-01-31');

            expect(result).toEqual(mockMetrics);
        });

        test('throws CONTROLLER_NOT_FOUND when controller does not exist', async () => {
            Controller.findById.mockResolvedValue(null);

            await expect(controllerService.getControllerMetrics(999)).rejects.toMatchObject({ code: 'CONTROLLER_NOT_FOUND' });
        });

        test('uses cache for metrics', async () => {
            // First call: cache controller
            Controller.findById.mockResolvedValue(mockController);
            const mockMetrics = [{ metric_id: 1, value: 22.5 }];
            // Second get call returns cached metrics
            cacheService.get
                .mockResolvedValueOnce(null) // controller cache miss
                .mockResolvedValueOnce(mockMetrics); // metrics cache hit

            const result = await controllerService.getControllerMetrics(1);

            expect(result).toEqual(mockMetrics);
        });
    });

    describe('createController', () => {
        test('creates controller and invalidates cache', async () => {
            const newController = { ...mockController, controller_id: 2, serial_number: 'SN-002' };
            Controller.create.mockResolvedValue(newController);

            const result = await controllerService.createController({ serial_number: 'SN-002', building_id: 1 });

            expect(Controller.create).toHaveBeenCalledWith({ serial_number: 'SN-002', building_id: 1 });
            expect(cacheService.invalidatePattern).toHaveBeenCalled();
            expect(result).toEqual(newController);
        });

        test('throws when serial_number is missing', async () => {
            await expect(controllerService.createController({})).rejects.toThrow();
        });

        test('throws when status is invalid', async () => {
            await expect(
                controllerService.createController({ serial_number: 'SN-003', status: 'invalid_status' })
            ).rejects.toThrow();
        });
    });

    describe('updateController', () => {
        test('updates controller and invalidates cache', async () => {
            const updated = { ...mockController, serial_number: 'SN-UPDATED' };
            Controller.update.mockResolvedValue(updated);
            Controller.findById.mockResolvedValue(updated);

            const result = await controllerService.updateController(1, { serial_number: 'SN-UPDATED' });

            expect(Controller.update).toHaveBeenCalledWith(1, { serial_number: 'SN-UPDATED' });
            expect(cacheService.invalidate).toHaveBeenCalled();
            expect(result).toEqual(updated);
        });

        test('returns null when controller not found', async () => {
            Controller.update.mockResolvedValue(null);

            const result = await controllerService.updateController(999, { serial_number: 'X' });

            expect(result).toBeNull();
        });

        test('throws on DB error', async () => {
            Controller.update.mockRejectedValue(new Error('DB error'));

            await expect(controllerService.updateController(1, { serial_number: 'X' })).rejects.toThrow();
        });
    });

    describe('updateControllerStatus', () => {
        test('updates status to valid value', async () => {
            const updated = { ...mockController, status: 'offline' };
            Controller.updateStatus.mockResolvedValue(updated);
            Controller.findById.mockResolvedValue(updated);

            const result = await controllerService.updateControllerStatus(1, 'offline');

            expect(Controller.updateStatus).toHaveBeenCalledWith(1, 'offline');
            expect(result).toEqual(updated);
        });

        test('throws INVALID_STATUS for invalid status value', async () => {
            await expect(controllerService.updateControllerStatus(1, 'invalid')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
        });

        test('throws INVALID_STATUS for empty status', async () => {
            await expect(controllerService.updateControllerStatus(1, '')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
        });

        test('throws INVALID_STATUS for null status', async () => {
            await expect(controllerService.updateControllerStatus(1, null)).rejects.toMatchObject({ code: 'INVALID_STATUS' });
        });

        test('returns null when controller not found', async () => {
            Controller.updateStatus.mockResolvedValue(null);

            const result = await controllerService.updateControllerStatus(999, 'online');

            expect(result).toBeNull();
        });
    });

    describe('deleteController', () => {
        test('deletes controller when no metrics exist', async () => {
            Metric.findByControllerId.mockResolvedValue([]);
            Controller.delete.mockResolvedValue(mockController);
            Controller.findById.mockResolvedValue(mockController);

            const result = await controllerService.deleteController(1);

            expect(Controller.delete).toHaveBeenCalledWith(1);
            expect(result).toEqual(mockController);
        });

        test('throws CONTROLLER_HAS_METRICS when metrics exist', async () => {
            Metric.findByControllerId.mockResolvedValue([{ metric_id: 1 }]);

            await expect(controllerService.deleteController(1)).rejects.toMatchObject({ code: 'CONTROLLER_HAS_METRICS' });
        });

        test('returns null when controller not found', async () => {
            Metric.findByControllerId.mockResolvedValue([]);
            Controller.delete.mockResolvedValue(null);

            const result = await controllerService.deleteController(999);

            expect(result).toBeNull();
        });

        test('invalidates cache after successful deletion', async () => {
            Metric.findByControllerId.mockResolvedValue([]);
            Controller.delete.mockResolvedValue(mockController);
            Controller.findById.mockResolvedValue(mockController);

            await controllerService.deleteController(1);

            expect(cacheService.invalidate).toHaveBeenCalled();
            expect(cacheService.invalidatePattern).toHaveBeenCalled();
        });
    });

    describe('findBySerialNumber', () => {
        test('returns from cache when available', async () => {
            cacheService.get.mockResolvedValue(mockController);

            const result = await controllerService.findBySerialNumber('SN-001');

            expect(result).toEqual(mockController);
            expect(Controller.findBySerialNumber).not.toHaveBeenCalled();
        });

        test('fetches from DB and caches when cache miss', async () => {
            Controller.findBySerialNumber.mockResolvedValue(mockController);

            const result = await controllerService.findBySerialNumber('SN-001');

            expect(Controller.findBySerialNumber).toHaveBeenCalledWith('SN-001');
            expect(cacheService.set).toHaveBeenCalled();
            expect(result).toEqual(mockController);
        });

        test('does not cache null result', async () => {
            Controller.findBySerialNumber.mockResolvedValue(null);

            const result = await controllerService.findBySerialNumber('UNKNOWN');

            expect(result).toBeNull();
            expect(cacheService.set).not.toHaveBeenCalled();
        });
    });

    describe('getControllersStatistics', () => {
        test('returns statistics from cache when available', async () => {
            const mockStats = { total: 2, by_status: { online: 1, offline: 1, maintenance: 0 } };
            cacheService.get.mockResolvedValue(mockStats);

            const result = await controllerService.getControllersStatistics();

            expect(result).toEqual(mockStats);
        });

        test('calculates statistics from DB on cache miss', async () => {
            const controllers = [
                { controller_id: 1, status: 'online', building_id: 1, type: 'sensor' },
                { controller_id: 2, status: 'offline', building_id: 1, type: 'sensor' },
                { controller_id: 3, status: 'maintenance', building_id: 2, type: 'actuator' }
            ];
            Controller.findAll.mockResolvedValue({ data: controllers });

            const result = await controllerService.getControllersStatistics();

            expect(result.total).toBe(3);
            expect(result.by_status.online).toBe(1);
            expect(result.by_status.offline).toBe(1);
            expect(result.by_status.maintenance).toBe(1);
            expect(result.by_building['1']).toBe(2);
            expect(result.by_building['2']).toBe(1);
            expect(result.by_type['sensor']).toBe(2);
            expect(result.by_type['actuator']).toBe(1);
        });

        test('caches computed statistics', async () => {
            Controller.findAll.mockResolvedValue({ data: [] });

            await controllerService.getControllersStatistics();

            expect(cacheService.set).toHaveBeenCalledWith(
                'controller:statistics',
                expect.any(Object),
                expect.any(Object)
            );
        });
    });

    describe('validateControllerData', () => {
        test('throws when serial_number is missing on create', () => {
            expect(() => controllerService.validateControllerData({})).toThrow();
        });

        test('does not throw when serial_number is missing on update', () => {
            expect(() => controllerService.validateControllerData({}, true)).not.toThrow();
        });

        test('throws for invalid status value', () => {
            expect(() => controllerService.validateControllerData({ serial_number: 'SN', status: 'bad' })).toThrow();
        });

        test('accepts valid status values', () => {
            expect(() => controllerService.validateControllerData({ serial_number: 'SN', status: 'online' })).not.toThrow();
            expect(() => controllerService.validateControllerData({ serial_number: 'SN', status: 'offline' })).not.toThrow();
            expect(() => controllerService.validateControllerData({ serial_number: 'SN', status: 'maintenance' })).not.toThrow();
        });
    });
});
