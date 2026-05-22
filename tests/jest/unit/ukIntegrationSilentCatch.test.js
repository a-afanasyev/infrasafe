/**
 * [P1-5] Regression: integration_log write failures must be logged.
 *
 * Three callsites in ukIntegrationService.js previously had
 *   .catch(() => {})
 * which silently swallowed audit-log write failures — the integration
 * audit trail could rot with no operator signal.
 *
 * Now each catch logs via logger.warn(...) so failures are visible in
 * the operations log without crashing the surrounding flow.
 *
 * This test forces IntegrationLog.updateStatus to reject and asserts
 * logger.warn was called with a recognizable message.
 */

'use strict';

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
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByRequestNumber: jest.fn(),
    findByAlertAndBuilding: jest.fn(),
    create: jest.fn(),
    markSent: jest.fn(),
    updateStatus: jest.fn(),
    areAllTerminal: jest.fn()
}));
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn()
}));
// [Sprint 9 / FIX-007] ukApiClient is gone; outbound goes via UkOutbox.enqueue.
jest.mock('../../../src/models/UkOutbox', () => ({
    enqueue: jest.fn()
}));
jest.mock('../../../src/events/alertEvents', () => ({
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    EVENTS: {
        ALERT_CREATED: 'ALERT_CREATED',
        UK_REQUEST_RESOLVED: 'UK_REQUEST_RESOLVED',
        TRANSFORMER_CHECK: 'TRANSFORMER_CHECK'
    }
}));

const IntegrationLog = require('../../../src/models/IntegrationLog');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const logger = require('../../../src/utils/logger');
const service = require('../../../src/services/ukIntegrationService');

describe("[P1-5] integration_log catches no longer silent", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('handleRequestWebhook: updateStatus(\'success\') failure → logger.warn', async () => {
        const logEntryId = 4242;
        IntegrationLog.create.mockResolvedValue({ id: logEntryId });
        // Non-terminal status keeps deferredResolveAlertId=null and
        // makes the path reach the success-mark line.
        AlertRequestMap.findByRequestNumber.mockResolvedValue({
            id: 1, infrasafe_alert_id: 7
        });
        AlertRequestMap.updateStatus.mockResolvedValue(undefined);
        IntegrationLog.updateStatus.mockRejectedValueOnce(new Error('db is down'));

        await expect(service.handleRequestWebhook({
            event_id: 'evt-1',
            event: 'request.status_changed',
            request: { request_number: 'REQ-1', status: 'В работе' }
        })).resolves.toBeUndefined();

        // logger.warn must have been called referencing our integration_log id
        const warnCalls = logger.warn.mock.calls.map(c => c[0]);
        expect(warnCalls.some(msg =>
            typeof msg === 'string' &&
            msg.includes(String(logEntryId)) &&
            msg.includes('db is down')
        )).toBe(true);
    });

    test('handleRequestWebhook: updateStatus(\'error\') failure inside catch → logger.warn', async () => {
        const logEntryId = 9999;
        IntegrationLog.create.mockResolvedValue({ id: logEntryId });
        // Force the main try-block to throw so we land in the error path.
        AlertRequestMap.findByRequestNumber.mockRejectedValueOnce(
            new Error('mapping lookup failed')
        );
        // The error-mark updateStatus also fails → catch fires logger.warn.
        IntegrationLog.updateStatus.mockRejectedValueOnce(
            new Error('audit table locked')
        );

        await expect(service.handleRequestWebhook({
            event_id: 'evt-2',
            event: 'request.status_changed',
            request: { request_number: 'REQ-2', status: 'Принято' }
        })).rejects.toThrow('mapping lookup failed');

        const warnCalls = logger.warn.mock.calls.map(c => c[0]);
        expect(warnCalls.some(msg =>
            typeof msg === 'string' &&
            msg.includes(String(logEntryId)) &&
            msg.includes('audit table locked')
        )).toBe(true);
    });

    test('[Sprint 0.1 / HIGH-2] sendAlertToUK: logEvent failure inside catch → logger.warn', async () => {
        // Sprint 9 / FIX-007: outbound is now UkOutbox.enqueue, not
        // ukApiClient.createRequest. We force enqueue to throw → enter the
        // catch block; then make the integration_log error write also fail
        // → triggers logger.warn for the inner audit-log .catch.
        const ORIGINAL_FLAG = process.env.UK_USE_WEBHOOK_SENDER;
        process.env.UK_USE_WEBHOOK_SENDER = 'true';

        const IntegrationConfig = require('../../../src/models/IntegrationConfig');
        const AlertRule = require('../../../src/models/AlertRule');
        const UkOutbox = require('../../../src/models/UkOutbox');

        IntegrationConfig.isEnabled.mockResolvedValue(true);
        AlertRule.findByTypeAndSeverity.mockResolvedValue({
            uk_category: 'electrical',
            uk_urgency: 'high'
        });
        // [P1-14 split] resolveBuildingIds lives on the alertForwarder
        // submodule now. The spy must intercept the actual method that
        // sendAlertToUK calls via `this.resolveBuildingIds(...)`.
        const alertForwarder = require('../../../src/services/uk/alertForwarder');
        jest.spyOn(alertForwarder, 'resolveBuildingIds').mockResolvedValue([{
            building_id: 99, external_id: 'ext-uuid-99'
        }]);
        AlertRequestMap.findByAlertAndBuilding.mockResolvedValue(null);
        AlertRequestMap.create.mockResolvedValue({ id: 1, idempotency_key: 'idem-1' });
        // Force the outbox enqueue to throw → enter the catch block
        UkOutbox.enqueue.mockRejectedValueOnce(new Error('outbox DB locked'));
        // Then the integration_log error write also fails → triggers logger.warn
        IntegrationLog.create.mockRejectedValueOnce(new Error('audit unreachable'));

        await service.sendAlertToUK({
            alert_id: 555,
            type: 'voltage_low',
            severity: 'high',
            infrastructure_type: 'building',
            infrastructure_id: 99,
            message: 'voltage out of band'
        });

        const warnCalls = logger.warn.mock.calls.map(c => c[0]);
        expect(warnCalls.some(msg =>
            typeof msg === 'string' &&
            msg.includes('555') &&            // alert_id
            msg.includes('99') &&             // building_id
            msg.includes('audit unreachable') // root cause
        )).toBe(true);

        const alertForwarderRestore = require('../../../src/services/uk/alertForwarder');
        alertForwarderRestore.resolveBuildingIds.mockRestore();

        if (ORIGINAL_FLAG === undefined) {
            delete process.env.UK_USE_WEBHOOK_SENDER;
        } else {
            process.env.UK_USE_WEBHOOK_SENDER = ORIGINAL_FLAG;
        }
    });

    test('no remaining `.catch(() => {})` patterns in source', () => {
        // Belt-and-braces guard: a grep-equivalent assertion so future regressions
        // (re-introducing silent catches) fail at unit-test time.
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../src/services/ukIntegrationService.js'),
            'utf8'
        );
        const matches = source.match(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/g) || [];
        expect(matches.length).toBe(0);
    });
});
