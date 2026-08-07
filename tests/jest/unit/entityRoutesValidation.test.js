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
            .send({ name: 'ТП-1', latitude: 41.31, longitude: 69.24, power_rating: 100 });

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
            .send({ name: 'Линия-1', voltage_kv: 10, commissioning_year: 2020 });

        expect(res.status).toBe(201);
        expect(mockCreated).toHaveBeenCalledTimes(1);
    });
});
