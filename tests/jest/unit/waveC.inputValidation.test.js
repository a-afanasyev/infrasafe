/**
 * Волна C — вход не проверяется там, где должен, и отказ приходит как 500.
 *
 * Четыре пункта беклога с общей темой: проверка либо отсутствует, либо стоит
 * слоем ниже, чем нужно, и клиент вместо «ты прислал не то» (4xx) получает
 * «у нас упало» (5xx). Для каждого правильный образец УЖЕ есть в репозитории
 * — это перенос дисциплины, а не изобретение.
 *
 *   CO-7  `?days=abc` → NaN проходит мимо обеих границ. Образец рядом:
 *         integrationController.js:183 делает `isNaN(id)`.
 *   L-6   enum `event` building-вебхука проверяется в сервисе, но не на входе.
 *         Образец рядом: соседний обработчик `/request` зовёт
 *         `isValidRequestEvent` прямо в контроллере.
 *   L-7   `Controller.create` пишет `status` без whitelist, а CHECK в БД нет
 *         (проверено на живой схеме: у `controllers` ни одного check-constraint).
 *         Образец рядом: `WaterLine.assertValidStatus` (M-12).
 *   AR-11 `retryLog` меняет строку `integration_log` двумя автокоммитами.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const db = require('../../../src/config/database');

describe('[CO-7] статистика алертов: нечисловой period', () => {
    const alertService = require('../../../src/services/alertService');
    const { getAlertStatistics } = require('../../../src/controllers/alertController');

    let req, res, next;
    beforeEach(() => {
        jest.clearAllMocks();
        req = { params: {}, query: {}, body: {} };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        next = jest.fn();
        jest.spyOn(alertService, 'getAlertStatistics').mockResolvedValue({ total: 0 });
    });
    afterEach(() => jest.restoreAllMocks());

    test.each(['abc', 'NaN', '7дней', '1e3', '7.5'])(
        'days=%p отбивается 400, а не считается',
        async (days) => {
            req.query.days = days;

            await getAlertStatistics(req, res, next);

            // Главное: до сервиса такой запрос доходить не должен вообще.
            expect(alertService.getAlertStatistics).not.toHaveBeenCalled();
            // Отказ идёт каноническим конвертом через `sendError` (AR-4), а не
            // через `next` — контроллер отвечает сам.
            expect(res.status).toHaveBeenCalledWith(400);
            const payload = res.json.mock.calls[0][0];
            expect(payload.success).toBe(false);
            expect(payload.error.status).toBe(400);
        }
    );

    test.each(['', '   '])(
        'days=%p считается ОТСУТСТВУЮЩИМ и даёт умолчание, а не 400',
        async (days) => {
            // Решение принято здесь осознанно: `?days=` — это пустое поле формы,
            // а не присланный мусор. Ронять на нём запрос значило бы наказывать
            // за UI, который отправляет незаполненный фильтр.
            req.query.days = days;

            await getAlertStatistics(req, res, next);

            expect(alertService.getAlertStatistics).toHaveBeenCalledWith(7);
            expect(next).not.toHaveBeenCalled();
        }
    );

    test('корректный days по-прежнему работает', async () => {
        req.query.days = '30';

        await getAlertStatistics(req, res, next);

        expect(alertService.getAlertStatistics).toHaveBeenCalledWith(30);
        expect(next).not.toHaveBeenCalled();
    });

    test('отсутствующий days даёт умолчание 7', async () => {
        await getAlertStatistics(req, res, next);

        expect(alertService.getAlertStatistics).toHaveBeenCalledWith(7);
    });

    test('границы 1 и 365 включительно, 0 и 366 — нет', async () => {
        for (const [days, allowed] of [['1', true], ['365', true], ['0', false], ['366', false]]) {
            jest.clearAllMocks();
            req.query.days = days;
            await getAlertStatistics(req, res, next);
            expect(alertService.getAlertStatistics).toHaveBeenCalledTimes(allowed ? 1 : 0);
        }
    });
});

describe('[L-6] building-вебхук: неизвестный event', () => {
    const { handleBuilding } = require('../../../src/controllers/webhookController');

    let req, res;
    beforeEach(() => {
        jest.clearAllMocks();
        req = { body: {}, headers: {} };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    });

    test('неизвестный event отбивается 400 на входе, а не падает 500 в сервисе', async () => {
        req.body = {
            event_id: '11111111-2222-3333-4444-555555555555',
            event: 'building.exploded',
            building: { id: 1, name: 'Дом' }
        };

        await handleBuilding(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        const payload = res.json.mock.calls[0][0];
        expect(payload.success).toBe(false);
        // Сообщение должно называть допустимые значения — иначе интегратору
        // на той стороне нечего исправлять.
        expect(String(payload.message)).toMatch(/event/i);
    });

    test.each(['building.created', 'building.updated', 'building.deleted'])(
        'штатный event %s не отбивается валидацией входа',
        async (event) => {
            req.body = {
                event_id: '11111111-2222-3333-4444-555555555555',
                event,
                building: { id: 1, name: 'Дом' }
            };

            await handleBuilding(req, res);

            // Дальше запрос может упасть по другим причинам (моки БД), но
            // ИМЕННО 400 про event он получить не должен.
            const status = res.status.mock.calls[0]?.[0];
            if (status === 400) {
                expect(String(res.json.mock.calls[0][0].message)).not.toMatch(/event/i);
            }
        }
    );
});

describe('[L-7] Controller.create: whitelist статуса', () => {
    const Controller = require('../../../src/models/Controller');

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockResolvedValue({ rows: [{ controller_id: 1 }] });
    });

    test('недопустимый статус отбивается 400 моделью, а не уезжает в БД', async () => {
        await expect(
            Controller.create({ serial_number: 'SN-1', building_id: 1, status: 'взорван' })
        ).rejects.toMatchObject({ statusCode: 400 });

        expect(db.query).not.toHaveBeenCalled();
    });

    test.each(['online', 'offline', 'maintenance'])('статус %s проходит', async (status) => {
        await Controller.create({ serial_number: 'SN-1', building_id: 1, status });
        expect(db.query).toHaveBeenCalled();
    });

    test('отсутствующий статус проходит — дефолт ставит БД', async () => {
        await Controller.create({ serial_number: 'SN-1', building_id: 1 });
        expect(db.query).toHaveBeenCalled();
    });
});

describe('[AR-11] retryLog: одна запись вместо двух автокоммитов', () => {
    const IntegrationLog = require('../../../src/models/IntegrationLog');

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockResolvedValue({ rows: [{ id: 7, status: 'pending', retry_count: 3 }] });
    });

    test('markForRetry меняет статус и счётчик ОДНИМ запросом', async () => {
        await IntegrationLog.markForRetry(7);

        // Два автокоммита оставляли окно, в котором строка уже 'pending', но
        // счётчик ещё старый: параллельный ретрай мог пройти повторно.
        expect(db.query).toHaveBeenCalledTimes(1);
        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/retry_count\s*=\s*retry_count\s*\+\s*1/);
        expect(sql).toMatch(/status/);
        expect(params).toEqual([7]);
    });
});
