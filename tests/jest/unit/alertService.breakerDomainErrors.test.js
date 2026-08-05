/**
 * [AR-1] Регресс на P0 из аудита 2026-08-03.
 *
 * `CircuitBreaker.execute()` считал отказом ЛЮБОЕ исключение, а
 * acknowledgeAlert/resolveAlert бросают доменное `alertNotFound` ИЗНУТРИ
 * `dbBreaker.execute`. Порог createDatabaseBreaker = 5, reset = 60 с, и тот же
 * dbBreaker обслуживает createAlert/_escalateAlert — то есть пять «алерт не
 * найден» подряд (двойной клик оператора; повторный UK_REQUEST_RESOLVED по уже
 * закрытому алерту во время reconcile-шторма УК) на минуту глушили СОЗДАНИЕ
 * алертов. Отказ был виден только строкой в логе.
 *
 * ВАЖНО: остальные alertService-тесты подменяют circuitBreaker заглушкой
 * (`execute: fn => fn()`), поэтому баг был для них невидим. Здесь breaker
 * НАСТОЯЩИЙ — иначе тест ничего не проверяет.
 */

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined)
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

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');
const { ALERT_NOT_FOUND } = require('../../../src/services/alert/alertConstants');

describe('alertService: доменные ошибки не открывают dbBreaker (AR-1)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        alertService.initialized = true;
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        alertService.dbBreaker.reset();
    });

    test('breaker остаётся CLOSED после порога промахов acknowledgeAlert', async () => {
        db.query.mockResolvedValue({ rows: [] });

        for (let i = 0; i < 6; i++) {
            await expect(alertService.acknowledgeAlert(999 + i, 5)).rejects.toMatchObject({
                code: ALERT_NOT_FOUND
            });
        }

        expect(alertService.dbBreaker.getState().state).toBe('CLOSED');
    });

    test('после серии промахов следующий вызов доходит до БД, а не отбивается breaker-ом', async () => {
        db.query.mockResolvedValue({ rows: [] });

        for (let i = 0; i < 6; i++) {
            await alertService.acknowledgeAlert(999 + i, 5).catch(() => {});
        }

        // Настоящий алерт: до фикса здесь прилетало «Сервис временно недоступен»,
        // потому что breaker уже был открыт промахами.
        db.query.mockResolvedValue({
            rows: [{
                alert_id: 10,
                type: 'TRANSFORMER_OVERLOAD',
                infrastructure_id: 1,
                infrastructure_type: 'transformer',
                status: 'acknowledged'
            }]
        });

        const result = await alertService.acknowledgeAlert(10, 5);
        expect(result.alert_id).toBe(10);
    });

    test('настоящие отказы БД по-прежнему открывают breaker', async () => {
        db.query.mockRejectedValue(new Error('connection terminated unexpectedly'));

        for (let i = 0; i < 5; i++) {
            await alertService.acknowledgeAlert(1, 5).catch(() => {});
        }

        expect(alertService.dbBreaker.getState().state).toBe('OPEN');
    });
});
