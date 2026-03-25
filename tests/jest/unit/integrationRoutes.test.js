'use strict';

jest.mock('../../../src/services/ukIntegrationService', () => ({
    getConfig: jest.fn(),
    updateConfig: jest.fn(),
    isEnabled: jest.fn()
}));
jest.mock('../../../src/models/IntegrationLog', () => ({
    findAll: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
    incrementRetry: jest.fn()
}));
jest.mock('../../../src/models/AlertRule', () => ({ findAll: jest.fn() }));
jest.mock('../../../src/middleware/auth', () => ({ isAdmin: (req, res, next) => next() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/utils/webhookValidation', () => ({
    isValidDirection: jest.fn(),
    isValidStatus: jest.fn(),
    isValidEntityType: jest.fn()
}));
const { isValidDirection, isValidStatus, isValidEntityType } = require('../../../src/utils/webhookValidation');

const ukIntegrationService = require('../../../src/services/ukIntegrationService');
const IntegrationLog = require('../../../src/models/IntegrationLog');
const AlertRule = require('../../../src/models/AlertRule');
const { handlers } = require('../../../src/routes/integrationRoutes');

function createMockReqRes(body = {}, query = {}, params = {}) {
    const req = { body, query, params, user: { role: 'admin' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return { req, res };
}

describe('integrationRoutes handlers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // getConfig
    // -------------------------------------------------------------------------
    describe('getConfig', () => {
        test('returns config on success', async () => {
            const mockConfig = {
                uk_integration_enabled: 'false',
                uk_api_url: 'https://example.com',
                uk_webhook_secret: '●●●●●●●●'
            };
            ukIntegrationService.getConfig.mockResolvedValue(mockConfig);

            const { req, res } = createMockReqRes();
            await handlers.getConfig(req, res);

            expect(ukIntegrationService.getConfig).toHaveBeenCalledTimes(1);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: mockConfig });
            expect(res.status).not.toHaveBeenCalled();
        });

        test('returns 500 when getConfig throws', async () => {
            ukIntegrationService.getConfig.mockRejectedValue(new Error('DB error'));

            const { req, res } = createMockReqRes();
            await handlers.getConfig(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });
    });

    // -------------------------------------------------------------------------
    // updateConfig
    // -------------------------------------------------------------------------
    describe('updateConfig', () => {
        test('updates config and returns success with refreshed config', async () => {
            const updatedConfig = { uk_integration_enabled: 'true', uk_webhook_secret: '●●●●●●●●' };
            ukIntegrationService.updateConfig.mockResolvedValue(undefined);
            ukIntegrationService.getConfig.mockResolvedValue(updatedConfig);

            const { req, res } = createMockReqRes({ uk_integration_enabled: 'true' });
            await handlers.updateConfig(req, res);

            expect(ukIntegrationService.updateConfig).toHaveBeenCalledWith({ uk_integration_enabled: 'true' });
            expect(ukIntegrationService.getConfig).toHaveBeenCalledTimes(1);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                data: updatedConfig,
                message: 'Config updated'
            });
        });

        test('returns 400 when a sensitive key is rejected', async () => {
            ukIntegrationService.updateConfig.mockRejectedValue(
                new Error('Cannot update this setting via API')
            );

            const { req, res } = createMockReqRes({ uk_webhook_secret: 'new-secret' });
            await handlers.updateConfig(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false, message: expect.stringContaining('Cannot update this setting') })
            );
        });

        test('returns 500 on unexpected error', async () => {
            ukIntegrationService.updateConfig.mockRejectedValue(new Error('DB connection lost'));

            const { req, res } = createMockReqRes({ uk_api_url: 'https://example.com' });
            await handlers.updateConfig(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });
    });

    // -------------------------------------------------------------------------
    // getLogs
    // -------------------------------------------------------------------------
    describe('getLogs', () => {
        beforeEach(() => {
            isValidDirection.mockReturnValue(true);
            isValidStatus.mockReturnValue(true);
            isValidEntityType.mockReturnValue(true);
        });

        test('returns paginated logs passing parsed page/limit to findAll', async () => {
            const mockResult = { logs: [{ id: 1 }, { id: 2 }], total: 2 };
            IntegrationLog.findAll.mockResolvedValue(mockResult);

            const { req, res } = createMockReqRes(
                {},
                { page: '2', limit: '10', direction: 'from_uk', status: 'success' }
            );
            await handlers.getLogs(req, res);

            expect(IntegrationLog.findAll).toHaveBeenCalledWith(
                expect.objectContaining({ page: 2, limit: 10, direction: 'from_uk', status: 'success' })
            );
            expect(res.json).toHaveBeenCalledWith({ success: true, data: mockResult });
        });

        test('returns 500 when findAll throws', async () => {
            IntegrationLog.findAll.mockRejectedValue(new Error('DB error'));

            const { req, res } = createMockReqRes({}, {});
            await handlers.getLogs(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });

        it('rejects invalid direction filter with 400', async () => {
            isValidDirection.mockReturnValue(false);
            const req = { query: { direction: 'INVALID' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await handlers.getLogs(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Invalid direction filter' })
            );
        });

        it('rejects invalid status filter with 400', async () => {
            isValidStatus.mockReturnValue(false);
            const req = { query: { status: 'hacked' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await handlers.getLogs(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('rejects invalid entity_type filter with 400', async () => {
            isValidEntityType.mockReturnValue(false);
            const req = { query: { entity_type: 'user' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            await handlers.getLogs(req, res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    // -------------------------------------------------------------------------
    // getLogById
    // -------------------------------------------------------------------------
    describe('getLogById', () => {
        test('returns log when found', async () => {
            const mockLog = { id: 5, status: 'success', direction: 'inbound' };
            IntegrationLog.findById.mockResolvedValue(mockLog);

            const { req, res } = createMockReqRes({}, {}, { id: '5' });
            await handlers.getLogById(req, res);

            expect(IntegrationLog.findById).toHaveBeenCalledWith(5);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: mockLog });
        });

        test('returns 404 when log is not found', async () => {
            IntegrationLog.findById.mockResolvedValue(null);

            const { req, res } = createMockReqRes({}, {}, { id: '999' });
            await handlers.getLogById(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ success: false })
            );
        });
    });

    // -------------------------------------------------------------------------
    // retryLog
    // -------------------------------------------------------------------------
    describe('retryLog', () => {
        test('marks a failed entry as pending and increments retry', async () => {
            const mockLog = { id: 3, status: 'failed' };
            IntegrationLog.findById.mockResolvedValue(mockLog);
            IntegrationLog.updateStatus.mockResolvedValue({ id: 3, status: 'pending' });
            IntegrationLog.incrementRetry.mockResolvedValue({ id: 3, retry_count: 1 });

            const { req, res } = createMockReqRes({}, {}, { id: '3' });
            await handlers.retryLog(req, res);

            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(3, 'pending');
            expect(IntegrationLog.incrementRetry).toHaveBeenCalledWith(3);
            expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Marked for retry' });
        });

        test('marks an error entry as pending and increments retry', async () => {
            const mockLog = { id: 7, status: 'error' };
            IntegrationLog.findById.mockResolvedValue(mockLog);
            IntegrationLog.updateStatus.mockResolvedValue({ id: 7, status: 'pending' });
            IntegrationLog.incrementRetry.mockResolvedValue({ id: 7, retry_count: 2 });

            const { req, res } = createMockReqRes({}, {}, { id: '7' });
            await handlers.retryLog(req, res);

            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(7, 'pending');
            expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Marked for retry' });
        });

        test('returns 400 for a non-failed entry (status: success)', async () => {
            const mockLog = { id: 10, status: 'success' };
            IntegrationLog.findById.mockResolvedValue(mockLog);

            const { req, res } = createMockReqRes({}, {}, { id: '10' });
            await handlers.retryLog(req, res);

            expect(IntegrationLog.updateStatus).not.toHaveBeenCalled();
            expect(IntegrationLog.incrementRetry).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });

        test('returns 404 when log entry does not exist', async () => {
            IntegrationLog.findById.mockResolvedValue(null);

            const { req, res } = createMockReqRes({}, {}, { id: '404' });
            await handlers.retryLog(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    // -------------------------------------------------------------------------
    // getRules
    // -------------------------------------------------------------------------
    describe('getRules', () => {
        test('returns all alert rules', async () => {
            const mockRules = [
                { id: 1, alert_type: 'TRANSFORMER_OVERLOAD', severity: 'WARNING', enabled: true },
                { id: 2, alert_type: 'TRANSFORMER_CRITICAL', severity: 'CRITICAL', enabled: true }
            ];
            AlertRule.findAll.mockResolvedValue(mockRules);

            const { req, res } = createMockReqRes();
            await handlers.getRules(req, res);

            expect(AlertRule.findAll).toHaveBeenCalledTimes(1);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: mockRules });
        });

        test('returns 500 when findAll throws', async () => {
            AlertRule.findAll.mockRejectedValue(new Error('DB error'));

            const { req, res } = createMockReqRes();
            await handlers.getRules(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });
    });
});
