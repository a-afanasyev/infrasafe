/**
 * [B-009] Сезонный гейт внутри createAlert.
 *
 * Гейта самого по себе мало: надо доказать, что он реально стоит в пайплайне
 * создания алерта, срабатывает ДО persistence-гейта (тот агрегирует `metrics`,
 * и вне сезона платить за этот запрос незачем) и не ломает существующее
 * поведение правил без окна.
 */

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
jest.mock('../../../src/services/uk/alertForwarder', () => ({ resolveBuildingIds: jest.fn() }));
jest.mock('../../../src/models/AlertRule', () => ({ findByTypeAndSeverity: jest.fn() }));

const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const alertService = require('../../../src/services/alertService');
const AlertRule = require('../../../src/models/AlertRule');

const HEATING_ALERT = {
    type: 'HEATING_FAILURE',
    severity: 'CRITICAL',
    infrastructure_type: 'heat_source',
    infrastructure_id: 3,
    message: 'Нет подачи тепла',
    data: {}
};
const heatingRule = (season_from, season_to) => ({
    id: 5,
    alert_type: 'HEATING_FAILURE',
    severity: 'CRITICAL',
    min_persistence_seconds: 60,
    min_affected_buildings: 1,
    season_from,
    season_to
});
const at = (mm, dd) => new Date(2026, mm - 1, dd, 12, 0, 0);

describe('[B-009] createAlert — сезонный гейт', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    test('вне сезона алерт не создаётся и НИ ОДНОГО запроса в БД не уходит', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(heatingRule('10-15', '04-15'));

        const result = await alertService.createAlert(HEATING_ALERT, { now: at(7, 25) });

        expect(result).toBeNull();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('skipped by season gate'));
        // Гейт стоит ПЕРЕД persistence — тот бы сходил в `metrics`.
        expect(db.query).not.toHaveBeenCalled();
    });

    // Persistence-гейт для HEATING_FAILURE намеренно fail-open (полностью
    // реализован только для LEAK_DETECTED + controller), поэтому внутри сезона
    // алерт должен дойти до INSERT и создаться.
    test('внутри сезона алерт создаётся', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(heatingRule('10-15', '04-15'));
        db.query.mockResolvedValue({ rows: [{ alert_id: 91, created_at: new Date().toISOString() }] });

        const result = await alertService.createAlert(HEATING_ALERT, { now: at(12, 1) });

        expect(result).not.toBeNull();
        expect(result.alert_id).toBe(91);
        expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('skipped by season gate'));
    });

    test('правило без окна ведёт себя как до B-009 (регрессия на существующих правилах)', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(heatingRule(null, null));
        db.query.mockResolvedValue({ rows: [{ alert_id: 92, created_at: new Date().toISOString() }] });

        const result = await alertService.createAlert(HEATING_ALERT, { now: at(7, 25) });

        expect(result).not.toBeNull();
        expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('skipped by season gate'));
    });

    test('bypassGates (ручная эскалация оператором) обходит и сезонный гейт', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(heatingRule('10-15', '04-15'));
        db.query.mockResolvedValue({ rows: [{ alert_id: 77, created_at: new Date().toISOString() }] });

        const result = await alertService.createAlert(
            HEATING_ALERT,
            { bypassGates: true, now: at(7, 25) }
        );

        expect(result).not.toBeNull();
        expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('skipped by season gate'));
    });

    test('нет подходящего правила → гейты не применяются (поведение сохранено)', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(null);
        db.query.mockResolvedValue({ rows: [{ alert_id: 78, created_at: new Date().toISOString() }] });

        const result = await alertService.createAlert(HEATING_ALERT, { now: at(7, 25) });

        expect(result).not.toBeNull();
    });
});
