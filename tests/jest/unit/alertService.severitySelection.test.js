// [A-05] Выбор уровня тревоги по напряжению: берётся высший уровень,
// ПРОШЕДШИЙ свой gate, а не высший из присутствующих в окне.
//
// Дефект аудита 08.09.2026. Классификатор смотрит окно 600 с и возвращает
// CRITICAL, если в нём есть ХОТЬ ОДИН критический сэмпл. Дальше
// persistence-gate требует минимум двух сэмплов, — и на одиночном выбросе
// отказывает. Проблема не в отказе, а в том, что на этом всё заканчивалось:
// устойчивые WARNING-сэмплы как WARNING уже не проверялись, а одиночный
// критический сэмпл оставался в окне ещё 600 секунд. Итог — реальная,
// продолжающаяся авария не порождала алерт до конца окна.
//
// Порядок именно такой: сначала пробуем CRITICAL, при отказе гейта — WARNING.
// Понижать уровень можно ТОЛЬКО из-за гейта: отказ по кулдауну или дедупу
// означает, что тревога уже есть, и понижение было бы вторым алертом на ту же
// аварию.

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
jest.mock('../../../src/services/ukIntegrationService', () => ({
    isEnabled: jest.fn().mockResolvedValue(false)
}));
jest.mock('../../../src/services/uk/alertForwarder', () => ({ resolveBuildingIds: jest.fn() }));
jest.mock('../../../src/models/AlertRule', () => ({
    findByTypeAndSeverity: jest.fn(),
    findPolicy: jest.fn()
}));

const db = require('../../../src/config/database');
const AlertRule = require('../../../src/models/AlertRule');
const alertService = require('../../../src/services/alertService');

const RULE = (severity) => ({
    rule_id: severity === 'CRITICAL' ? 1 : 2,
    alert_type: 'VOLTAGE_ANOMALY',
    severity,
    min_persistence_seconds: severity === 'CRITICAL' ? 10 : 60,
});

describe('[A-05] высший уровень, прошедший свой gate', () => {
    let candidatesSpy;
    let gateSpy;
    let createSpy;

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockReset();
        db.query.mockResolvedValue({ rows: [] });     // нет открытых алертов
        alertService.activeAlerts.clear();
        alertService.lastChecks.clear();
        alertService.initialized = true;
        AlertRule.findByTypeAndSeverity.mockImplementation(
            async (_type, severity) => RULE(severity)
        );
        createSpy = jest.spyOn(alertService, 'createAlert').mockResolvedValue({ alert_id: 1 });
    });

    afterEach(() => {
        candidatesSpy?.mockRestore();
        gateSpy?.mockRestore();
        createSpy.mockRestore();
    });

    test('CRITICAL не прошёл gate → тревога заводится как WARNING', async () => {
        // Сердцевина находки: раньше здесь не заводилось НИЧЕГО, и так
        // продолжалось до конца 600-секундного окна.
        candidatesSpy = jest.spyOn(alertService, '_voltageSeverityCandidates')
            .mockResolvedValue(['CRITICAL', 'WARNING']);
        gateSpy = jest.spyOn(alertService, '_checkPersistenceGate')
            .mockImplementation(async (alertData) => (
                alertData.severity === 'CRITICAL'
                    ? { allowed: false, reason: 'only 1 sample' }
                    : { allowed: true, reason: 'ok' }
            ));

        await alertService.checkVoltage(42);

        expect(createSpy).toHaveBeenCalledTimes(1);
        expect(createSpy.mock.calls[0][0].severity).toBe('WARNING');
    });

    test('CRITICAL прошёл gate → WARNING даже не пробуется', async () => {
        candidatesSpy = jest.spyOn(alertService, '_voltageSeverityCandidates')
            .mockResolvedValue(['CRITICAL', 'WARNING']);
        gateSpy = jest.spyOn(alertService, '_checkPersistenceGate')
            .mockResolvedValue({ allowed: true, reason: 'ok' });

        await alertService.checkVoltage(42);

        expect(gateSpy).toHaveBeenCalledTimes(1);
        expect(createSpy.mock.calls[0][0].severity).toBe('CRITICAL');
    });

    test('ни один уровень не прошёл gate → тревоги нет и кулдаун НЕ взводится', async () => {
        // Иначе отказ гейта маскировал бы аварию до конца окна кулдауна —
        // ровно та ошибка, которую чинил коммит e15436f.
        candidatesSpy = jest.spyOn(alertService, '_voltageSeverityCandidates')
            .mockResolvedValue(['CRITICAL', 'WARNING']);
        gateSpy = jest.spyOn(alertService, '_checkPersistenceGate')
            .mockResolvedValue({ allowed: false, reason: 'not persistent' });

        const result = await alertService.checkVoltage(42);

        expect(result).toBeNull();
        expect(createSpy).not.toHaveBeenCalled();
        expect(alertService.lastChecks.has('controller:42:voltage_check')).toBe(false);
    });

    test('в окне только WARNING → поведение прежнее', async () => {
        candidatesSpy = jest.spyOn(alertService, '_voltageSeverityCandidates')
            .mockResolvedValue(['WARNING']);
        gateSpy = jest.spyOn(alertService, '_checkPersistenceGate')
            .mockResolvedValue({ allowed: true, reason: 'ok' });

        await alertService.checkVoltage(42);

        expect(gateSpy).toHaveBeenCalledTimes(1);
        expect(createSpy.mock.calls[0][0].severity).toBe('WARNING');
    });

    test('аномалии нет вовсе → ни гейта, ни тревоги', async () => {
        candidatesSpy = jest.spyOn(alertService, '_voltageSeverityCandidates')
            .mockResolvedValue([]);
        gateSpy = jest.spyOn(alertService, '_checkPersistenceGate');

        const result = await alertService.checkVoltage(42);

        expect(result).toBeNull();
        expect(gateSpy).not.toHaveBeenCalled();
        expect(createSpy).not.toHaveBeenCalled();
    });

    test('правило выбранного уровня передаётся в createAlert снимком', async () => {
        // Тот же приём, что в verify-режиме: между проверкой гейта и вставкой
        // правило могли отключить, и повторное чтение дало бы null → fail-open.
        candidatesSpy = jest.spyOn(alertService, '_voltageSeverityCandidates')
            .mockResolvedValue(['CRITICAL', 'WARNING']);
        gateSpy = jest.spyOn(alertService, '_checkPersistenceGate')
            .mockImplementation(async (alertData) => (
                alertData.severity === 'CRITICAL'
                    ? { allowed: false, reason: 'only 1 sample' }
                    : { allowed: true, reason: 'ok' }
            ));

        await alertService.checkVoltage(42);

        const [, options] = createSpy.mock.calls[0];
        expect(options?.ruleSnapshot).toMatchObject({ severity: 'WARNING' });
    });

    test('уровня без правила гейты не касаются — поведение createAlert сохранено', async () => {
        // В createAlert отсутствие правила означает «гейты не применяются».
        // Селектор обязан вести себя так же, иначе он стал бы строже
        // createAlert и молча душил бы типы без политики.
        AlertRule.findByTypeAndSeverity.mockResolvedValue(null);
        candidatesSpy = jest.spyOn(alertService, '_voltageSeverityCandidates')
            .mockResolvedValue(['CRITICAL', 'WARNING']);
        gateSpy = jest.spyOn(alertService, '_checkPersistenceGate');

        await alertService.checkVoltage(42);

        expect(gateSpy).not.toHaveBeenCalled();
        expect(createSpy.mock.calls[0][0].severity).toBe('CRITICAL');
    });
});
