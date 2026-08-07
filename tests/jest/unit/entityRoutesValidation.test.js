/**
 * [AR-10, доработка] Схемы должны стоять на тех маршрутах, которыми реально
 * пользуется админка.
 *
 * Волна 3 повесила схемы только на `POST /api/admin/*`. Браузерная проверка на
 * живом стенде показала, что форма «Добавить трансформатор» шлёт
 * `POST /api/transformers` — и трансформатор с именем `<script>alert(1)</script>`
 * создался с кодом 201. То есть валидация была, но не на пути клиента: из пяти
 * сущностей UI ходит в `/api/admin/*` ровно для одной (водные линии).
 *
 * Эти тесты бьют по тем URL, по которым ходит админка. Они падали до правки —
 * возвращалась 201 вместо 400.
 *
 * `isAdmin` замокан: предмет проверки — валидация тела, а не доступ; авторизация
 * покрыта отдельно в default-deny.test.js.
 */

jest.mock('../../../src/middleware/auth', () => ({
    isAdmin: (req, res, next) => next(),
    authenticateJWT: (req, res, next) => next(),
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// Контроллеры замоканы целиком: если валидация пропустит запрос, тест увидит
// это по вызову create — и по коду 201, а не по ошибке БД.
// Префикс `mock` обязателен: jest.mock поднимается наверх и запрещает
// ссылаться из фабрики на переменные без него.
const mockCreated = jest.fn((req, res) => res.status(201).json({ success: true, data: { id: 1 } }));

// Прокси вместо перечисления методов: маршрутные файлы ссылаются на десяток
// обработчиков, и список пришлось бы чинить при каждом новом маршруте. Любое
// имя отдаёт заглушку, `create*` — счётчик.
const stubController = () => new Proxy({}, {
    get: (_t, name) => (typeof name === 'string' && name.startsWith('create')
        ? (...a) => mockCreated(...a)
        : (req, res) => res.json({})),
});

jest.mock('../../../src/controllers/transformerController', () => stubController());
jest.mock('../../../src/controllers/lineController', () => stubController());
jest.mock('../../../src/controllers/coldWaterSourceController', () => stubController());

const request = require('supertest');
const express = require('express');

const buildApp = (mountPath, routesPath) => {
    const app = express();
    app.use(express.json());
    app.use(mountPath, require(routesPath));
    app.use(require('../../../src/middleware/errorHandler'));
    return app;
};

beforeEach(() => jest.clearAllMocks());

describe('[AR-10] POST /api/transformers — схема на маршруте, которым ходит админка', () => {
    const app = () => buildApp('/api/transformers', '../../../src/routes/transformerRoutes');

    test('XSS в названии отвергается 400, до контроллера не доходит', async () => {
        const res = await request(app())
            .post('/api/transformers')
            .send({ name: '<script>alert(1)</script>', latitude: 41.31, longitude: 69.24 });

        expect(res.status).toBe(400);
        expect(mockCreated).not.toHaveBeenCalled();
        expect(res.body.error.details.some(d => d.field === 'name')).toBe(true);
    });

    test('пустое название отвергается 400', async () => {
        const res = await request(app()).post('/api/transformers').send({ name: '   ' });

        expect(res.status).toBe(400);
        expect(mockCreated).not.toHaveBeenCalled();
    });

    test('координаты вне диапазона отвергаются 400', async () => {
        const res = await request(app())
            .post('/api/transformers')
            .send({ name: 'ТП-1', latitude: 200, longitude: 69.24 });

        expect(res.status).toBe(400);
        expect(mockCreated).not.toHaveBeenCalled();
    });

    test('корректное тело проходит к контроллеру', async () => {
        const res = await request(app())
            .post('/api/transformers')
            .send({ name: 'ТП-1', latitude: 41.31, longitude: 69.24, power_kva: 100, voltage_kv: 10 });

        expect(res.status).toBe(201);
        expect(mockCreated).toHaveBeenCalledTimes(1);
    });
});

describe('[AR-10] POST /api/lines — схема на маршруте, которым ходит админка', () => {
    const app = () => buildApp('/api/lines', '../../../src/routes/lineRoutes');

    test('год вне диапазона отвергается 400', async () => {
        const res = await request(app())
            .post('/api/lines')
            .send({ name: 'Линия-1', commissioning_year: 202 });

        expect(res.status).toBe(400);
        expect(mockCreated).not.toHaveBeenCalled();
    });

    test('корректное тело проходит к контроллеру', async () => {
        const res = await request(app())
            .post('/api/lines')
            .send({ name: 'Линия-1', voltage_kv: 10, length_km: 2.5, commissioning_year: 2020 });

        expect(res.status).toBe(201);
        expect(mockCreated).toHaveBeenCalledTimes(1);
    });
});

/**
 * [AR-10, доработка 2] Схема должна описывать РЕАЛЬНЫЕ колонки таблицы.
 *
 * Та же браузерная проверка вскрыла второй слой: схема трансформатора
 * перечисляла поля, которых в таблице нет (`power_rating`, `voltage_primary`,
 * `address`, `maintenance_contact`), и молчала про `power_kva` и `voltage_kv` —
 * NOT NULL с CHECK > 0. Итог: корректное с виду тело падало не на 400 с
 * указанием поля, а на 500 из БД. Ровно тот случай, ради которого AR-10 и
 * затевался.
 *
 * Обязательность здесь не ужесточение, а перевод отказа из 500 в 400: БД эти
 * тела и раньше не принимала.
 */
describe('[AR-10] схема повторяет ограничения БД, а не выдуманные поля', () => {
    const app = (mount, routes) => buildApp(mount, routes);

    describe('POST /api/transformers', () => {
        const post = (body) => request(app('/api/transformers', '../../../src/routes/transformerRoutes'))
            .post('/api/transformers').send(body);

        test('без power_kva → 400 с указанием поля, а не 500 из БД', async () => {
            const res = await post({ name: 'ТП-1', voltage_kv: 10, latitude: 41.3, longitude: 69.2 });

            expect(res.status).toBe(400);
            expect(res.body.error.details.some(d => d.field === 'power_kva')).toBe(true);
            expect(mockCreated).not.toHaveBeenCalled();
        });

        test('power_kva = 0 → 400: в БД стоит CHECK power_kva > 0', async () => {
            const res = await post({ name: 'ТП-1', power_kva: 0, voltage_kv: 10 });

            expect(res.status).toBe(400);
            expect(mockCreated).not.toHaveBeenCalled();
        });

        test('без voltage_kv → 400', async () => {
            const res = await post({ name: 'ТП-1', power_kva: 100 });

            expect(res.status).toBe(400);
            expect(mockCreated).not.toHaveBeenCalled();
        });

        test('тело, которое реально шлёт форма админки, проходит', async () => {
            const res = await post({ name: 'ТП-1', power_kva: 100, voltage_kv: 10, latitude: 41.31, longitude: 69.24 });

            expect(res.status).toBe(201);
            expect(mockCreated).toHaveBeenCalledTimes(1);
        });
    });

    describe('POST /api/lines', () => {
        const post = (body) => request(app('/api/lines', '../../../src/routes/lineRoutes'))
            .post('/api/lines').send(body);

        test('без length_km → 400: колонка NOT NULL', async () => {
            const res = await post({ name: 'Линия-1', voltage_kv: 10 });

            expect(res.status).toBe(400);
            expect(res.body.error.details.some(d => d.field === 'length_km')).toBe(true);
        });

        test('полное тело проходит', async () => {
            const res = await post({ name: 'Линия-1', voltage_kv: 10, length_km: 2.5 });

            expect(res.status).toBe(201);
            expect(mockCreated).toHaveBeenCalledTimes(1);
        });
    });

    describe('POST /api/cold-water-sources', () => {
        const post = (body) => request(app('/api/cold-water-sources', '../../../src/routes/waterSourceRoutes'))
            .post('/api/cold-water-sources').send(body);

        test('без address / source_type / координат → 400', async () => {
            const res = await post({ name: 'Скважина-1' });

            expect(res.status).toBe(400);
            const fields = res.body.error.details.map(d => d.field);
            expect(fields).toEqual(expect.arrayContaining(['address', 'source_type', 'latitude', 'longitude']));
            expect(mockCreated).not.toHaveBeenCalled();
        });

        test('полное тело проходит', async () => {
            const res = await post({
                name: 'Скважина-1', address: 'ул. Тестовая, 1', source_type: 'well',
                latitude: 41.31, longitude: 69.24,
            });

            expect(res.status).toBe(201);
            expect(mockCreated).toHaveBeenCalledTimes(1);
        });
    });
});
