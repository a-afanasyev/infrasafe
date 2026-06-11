// PR-3 (AUD-006): voltage escalate-in-place UK notification. enqueueEscalation
// mirrors the engineer-escalation path — no AlertRequestMap, deterministic
// event_id, idempotent UkOutbox enqueue + reviveDead — but emits `alert.escalated`
// and carries the policy's urgency. The policy is PASSED IN (no re-lookup → no
// TOCTOU). Gating on the UK_ESCALATION_NOTIFY flag lives in the caller; this
// method still self-checks configProxy.isEnabled().

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/models/AlertRequestMap', () => ({
    findByAlertAndBuilding: jest.fn(), create: jest.fn(), findByIdempotencyKey: jest.fn()
}));
jest.mock('../../../src/models/UkOutbox', () => ({
    enqueue: jest.fn(), findByEventId: jest.fn(), reviveDead: jest.fn()
}));
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn(), findPolicyByTypeAndSeverity: jest.fn()
}));
jest.mock('../../../src/services/uk/configProxy', () => ({ isEnabled: jest.fn() }));
jest.mock('../../../src/services/uk/webhookVerifier', () => ({ logEvent: jest.fn().mockResolvedValue(undefined) }));

const db = require('../../../src/config/database');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const UkOutbox = require('../../../src/models/UkOutbox');
const AlertRule = require('../../../src/models/AlertRule');
const configProxy = require('../../../src/services/uk/configProxy');
const forwarder = require('../../../src/services/uk/alertForwarder');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const alertData = {
    alert_id: 55,
    type: 'VOLTAGE_ANOMALY',
    severity: 'CRITICAL',
    infrastructure_type: 'controller',
    infrastructure_id: 2,
    message: 'critical voltage',
    created_at: '2026-06-11T00:00:00Z'
};
const policy = { id: 7, uk_urgency: 'critical', enabled: true, reopen_urgency_bump: false };

describe('[AUD-006] enqueueEscalation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        configProxy.isEnabled.mockResolvedValue(true);
        db.query.mockResolvedValue({ rows: [{ building_id: 10, external_id: 'ext-aaa' }] });
        UkOutbox.enqueue.mockResolvedValue({ id: 1, event_id: 'x' });
    });

    test('enqueues alert.escalated WITHOUT AlertRequestMap and without re-looking-up the policy', async () => {
        const ok = await forwarder.enqueueEscalation(alertData, policy);

        expect(ok).toBe(true);
        expect(AlertRequestMap.create).not.toHaveBeenCalled();
        expect(AlertRule.findByTypeAndSeverity).not.toHaveBeenCalled();
        expect(AlertRule.findPolicyByTypeAndSeverity).not.toHaveBeenCalled();
        expect(UkOutbox.enqueue).toHaveBeenCalledTimes(1);
        const body = JSON.parse(UkOutbox.enqueue.mock.calls[0][0].payload_body);
        expect(body.event).toBe('alert.escalated');
        expect(body.alert.uk_urgency_override).toBe('critical');
        expect(body.alert.alert_id).toBe(55);
        expect(body.alert.created_at).toBe('2026-06-11T00:00:00Z');
        expect(UkOutbox.enqueue.mock.calls[0][0].event_id).toMatch(UUID_RE);
    });

    test('event_id is deterministic per (alert_id, severity, building) and severity-sensitive', async () => {
        await forwarder.enqueueEscalation(alertData, policy);
        const idCrit = UkOutbox.enqueue.mock.calls[0][0].event_id;
        UkOutbox.enqueue.mockClear();
        await forwarder.enqueueEscalation(alertData, policy);
        const idCrit2 = UkOutbox.enqueue.mock.calls[0][0].event_id;
        expect(idCrit).toBe(idCrit2);

        UkOutbox.enqueue.mockClear();
        await forwarder.enqueueEscalation({ ...alertData, severity: 'WARNING' }, policy);
        const idWarn = UkOutbox.enqueue.mock.calls[0][0].event_id;
        expect(idWarn).not.toBe(idCrit);
    });

    test('returns false (no enqueue) when integration is disabled', async () => {
        configProxy.isEnabled.mockResolvedValue(false);
        const ok = await forwarder.enqueueEscalation(alertData, policy);
        expect(ok).toBe(false);
        expect(UkOutbox.enqueue).not.toHaveBeenCalled();
    });

    test('returns false when no building has an external_id', async () => {
        db.query.mockResolvedValue({ rows: [{ building_id: 10, external_id: null }] });
        const ok = await forwarder.enqueueEscalation(alertData, policy);
        expect(ok).toBe(false);
        expect(UkOutbox.enqueue).not.toHaveBeenCalled();
    });

    test('revives a dead outbox row on ON CONFLICT duplicate', async () => {
        UkOutbox.enqueue.mockResolvedValue(null); // ON CONFLICT
        UkOutbox.findByEventId.mockResolvedValue({ status: 'dead' });
        UkOutbox.reviveDead.mockResolvedValue(true);

        const ok = await forwarder.enqueueEscalation(alertData, policy);
        expect(ok).toBe(true);
        expect(UkOutbox.reviveDead).toHaveBeenCalledTimes(1);
    });
});
