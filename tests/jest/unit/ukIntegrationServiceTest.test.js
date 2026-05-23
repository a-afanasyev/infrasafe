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
    findByIdempotencyKey: jest.fn(),
    updateStatus: jest.fn(),
    areAllTerminal: jest.fn()
}));
// [Sprint 9 / FIX-007] ukApiClient is gone. Outbound now goes through
// UkOutbox.enqueue (drain worker handles the actual UK POST in
// ukOutboxService); counters now query alert_request_map via db.query.
jest.mock('../../../src/models/UkOutbox', () => ({
    enqueue: jest.fn()
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
const UkOutbox = require('../../../src/models/UkOutbox');
const alertService = require('../../../src/services/alertService');
const logger = require('../../../src/utils/logger');
const service = require('../../../src/services/ukIntegrationService');

describe('UKIntegrationService — Phase 3-5', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        service.invalidateRequestCache();
        process.env = { ...ORIGINAL_ENV };
        // Sprint 9 / FIX-007: most sendAlertToUK tests assume the webhook
        // sender is enabled. Tests for the dormant path explicitly clear
        // this in their own setup.
        process.env.UK_USE_WEBHOOK_SENDER = 'true';
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
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
            expect(UkOutbox.enqueue).not.toHaveBeenCalled();
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

            expect(UkOutbox.enqueue).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('already sent')
            );
        });

        it('retries pending mapping by enqueueing with existing idempotency_key', async () => {
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
            UkOutbox.enqueue.mockResolvedValue({ id: 1, event_id: 'existing-key' });
            IntegrationLog.create.mockResolvedValue({ id: 1 });

            await service.sendAlertToUK(alertData);

            expect(AlertRequestMap.create).not.toHaveBeenCalled();
            // Sprint 9: drain worker (not alertForwarder) will call
            // AlertRequestMap.markSent after UK responds — assert NOT here.
            expect(AlertRequestMap.markSent).not.toHaveBeenCalled();
            expect(UkOutbox.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_id: 'existing-key',
                    payload_body: expect.any(String)
                })
            );
            const enqueueCall = UkOutbox.enqueue.mock.calls[0][0];
            const parsed = JSON.parse(enqueueCall.payload_body);
            expect(parsed.event_id).toBe('existing-key');
            expect(parsed.event).toBe('alert.created');
            expect(parsed.alert.external_id).toBe('ext-1');
        });

        it('creates new mapping and enqueues outbox event for new alert', async () => {
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
            UkOutbox.enqueue.mockResolvedValue({ id: 2, event_id: 'new-key' });
            IntegrationLog.create.mockResolvedValue({ id: 2 });

            await service.sendAlertToUK(alertData);

            expect(AlertRequestMap.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    infrasafe_alert_id: 100,
                    building_external_id: 'ext-1',
                    status: 'pending'
                })
            );
            // Sprint 9: payload carries the full Phase 2 alert envelope.
            // category/urgency are NOT in payload — UK derives them from
            // type+severity per O3.
            const enqueueCall = UkOutbox.enqueue.mock.calls[0][0];
            const parsed = JSON.parse(enqueueCall.payload_body);
            expect(parsed.alert.external_id).toBe('ext-1');
            expect(parsed.alert.type).toBe('voltage_drop');
            expect(parsed.alert.severity).toBe('critical');
            expect(parsed.alert.message).toBe('Voltage dropped below threshold');
            // markSent moves to drain worker, not alertForwarder
            expect(AlertRequestMap.markSent).not.toHaveBeenCalled();
        });

        it('does not enqueue when UK_USE_WEBHOOK_SENDER is disabled (dormant)', async () => {
            // Sprint 9 / D5: prod default keeps the sender dormant.
            delete process.env.UK_USE_WEBHOOK_SENDER;
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            AlertRule.findByTypeAndSeverity.mockResolvedValue({
                uk_category: 'electricity',
                uk_urgency: 'high'
            });
            db.query.mockResolvedValue({
                rows: [{ building_id: 1, external_id: 'ext-1' }]
            });
            AlertRequestMap.findByAlertAndBuilding.mockResolvedValue(null);
            AlertRequestMap.create.mockResolvedValue({ id: 60, idempotency_key: 'k' });

            await service.sendAlertToUK(alertData);

            // Mapping is created (so flag-flip catches up) but no enqueue.
            expect(AlertRequestMap.create).toHaveBeenCalled();
            expect(UkOutbox.enqueue).not.toHaveBeenCalled();
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
            expect(UkOutbox.enqueue).not.toHaveBeenCalled();
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
            UkOutbox.enqueue.mockResolvedValue({ id: 3, event_id: 'race-key' });
            IntegrationLog.create.mockResolvedValue({ id: 3 });

            await service.sendAlertToUK(alertData);

            expect(UkOutbox.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({ event_id: 'race-key' })
            );
            // markSent moves to drain worker
            expect(AlertRequestMap.markSent).not.toHaveBeenCalled();
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
            UkOutbox.enqueue.mockResolvedValue({ id: 4, event_id: 'key-2' });
            IntegrationLog.create.mockResolvedValue({ id: 4 });

            await service.sendAlertToUK(alertData);

            // First building fails, second should succeed
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('failed for building 1')
            );
            expect(UkOutbox.enqueue).toHaveBeenCalledTimes(1);
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

        // -------------------------------------------------------------------
        // [Sprint 9.1 / FIX-007] request.created matching by source_event_id.
        //
        // UK Phase 2 emits `request.created` with `source_event_id` echoed
        // from our `event_id` (= AlertRequestMap.idempotency_key). We must
        // match the mapping and fill `uk_request_number` so subsequent
        // `request.status_changed` events can find it via findByRequestNumber.
        // -------------------------------------------------------------------

        it('request.created with source_event_id → matches mapping and fills uk_request_number', async () => {
            const payload = {
                ...basePayload,
                event: 'request.created',
                request: {
                    request_number: 'REQ-200',
                    source_event_id: 'idemp-key-abc'
                }
            };
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue({
                id: 77,
                idempotency_key: 'idemp-key-abc',
                infrasafe_alert_id: 555
            });
            AlertRequestMap.markSent.mockResolvedValue({});

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.findByIdempotencyKey).toHaveBeenCalledWith('idemp-key-abc');
            expect(AlertRequestMap.markSent).toHaveBeenCalledWith(77, 'REQ-200');
            // findByRequestNumber should NOT be called on request.created — only on status_changed
            expect(AlertRequestMap.findByRequestNumber).not.toHaveBeenCalled();
            // Integration log marked success (fall-through after request.created branch)
            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(10, 'success');
        });

        it('request.created without source_event_id → logs only, no mapping lookup (manual UK request)', async () => {
            const payload = {
                ...basePayload,
                event: 'request.created',
                request: { request_number: 'REQ-MANUAL-1' }
            };

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.findByIdempotencyKey).not.toHaveBeenCalled();
            expect(AlertRequestMap.markSent).not.toHaveBeenCalled();
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('manual UK request')
            );
            // Still marks log success — webhook was processed cleanly
            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(10, 'success');
        });

        it('request.created with unknown source_event_id → debug log, no markSent', async () => {
            const payload = {
                ...basePayload,
                event: 'request.created',
                request: {
                    request_number: 'REQ-STALE-1',
                    source_event_id: 'idemp-unknown'
                }
            };
            AlertRequestMap.findByIdempotencyKey.mockResolvedValue(null);

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.findByIdempotencyKey).toHaveBeenCalledWith('idemp-unknown');
            expect(AlertRequestMap.markSent).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('no AlertRequestMap for source_event_id')
            );
            // Still marks log success — webhook processed without errors
            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(10, 'success');
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

        // Phase 7: instead of directly calling alertService.resolveAlert,
        // ukIntegrationService now emits `uk.request.resolved` on the
        // central event bus; alertService subscribes to that event at
        // module-load time. These tests verify the event emission rather
        // than the downstream resolveAlert invocation (the alertService
        // listener is covered in alertServiceCoverage.test.js).
        it('emits uk.request.resolved when all requests are terminal', async () => {
            const alertEvents = require('../../../src/events/alertEvents');
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 20,
                infrasafe_alert_id: 200
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(true);

            const listener = jest.fn();
            alertEvents.once(alertEvents.EVENTS.UK_REQUEST_RESOLVED, listener);

            await service.handleRequestWebhook(basePayload);

            expect(listener).toHaveBeenCalledWith({ alertId: 200 });
        });

        it('does not emit uk.request.resolved when not all requests are terminal', async () => {
            const alertEvents = require('../../../src/events/alertEvents');
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 20,
                infrasafe_alert_id: 200
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(false);

            const listener = jest.fn();
            alertEvents.on(alertEvents.EVENTS.UK_REQUEST_RESOLVED, listener);

            await service.handleRequestWebhook(basePayload);
            alertEvents.off(alertEvents.EVENTS.UK_REQUEST_RESOLVED, listener);

            expect(listener).not.toHaveBeenCalled();
        });

        it('does nothing to mapping when no ARM found (manual UK request or stale)', async () => {
            // [Sprint 9.2.1] Earlier behavior: early return → integration_log stays pending.
            // New behavior: log debug, fall through to integration_log.success.
            AlertRequestMap.findByRequestNumber.mockResolvedValue(null);

            await service.handleRequestWebhook(basePayload);

            expect(AlertRequestMap.updateStatus).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('no mapping for request REQ-100')
            );
            // Sprint 9.2.1: log is now marked success even on no-mapping path
            expect(IntegrationLog.updateStatus).toHaveBeenCalledWith(10, 'success');
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

        // -------------------------------------------------------------------
        // [Sprint 9.2 / FIX-007] Accept `new_status` (UK Phase 2 payload
        // shape) as alias for `status` on request.status_changed events.
        //
        // UK ARCH-113 emits `{old_status, new_status}` — our Sprint 8 spec
        // defined a single `status` field. The validator + handler now
        // accept either; when both present, `new_status` wins.
        // -------------------------------------------------------------------

        it('accepts new_status field as alias for status (UK Phase 2 payload)', async () => {
            const payload = {
                ...basePayload,
                request: {
                    request_number: 'REQ-100',
                    old_status: 'В работе',
                    new_status: 'Принято'
                }
            };
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 40,
                infrasafe_alert_id: 400
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(false);

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.updateStatus).toHaveBeenCalledWith(40, 'resolved');
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('uk_status=Принято')
            );
        });

        it('prefers new_status over status when both are present', async () => {
            const payload = {
                ...basePayload,
                request: {
                    request_number: 'REQ-100',
                    status: 'В работе',           // legacy field — non-terminal
                    new_status: 'Принято'         // UK Phase 2 field — terminal
                }
            };
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 50,
                infrasafe_alert_id: 500
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});
            AlertRequestMap.areAllTerminal.mockResolvedValue(false);

            await service.handleRequestWebhook(payload);

            // new_status wins → terminal → resolved (not 'active' from status)
            expect(AlertRequestMap.updateStatus).toHaveBeenCalledWith(50, 'resolved');
        });

        it('non-terminal new_status updates mapping to active', async () => {
            const payload = {
                ...basePayload,
                request: {
                    request_number: 'REQ-100',
                    old_status: 'Новая',
                    new_status: 'В работе'
                }
            };
            AlertRequestMap.findByRequestNumber.mockResolvedValue({
                id: 60,
                infrasafe_alert_id: 600
            });
            AlertRequestMap.updateStatus.mockResolvedValue({});

            await service.handleRequestWebhook(payload);

            expect(AlertRequestMap.updateStatus).toHaveBeenCalledWith(60, 'active');
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
    //
    // Sprint 9 / FIX-007 O4: source switched from UK API to local
    // alert_request_map aggregation. UK confirmed they won't implement
    // /requests/counts-by-building; counts are built from inbound
    // request.* webhook events (with ARCH-113 under-count caveat).
    // -------------------------------------------------------------------------
    describe('getRequestCounts()', () => {
        it('returns empty object when integration is disabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(false);

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: {} });
            expect(db.query).not.toHaveBeenCalled();
        });

        it('aggregates open mappings from alert_request_map', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockResolvedValue({
                rows: [
                    { external_id: 'ext-1', count: 5 },
                    { external_id: 'ext-2', count: 2 }
                ]
            });

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: { 'ext-1': 5, 'ext-2': 2 } });
            const sql = db.query.mock.calls[0][0];
            expect(sql).toMatch(/FROM alert_request_map/);
            expect(sql).toMatch(/status IN \('pending', 'sent', 'active'\)/);
        });

        it('returns cached result within TTL window', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockResolvedValue({
                rows: [{ external_id: 'ext-1', count: 5 }]
            });

            await service.getRequestCounts();
            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: { 'ext-1': 5 } });
            // db.query called only once due to 60s cache
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        it('returns empty object on DB error (graceful degradation)', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockRejectedValue(new Error('DB timeout'));

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: {} });
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('getRequestCounts error')
            );
        });

        it('returns empty when no open mappings exist', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockResolvedValue({ rows: [] });

            const result = await service.getRequestCounts();

            expect(result).toEqual({ buildings: {} });
        });
    });

    // -------------------------------------------------------------------------
    // getBuildingRequests
    //
    // Sprint 9 / FIX-007 O4: same data source switch as getRequestCounts.
    // Returns AlertRequestMap rows in `{requests: [...]}` envelope.
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
            expect(db.query).not.toHaveBeenCalled();
        });

        it('queries alert_request_map with default limit 3', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockResolvedValue({
                rows: [{ id: 1, uk_request_number: 'REQ-1', status: 'sent' }]
            });

            const result = await service.getBuildingRequests(validUUID);

            expect(result.requests).toHaveLength(1);
            expect(result.requests[0]).toMatchObject({ uk_request_number: 'REQ-1' });
            const [sql, params] = db.query.mock.calls[0];
            expect(sql).toMatch(/FROM alert_request_map/);
            expect(sql).toMatch(/building_external_id = \$1/);
            expect(params).toEqual([validUUID, 3]);
        });

        it('respects custom limit', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockResolvedValue({ rows: [] });

            await service.getBuildingRequests(validUUID, 10);

            const params = db.query.mock.calls[0][1];
            expect(params[1]).toBe(10);
        });

        it('clamps limit to [1, 50]', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockResolvedValue({ rows: [] });

            await service.getBuildingRequests(validUUID, 999);
            expect(db.query.mock.calls[0][1][1]).toBe(50);

            db.query.mockClear();
            await service.getBuildingRequests(validUUID, 0);
            expect(db.query.mock.calls[0][1][1]).toBe(3); // 0 → NaN → default 3
        });

        it('returns empty on DB error (graceful degradation)', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockRejectedValue(new Error('Network error'));

            const result = await service.getBuildingRequests(validUUID);

            expect(result).toEqual({ requests: [] });
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('getBuildingRequests error')
            );
        });
    });

    // -------------------------------------------------------------------------
    // invalidateRequestCache
    // -------------------------------------------------------------------------
    describe('invalidateRequestCache()', () => {
        it('clears the internal request counts cache', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            db.query.mockResolvedValue({
                rows: [{ external_id: 'ext-1', count: 3 }]
            });

            await service.getRequestCounts();
            expect(db.query).toHaveBeenCalledTimes(1);

            service.invalidateRequestCache();

            await service.getRequestCounts();
            expect(db.query).toHaveBeenCalledTimes(2);
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
