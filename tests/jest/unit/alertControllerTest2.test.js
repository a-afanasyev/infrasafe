jest.mock('../../../src/services/alertService', () => {
    const instance = {
        getActiveAlerts: jest.fn(),
        acknowledgeAlert: jest.fn(),
        resolveAlert: jest.fn(),
        createAlert: jest.fn(),
        checkTransformerLoad: jest.fn(),
        checkAllTransformers: jest.fn(),
        getAlertStatistics: jest.fn(),
        getThresholds: jest.fn(),
        updateThresholds: jest.fn(),
        getStatus: jest.fn()
    };
    return instance;
});

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const AlertController = require('../../../src/controllers/alertController');
const alertService = require('../../../src/services/alertService');

describe('AlertController', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            query: {},
            params: {},
            body: {},
            user: { user_id: 1 }
        };
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('createAlert', () => {
        test('returns 400 when required fields are missing', async () => {
            req.body = { type: 'TEST' }; // missing other required fields
            await AlertController.createAlert(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    message: expect.stringContaining('Обязательные поля')
                })
            );
        });

        test('returns 400 for invalid severity', async () => {
            req.body = {
                type: 'TEST',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                severity: 'EXTREME',
                message: 'Test alert'
            };
            await AlertController.createAlert(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    message: expect.stringContaining('severity')
                })
            );
        });

        test('creates alert successfully with valid data', async () => {
            req.body = {
                type: 'TRANSFORMER_OVERLOAD',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                severity: 'WARNING',
                message: 'High load detected',
                affected_buildings: 3,
                data: { load_percent: 87 }
            };
            const mockAlert = { alert_id: 42, ...req.body, status: 'active' };
            alertService.createAlert.mockResolvedValue(mockAlert);

            await AlertController.createAlert(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: expect.stringContaining('создан'),
                    data: mockAlert
                })
            );
        });

        test('normalizes severity to uppercase and infrastructure_type to lowercase', async () => {
            req.body = {
                type: 'TEST',
                infrastructure_id: 1,
                infrastructure_type: 'TRANSFORMER',
                severity: 'warning',
                message: 'Test alert'
            };
            alertService.createAlert.mockResolvedValue({ alert_id: 1 });

            await AlertController.createAlert(req, res, next);

            const callArg = alertService.createAlert.mock.calls[0][0];
            expect(callArg.severity).toBe('WARNING');
            expect(callArg.infrastructure_type).toBe('transformer');
        });

        test('defaults affected_buildings to 0', async () => {
            req.body = {
                type: 'TEST',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                severity: 'INFO',
                message: 'Test'
            };
            alertService.createAlert.mockResolvedValue({ alert_id: 1 });

            await AlertController.createAlert(req, res, next);

            const callArg = alertService.createAlert.mock.calls[0][0];
            expect(callArg.affected_buildings).toBe(0);
            expect(callArg.data).toEqual({});
        });

        test('delegates to next(error) on service error', async () => {
            req.body = {
                type: 'TEST',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                severity: 'WARNING',
                message: 'Test'
            };
            const error = new Error('DB error');
            alertService.createAlert.mockRejectedValue(error);

            await AlertController.createAlert(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('acknowledgeAlert', () => {
        test('returns 401 when no user is authenticated', async () => {
            req.user = {};
            req.params = { alertId: '10' };
            await AlertController.acknowledgeAlert(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('acknowledges alert successfully', async () => {
            req.params = { alertId: '10' };
            const mockAlert = { alert_id: 10, status: 'acknowledged' };
            alertService.acknowledgeAlert.mockResolvedValue(mockAlert);

            await AlertController.acknowledgeAlert(req, res, next);

            expect(alertService.acknowledgeAlert).toHaveBeenCalledWith(10, 1);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockAlert
                })
            );
        });

        test('returns 404 when alert not found', async () => {
            req.params = { alertId: '999' };
            alertService.acknowledgeAlert.mockRejectedValue(
                new Error('Алерт 999 не найден или уже обработан')
            );

            await AlertController.acknowledgeAlert(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('delegates to next(error) on unexpected error', async () => {
            req.params = { alertId: '10' };
            const error = new Error('DB connection lost');
            alertService.acknowledgeAlert.mockRejectedValue(error);

            await AlertController.acknowledgeAlert(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('resolveAlert', () => {
        test('returns 401 when no user is authenticated', async () => {
            req.user = {};
            req.params = { alertId: '20' };
            await AlertController.resolveAlert(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('resolves alert successfully', async () => {
            req.params = { alertId: '20' };
            const mockAlert = { alert_id: 20, status: 'resolved' };
            alertService.resolveAlert.mockResolvedValue(mockAlert);

            await AlertController.resolveAlert(req, res, next);

            expect(alertService.resolveAlert).toHaveBeenCalledWith(20, 1);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockAlert
                })
            );
        });

        test('returns 404 when alert not found', async () => {
            req.params = { alertId: '999' };
            alertService.resolveAlert.mockRejectedValue(
                new Error('Алерт 999 не найден или уже закрыт')
            );

            await AlertController.resolveAlert(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('delegates to next(error) on unexpected error', async () => {
            req.params = { alertId: '20' };
            const error = new Error('Timeout');
            alertService.resolveAlert.mockRejectedValue(error);

            await AlertController.resolveAlert(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('checkTransformer', () => {
        test('returns 400 when transformerId is missing', async () => {
            req.params = {};
            await AlertController.checkTransformer(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns alert when created', async () => {
            req.params = { transformerId: '5' };
            const mockAlert = { alert_id: 50, type: 'TRANSFORMER_OVERLOAD' };
            alertService.checkTransformerLoad.mockResolvedValue(mockAlert);

            await AlertController.checkTransformer(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: expect.stringContaining('Создан'),
                    data: mockAlert
                })
            );
        });

        test('returns null data when no alert needed', async () => {
            req.params = { transformerId: '5' };
            alertService.checkTransformerLoad.mockResolvedValue(null);

            await AlertController.checkTransformer(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: null
                })
            );
        });

        test('delegates to next(error) on error', async () => {
            req.params = { transformerId: '5' };
            const error = new Error('fail');
            alertService.checkTransformerLoad.mockRejectedValue(error);

            await AlertController.checkTransformer(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('checkAllTransformers', () => {
        test('returns check results', async () => {
            const mockResult = {
                checked: 10,
                alerts_created: 2,
                alerts: [{ alert_id: 1 }, { alert_id: 2 }]
            };
            alertService.checkAllTransformers.mockResolvedValue(mockResult);

            await AlertController.checkAllTransformers(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: expect.stringContaining('10'),
                    data: mockResult
                })
            );
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            alertService.checkAllTransformers.mockRejectedValue(error);

            await AlertController.checkAllTransformers(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getAlertStatistics', () => {
        test('returns statistics for default period', async () => {
            req.query = {};
            const mockStats = { period_days: 7, statistics: [] };
            alertService.getAlertStatistics.mockResolvedValue(mockStats);

            await AlertController.getAlertStatistics(req, res, next);

            expect(alertService.getAlertStatistics).toHaveBeenCalledWith(7);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, data: mockStats })
            );
        });

        test('returns statistics for specified period', async () => {
            req.query = { days: '30' };
            const mockStats = { period_days: 30, statistics: [] };
            alertService.getAlertStatistics.mockResolvedValue(mockStats);

            await AlertController.getAlertStatistics(req, res, next);

            expect(alertService.getAlertStatistics).toHaveBeenCalledWith(30);
        });

        test('returns 400 for period below 1', async () => {
            req.query = { days: '0' };
            await AlertController.getAlertStatistics(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 for period above 365', async () => {
            req.query = { days: '400' };
            await AlertController.getAlertStatistics(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('delegates to next(error) on error', async () => {
            req.query = { days: '7' };
            const error = new Error('fail');
            alertService.getAlertStatistics.mockRejectedValue(error);

            await AlertController.getAlertStatistics(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getThresholds', () => {
        test('returns current thresholds', async () => {
            const mockThresholds = {
                transformer_overload: 85,
                transformer_critical: 95
            };
            alertService.getThresholds.mockReturnValue(mockThresholds);

            await AlertController.getThresholds(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockThresholds
                })
            );
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            alertService.getThresholds.mockImplementation(() => {
                throw error;
            });

            await AlertController.getThresholds(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('updateThresholds', () => {
        test('updates thresholds with valid data', async () => {
            req.body = { transformer_overload: 90 };
            alertService.getThresholds.mockReturnValue({
                transformer_overload: 90,
                transformer_critical: 95
            });

            await AlertController.updateThresholds(req, res, next);

            expect(alertService.updateThresholds).toHaveBeenCalledWith({ transformer_overload: 90 });
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: expect.stringContaining('обновлены')
                })
            );
        });

        test('returns 400 for invalid keys', async () => {
            req.body = { invalid_key: 50 };

            await AlertController.updateThresholds(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    message: expect.stringContaining('invalid_key')
                })
            );
        });

        test('returns 400 for non-numeric values', async () => {
            req.body = { transformer_overload: 'not-a-number' };

            await AlertController.updateThresholds(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 for negative values', async () => {
            req.body = { transformer_overload: -5 };

            await AlertController.updateThresholds(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 for zero values', async () => {
            req.body = { transformer_overload: 0 };

            await AlertController.updateThresholds(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('delegates to next(error) on error', async () => {
            req.body = { transformer_overload: 90 };
            const error = new Error('fail');
            alertService.updateThresholds.mockImplementation(() => {
                throw error;
            });

            await AlertController.updateThresholds(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getActiveAlerts', () => {
        test('passes valid filters and pagination to service', async () => {
            req.query = {
                status: 'active',
                severity: 'WARNING',
                infrastructure_type: 'transformer',
                page: '2',
                limit: '20',
                sort: 'created_at',
                order: 'asc'
            };
            alertService.getActiveAlerts.mockResolvedValue({ data: [], total: 0 });

            await AlertController.getActiveAlerts(req, res, next);

            expect(alertService.getActiveAlerts).toHaveBeenCalledWith(
                { status: 'active', severity: 'WARNING', infrastructure_type: 'transformer' },
                { page: 2, limit: 20, sort: 'created_at', order: 'ASC' }
            );
        });

        test('rejects invalid status', async () => {
            req.query = { status: 'INVALID' };
            await AlertController.getActiveAlerts(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('rejects invalid severity', async () => {
            req.query = { severity: 'EXTREME' };
            await AlertController.getActiveAlerts(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('rejects invalid infrastructure_type', async () => {
            req.query = { infrastructure_type: 'nuclear' };
            await AlertController.getActiveAlerts(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('delegates to next(error) on service error', async () => {
            req.query = {};
            const error = new Error('fail');
            alertService.getActiveAlerts.mockRejectedValue(error);

            await AlertController.getActiveAlerts(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getSystemStatus', () => {
        test('returns system status', async () => {
            const mockStatus = {
                active_alerts: 5,
                last_checks: 3,
                cooldown_minutes: 15
            };
            alertService.getStatus.mockReturnValue(mockStatus);

            await AlertController.getSystemStatus(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    data: mockStatus
                })
            );
        });

        test('delegates to next(error) on error', async () => {
            const error = new Error('fail');
            alertService.getStatus.mockImplementation(() => {
                throw error;
            });

            await AlertController.getSystemStatus(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });
});
