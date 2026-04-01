'use strict';

/**
 * Tests for UKIntegrationService Phase 3-5 additions:
 * resolveBuildingIds, sendAlertToUK, handleRequestWebhook,
 * getRequestCounts, getBuildingRequests, invalidateRequestCache.
 */

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
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn()
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByAlertAndBuilding: jest.fn(),
    create: jest.fn(),
    markSent: jest.fn(),
    findByRequestNumber: jest.fn(),
    updateStatus: jest.fn(),
    areAllTerminal: jest.fn()
}));
jest.mock('../../../src/clients/ukApiClient', () => ({
    createRequest: jest.fn(),
    get: jest.fn()
}));
jest.mock('../../../src/services/alertService', () => ({
    resolveAlert: jest.fn()
}));
jest.mock('../../../src/utils/webhookValidation', () => ({
    isValidBuildingEvent: jest.fn()
}));

const db = require('../../../src/config/database');
const IntegrationConfig = require('../../../src/models/IntegrationConfig');
const IntegrationLog = require('../../../src/models/IntegrationLog');
const AlertRule = require('../../../src/models/AlertRule');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const ukApiClient = require('../../../src/clients/ukApiClient');
const alertService = require('../../../src/services/alertService');
const logger = require('../../../src/utils/logger');
const service = require('../../../src/services/ukIntegrationService');

describe('UKIntegrationService — Phase 3-5', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        service.invalidateRequestCache();
    });

    // -------------------------------------------------------------------------
    // resolveBuildingIds
    // -------------------------------------------------------------------------
    describe('resolveBuildingIds()', () => {
        it('returns buildings for transformer infrastructure type', async () => {
            const mockRows = [
                { building_id: 1, external_id: 'ext-1' },
                { building_id: 2, external_id: 'ext-2' }
            ];
            db.query.mockResolvedValue({ rows: mockRows });

            const result = await service.resolveBuildingIds(10, 'transformer');

            expect(result).toEqual(mockRows);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('primary_transformer_id'),
                [10]
            );
        });

        it('returns buildings for controller infrastructure type', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 5, external_id: 'ext-5' }] });

            const result = await service.resolveBuildingIds(3, 'controller');

            expect(result).toHaveLength(1);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('controller_id'),
                [3]
            );
        });

        it('returns buildings for water_source infrastructure type', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 7, external_id: 'ext-7' }] });

            const result = await service.resolveBuildingIds(4, 'water_source');

            expect(result).toHaveLength(1);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('cold_water_source_id'),
                [4]
            );
        });

        it('returns buildings for heat_source infrastructure type', async () => {
            db.query.mockResolvedValue({ rows: [{ building_id: 8, external_id: 'ext-8' }] });

            const result = await service.resolveBuildingIds(6, 'heat_source');

            expect(result).toHaveLength(1);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('heat_source_id'),
                [6]
            );
        });

        it('returns empty array and logs warning for unknown infrastructure type', async () => {
            const result = await service.resolveBuildingIds(1, 'unknown_type');

            expect(result).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining("unknown infrastructure_type 'unknown_type'")
            );
            expect(db.query).not.toHaveBeenCalled();
        });

        it('returns empty array on database error', async () => {
            db.query.mockRejectedValue(new Error('DB connection lost'));

            const result = await service.resolveBuildingIds(10, 'transformer');

            expect(result).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('resolveBuildingIds error')
            );
        });
    });

    // -------------------------------------------------------------------------
    // sendAlertToUK
    // -------------------------------------------------------------------------
    describe('sendAlertToUK()', () => {
        const alertData = {
            alert_id: 100,
            type: 'voltage_drop',
            severity: 'critical',
            infrastructure_id: 10,
            infrastructure_type: 'transformer',
            message: 'Voltage dropped below threshold'
        };

        it('does nothing when integration is disabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(false);

            await service.sendAlertToUK(alertData);

            expect(AlertRule.findByTypeAndSeverity).not.toHaveBeenCalled();
        });

        it('does nothing when no matching alert rule found', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue(null);

            await service.sendAlertToUK(alertData);

            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('no matching rule')
            );
        });

        it('does nothing when no buildings resolved', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({ rows: [] });

            await service.sendAlertToUK(alertData);

            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('no buildings found')
            );
        });

        it('skips buildings without external_id', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, external_id: null }]
            });

            await service.sendAlertToUK(alertData);

            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('has no external_id')
            );
            expect(ukApiClient.createRequest).not.toHaveBeenCalled();
        });

        it('skips buildings already sent (existing mapping with sent status)', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, external_id: 'ext-1' }]
            });
            AlertRequestMap.findByAlertAndBuilding.mockResolvedValue({
                id: 50,
                status: 'sent',
                idempotency_key: 'key-1'
            });

            await service.sendAlertToUK(alertData);

            expect(ukApiClient.createRequest).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('already sent')
            );
        });

        it('retries pending mapping without creating a new one', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, external_id: 'ext-1' }]
            });
            AlertRequestMap.findByAlertAndBuilding.mockResolvedValue({
                id: 50,
                status: 'pending',
                idempotency_key: 'existing-key'
            });
            ukApiClient.createRequest.mockResolvedValue({ request_number: 'REQ-001' });
            AlertRequestMap.markSent.mockResolvedValue({});
            IntegrationLog.create.mockResolvedValue({ id: 1 });

            await service.sendAlertToUK(alertData);

            expect(AlertRequestMap.create).not.toHaveBeenCalled();
            expect(ukApiClient.createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    building_external_id: 'ext-1',
                    idempotency_key: 'existing-key'
                })
            );
            expect(AlertRequestMap.markSent).toHaveBeenCalledWith(50, 'REQ-001');
        });

        it('creates new mapping and sends to UK API for new alert', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, external_id: 'ext-1' }]
            });
            AlertRequestMap.findByAlertAndBuilding.mockResolvedValue(null);
            AlertRequestMap.create.mockResolvedValue({
                id: 60,
                idempotency_key: 'new-key'
            });
            ukApiClient.createRequest.mockResolvedValue({ request_number: 'REQ-002' });
            AlertRequestMap.markSent.mockResolvedValue({});
            IntegrationLog.create.mockResolvedValue({ id: 2 });

            await service.sendAlertToUK(alertData);

            expect(AlertRequestMap.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    infrasafe_alert_id: 100,
                    building_external_id: 'ext-1',
                    status: 'pending'
                })
            );
            expect(ukApiClient.createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    building_external_id: 'ext-1',
                    category: 'electricity',
                    urgency: 'high',
                    description: 'Voltage dropped below threshold'
                })
            );
            expect(AlertRequestMap.markSent).toHaveBeenCalledWith(60, 'REQ-002');
        });

        it('handles race condition when create returns null (concurrent insert)', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, external_id: 'ext-1' }]
            });
            // First call returns null (no existing), second returns null on create
            AlertRequestMap.findByAlertAndBuilding
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 70, status: 'sent', idempotency_key: 'race-key' });
            AlertRequestMap.create.mockResolvedValue(null);

            await service.sendAlertToUK(alertData);

            // Should skip because race winner has status 'sent'
            expect(ukApiClient.createRequest).not.toHaveBeenCalled();
        });

        it('handles race condition: create null, race winner pending', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, external_id: 'ext-1' }]
            });
            AlertRequestMap.findByAlertAndBuilding
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 70, status: 'pending', idempotency_key: 'race-key' });
            AlertRequestMap.create.mockResolvedValue(null);
            ukApiClient.createRequest.mockResolvedValue({ request_number: 'REQ-RACE' });
            AlertRequestMap.markSent.mockResolvedValue({});
            IntegrationLog.create.mockResolvedValue({ id: 3 });

            await service.sendAlertToUK(alertData);

            expect(ukApiClient.createRequest).toHaveBeenCalledWith(
                expect.objectContaining({ idempotency_key: 'race-key' })
            );
            expect(AlertRequestMap.markSent).toHaveBeenCalledWith(70, 'REQ-RACE');
        });

        it('logs error per building but continues with others on per-building failure', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [
                    { building_id: 1, external_id: 'ext-1' },
                    { building_id: 2, external_id: 'ext-2' }
                ]
            });
            AlertRequestMap.findByAlertAndBuilding.mockResolvedValue(null);
            AlertRequestMap.create
                .mockRejectedValueOnce(new Error('DB constraint error'))
                .mockResolvedValueOnce({ id: 80, idempotency_key: 'key-2' });
            ukApiClient.createRequest.mockResolvedValue({ request_number: 'REQ-003' });
            AlertRequestMap.markSent.mockResolvedValue({});
            IntegrationLog.create.mockResolvedValue({ id: 4 });

            await service.sendAlertToUK(alertData);

            // First building fails, second should succeed
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('failed for building 1')
            );
            expect(ukApiClient.createRequest).toHaveBeenCalledTimes(1);
        });

        it('does not throw on top-level error (graceful degradation)', async () => {
            IntegrationConfig.isEnabled.mockRejectedValue(new Error('Total failure'));

            await expect(service.sendAlertToUK(alertData)).resolves.toBeUndefined();

            // isEnabled catches its own error and returns false, so sendAlertToUK returns early.
            // The error is logged by isEnabled, not sendAlertToUK.
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('isEnabled error')
            );
        });
    });

    // -------------------------------------------------------------------------
    // handleRequestWebhook
    // -------------------------------------------------------------------------
    describe('handleRequestWebhook()', () => {
        const basePayload = {
            event_id: 'aabbccdd-1122-3344-5566-778899001122',
            event: 'request.status_changed',
            request: {
                request_number: 'REQ-100',
                status: 'Принято'
            }
        };

        beforeEach(() => {
            IntegrationLog.create.mockResolvedValue({ id: 10 });
            IntegrationLog.updateStatus.mockResolvedValue({});
        });

        it('creates pending log entry and invalidates cache', async () => {
            AlertRequestMap.findByRequestNumber.mockResolvedValue(null);

            await service.handleRequestWebhook(basePayload);

            expect(IntegrationLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_id: basePayload.event_id,
                    direction: 'from_uk',
                    entity_type: 'request',
                    status: 'pending'
                })
            );
        });

        it('skips on duplicate event_id (UNIQUE violation)', async () => {
            const uniqueError = new Error('duplicate key');
            uniqueError.code = '23505';
            IntegrationLog.create.mockRejectedValue(uniqueError);

            await service.handleRequestWebhook(basePayload);

            expect(AlertRequestMap.findByRequestNumber).not.toHaveBeenCalled();
        });

        it('re-throws non-UNIQUE log creation errors', async () => {
            IntegrationLog.create.mockRejectedValue(new Error('DB down'));

            await expect(
                service.handleRequestWebhook(basePayload)
            ).rejects.toThrow('DB down');
        });

        it('handles request.created event — logs only, no mapping lookup', async () => {
            const payload = {
                ...basePayload,
                event: 'request.created'
            };

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.findByRequestNumber).not.toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('request.created')
            );
        });

        it('updates mapping to resolved on terminal status (Принято)', async () => {
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 20,
                infrasafe_alert_id: 200
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(false);

            await service.handleRequestWebhook(basePayload);

            expect(AlertRequestMap.updateStatus).toHaveBeenCalledWith(20, 'resolved');
        });

        it('updates mapping to active on non-terminal status', async () => {
            const payload = {
                ...basePayload,
                request: { request_number: 'REQ-100', status: 'В работе' }
            };
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 20,
                infrasafe_alert_id: 200
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.updateStatus).toHaveBeenCalledWith(20, 'active');
        });

        it('auto-resolves alert when all requests are terminal', async () => {
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 20,
                infrasafe_alert_id: 200
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(true);
            alertService.resolveAlert.mockResolvedValue({});

            await service.handleRequestWebhook(basePayload);

            expect(alertService.resolveAlert).toHaveBeenCalledWith(200, null);
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('auto-resolved alert 200')
            );
        });

        it('logs error but does not throw when auto-resolve fails', async () => {
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 20,
                infrasafe_alert_id: 200
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(true);
            alertService.resolveAlert.mockRejectedValue(new Error('Alert not found'));

            await service.handleRequestWebhook(basePayload);

            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('failed to resolve alert 200')
            );
        });

        it('does nothing when no mapping found for request number (manual UK request)', async () => {
            AlertRequestMap.findByRequestNumber.mockResolvedValue(null);

            await service.handleRequestWebhook(basePayload);

            expect(AlertRequestMap.updateStatus).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('no mapping for request REQ-100')
            );
        });

        it('handles terminal status Отменена', async () => {
            const payload = {
                ...basePayload,
                request: { request_number: 'REQ-100', status: 'Отменена' }
            };
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 30,
                infrasafe_alert_id: 300
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(false);

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.updateStatus).toHaveBeenCalledWith(30, 'resolved');
        });

        it('marks log as error and re-throws on processing failure', async () => {
            AlertRequestMap.findByRequestNumber.mockRejectedValue(new Error('Query failed'));

            await expect(
                service.handleRequestWebhook(basePayload)
            ).rejects.toThrow('Query failed');

            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(
                10, 'error', 'Query failed'
            );
        });

        it('truncates entity_id to 50 characters', async () => {
            const longNumber = 'R'.repeat(60);
            const payload = {
                ...basePayload,
                request: { request_number: longNumber, status: 'В работе' }
            };
            AlertRequestMap.findByRequestNumber.mockResolvedValue(null);

            await service.handleRequestWebhook(payload);

            expect(IntegrationLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    entity_id: longNumber.slice(0, 50)
                })
            );
        });
    });

    // -------------------------------------------------------------------------
    // getRequestCounts
    // -------------------------------------------------------------------------
    describe('getRequestCounts()', () => {
        it('returns empty object when integration is disabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(false);

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: {} });
            expect(ukApiClient.get).not.toHaveBeenCalled();
        });

        it('fetches from UK API when cache is empty', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue({ buildings: { 'ext-1': 5 } });

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: { 'ext-1': 5 } });
            expect(ukApiClient.get).toHaveBeenCalledWith('/requests/counts-by-building');
        });

        it('returns cached result within TTL window', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue({ buildings: { 'ext-1': 5 } });

            // First call populates cache
            await service.getRequestCounts();
            // Second call should use cache
            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: { 'ext-1': 5 } });
            expect(ukApiClient.get).toHaveBeenCalledTimes(1);
        });

        it('returns empty object on API error', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockRejectedValue(new Error('API timeout'));

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: {} });
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('getRequestCounts error')
            );
        });

        it('returns empty object when API returns null', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue(null);

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: {} });
        });
    });

    // -------------------------------------------------------------------------
    // getBuildingRequests
    // -------------------------------------------------------------------------
    describe('getBuildingRequests()', () => {
        const validUUID = '550e8400-e29b-41d4-a716-446655440000';

        it('returns empty when externalId is null', async () => {
            const result = await service.getBuildingRequests(null);

            expect(result).toEqual({ requests: [] });
        });

        it('returns empty for invalid UUID format', async () => {
            const result = await service.getBuildingRequests('not-a-uuid');

            expect(result).toEqual({ requests: [] });
        });

        it('returns empty when integration is disabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(false);

            const result = await service.getBuildingRequests(validUUID);

            expect(result).toEqual({ requests: [] });
            expect(ukApiClient.get).not.toHaveBeenCalled();
        });

        it('fetches requests from UK API with default limit', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue({ requests: [{ id: 1, status: 'open' }] });

            const result = await service.getBuildingRequests(validUUID);

            expect(result).toEqual({ requests: [{ id: 1, status: 'open' }] });
            expect(ukApiClient.get).toHaveBeenCalledWith(
                expect.stringContaining(`external_id=${encodeURIComponent(validUUID)}`)
            );
            expect(ukApiClient.get).toHaveBeenCalledWith(
                expect.stringContaining('limit=3')
            );
        });

        it('fetches requests with custom limit', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue({ requests: [] });

            await service.getBuildingRequests(validUUID, 10);

            expect(ukApiClient.get).toHaveBeenCalledWith(
                expect.stringContaining('limit=10')
            );
        });

        it('returns empty on API error', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockRejectedValue(new Error('Network error'));

            const result = await service.getBuildingRequests(validUUID);

            expect(result).toEqual({ requests: [] });
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('getBuildingRequests error')
            );
        });

        it('returns empty when API returns null', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue(null);

            const result = await service.getBuildingRequests(validUUID);

            expect(result).toEqual({ requests: [] });
        });
    });

    // -------------------------------------------------------------------------
    // invalidateRequestCache
    // -------------------------------------------------------------------------
    describe('invalidateRequestCache()', () => {
        it('clears the internal request counts cache', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue({ buildings: { 'ext-1': 3 } });

            // Populate cache
            await service.getRequestCounts();
            expect(ukApiClient.get).toHaveBeenCalledTimes(1);

            // Invalidate
            service.invalidateRequestCache();

            // Next call should hit API again
            await service.getRequestCounts();
            expect(ukApiClient.get).toHaveBeenCalledTimes(2);
        });

        it('resets cache time to 0', () => {
            service._requestCountsCacheTime = Date.now();
            service._requestCountsCache = { buildings: {} };

            service.invalidateRequestCache();

            expect(service._requestCountsCache).toBeNull();
            expect(service._requestCountsCacheTime).toBe(0);
        });
    });
});
