/**
 * [FE-119] Phase 1 — populate metric/infrastructure context on the alertData that
 * feeds the UK webhook: TRANSFORMER_OVERLOAD (load%) and HEATING_FAILURE (ГВС
 * temp), plus infrastructure_label everywhere. The payload builder
 * (alertForwarder._buildAlertEventBody) already forwards these — these tests pin
 * that the alert producers actually set them.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn(),
    circuitBreaker: { execute: jest.fn() },
}));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));
jest.mock('../../../src/services/uk/alertForwarder', () => ({
    resolveBuildingIds: jest.fn().mockResolvedValue([]),
}));

const alertService = require('../../../src/services/alertService');
const analyticsService = require('../../../src/services/analyticsService');

beforeEach(() => {
    jest.clearAllMocks();
    alertService.activeAlerts.clear();
    alertService.lastChecks.clear();
    alertService.initialized = true;
});

// restore spyOn'd methods so a spy from one test (e.g. _recentHeatingMinTemp)
// does not leak into the next — clearAllMocks resets calls but not spy impls.
afterEach(() => {
    jest.restoreAllMocks();
});

describe('[FE-119] HEATING_FAILURE metric context', () => {
    test('_buildHeatingAlertData carries metric/infrastructure fields', () => {
        const d = alertService._buildHeatingAlertData(7, 32.5);
        expect(d.infrastructure_label).toBe('Контроллер №7');
        expect(d.metric_id).toBe('hot_water_in_temp');
        expect(d.metric_label).toBe('Температура ГВС');
        expect(d.metric_value).toBe(32.5);
        expect(d.metric_unit).toBe('°C');
        expect(d.metric_normal_min).toBe(40); // hot_water_in_critical threshold
        expect(d.metric_normal_max).toBeNull(); // lower-bound rule → no upper bound
    });

    test('_buildHeatingAlertData defaults metric_value to null (verify/reopen path)', () => {
        expect(alertService._buildHeatingAlertData(7).metric_value).toBeNull();
    });

    test('checkHeating threads the fetched temperature into metric_value', async () => {
        jest.spyOn(alertService, '_hasRecentHeatingAnomaly').mockResolvedValue(true);
        jest.spyOn(alertService, '_recentHeatingMinTemp').mockResolvedValue(31.2);
        const createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 1 });

        await alertService.checkHeating(7);

        expect(createSpy).toHaveBeenCalledTimes(1);
        const [alertData] = createSpy.mock.calls[0];
        expect(alertData.metric_value).toBe(31.2);
        expect(alertData.metric_label).toBe('Температура ГВС');
        expect(alertData.infrastructure_label).toBe('Контроллер №7');
    });

    test('_recentHeatingMinTemp returns null (no throw) when db yields no rows', async () => {
        const db = require('../../../src/config/database');
        db.query.mockResolvedValue(undefined); // defensive: mocked query returns undefined
        await expect(alertService._recentHeatingMinTemp(7)).resolves.toBeNull();
    });
});

describe('[FE-119] LEAK_DETECTED — label-only', () => {
    test('_buildLeakAlertData carries label + infrastructure, no numeric metric', () => {
        const d = alertService._buildLeakAlertData(3);
        expect(d.metric_label).toBe('Протечка');
        expect(d.metric_id).toBe('leak_sensor');
        expect(d.infrastructure_label).toBe('Контроллер №3');
        // label-only: no numeric value/bounds (payload helper serializes as null)
        expect(d.metric_value).toBeUndefined();
        expect(d.metric_normal_min).toBeUndefined();
        expect(d.metric_normal_max).toBeUndefined();
    });
});

describe('[FE-119 Phase 2] VOLTAGE_ANOMALY metric context', () => {
    test('_buildVoltageAlertData carries metric/infrastructure fields', () => {
        const d = alertService._buildVoltageAlertData(7, 'WARNING', 215.3);
        expect(d.infrastructure_label).toBe('Контроллер №7');
        expect(d.metric_id).toBe('voltage');
        expect(d.metric_label).toBe('Напряжение');
        expect(d.metric_value).toBe(215.3);
        expect(d.metric_unit).toBe('В');
        expect(d.metric_normal_min).toBe(198); // voltage.warn_min
        expect(d.metric_normal_max).toBe(242); // voltage.warn_max
    });

    test('_buildVoltageAlertData defaults metric_value to null (verify/reopen path)', () => {
        expect(alertService._buildVoltageAlertData(7, 'WARNING').metric_value).toBeNull();
    });

    test('_recentVoltageMetric returns the most-deviant out-of-band phase value', async () => {
        const db = require('../../../src/config/database');
        // warn band [198, 242]. Deviations: 188→10 (below), 250→8 (above), 245→3.
        db.query.mockResolvedValue({ rows: [{
            ph1_min: 215, ph1_max: 230,
            ph2_min: 188, ph2_max: 240,
            ph3_min: 245, ph3_max: 250,
        }] });
        await expect(alertService._recentVoltageMetric(7)).resolves.toBe(188);
    });

    test('_recentVoltageMetric returns null when all phases are within band', async () => {
        const db = require('../../../src/config/database');
        db.query.mockResolvedValue({ rows: [{
            ph1_min: 220, ph1_max: 240, ph2_min: 221, ph2_max: 239, ph3_min: 225, ph3_max: 238,
        }] });
        await expect(alertService._recentVoltageMetric(7)).resolves.toBeNull();
    });

    test('_recentVoltageMetric returns null (no throw) when db yields no rows', async () => {
        const db = require('../../../src/config/database');
        db.query.mockResolvedValue(undefined);
        await expect(alertService._recentVoltageMetric(7)).resolves.toBeNull();
    });

    test('checkVoltage threads the fetched phase value into metric_value (fresh alert)', async () => {
        jest.spyOn(alertService, '_classifyVoltageSeverity').mockResolvedValue('WARNING');
        jest.spyOn(alertService, '_recentVoltageMetric').mockResolvedValue(189.4);
        jest.spyOn(alertService, '_findActiveAlert').mockResolvedValue(null);
        const createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 5 });

        await alertService.checkVoltage(7, { bypassCooldown: true });

        expect(createSpy).toHaveBeenCalledTimes(1);
        const [alertData] = createSpy.mock.calls[0];
        expect(alertData.type).toBe('VOLTAGE_ANOMALY');
        expect(alertData.metric_value).toBe(189.4);
        expect(alertData.metric_label).toBe('Напряжение');
        expect(alertData.infrastructure_label).toBe('Контроллер №7');
    });
});

describe('[FE-119] TRANSFORMER_OVERLOAD metric context', () => {
    test('checkTransformerLoad sets metric/infrastructure fields on the alert', async () => {
        analyticsService.getTransformerLoad.mockResolvedValue({
            load_percent: 88.5, // WARNING band: >= overload(85), < critical(95)
            capacity_kva: 800,
            name: 'Олмазор-1',
            buildings_count: 3,
            active_controllers_count: 5,
            last_metric_time: '2026-06-13T10:00:00Z',
        });
        const createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 9 });

        await alertService.checkTransformerLoad(10);

        expect(createSpy).toHaveBeenCalledTimes(1);
        const [alertData] = createSpy.mock.calls[0];
        expect(alertData.infrastructure_type).toBe('transformer');
        expect(alertData.infrastructure_id).toBe(10);
        expect(alertData.infrastructure_label).toBe('Трансформатор №10');
        expect(alertData.metric_id).toBe('load_percent');
        expect(alertData.metric_label).toBe('Загрузка трансформатора');
        expect(alertData.metric_value).toBe(88.5);
        expect(alertData.metric_unit).toBe('%');
        expect(alertData.metric_normal_min).toBe(0);
        expect(alertData.metric_normal_max).toBe(alertService.thresholds.transformer_overload);
    });
});
