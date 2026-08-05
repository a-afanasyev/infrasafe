/**
 * [AR-7] Кэш и лимитер на публичном /api/buildings-metrics.
 *
 * Эндпоинт публичный (`optionalAuth`), делает LATERAL «последняя метрика» на
 * каждый контроллер с `LIMIT 5000`, и до этой правки шёл в БД на КАЖДЫЙ запрос:
 * без кэша, без прикладного лимитера (у CRUD, аналитики и UK-инвентаря они
 * есть) и вне предохранителя. Защита была только краевая — 20 r/s на IP в
 * nginx, то есть один клиент мог держать БД под постоянной нагрузкой законными
 * с точки зрения эджа запросами.
 *
 * Кэшируется ТОЛЬКО анонимная выдача. Авторизованный вызов — это операторская
 * консоль (карта, по которой смотрят протечки, и админ, только что подвинувший
 * маркер), и пятнадцать секунд «правка не сохранилась» там дороже одного
 * сэкономленного запроса — тем более что админский путь записи кэши вообще не
 * инвалидирует. Побочный, но важный эффект: раз авторизованный ответ в кэш не
 * попадает вовсе, урезанность анонимной проекции (`mapAnonymousRow` не отдаёт
 * `external_id` — P-PENTEST-3) защищена структурно, а не аккуратностью ключа.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn(),
    set: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');
const cacheService = require('../../../src/services/cacheService');
const service = require('../../../src/services/buildingMetricsService');

const ROW = {
    building_id: 1,
    building_name: 'Дом 1',
    address: 'ул. Тестовая, 1',
    town: 'Ташкент',
    latitude: '41.3',
    longitude: '69.2',
    region: 'Юнусабад',
    management_company: 'УК-1',
    external_id: '11111111-1111-4111-8111-111111111111',
    has_hot_water: true,
    controller_id: 7,
    controller_serial: 'SN-7',
    controller_status: 'online',
    timestamp: '2026-08-05T10:00:00.000Z',
    electricity_ph1: '220.5',
    leak_sensor: false
};

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [ROW] });
    cacheService.get.mockResolvedValue(null);
    cacheService.set.mockResolvedValue(undefined);
});

describe('[AR-7] кэш /buildings-metrics', () => {
    test('промах кэша: идём в БД и кладём результат под TTL 10-30 с', async () => {
        await service.getBuildingsWithMetrics(false, {});

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(cacheService.set).toHaveBeenCalledTimes(1);

        const [, , options] = cacheService.set.mock.calls[0];
        expect(options.ttl).toBeGreaterThanOrEqual(10);
        expect(options.ttl).toBeLessThanOrEqual(30);
    });

    test('попадание в кэш: БД не трогаем вовсе', async () => {
        const cached = { data: [{ building_id: 1 }], pagination: { total: 1 } };
        cacheService.get.mockResolvedValue(cached);

        const result = await service.getBuildingsWithMetrics(false, {});

        expect(db.query).not.toHaveBeenCalled();
        expect(result).toEqual(cached);
    });

    // Самый важный тест файла: авторизованная выдача не кэшируется вовсе.
    test('авторизованный вызов не трогает кэш ни на чтение, ни на запись', async () => {
        const result = await service.getBuildingsWithMetrics(true, {});

        expect(cacheService.get).not.toHaveBeenCalled();
        expect(cacheService.set).not.toHaveBeenCalled();
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(result.data[0].external_id).toBe(ROW.external_id);
    });

    test('прогретый анонимом кэш не отдаётся авторизованному (и наоборот)', async () => {
        // Аноним прогревает кэш урезанной проекцией.
        await service.getBuildingsWithMetrics(false, {});
        const anonPayload = cacheService.set.mock.calls[0][1];
        expect(anonPayload.data[0].external_id).toBeUndefined();

        // Авторизованный приходит следом — и всё равно идёт в БД за полной.
        cacheService.get.mockResolvedValue(anonPayload);
        const authResult = await service.getBuildingsWithMetrics(true, {});

        expect(authResult.data[0].external_id).toBe(ROW.external_id);
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('разный bbox — разные ключи', async () => {
        await service.getBuildingsWithMetrics(false, { bbox: { latMin: 41, latMax: 42, lngMin: 69, lngMax: 70 } });
        await service.getBuildingsWithMetrics(false, { bbox: { latMin: 41, latMax: 43, lngMin: 69, lngMax: 70 } });

        expect(cacheService.set.mock.calls[0][0]).not.toBe(cacheService.set.mock.calls[1][0]);
        expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('разный limit — разные ключи', async () => {
        await service.getBuildingsWithMetrics(false, { limit: 100 });
        await service.getBuildingsWithMetrics(false, { limit: 200 });

        expect(cacheService.set.mock.calls[0][0]).not.toBe(cacheService.set.mock.calls[1][0]);
    });

    // Кэш — ускоритель, а не зависимость: его отказ не должен ронять карту.
    test('отказ кэша на чтении: деградируем в БД, а не в 500', async () => {
        cacheService.get.mockRejectedValue(new Error('Redis down'));

        const result = await service.getBuildingsWithMetrics(false, {});

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(result.data).toHaveLength(1);
    });

    test('отказ кэша на записи: ответ всё равно отдаётся', async () => {
        cacheService.set.mockRejectedValue(new Error('Redis down'));

        const result = await service.getBuildingsWithMetrics(false, {});

        expect(result.data).toHaveLength(1);
    });
});
