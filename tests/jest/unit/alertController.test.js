jest.mock('../../../src/services/alertService', () => {
    const instance = {
        getActiveAlerts: jest.fn().mockResolvedValue({ data: [], total: 0 }),
        acknowledgeAlert: jest.fn(),
        resolveAlert: jest.fn()
    };
    // alertService is a singleton instance, not a class
    return instance;
});

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const alertController = require('../../../src/controllers/alertController');
const alertService = require('../../../src/services/alertService');

describe('AlertController.getActiveAlerts', () => {
    let req, res;

    beforeEach(() => {
        req = { query: {} };
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
        jest.clearAllMocks();
        alertService.getActiveAlerts.mockResolvedValue({ data: [], total: 0 });
    });

    test('rejects invalid status param', async () => {
        req.query = { status: 'INVALID' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rejects invalid severity param', async () => {
        req.query = { severity: 'EXTREME' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('rejects invalid infrastructure_type param', async () => {
        req.query = { infrastructure_type: 'nuclear' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('accepts valid params and returns paginated response', async () => {
        req.query = { status: 'active', severity: 'WARNING', page: '1', limit: '10' };
        await alertController.getActiveAlerts(req, res);
        expect(res.status).not.toHaveBeenCalled();
        const response = res.json.mock.calls[0][0];
        expect(response).toHaveProperty('success', true);
        expect(response).toHaveProperty('data');
        expect(response).toHaveProperty('pagination');
        expect(response.pagination).toEqual({ page: 1, limit: 10, total: 0 });
    });

    test('defaults to page 1 and limit 10 when not provided', async () => {
        req.query = {};
        await alertController.getActiveAlerts(req, res);
        const response = res.json.mock.calls[0][0];
        expect(response.pagination.page).toBe(1);
        expect(response.pagination.limit).toBe(10);
    });

    test('caps limit at 200', async () => {
        req.query = { limit: '500' };
        await alertController.getActiveAlerts(req, res);
        const callArgs = alertService.getActiveAlerts.mock.calls[0];
        expect(callArgs[1].limit).toBe(200);
    });
});
