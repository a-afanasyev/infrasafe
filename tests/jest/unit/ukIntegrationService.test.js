'use strict';

const crypto = require('crypto');

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/models/IntegrationConfig', () => ({
    isEnabled: jest.fn(),
    getAll: jest.fn(),
    set: jest.fn()
}));
jest.mock('../../../src/models/IntegrationLog', () => ({
    create: jest.fn(),
    findByEventId: jest.fn(),
    updateStatus: jest.fn()
}));

jest.mock('../../../src/models/Building', () => ({
    findByExternalId: jest.fn(),
    createFromUK: jest.fn(),
    updateFromUK: jest.fn(),
    softDelete: jest.fn()
}));
jest.mock('../../../src/utils/webhookValidation', () => ({
    isValidBuildingEvent: jest.fn()
}));

// Require after mocks are set up
const IntegrationConfig = require('../../../src/models/IntegrationConfig');
const IntegrationLog = require('../../../src/models/IntegrationLog');
const logger = require('../../../src/utils/logger');
const service = require('../../../src/services/ukIntegrationService');

const Building = require('../../../src/models/Building');
const { isValidBuildingEvent } = require('../../../src/utils/webhookValidation');

describe('UKIntegrationService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // isEnabled
    // -------------------------------------------------------------------------
    describe('isEnabled()', () => {
        it('returns true when integration is enabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            const result = await service.isEnabled();
            expect(result).toBe(true);
            expect(IntegrationConfig.isEnabled).toHaveBeenCalledTimes(1);
        });

        it('returns false when integration is disabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(false);
            const result = await service.isEnabled();
            expect(result).toBe(false);
        });

        it('returns false and does not throw on error (graceful degradation)', async () => {
            IntegrationConfig.isEnabled.mockRejectedValue(new Error('DB down'));
            const result = await service.isEnabled();
            expect(result).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // getConfig
    // -------------------------------------------------------------------------
    describe('getConfig()', () => {
        it('returns DB config merged with masked sensitive fields', async () => {
            IntegrationConfig.getAll.mockResolvedValue({
                uk_integration_enabled: 'true',
                uk_api_url: 'https://example.com',
                uk_webhook_secret: 'real-secret',
                uk_service_user: 'svc_user',
                uk_service_password: 'svc_pass'
            });

            const config = await service.getConfig();

            expect(config.uk_integration_enabled).toBe('true');
            expect(config.uk_api_url).toBe('https://example.com');
            expect(config.uk_webhook_secret).toBe('●●●●●●●●');
            expect(config.uk_service_user).toBe('●●●●●●●●');
            expect(config.uk_service_password).toBe('●●●●●●●●');
        });

        it('masks secrets even when DB returns no secret values', async () => {
            IntegrationConfig.getAll.mockResolvedValue({});
            const config = await service.getConfig();
            expect(config.uk_webhook_secret).toBe('●●●●●●●●');
            expect(config.uk_service_user).toBe('●●●●●●●●');
            expect(config.uk_service_password).toBe('●●●●●●●●');
        });
    });

    // -------------------------------------------------------------------------
    // updateConfig
    // -------------------------------------------------------------------------
    describe('updateConfig()', () => {
        it('calls IntegrationConfig.set for each allowed key', async () => {
            IntegrationConfig.set.mockResolvedValue({});
            await service.updateConfig({
                uk_integration_enabled: 'true',
                uk_api_url: 'https://api.example.com'
            });
            expect(IntegrationConfig.set).toHaveBeenCalledTimes(2);
            expect(IntegrationConfig.set).toHaveBeenCalledWith('uk_integration_enabled', 'true');
            expect(IntegrationConfig.set).toHaveBeenCalledWith('uk_api_url', 'https://api.example.com');
        });

        it('throws "Cannot update this setting via API" for sensitive keys', async () => {
            await expect(
                service.updateConfig({ uk_webhook_secret: 'newsecret' })
            ).rejects.toThrow('Cannot update this setting via API');
            expect(IntegrationConfig.set).not.toHaveBeenCalled();
        });

        it('throws for uk_service_user (sensitive)', async () => {
            await expect(
                service.updateConfig({ uk_service_user: 'user' })
            ).rejects.toThrow('Cannot update this setting via API');
        });

        it('throws for uk_service_password (sensitive)', async () => {
            await expect(
                service.updateConfig({ uk_service_password: 'pass' })
            ).rejects.toThrow('Cannot update this setting via API');
        });

        it('logs a warning and skips unknown keys', async () => {
            IntegrationConfig.set.mockResolvedValue({});
            await service.updateConfig({ unknown_key: 'value' });
            expect(IntegrationConfig.set).not.toHaveBeenCalled();
            expect(logger.warn).toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // verifyWebhookSignature
    // -------------------------------------------------------------------------
    describe('verifyWebhookSignature()', () => {
        const SECRET = 'test-webhook-secret';
        const BODY = JSON.stringify({ event: 'test' });

        function buildHeader(body, secret, timestampOverride) {
            const timestamp = timestampOverride !== undefined
                ? String(timestampOverride)
                : String(Math.floor(Date.now() / 1000));
            const sig = crypto
                .createHmac('sha256', secret)
                .update(`${timestamp}.${body}`)
                .digest('hex');
            return `t=${timestamp},v1=${sig}`;
        }

        let originalSecret;

        beforeEach(() => {
            originalSecret = process.env.UK_WEBHOOK_SECRET;
        });

        afterEach(() => {
            if (originalSecret === undefined) {
                delete process.env.UK_WEBHOOK_SECRET;
            } else {
                process.env.UK_WEBHOOK_SECRET = originalSecret;
            }
        });

        it('returns true for a valid signature', () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const header = buildHeader(BODY, SECRET);
            expect(service.verifyWebhookSignature(BODY, header)).toBe(true);
        });

        it('returns false for an invalid (tampered) signature', () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const header = buildHeader(BODY, 'wrong-secret');
            expect(service.verifyWebhookSignature(BODY, header)).toBe(false);
        });

        it('returns false when timestamp is older than 5 minutes', () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const expiredTimestamp = Math.floor(Date.now() / 1000) - 301;
            const header = buildHeader(BODY, SECRET, expiredTimestamp);
            expect(service.verifyWebhookSignature(BODY, header)).toBe(false);
        });

        it('returns false when UK_WEBHOOK_SECRET is not configured', () => {
            delete process.env.UK_WEBHOOK_SECRET;
            const header = buildHeader(BODY, SECRET);
            expect(service.verifyWebhookSignature(BODY, header)).toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });

        it('returns false when header is missing t field', () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const timestamp = Math.floor(Date.now() / 1000);
            const sig = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${BODY}`).digest('hex');
            expect(service.verifyWebhookSignature(BODY, `v1=${sig}`)).toBe(false);
        });

        it('returns false when header is missing v1 field', () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const timestamp = Math.floor(Date.now() / 1000);
            expect(service.verifyWebhookSignature(BODY, `t=${timestamp}`)).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // logEvent
    // -------------------------------------------------------------------------
    describe('logEvent()', () => {
        it('delegates to IntegrationLog.create and returns the result', async () => {
            const eventData = { event_id: 'evt-1', direction: 'inbound', action: 'test' };
            const created = { id: 42, ...eventData };
            IntegrationLog.create.mockResolvedValue(created);

            const result = await service.logEvent(eventData);

            expect(IntegrationLog.create).toHaveBeenCalledWith(eventData);
            expect(result).toEqual(created);
        });
    });

    // -------------------------------------------------------------------------
    // isDuplicateEvent
    // -------------------------------------------------------------------------
    describe('isDuplicateEvent()', () => {
        it('returns true when the event already exists in the log', async () => {
            IntegrationLog.findByEventId.mockResolvedValue({ id: 1, event_id: 'dup-123' });
            const result = await service.isDuplicateEvent('dup-123');
            expect(result).toBe(true);
            expect(IntegrationLog.findByEventId).toHaveBeenCalledWith('dup-123');
        });

        it('returns false when the event does not exist in the log', async () => {
            IntegrationLog.findByEventId.mockResolvedValue(null);
            const result = await service.isDuplicateEvent('new-456');
            expect(result).toBe(false);
        });
    });

    describe('handleBuildingWebhook()', () => {
        const basePayload = {
            event_id: '550e8400-e29b-41d4-a716-446655440000',
            event: 'building.created',
            building: { id: 15, name: 'Дом 42', address: 'ул. Навои, 42', town: 'Ташкент' },
            timestamp: '2026-03-24T14:30:00Z'
        };

        beforeEach(() => {
            IntegrationLog.create.mockResolvedValue({ id: 1 });
            IntegrationLog.updateStatus.mockResolvedValue({ id: 1 });
            isValidBuildingEvent.mockImplementation(e =>
                ['building.created', 'building.updated', 'building.deleted'].includes(e)
            );
        });

        it('creates a new building on building.created when not exists', async () => {
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(basePayload);

            expect(Building.findByExternalId).toHaveBeenCalled();
            expect(Building.createFromUK).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Дом 42', address: 'ул. Навои, 42', town: 'Ташкент' })
            );
        });

        it('updates existing building on building.created (idempotent)', async () => {
            Building.findByExternalId.mockResolvedValue({ building_id: 5 });
            Building.updateFromUK.mockResolvedValue({ building_id: 5 });

            await service.handleBuildingWebhook(basePayload);

            expect(Building.updateFromUK).toHaveBeenCalledWith(5, expect.objectContaining({ name: 'Дом 42' }));
            expect(Building.createFromUK).not.toHaveBeenCalled();
        });

        it('updates building on building.updated', async () => {
            const payload = { ...basePayload, event: 'building.updated' };
            Building.findByExternalId.mockResolvedValue({ building_id: 5 });
            Building.updateFromUK.mockResolvedValue({ building_id: 5 });

            await service.handleBuildingWebhook(payload);

            expect(Building.updateFromUK).toHaveBeenCalledWith(5, expect.objectContaining({ name: 'Дом 42' }));
        });

        it('creates building on building.updated if not exists (late-arriving create)', async () => {
            const payload = { ...basePayload, event: 'building.updated' };
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(payload);

            expect(Building.createFromUK).toHaveBeenCalled();
        });

        it('soft-deletes building on building.deleted', async () => {
            const payload = { ...basePayload, event: 'building.deleted' };
            Building.findByExternalId.mockResolvedValue({ building_id: 5 });
            Building.softDelete.mockResolvedValue({ building_id: 5 });

            await service.handleBuildingWebhook(payload);

            expect(Building.softDelete).toHaveBeenCalledWith(5);
        });

        it('ignores building.deleted when building not found', async () => {
            const payload = { ...basePayload, event: 'building.deleted' };
            Building.findByExternalId.mockResolvedValue(null);

            await service.handleBuildingWebhook(payload);

            expect(Building.softDelete).not.toHaveBeenCalled();
        });

        it('creates pending log entry then updates to success', async () => {
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(basePayload);

            expect(IntegrationLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    direction: 'from_uk',
                    entity_type: 'building',
                    action: 'building.created',
                    status: 'pending'
                })
            );
            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(1, 'success');
        });

        it('updates log to error status and re-throws when processing fails', async () => {
            Building.findByExternalId.mockRejectedValue(new Error('DB down'));

            await expect(service.handleBuildingWebhook(basePayload)).rejects.toThrow('DB down');

            expect(IntegrationLog.create).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'pending' })
            );
            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(1, 'error', 'DB down');
        });

        it('silently skips when concurrent duplicate event_id (UNIQUE violation)', async () => {
            const uniqueError = new Error('duplicate key');
            uniqueError.code = '23505';
            IntegrationLog.create.mockRejectedValue(uniqueError);

            await service.handleBuildingWebhook(basePayload);

            expect(Building.findByExternalId).not.toHaveBeenCalled();
        });

        it('throws on invalid event type', async () => {
            isValidBuildingEvent.mockReturnValue(false);
            const payload = { ...basePayload, event: 'building.migrated' };

            await expect(service.handleBuildingWebhook(payload))
                .rejects.toThrow('Invalid building event type');
        });
    });
});
