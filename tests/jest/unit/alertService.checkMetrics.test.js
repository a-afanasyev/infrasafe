/**
 * [AR-2, находка код-ревью] Счётчик infrasafe_alert_checks_total должен реально
 * инкрементиться.
 *
 * Он был объявлен, экспортирован и покрыт unit-тестом в изоляции, но НИ ОДИН
 * боевой путь его не вызывал — в проде серия навсегда осталась бы нулевой.
 * Ирония в том, что комментарий самого модуля metrics.js называет ровно этот
 * сценарий «худшим видом ложной зелёности», а правило InfrasafeAlertEngineSilent
 * в profk-observability построено на `increase(infrasafe_alert_checks_total[30m]) == 0`
 * и без инкремента не сработало бы никогда.
 *
 * Важно, что считается КАЖДЫЙ исход, включая cooldown: при штатной телеметрии
 * большинство проверок отсекается именно им, и если не считать их, здоровая
 * система выглядела бы «молчащей».
 */

jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn(),
    safeRollback: jest.fn(),
    releaseClient: jest.fn()
}));

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
        createDatabaseBreaker: () => ({ execute: (fn) => fn(), getState: () => ({ state: 'CLOSED' }) }),
        createAnalyticsBreaker: () => ({ execute: (fn) => fn(), getState: () => ({ state: 'CLOSED' }) })
    }
}));

jest.mock('../../../src/services/analyticsService', () => ({
    getTransformerLoad: jest.fn().mockResolvedValue(null),
    getAllTransformersWithAnalytics: jest.fn().mockResolvedValue([]),
    checkForAlerts: jest.fn()
}));

jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false),
    sendAlertToUK: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn()
}));

jest.mock('../../../src/services/uk/alertForwarder', () => ({
    resolveBuildingIds: jest.fn()
}));

jest.mock('../../../src/observability/metrics', () => ({
    recordAlertCheck: jest.fn(),
    recordAlertCreated: jest.fn(),
    setCircuitBreakerState: jest.fn(),
    incCircuitBreakerOpened: jest.fn(),
    incOutboxDead: jest.fn(),
    markVerificationTick: jest.fn()
}));

const metrics = require('../../../src/observability/metrics');
const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');
const alertService = require('../../../src/services/alertService');

/** Исходы, зафиксированные для метки outcome. */
function outcomesFor(type) {
    return metrics.recordAlertCheck.mock.calls
        .filter(([t]) => t === type)
        .map(([, outcome]) => outcome);
}

describe('[AR-2] исходы проверок алертов попадают в метрику', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
    });

    test('cooldown считается — иначе здоровая система выглядит «молчащей»', async () => {
        // Ставим отметку последней проверки «только что» → следующая отсечётся.
        alertService.lastChecks.set('controller:1:leak_check', Date.now());

        await alertService.checkLeak(1);

        expect(outcomesFor('LEAK_DETECTED')).toContain('cooldown');
    });

    // Эти два исхода различает САМ createAlert (только он знает, какой гейт
    // отказал), поэтому гоняем его по-настоящему, а не подменяем заглушкой:
    // мок скрыл бы ровно ту инструментацию, которую проверяем.
    const alertData = {
        type: 'LEAK_DETECTED',
        severity: 'WARNING',
        infrastructure_type: 'controller',
        infrastructure_id: 1,
        message: 'Протечка',
        data: {}
    };
    const rule = {
        id: 4,
        alert_type: 'LEAK_DETECTED',
        severity: 'WARNING',
        min_persistence_seconds: 15,
        min_affected_buildings: 1
    };

    test('успешное создание считается как created', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(rule);
        const firstSeen = new Date(Date.now() - 60000).toISOString();
        db.query
            .mockResolvedValueOnce({ rows: [{ samples: '5', first_seen: firstSeen }] })   // гейт persistence
            .mockResolvedValueOnce({ rows: [{ alert_id: 5, created_at: new Date() }] });  // INSERT

        const result = await alertService.createAlert(alertData);

        expect(result).not.toBeNull();
        expect(outcomesFor('LEAK_DETECTED')).toContain('created');
    });

    test('отказ гейта считается отдельно от создания', async () => {
        AlertRule.findByTypeAndSeverity.mockResolvedValue(rule);
        // Одного сэмпла мало → гейт persistence отказывает.
        db.query.mockResolvedValueOnce({ rows: [{ samples: '1', first_seen: new Date().toISOString() }] });

        const result = await alertService.createAlert(alertData);

        expect(result).toBeNull();
        const outcomes = outcomesFor('LEAK_DETECTED');
        expect(outcomes).toContain('gate_denied');
        expect(outcomes).not.toContain('created');
    });

    test('ошибка проверки считается как error, а не теряется', async () => {
        jest.spyOn(alertService, 'createAlert').mockRejectedValue(new Error('db down'));

        await alertService.checkLeak(1);

        expect(outcomesFor('LEAK_DETECTED')).toContain('error');
    });

    test('каждый чекер отмечается своим типом алерта', async () => {
        jest.spyOn(alertService, 'createAlert').mockResolvedValue(null);
        alertService.lastChecks.clear();

        await alertService.checkVoltage(2).catch(() => {});
        await alertService.checkHeating(3).catch(() => {});

        const types = metrics.recordAlertCheck.mock.calls.map(([t]) => t);
        expect(types).toEqual(expect.arrayContaining(['VOLTAGE_ANOMALY', 'HEATING_FAILURE']));
    });
});
