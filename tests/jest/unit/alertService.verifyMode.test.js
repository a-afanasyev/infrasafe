// [AUD-001 PR-B] Verify-mode contract for the checkers.
//
// When a checker is invoked with opts.reopenContext (from a VERIFY_* event),
// it operates in "verify mode": bypass cooldown, bypass the in-memory dedup
// gate, evaluate the fault on FRESH post-resolve telemetry only, and return a
// structured { checked, alert } result instead of the legacy createdAlert|null.
//
//   checked:true  — the checker evaluated the condition on fresh data (incl.
//                   a gate-denial: "fault no longer holds"). Caller acks via
//                   AlertVerification.markChecked → window-expired ⇒ passed.
//   checked:false — could not evaluate: no fresh telemetry (silent sensor ≠
//                   recovered), rule disabled, or an internal error. No ack →
//                   window-expired ⇒ skipped.
//
// This file covers the checker plumbing (freshness-probe gating, reopen-field
// merge, return contract). The verify-gate persistence SQL is covered in
// alertService.persistenceGate.test.js.

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/utils/circuitBreaker', () => ({
    CircuitBreakerFactory: {
        createDatabaseBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' }),
        createAnalyticsBreaker: () => ({ execute: (fn) => fn(), getState: () => 'CLOSED' })
    }
}));
jest.mock('../../../src/services/analyticsService', () => ({ getTransformerLoad: jest.fn() }));
jest.mock('../../../src/services/ukIntegrationService', () => ({ isEnabled: jest.fn().mockResolvedValue(false) }));
jest.mock('../../../src/services/uk/alertForwarder', () => ({ resolveBuildingIds: jest.fn().mockResolvedValue(['b-1']) }));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');
const AlertRule = require('../../../src/models/AlertRule');
const analyticsService = require('../../../src/services/analyticsService');

const OBS = '2026-06-10T00:00:00Z';
const reopenCtx = {
    chainId: '550e8400-e29b-41d4-a716-446655440000',
    sequence: 2,
    previousAlertId: 21,
    previousUkRequestNumber: '260610-001',
    observationSince: OBS
};

describe('[AUD-001 PR-B] checkLeak verify-mode', () => {
    let createSpy;
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 555 });
    });
    afterEach(() => createSpy.mockRestore());

    // Freshness-probe routes through db.query; latest leak sample decides.
    const mockLatestLeak = (val) => {
        db.query.mockImplementation((sql) => {
            if (/ORDER BY\s+timestamp\s+DESC/i.test(sql)) {
                return Promise.resolve({ rows: val === null ? [] : [{ leak_sensor: val }] });
            }
            return Promise.resolve({ rows: [] });
        });
    };

    test('no fresh post-resolve sample → {checked:false}, createAlert NOT called', async () => {
        mockLatestLeak(null);
        const r = await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: false, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('latest fresh sample healthy → {checked:true, alert:null} (recovered), no reopen', async () => {
        mockLatestLeak(false);
        const r = await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: true, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('latest fresh sample anomalous + rule present → createAlert with reopen fields + snapshot/sinceTimestamp', async () => {
        mockLatestLeak(true);
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({ id: 4, alert_type: 'LEAK_DETECTED', min_persistence_seconds: 15 });

        const r = await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });

        expect(createSpy).toHaveBeenCalledTimes(1);
        const [alertData, options] = createSpy.mock.calls[0];
        expect(alertData.type).toBe('LEAK_DETECTED');
        expect(alertData.reopen_chain_id).toBe(reopenCtx.chainId);
        expect(alertData.reopen_sequence).toBe(2);
        expect(alertData.previous_alert_id).toBe(21);
        expect(alertData.previous_uk_request_number).toBe('260610-001');
        expect(options).toEqual(expect.objectContaining({ sinceTimestamp: OBS }));
        expect(options.ruleSnapshot).toEqual(expect.objectContaining({ id: 4 }));
        expect(options.bypassGates).toBeFalsy();
        expect(r).toEqual({ checked: true, alert: { alert_id: 555 } });
    });

    test('gate-denied (createAlert→null) on fresh anomalous data → {checked:true, alert:null}', async () => {
        mockLatestLeak(true);
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({ id: 4, min_persistence_seconds: 15 });
        createSpy.mockResolvedValueOnce(null);
        const r = await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: true, alert: null });
    });

    test('rule absent/disabled → {checked:false}, createAlert NOT called', async () => {
        mockLatestLeak(true);
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(null);
        const r = await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: false, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('bypasses in-memory dedup gate when reopenContext present (stale activeAlerts)', async () => {
        mockLatestLeak(true);
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({ id: 4 });
        alertService.activeAlerts.set('controller:7:LEAK_DETECTED', { alert_id: 1 });
        await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(createSpy).toHaveBeenCalledTimes(1);
    });

    test('bypasses cooldown when bypassCooldown set (fresh lastChecks)', async () => {
        mockLatestLeak(false);
        alertService.lastChecks.set('controller:7:leak_check', Date.now());
        const r = await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });
        // probe ran (not short-circuited by cooldown) → got a verdict
        expect(r).toEqual({ checked: true, alert: null });
        expect(db.query).toHaveBeenCalled();
    });

    test('internal error → {checked:false} (verify mode never throws to the listener)', async () => {
        db.query.mockRejectedValueOnce(new Error('db boom'));
        const r = await alertService.checkLeak(7, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: false, alert: null });
    });

    test('legacy call (no reopenContext) is unchanged — returns createdAlert, not {checked}', async () => {
        db.query.mockResolvedValue({ rows: [] });
        const r = await alertService.checkLeak(7);
        expect(r).toEqual({ alert_id: 555 });
    });
});

describe('[AUD-001 PR-B] checkHeating verify-mode', () => {
    let createSpy;
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 600 });
    });
    afterEach(() => createSpy.mockRestore());

    const mockLatestHeating = (temp) => {
        db.query.mockImplementation((sql) => {
            if (/ORDER BY\s+timestamp\s+DESC/i.test(sql)) {
                return Promise.resolve({ rows: temp === null ? [] : [{ hot_water_in_temp: temp }] });
            }
            return Promise.resolve({ rows: [] });
        });
    };

    test('no fresh sample → {checked:false}', async () => {
        mockLatestHeating(null);
        const r = await alertService.checkHeating(3, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: false, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('latest healthy (≥40°C) → {checked:true, alert:null}', async () => {
        mockLatestHeating(50);
        const r = await alertService.checkHeating(3, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: true, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('latest anomalous (<40°C) + rule → createAlert HEATING_FAILURE CRITICAL with reopen fields', async () => {
        mockLatestHeating(30);
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({ id: 6, min_persistence_seconds: 10 });
        const r = await alertService.checkHeating(3, { bypassCooldown: true, reopenContext: reopenCtx });
        const [alertData, options] = createSpy.mock.calls[0];
        expect(alertData.type).toBe('HEATING_FAILURE');
        expect(alertData.severity).toBe('CRITICAL');
        expect(alertData.reopen_chain_id).toBe(reopenCtx.chainId);
        expect(options.ruleSnapshot.id).toBe(6);
        expect(r).toEqual({ checked: true, alert: { alert_id: 600 } });
    });
});

describe('[AUD-001 PR-B] checkVoltage verify-mode', () => {
    let createSpy;
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 700 });
    });
    afterEach(() => createSpy.mockRestore());

    // Routes freshness-probe (latest phases) + classifier (warn/crit counts).
    const mockVoltage = ({ latest, warn = 0, crit = 0 }) => {
        db.query.mockImplementation((sql) => {
            if (/ORDER BY\s+timestamp\s+DESC/i.test(sql)) {
                return Promise.resolve({ rows: latest === null ? [] : [latest] });
            }
            if (/warn_samples/i.test(sql)) {
                return Promise.resolve({ rows: [{ warn_samples: String(warn), crit_samples: String(crit) }] });
            }
            return Promise.resolve({ rows: [] });
        });
    };

    test('no fresh sample → {checked:false}', async () => {
        mockVoltage({ latest: null });
        const r = await alertService.checkVoltage(5, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: false, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('latest in-band (220V) → {checked:true, alert:null}', async () => {
        mockVoltage({ latest: { electricity_ph1: 220, electricity_ph2: 221, electricity_ph3: 219 } });
        const r = await alertService.checkVoltage(5, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: true, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('latest anomalous (190V) + classifier WARNING + rule → createAlert WARNING', async () => {
        mockVoltage({ latest: { electricity_ph1: 190, electricity_ph2: 220, electricity_ph3: 221 }, warn: 3, crit: 0 });
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({ id: 5, min_persistence_seconds: 60 });
        const r = await alertService.checkVoltage(5, { bypassCooldown: true, reopenContext: reopenCtx });
        const [alertData, options] = createSpy.mock.calls[0];
        expect(alertData.type).toBe('VOLTAGE_ANOMALY');
        expect(alertData.severity).toBe('WARNING');
        expect(alertData.reopen_chain_id).toBe(reopenCtx.chainId);
        expect(options.sinceTimestamp).toBe(OBS);
        expect(r).toEqual({ checked: true, alert: { alert_id: 700 } });
    });

    test('latest anomalous but classifier says recovered (0 samples) → {checked:true, alert:null}', async () => {
        mockVoltage({ latest: { electricity_ph1: 190, electricity_ph2: 220, electricity_ph3: 221 }, warn: 0, crit: 0 });
        const r = await alertService.checkVoltage(5, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: true, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('classifier clamps to observationSince in verify mode', async () => {
        mockVoltage({ latest: { electricity_ph1: 190, electricity_ph2: 220, electricity_ph3: 221 }, warn: 2, crit: 0 });
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({ id: 5 });
        await alertService.checkVoltage(5, { bypassCooldown: true, reopenContext: reopenCtx });
        const classifierCall = db.query.mock.calls.find((c) => /warn_samples/i.test(c[0]));
        expect(classifierCall[0]).toMatch(/timestamp > \$\d+::timestamptz/);
        expect(classifierCall[1]).toContain(OBS);
    });
});

describe('[AUD-001 PR-B] checkTransformerLoad verify-mode', () => {
    let createSpy;
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 800 });
    });
    afterEach(() => createSpy.mockRestore());

    // Routes the direct-load lateral query; load_percent + sample_count decide.
    const mockLoadSince = (row) => {
        db.query.mockImplementation((sql) => {
            if (/LATERAL/i.test(sql) && /power_kva/i.test(sql)) {
                return Promise.resolve({ rows: row === null ? [{ sample_count: '0' }] : [row] });
            }
            return Promise.resolve({ rows: [] });
        });
    };

    test('uses direct calc, NOT getTransformerLoad (24h MV/cache)', async () => {
        mockLoadSince({ name: 'T1', capacity_kva: 1000, buildings_count: '3', sample_count: '3', load_percent: '50' });
        await alertService.checkTransformerLoad(1, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(analyticsService.getTransformerLoad).not.toHaveBeenCalled();
    });

    test('[H-1] load AVG filters out silent controllers (no dilution by 0-amperage NULL rows)', async () => {
        mockLoadSince({ name: 'T1', capacity_kva: 1000, buildings_count: '3', sample_count: '2', load_percent: '90' });
        await alertService.checkTransformerLoad(1, { bypassCooldown: true, reopenContext: reopenCtx });
        const loadCall = db.query.mock.calls.find((c) => /LATERAL/i.test(c[0]) && /power_kva/i.test(c[0]));
        expect(loadCall[0]).toMatch(/FILTER\s*\(WHERE\s+m\.timestamp\s+IS\s+NOT\s+NULL\)/i);
    });

    test('no fresh metrics (sample_count 0) → {checked:false}', async () => {
        mockLoadSince(null);
        const r = await alertService.checkTransformerLoad(1, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: false, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('current load below overload (50%) → {checked:true, alert:null} (recovered)', async () => {
        mockLoadSince({ name: 'T1', capacity_kva: 1000, buildings_count: '3', sample_count: '3', load_percent: '50' });
        const r = await alertService.checkTransformerLoad(1, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: true, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('current load critical (97%) + rule → createAlert TRANSFORMER_CRITICAL_OVERLOAD with reopen fields', async () => {
        mockLoadSince({ name: 'T1', capacity_kva: 1000, buildings_count: '3', sample_count: '3', load_percent: '97' });
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce({ id: 1, min_persistence_seconds: 10 });
        const r = await alertService.checkTransformerLoad(1, { bypassCooldown: true, reopenContext: reopenCtx });
        const [alertData, options] = createSpy.mock.calls[0];
        expect(alertData.type).toBe('TRANSFORMER_CRITICAL_OVERLOAD');
        expect(alertData.severity).toBe('CRITICAL');
        expect(alertData.reopen_chain_id).toBe(reopenCtx.chainId);
        expect(options.sinceTimestamp).toBe(OBS);
        expect(options.ruleSnapshot.id).toBe(1);
        expect(r).toEqual({ checked: true, alert: { alert_id: 800 } });
    });

    test('overload (90%) but rule absent → {checked:false}', async () => {
        mockLoadSince({ name: 'T1', capacity_kva: 1000, buildings_count: '3', sample_count: '3', load_percent: '90' });
        AlertRule.findByTypeAndSeverity.mockResolvedValueOnce(null);
        const r = await alertService.checkTransformerLoad(1, { bypassCooldown: true, reopenContext: reopenCtx });
        expect(r).toEqual({ checked: false, alert: null });
        expect(createSpy).not.toHaveBeenCalled();
    });
});
