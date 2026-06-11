// PR-3 (AUD-006): _escalateAlert — upgrade an OPEN alert's severity in place
// (reactivating it) instead of dropping a worse reading on the floor. Returns an
// explicit {outcome}. Mirrors the engineer-escalation durability (non-atomic:
// UPDATE via dbBreaker, then best-effort immediate notify + UK enqueue).

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), invalidate: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/utils/circuitBreaker', () => ({
    CircuitBreakerFactory: {
        createDatabaseBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' }),
        createAnalyticsBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' })
    }
}));
jest.mock('../../../src/services/analyticsService', () => ({ getTransformerLoad: jest.fn() }));
jest.mock('../../../src/services/ukIntegrationService', () => ({ isEnabled: jest.fn().mockResolvedValue(false) }));
jest.mock('../../../src/services/uk/alertForwarder', () => ({
    resolveBuildingIds: jest.fn().mockResolvedValue([]),
    enqueueEscalation: jest.fn().mockResolvedValue(true)
}));
jest.mock('../../../src/services/uk/configProxy', () => ({
    isEnabled: jest.fn().mockResolvedValue(true),
    isEscalationNotifyEnabled: jest.fn().mockReturnValue(true)
}));
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn(),
    findPolicyByTypeAndSeverity: jest.fn()
}));
jest.mock('../../../src/events/alertEvents', () => {
    const EventEmitter = require('events');
    const e = new EventEmitter();
    e.EVENTS = new Proxy({}, { get: (_t, k) => k });
    return e;
});

const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');
const alertForwarder = require('../../../src/services/uk/alertForwarder');
const configProxy = require('../../../src/services/uk/configProxy');
const alertEvents = require('../../../src/events/alertEvents');
const alertService = require('../../../src/services/alertService');

const existing = { alert_id: 99, severity: 'WARNING', status: 'active', created_at: '2026-06-01T00:00:00Z' };
const newData = {
    type: 'VOLTAGE_ANOMALY', severity: 'CRITICAL',
    infrastructure_id: 42, infrastructure_type: 'controller',
    message: 'critical voltage', affected_buildings: 1, data: { source: 'auto_voltage_check' }
};
const POLICY = { id: 7, uk_urgency: 'critical', enabled: true };

describe('[AUD-006] _escalateAlert', () => {
    let gatesSpy, notifySpy;
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.activeAlerts.clear();
        alertService.initialized = true;
        AlertRule.findPolicyByTypeAndSeverity.mockResolvedValue({ ...POLICY });
        gatesSpy = jest.spyOn(alertService, '_evaluateGates').mockResolvedValue({ allowed: true });
        notifySpy = jest.spyOn(alertService, 'sendImmediateNotification').mockResolvedValue(undefined);
        configProxy.isEscalationNotifyEnabled.mockReturnValue(true);
        configProxy.isEnabled.mockResolvedValue(true);
    });
    afterEach(() => { gatesSpy.mockRestore(); notifySpy.mockRestore(); });

    test('fail-CLOSE: no policy → denied, no UPDATE', async () => {
        AlertRule.findPolicyByTypeAndSeverity.mockResolvedValue(null);
        const r = await alertService._escalateAlert(existing, newData);
        expect(r.outcome).toBe('denied');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('gate denies → denied, no UPDATE', async () => {
        gatesSpy.mockResolvedValue({ allowed: false, reason: 'not persistent' });
        const r = await alertService._escalateAlert(existing, newData);
        expect(r.outcome).toBe('denied');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('UPDATE 1 row → escalated: reactivation + JSONB merge + map synced + immediate notify (no ALERT_CREATED)', async () => {
        const emitSpy = jest.spyOn(alertEvents, 'emit');
        db.query.mockResolvedValue({ rows: [{ alert_id: 99, created_at: '2026-06-01T00:00:00Z' }] });

        const r = await alertService._escalateAlert(existing, newData);

        expect(r.outcome).toBe('escalated');
        expect(r.alert).toMatchObject({ alert_id: 99, severity: 'CRITICAL', escalated: true });
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/UPDATE infrastructure_alerts/);
        expect(sql).toMatch(/status\s*=\s*'active'/);
        expect(sql).toMatch(/acknowledged_at\s*=\s*NULL/);
        expect(sql).toMatch(/\|\|\s*\$4::jsonb/);            // JSONB merge
        expect(sql).toMatch(/severity\s*<>\s*\$2/);
        // map synced to CRITICAL/active
        expect(alertService.activeAlerts.get('controller:42:VOLTAGE_ANOMALY')).toMatchObject({ severity: 'CRITICAL', status: 'active' });
        // immediate notification, NOT sendNotifications (no ALERT_CREATED double-UK)
        expect(notifySpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).not.toHaveBeenCalledWith('ALERT_CREATED', expect.anything());
        emitSpy.mockRestore();
    });

    test('escalated + flags on → enqueueEscalation called with the policy', async () => {
        db.query.mockResolvedValue({ rows: [{ alert_id: 99, created_at: 'x' }] });
        await alertService._escalateAlert(existing, newData);
        expect(alertForwarder.enqueueEscalation).toHaveBeenCalledTimes(1);
        expect(alertForwarder.enqueueEscalation.mock.calls[0][1]).toMatchObject({ id: 7 });
    });

    test('escalated but UK_ESCALATION_NOTIFY off → no enqueue (alert still escalates)', async () => {
        configProxy.isEscalationNotifyEnabled.mockReturnValue(false);
        db.query.mockResolvedValue({ rows: [{ alert_id: 99, created_at: 'x' }] });
        const r = await alertService._escalateAlert(existing, newData);
        expect(r.outcome).toBe('escalated');
        expect(alertForwarder.enqueueEscalation).not.toHaveBeenCalled();
    });

    test('escalated but rule disabled → no enqueue', async () => {
        AlertRule.findPolicyByTypeAndSeverity.mockResolvedValue({ ...POLICY, enabled: false });
        db.query.mockResolvedValue({ rows: [{ alert_id: 99, created_at: 'x' }] });
        await alertService._escalateAlert(existing, newData);
        expect(alertForwarder.enqueueEscalation).not.toHaveBeenCalled();
    });

    test('0 rows + re-read CRITICAL → alreadyCritical (map synced)', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })                                   // UPDATE no-op
            .mockResolvedValueOnce({ rows: [{ alert_id: 99, created_at: 'x', severity: 'CRITICAL', status: 'active' }] }); // _findActiveAlert
        const r = await alertService._escalateAlert(existing, newData);
        expect(r.outcome).toBe('alreadyCritical');
        expect(alertService.activeAlerts.get('controller:42:VOLTAGE_ANOMALY').severity).toBe('CRITICAL');
    });

    test('0 rows + re-read still WARNING (race) → retry', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ alert_id: 100, created_at: 'x', severity: 'WARNING', status: 'active' }] });
        const r = await alertService._escalateAlert(existing, newData);
        expect(r.outcome).toBe('retry');
    });

    test('0 rows + re-read none → gone (carries the policy snapshot)', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });
        const r = await alertService._escalateAlert(existing, newData);
        expect(r.outcome).toBe('gone');
        expect(r.policy).toMatchObject({ id: 7 });
    });

    test('immediate-notification failure does not roll back the escalation', async () => {
        db.query.mockResolvedValue({ rows: [{ alert_id: 99, created_at: 'x' }] });
        notifySpy.mockRejectedValue(new Error('notify boom'));
        const r = await alertService._escalateAlert(existing, newData);
        expect(r.outcome).toBe('escalated');
    });
});
