jest.mock('../../../src/services/controllerService', () => ({
    getAllControllers: jest.fn(),
    getControllerById: jest.fn(),
    getControllersByBuildingId: jest.fn(),
    getControllerMetrics: jest.fn(),
    createController: jest.fn(),
    updateController: jest.fn(),
    updateControllerStatus: jest.fn(),
    deleteController: jest.fn(),
    updateControllersStatusByActivity: jest.fn(),
    getControllersStatistics: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const controllerService = require('../../../src/services/controllerService');
const {
    getAllControllers,
    getControllerById,
    getControllersByBuildingId,
    getControllerMetrics,
    createController,
    updateController,
    updateControllerStatus,
    deleteController,
    updateControllersStatusByActivity,
    getControllersStatistics
} = require('../../../src/controllers/controllerController');

describe('ControllerController', () => {
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
        test('returns paginated list with 200', async () => {
            controllerService.getAllControllers.mockResolvedValue(mockPaginated);

            await getAllControllers(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockPaginated);
        });

        test('passes parsed query params to service', async () => {
            req.query = { page: '2', limit: '20', sort: 'serial_number', order: 'desc' };
            controllerService.getAllControllers.mockResolvedValue(mockPaginated);

            await getAllControllers(req, res, next);

            expect(controllerService.getAllControllers).toHaveBeenCalledWith(2, 20, 'serial_number', 'desc');
        });

        test('uses defaults for missing query params', async () => {
            controllerService.getAllControllers.mockResolvedValue(mockPaginated);

            await getAllControllers(req, res, next);

            expect(controllerService.getAllControllers).toHaveBeenCalledWith(1, 10, 'controller_id', 'asc');
        });

        test('calls next on error', async () => {
            controllerService.getAllControllers.mockRejectedValue(new Error('Service error'));

            await getAllControllers(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getControllerById', () => {
        test('returns controller with 200 when found', async () => {
            req.params.id = '1';
            controllerService.getControllerById.mockResolvedValue(mockController);

            await getControllerById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockController);
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            controllerService.getControllerById.mockResolvedValue(null);

            await getControllerById(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: expect.objectContaining({ message: 'Controller not found' })
                })
            );
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            controllerService.getControllerById.mockRejectedValue(new Error('DB error'));

            await getControllerById(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getControllersByBuildingId', () => {
        test('returns controllers for building with 200', async () => {
            req.params.buildingId = '5';
            controllerService.getControllersByBuildingId.mockResolvedValue([mockController]);

            await getControllersByBuildingId(req, res, next);

            expect(controllerService.getControllersByBuildingId).toHaveBeenCalledWith('5');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith([mockController]);
        });

        test('returns empty array when no controllers', async () => {
            req.params.buildingId = '999';
            controllerService.getControllersByBuildingId.mockResolvedValue([]);

            await getControllersByBuildingId(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith([]);
        });

        test('calls next on error', async () => {
            req.params.buildingId = '5';
            controllerService.getControllersByBuildingId.mockRejectedValue(new Error('DB error'));

            await getControllersByBuildingId(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getControllerMetrics', () => {
        test('returns metrics with 200', async () => {
            req.params.id = '1';
            req.query = { startDate: '2026-01-01', endDate: '2026-01-31' };
            const mockMetrics = [{ metric_id: 1, value: 22.5 }];
            controllerService.getControllerMetrics.mockResolvedValue(mockMetrics);

            await getControllerMetrics(req, res, next);

            expect(controllerService.getControllerMetrics).toHaveBeenCalledWith('1', '2026-01-01', '2026-01-31');
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockMetrics);
        });

        test('returns 404 when controller not found', async () => {
            req.params.id = '999';
            req.query = {};
            const error = new Error('Controller not found');
            error.code = 'CONTROLLER_NOT_FOUND';
            controllerService.getControllerMetrics.mockRejectedValue(error);

            await getControllerMetrics(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on generic error', async () => {
            req.params.id = '1';
            req.query = {};
            controllerService.getControllerMetrics.mockRejectedValue(new Error('DB error'));

            await getControllerMetrics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('createController', () => {
        test('creates and returns 201', async () => {
            req.body = { serial_number: 'SN-002', building_id: 1 };
            controllerService.createController.mockResolvedValue(mockController);

            await createController(req, res, next);

            expect(controllerService.createController).toHaveBeenCalledWith(req.body);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(mockController);
        });

        test('calls next on error', async () => {
            req.body = { serial_number: 'SN-002' };
            controllerService.createController.mockRejectedValue(new Error('Validation error'));

            await createController(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateController', () => {
        test('updates and returns 200', async () => {
            req.params.id = '1';
            req.body = { serial_number: 'SN-UPDATED' };
            const updated = { ...mockController, serial_number: 'SN-UPDATED' };
            controllerService.updateController.mockResolvedValue(updated);

            await updateController(req, res, next);

            expect(controllerService.updateController).toHaveBeenCalledWith('1', req.body);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(updated);
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            req.body = { serial_number: 'X' };
            controllerService.updateController.mockResolvedValue(null);

            await updateController(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('calls next on error', async () => {
            req.params.id = '1';
            req.body = { serial_number: 'X' };
            controllerService.updateController.mockRejectedValue(new Error('DB error'));

            await updateController(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateControllerStatus', () => {
        test('updates status and returns 200', async () => {
            req.params.id = '1';
            req.body = { status: 'offline' };
            const updated = { ...mockController, status: 'offline' };
            controllerService.updateControllerStatus.mockResolvedValue(updated);

            await updateControllerStatus(req, res, next);

            expect(controllerService.updateControllerStatus).toHaveBeenCalledWith('1', 'offline');
            expect(res.status).toHaveBeenCalledWith(200);
        });

        test('returns 404 when controller not found', async () => {
            req.params.id = '999';
            req.body = { status: 'online' };
            controllerService.updateControllerStatus.mockResolvedValue(null);

            await updateControllerStatus(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('returns 400 for invalid status', async () => {
            req.params.id = '1';
            req.body = { status: 'invalid' };
            const error = new Error('Invalid status');
            error.code = 'INVALID_STATUS';
            controllerService.updateControllerStatus.mockRejectedValue(error);

            await updateControllerStatus(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('calls next on generic error', async () => {
            req.params.id = '1';
            req.body = { status: 'online' };
            controllerService.updateControllerStatus.mockRejectedValue(new Error('DB error'));

            await updateControllerStatus(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('deleteController', () => {
        test('deletes and returns 200 with message', async () => {
            req.params.id = '1';
            controllerService.deleteController.mockResolvedValue(mockController);

            await deleteController(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Controller deleted successfully',
                    deleted: mockController
                })
            );
        });

        test('returns 404 when not found', async () => {
            req.params.id = '999';
            controllerService.deleteController.mockResolvedValue(null);

            await deleteController(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('returns 400 when controller has metrics', async () => {
            req.params.id = '1';
            const error = new Error('Has metrics');
            error.code = 'CONTROLLER_HAS_METRICS';
            controllerService.deleteController.mockRejectedValue(error);

            await deleteController(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('calls next on generic error', async () => {
            req.params.id = '1';
            controllerService.deleteController.mockRejectedValue(new Error('DB error'));

            await deleteController(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('updateControllersStatusByActivity', () => {
        test('returns result with 200', async () => {
            const mockResult = { updated: 3, total: 15 };
            controllerService.updateControllersStatusByActivity.mockResolvedValue(mockResult);

            await updateControllersStatusByActivity(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockResult);
        });

        test('calls next on error', async () => {
            controllerService.updateControllersStatusByActivity.mockRejectedValue(new Error('Error'));

            await updateControllersStatusByActivity(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('getControllersStatistics', () => {
        test('returns statistics with 200', async () => {
            const mockStats = { total: 15, by_status: { online: 8, offline: 4, maintenance: 3 } };
            controllerService.getControllersStatistics.mockResolvedValue(mockStats);

            await getControllersStatistics(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(mockStats);
        });

        test('calls next on error', async () => {
            controllerService.getControllersStatistics.mockRejectedValue(new Error('Error'));

            await getControllersStatistics(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
