jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/controllers/controllerController', () => ({
    createController: jest.fn(),
    getControllerById: jest.fn(),
    updateController: jest.fn(),
    deleteController: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const controllerController = require('../../../src/controllers/controllerController');
const {
    getOptimizedControllers,
    createController,
    getControllerById,
    updateController,
    deleteController,
    batchControllersOperation
} = require('../../../src/controllers/admin/adminControllerController');

describe('AdminControllerController', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { params: {}, query: {}, body: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    describe('getOptimizedControllers', () => {
        test('returns paginated controllers with default params', async () => {
            const mockRows = [{ controller_id: 1, serial_number: 'SN001' }];
            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ count: '1' }] });

            await getOptimizedControllers(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: mockRows,
                    pagination: expect.objectContaining({
                        total: 1,
                        page: expect.any(Number),
                        limit: expect.any(Number),
                        totalPages: expect.any(Number)
                    })
                })
            );
        });

        test('applies search filter with ILIKE on serial_number', async () => {
            req.query = { search: 'SN' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('ILIKE');
            expect(dataQuery).toContain('serial_number');
        });

        test('applies status filter', async () => {
            req.query = { status: 'online' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('status');
        });

        test('applies manufacturer filter', async () => {
            req.query = { manufacturer: 'Siemens' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('manufacturer');
        });

        test('applies building_id filter', async () => {
            req.query = { building_id: '5' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('building_id');
        });

        test('applies multiple filters together', async () => {
            req.query = { search: 'SN', status: 'online', building_id: '3' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '0' }] });

            await getOptimizedControllers(req, res, next);

            const dataQuery = db.query.mock.calls[0][0];
            expect(dataQuery).toContain('WHERE');
            expect(dataQuery).toContain('AND');
        });

        test('respects page and limit params', async () => {
            req.query = { page: '3', limit: '25' };
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ count: '100' }] });

            await getOptimizedControllers(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    pagination: expect.objectContaining({
                        page: 3,
                        limit: 25
                    })
                })
            );
        });

        test('calls next on database error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await getOptimizedControllers(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    describe('CRUD delegation', () => {
        test('createController delegates to controllerController', async () => {
            controllerController.createController.mockResolvedValue(undefined);

            await createController(req, res, next);

            expect(controllerController.createController).toHaveBeenCalledWith(req, res, next);
        });

        test('getControllerById delegates to controllerController', async () => {
            controllerController.getControllerById.mockResolvedValue(undefined);

            await getControllerById(req, res, next);

            expect(controllerController.getControllerById).toHaveBeenCalledWith(req, res, next);
        });

        test('updateController delegates to controllerController', async () => {
            controllerController.updateController.mockResolvedValue(undefined);

            await updateController(req, res, next);

            expect(controllerController.updateController).toHaveBeenCalledWith(req, res, next);
        });

        test('deleteController delegates to controllerController', async () => {
            controllerController.deleteController.mockResolvedValue(undefined);

            await deleteController(req, res, next);

            expect(controllerController.deleteController).toHaveBeenCalledWith(req, res, next);
        });
    });

    describe('batchControllersOperation', () => {
        test('returns success with affected count', async () => {
            req.body = { action: 'delete', ids: [1, 2] };

            await batchControllersOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 2
                })
            );
        });

        test('returns affected 0 when ids not provided', async () => {
            req.body = { action: 'delete' };

            await batchControllersOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    affected: 0
                })
            );
        });

        test('includes action name in message', async () => {
            req.body = { action: 'update_status', ids: [1] };

            await batchControllersOperation(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('update_status')
                })
            );
        });
    });
});
