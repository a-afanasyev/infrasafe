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
    isValidBuildingEvent: jest.fn(),
    isValidUUID: jest.fn(),
    validateCoordinate: jest.fn(() => ({ ok: true }))
}));

// Require after mocks are set up
const IntegrationConfig = require('../../../src/models/IntegrationConfig');
const IntegrationLog = require('../../../src/models/IntegrationLog');
const logger = require('../../../src/utils/logger');
const service = require('../../../src/services/ukIntegrationService');

const Building = require('../../../src/models/Building');
const { isValidBuildingEvent, isValidUUID, validateCoordinate } = require('../../../src/utils/webhookValidation');

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
            // [P0-2] Clear nonce-dedup state between tests so deterministic
            // payloads with the same timestamp don't get rejected as replays.
            service._resetSeenSignatures();
        });

        afterEach(() => {
            if (originalSecret === undefined) {
                delete process.env.UK_WEBHOOK_SECRET;
            } else {
                process.env.UK_WEBHOOK_SECRET = originalSecret;
            }
        });

        // [Sprint 4] verifyWebhookSignature is async.
        it('returns true for a valid signature', async () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const header = buildHeader(BODY, SECRET);
            await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(true);
        });

        it('returns false for an invalid (tampered) signature', async () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const header = buildHeader(BODY, 'wrong-secret');
            await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(false);
        });

        it('returns false when timestamp is older than 5 minutes', async () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const expiredTimestamp = Math.floor(Date.now() / 1000) - 301;
            const header = buildHeader(BODY, SECRET, expiredTimestamp);
            await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(false);
        });

        it('returns false when UK_WEBHOOK_SECRET is not configured', async () => {
            delete process.env.UK_WEBHOOK_SECRET;
            const header = buildHeader(BODY, SECRET);
            await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(false);
            expect(logger.error).toHaveBeenCalled();
        });

        it('returns false when header is missing t field', async () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const timestamp = Math.floor(Date.now() / 1000);
            const sig = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${BODY}`).digest('hex');
            await expect(service.verifyWebhookSignature(BODY, `v1=${sig}`)).resolves.toBe(false);
        });

        it('returns false when header is missing v1 field', async () => {
            process.env.UK_WEBHOOK_SECRET = SECRET;
            const timestamp = Math.floor(Date.now() / 1000);
            await expect(service.verifyWebhookSignature(BODY, `t=${timestamp}`)).resolves.toBe(false);
        });

        // [P0-2] Nonce/replay protection cases — in-memory branch
        // (Redis not configured in test env → falls through to Map).
        describe('[P0-2] replay protection within timestamp window', () => {
            it('rejects a second submission of the same valid signature', async () => {
                process.env.UK_WEBHOOK_SECRET = SECRET;
                const header = buildHeader(BODY, SECRET);

                await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(true);
                await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(false);
            });

            it('logs a warn on replay attempt', async () => {
                process.env.UK_WEBHOOK_SECRET = SECRET;
                const header = buildHeader(BODY, SECRET);

                await service.verifyWebhookSignature(BODY, header);
                logger.warn.mockClear();
                await service.verifyWebhookSignature(BODY, header);

                expect(logger.warn).toHaveBeenCalled();
                const msgs = logger.warn.mock.calls.map(c => c[0]);
                expect(msgs.some(m => typeof m === 'string' && m.includes('replay'))).toBe(true);
            });

            it('accepts a different signature with the same timestamp', async () => {
                process.env.UK_WEBHOOK_SECRET = SECRET;
                const ts = Math.floor(Date.now() / 1000);
                const body1 = JSON.stringify({ event: 'a' });
                const body2 = JSON.stringify({ event: 'b' });
                const sig1 = crypto.createHmac('sha256', SECRET).update(`${ts}.${body1}`).digest('hex');
                const sig2 = crypto.createHmac('sha256', SECRET).update(`${ts}.${body2}`).digest('hex');

                await expect(service.verifyWebhookSignature(body1, `t=${ts},v1=${sig1}`)).resolves.toBe(true);
                await expect(service.verifyWebhookSignature(body2, `t=${ts},v1=${sig2}`)).resolves.toBe(true);
            });

            it('accepts a replay once the recorded entry has expired', async () => {
                process.env.UK_WEBHOOK_SECRET = SECRET;
                const header = buildHeader(BODY, SECRET);

                await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(true);

                const seen = service._seenSignatures;
                for (const [k] of seen) {
                    seen.set(k, Date.now() - 1);
                }

                await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(true);
            });

            it('does not record a signature when timestamp window check fails', async () => {
                process.env.UK_WEBHOOK_SECRET = SECRET;
                const sizeBefore = service._seenSignatures.size;
                const expired = Math.floor(Date.now() / 1000) - 600;
                const header = buildHeader(BODY, SECRET, expired);

                await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(false);
                expect(service._seenSignatures.size).toBe(sizeBefore);
            });

            it('does not record a signature when HMAC verification fails', async () => {
                process.env.UK_WEBHOOK_SECRET = SECRET;
                const sizeBefore = service._seenSignatures.size;
                const header = buildHeader(BODY, 'wrong-secret');

                await expect(service.verifyWebhookSignature(BODY, header)).resolves.toBe(false);
                expect(service._seenSignatures.size).toBe(sizeBefore);
            });
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
            // Default: no external_id in payload, isValidUUID returns false.
            // Specific CR-2 tests override this per scenario.
            isValidUUID.mockReturnValue(false);
            validateCoordinate.mockReturnValue({ ok: true });
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

        it('passes latitude/longitude to createFromUK when provided in payload', async () => {
            const payload = {
                ...basePayload,
                building: { ...basePayload.building, latitude: 41.349151, longitude: 69.246436 }
            };
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(payload);

            expect(Building.createFromUK).toHaveBeenCalledWith(
                expect.objectContaining({ latitude: 41.349151, longitude: 69.246436 })
            );
        });

        it('passes null coords when payload omits them (backward compat)', async () => {
            // basePayload has no latitude/longitude
            Building.findByExternalId.mockResolvedValue(null);
            Building.createFromUK.mockResolvedValue({ building_id: 18 });

            await service.handleBuildingWebhook(basePayload);

            expect(Building.createFromUK).toHaveBeenCalledWith(
                expect.objectContaining({ latitude: null, longitude: null })
            );
        });

        it('passes coords to updateFromUK on building.updated', async () => {
            const payload = {
                ...basePayload,
                event: 'building.updated',
                building: { ...basePayload.building, latitude: 42.0, longitude: 70.0 }
            };
            Building.findByExternalId.mockResolvedValue({ building_id: 5 });
            Building.updateFromUK.mockResolvedValue({ building_id: 5 });

            await service.handleBuildingWebhook(payload);

            expect(Building.updateFromUK).toHaveBeenCalledWith(
                5,
                expect.objectContaining({ latitude: 42.0, longitude: 70.0 })
            );
        });

        it('rejects payload with out-of-range latitude (validateCoordinate fails)', async () => {
            validateCoordinate.mockImplementationOnce(() => ({ ok: false, message: 'Invalid latitude: must be in [-90, 90]' }));
            const payload = {
                ...basePayload,
                building: { ...basePayload.building, latitude: 999, longitude: 0 }
            };
            Building.findByExternalId.mockResolvedValue(null);

            await expect(service.handleBuildingWebhook(payload)).rejects.toThrow(/Invalid latitude/);
            expect(Building.createFromUK).not.toHaveBeenCalled();
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

        // -------------------------------------------------------------------
        // [Sprint 6 / CR-2] Deterministic external_id from UK payload
        // -------------------------------------------------------------------
        describe('[CR-2] external_id from payload', () => {
            const ukExternalId = 'deadbeef-1234-5678-9abc-def012345678';

            it('uses payload.building.external_id when it is a valid UUID', async () => {
                isValidUUID.mockImplementation(v => v === ukExternalId);
                Building.findByExternalId.mockResolvedValue(null);
                Building.createFromUK.mockResolvedValue({ building_id: 18 });

                const payload = {
                    ...basePayload,
                    building: { ...basePayload.building, external_id: ukExternalId }
                };

                await service.handleBuildingWebhook(payload);

                expect(Building.findByExternalId).toHaveBeenCalledWith(ukExternalId);
                expect(Building.createFromUK).toHaveBeenCalledWith(
                    expect.objectContaining({ external_id: ukExternalId })
                );
            });

            it('falls back to internal hash when external_id is missing', async () => {
                isValidUUID.mockReturnValue(false);
                Building.findByExternalId.mockResolvedValue(null);
                Building.createFromUK.mockResolvedValue({ building_id: 18 });

                // basePayload has no external_id
                await service.handleBuildingWebhook(basePayload);

                // findByExternalId called with internal hash — a UUID-shaped
                // string but NOT the one UK would produce.
                const calledWith = Building.findByExternalId.mock.calls[0][0];
                expect(calledWith).toMatch(
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
                );
                expect(calledWith).not.toBe(ukExternalId);
            });

            it('falls back to internal hash AND warns when external_id is malformed', async () => {
                isValidUUID.mockReturnValue(false);
                Building.findByExternalId.mockResolvedValue(null);
                Building.createFromUK.mockResolvedValue({ building_id: 18 });

                const payload = {
                    ...basePayload,
                    building: { ...basePayload.building, external_id: 'not-a-uuid' }
                };

                await service.handleBuildingWebhook(payload);

                expect(logger.warn).toHaveBeenCalledWith(
                    expect.stringContaining('invalid building.external_id')
                );
                expect(Building.findByExternalId).toHaveBeenCalled();
            });

            it('does not warn when external_id is simply absent', async () => {
                isValidUUID.mockReturnValue(false);
                Building.findByExternalId.mockResolvedValue(null);
                Building.createFromUK.mockResolvedValue({ building_id: 18 });

                await service.handleBuildingWebhook(basePayload);

                expect(logger.warn).not.toHaveBeenCalledWith(
                    expect.stringContaining('invalid building.external_id')
                );
            });
        });
    });
});
