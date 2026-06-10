// [AUD-001 PR-B Step 5b] Engineer-escalation forwarding — the dedicated path
// that bypasses AlertRequestMap. The old shared path routed engineer events
// through the per-building mapping loop, where an existing mapping for the same
// {alert,building} (the original request) made it skip — so engineer tickets
// NEVER reached UK. These tests pin: no AlertRequestMap, deterministic event_id,
// enqueue outside the UK_USE_WEBHOOK_SENDER gate, and the ack contract.

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByAlertAndBuilding: jest.fn(),
    create: jest.fn(),
    findByIdempotencyKey: jest.fn()
}));
jest.mock('../../../src/models/UkOutbox', () => ({
    enqueue: jest.fn(),
    findByEventId: jest.fn()
}));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));
jest.mock('../../../src/services/uk/configProxy', () => ({ isEnabled: jest.fn() }));
jest.mock('../../../src/services/uk/webhookVerifier', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));

const db = require('../../../src/config/database');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const UkOutbox = require('../../../src/models/UkOutbox');
const AlertRule = require('../../../src/models/AlertRule');
const configProxy = require('../../../src/services/uk/configProxy');
const forwarder = require('../../../src/services/uk/alertForwarder');

const alertData = {
    alert_id: 21,
    type: 'LEAK_DETECTED',
    severity: 'CRITICAL',
    infrastructure_type: 'controller',
    infrastructure_id: 1,
    message: 'leak'
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('[AUD-001 PR-B Step 5b] engineer escalation forwarding', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configProxy.isEnabled.mockResolvedValue(true);
        AlertRule.findByTypeAndSeverity.mockResolvedValue({ id: 4, uk_urgency: 'high' });
        // resolveBuildingIds → one building with external_id
        db.query.mockResolvedValue({ rows: [{ building_id: 10, external_id: 'ext-aaa' }] });
        UkOutbox.enqueue.mockResolvedValue({ id: 1, event_id: 'x' });
    });

    test('enqueues to UK outbox WITHOUT touching AlertRequestMap', async () => {
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });

        expect(ok).toBe(true);
        expect(AlertRequestMap.findByAlertAndBuilding).not.toHaveBeenCalled();
        expect(AlertRequestMap.create).not.toHaveBeenCalled();
        expect(UkOutbox.enqueue).toHaveBeenCalledTimes(1);
        const body = JSON.parse(UkOutbox.enqueue.mock.calls[0][0].payload_body);
        expect(body.event).toBe('alert.engineer_required');
        expect(body.alert.uk_category_override).toBe('Инженерный разбор');
        expect(body.alert.engineer_required_reason).toBe('max_reopens_per_24h');
        expect(UkOutbox.enqueue.mock.calls[0][0].event_id).toMatch(UUID_RE);
    });

    test('event_id is deterministic for the same (verificationId, building)', async () => {
        await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        const id1 = UkOutbox.enqueue.mock.calls[0][0].event_id;
        UkOutbox.enqueue.mockClear();
        await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        const id2 = UkOutbox.enqueue.mock.calls[0][0].event_id;
        expect(id1).toBe(id2);
    });

    test('different verificationId → different event_id', async () => {
        await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 1 });
        const id1 = UkOutbox.enqueue.mock.calls[0][0].event_id;
        UkOutbox.enqueue.mockClear();
        await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 2 });
        expect(UkOutbox.enqueue.mock.calls[0][0].event_id).not.toBe(id1);
    });

    test('missing verificationId → warn + NOT enqueued + false', async () => {
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true });
        expect(ok).toBe(false);
        expect(UkOutbox.enqueue).not.toHaveBeenCalled();
    });

    test('enqueues even when UK_USE_WEBHOOK_SENDER is off (outbox is the durable buffer)', async () => {
        const prev = process.env.UK_USE_WEBHOOK_SENDER;
        delete process.env.UK_USE_WEBHOOK_SENDER;
        await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(UkOutbox.enqueue).toHaveBeenCalledTimes(1);
        if (prev !== undefined) process.env.UK_USE_WEBHOOK_SENDER = prev;
    });

    test('integration disabled → false, no enqueue', async () => {
        configProxy.isEnabled.mockResolvedValue(false);
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(ok).toBe(false);
        expect(UkOutbox.enqueue).not.toHaveBeenCalled();
    });

    test('no matching rule → false', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(null);
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(ok).toBe(false);
    });

    test('no buildings with external_id → false', async () => {
        db.query.mockResolvedValue({ rows: [{ building_id: 10, external_id: null }] });
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(ok).toBe(false);
        expect(UkOutbox.enqueue).not.toHaveBeenCalled();
    });

    test('mixed targets (one with external_id ok + one without) → true, only the ext one enqueued', async () => {
        db.query.mockResolvedValue({ rows: [
            { building_id: 10, external_id: 'ext-aaa' },
            { building_id: 11, external_id: null }
        ] });
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(ok).toBe(true);
        expect(UkOutbox.enqueue).toHaveBeenCalledTimes(1);
    });

    test('partial failure (one target enqueue throws) → false', async () => {
        db.query.mockResolvedValue({ rows: [
            { building_id: 10, external_id: 'ext-aaa' },
            { building_id: 11, external_id: 'ext-bbb' }
        ] });
        UkOutbox.enqueue.mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(new Error('db boom'));
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(ok).toBe(false);
    });

    test('duplicate enqueue (null) that is pending/sent → delivered (true)', async () => {
        UkOutbox.enqueue.mockResolvedValue(null);              // ON CONFLICT
        UkOutbox.findByEventId.mockResolvedValue({ status: 'sent' });
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(ok).toBe(true);
    });

    test('duplicate enqueue (null) that is DEAD → not delivered (false) [PR-C revives]', async () => {
        UkOutbox.enqueue.mockResolvedValue(null);
        UkOutbox.findByEventId.mockResolvedValue({ status: 'dead' });
        const ok = await forwarder.sendAlertToUK(alertData, { engineerRequired: true, verificationId: 99 });
        expect(ok).toBe(false);
    });
});
