/**
 * [AR-10] Схемная валидация тел admin-CRUD.
 *
 * Было: схема есть у 2 сущностей из ~15. Тела `/admin/transformers`, `/admin/lines`,
 * `/admin/water-lines`, `/admin/cold-water-sources`, `/admin/heat-sources` не
 * проверялись схемой вообще — только «поле не пустое» в самом контроллере, а
 * координаты, диаметры и напряжения принимались любыми.
 *
 * Библиотека НЕ добавлялась: `express-validator` уже есть, уже подключён и после
 * AR-4 отдаёт канонический конверт. Вторая схемная библиотека рядом с ней — это
 * ровно те «две параллельные реализации одного и того же», которые отчёт и
 * велит устранять.
 *
 * Поля взяты из writable-колонок моделей, а не выдуманы: Line
 * (LINE_WRITABLE_COLUMNS), WaterLine (WATER_LINE_WRITABLE_COLUMNS + домен
 * статуса), ColdWaterSource/HeatSource (FIELDS).
 */

const request = require('supertest');
const express = require('express');

const V = require('../../../src/middleware/validators');

/** Поднять минимальное приложение с одним валидируемым POST. */
const appWith = (chain) => {
    const app = express();
    app.use(express.json());
    app.post('/t', chain, (req, res) => res.json({ success: true, data: 'ok' }));
    return app;
};

/** Достать список полей, на которые пожаловалась валидация. */
const failedFields = (res) => (res.body.error.details || []).map(d => d.field);

describe('[AR-10] общая форма ответа валидации', () => {
    test('отказ приходит в каноническом конверте с details', async () => {
        const res = await request(appWith(V.validateTransformerCreate)).post('/t').send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(Array.isArray(res.body.error.details)).toBe(true);
        expect(res.body.error.details.length).toBeGreaterThan(0);
    });
});

describe('[AR-10] трансформаторы', () => {
    const app = appWith(V.validateTransformerCreate);

    test('имя обязательно', async () => {
        const res = await request(app).post('/t').send({ latitude: 41.3, longitude: 69.2 });
        expect(failedFields(res)).toContain('name');
    });

    test('координаты обязаны быть в допустимом диапазоне', async () => {
        const res = await request(app).post('/t').send({ name: 'ТП-1', latitude: 91, longitude: 69.2 });
        expect(failedFields(res)).toContain('latitude');
    });

    test('долгота вне диапазона отклоняется', async () => {
        const res = await request(app).post('/t').send({ name: 'ТП-1', latitude: 41.3, longitude: 181 });
        expect(failedFields(res)).toContain('longitude');
    });

    test('напряжение не может быть отрицательным', async () => {
        const res = await request(app).post('/t')
            .send({ name: 'ТП-1', latitude: 41.3, longitude: 69.2, voltage_primary: -5 });
        expect(failedFields(res)).toContain('voltage_primary');
    });

    test('корректное тело проходит', async () => {
        const res = await request(app).post('/t').send({
            name: 'ТП-1', latitude: 41.3, longitude: 69.2,
            voltage_primary: 10, voltage_secondary: 0.4
        });
        expect(res.status).toBe(200);
    });

    test('XSS в имени отклоняется', async () => {
        const res = await request(app).post('/t')
            .send({ name: '<script>alert(1)</script>', latitude: 41.3, longitude: 69.2 });
        expect(failedFields(res)).toContain('name');
    });
});

describe('[AR-10] линии электропередач', () => {
    const app = appWith(V.validateLineCreate);

    test('имя обязательно', async () => {
        expect(failedFields(await request(app).post('/t').send({}))).toContain('name');
    });

    test('напряжение и длина — числа, и неотрицательные', async () => {
        const res = await request(app).post('/t').send({ name: 'Л-1', voltage_kv: 'высокое', length_km: -3 });
        const fields = failedFields(res);
        expect(fields).toContain('voltage_kv');
        expect(fields).toContain('length_km');
    });

    test('год ввода в эксплуатацию правдоподобен', async () => {
        const res = await request(app).post('/t').send({ name: 'Л-1', commissioning_year: 1500 });
        expect(failedFields(res)).toContain('commissioning_year');
    });

    test('корректное тело проходит', async () => {
        const res = await request(app).post('/t')
            .send({ name: 'Л-1', voltage_kv: 10, length_km: 2.5, commissioning_year: 2020 });
        expect(res.status).toBe(200);
    });
});

describe('[AR-10] линии водоснабжения', () => {
    const app = appWith(V.validateWaterLineCreate);

    test('имя обязательно', async () => {
        expect(failedFields(await request(app).post('/t').send({}))).toContain('name');
    });

    // Домен статуса уже закреплён в БД (миграция 040) и в модели
    // (assertValidStatus). Валидатор — третий рубеж, но самый ранний:
    // отказ приходит до попадания в контроллер.
    test('статус вне домена отклоняется', async () => {
        const res = await request(app).post('/t').send({ name: 'В-1', status: 'выключена' });
        expect(failedFields(res)).toContain('status');
    });

    test('все три статуса из домена принимаются', async () => {
        for (const status of ['active', 'maintenance', 'inactive']) {
            const res = await request(app).post('/t').send({ name: 'В-1', status });
            expect(res.status).toBe(200);
        }
    });

    test('диаметр и давление — положительные числа', async () => {
        const res = await request(app).post('/t')
            .send({ name: 'В-1', diameter_mm: -100, pressure_bar: 'много' });
        const fields = failedFields(res);
        expect(fields).toContain('diameter_mm');
        expect(fields).toContain('pressure_bar');
    });
});

describe('[AR-10] источники воды и тепла', () => {
    test('холодная вода: имя обязательно, координаты в диапазоне', async () => {
        const app = appWith(V.validateColdWaterSourceCreate);
        const res = await request(app).post('/t').send({ latitude: -91 });
        const fields = failedFields(res);
        expect(fields).toContain('name');
        expect(fields).toContain('latitude');
    });

    test('тепло: мощность неотрицательна', async () => {
        const app = appWith(V.validateHeatSourceCreate);
        const res = await request(app).post('/t').send({ name: 'ТЭЦ-1', capacity_mw: -10 });
        expect(failedFields(res)).toContain('capacity_mw');
    });

    test('тепло: корректное тело проходит', async () => {
        const app = appWith(V.validateHeatSourceCreate);
        const res = await request(app).post('/t')
            .send({ name: 'ТЭЦ-1', capacity_mw: 120, latitude: 41.3, longitude: 69.2 });
        expect(res.status).toBe(200);
    });
});

describe('[AR-10] необязательные поля остаются необязательными', () => {
    // Иначе валидация превратилась бы в ломающее изменение для админки:
    // формы шлют только заполненные поля.
    test('пустое необязательное поле не делает запрос невалидным', async () => {
        const app = appWith(V.validateTransformerCreate);
        const res = await request(app).post('/t').send({ name: 'ТП-2', latitude: 41.3, longitude: 69.2 });
        expect(res.status).toBe(200);
    });

    test('null в необязательном числовом поле допустим', async () => {
        const app = appWith(V.validateLineCreate);
        const res = await request(app).post('/t').send({ name: 'Л-2', voltage_kv: null });
        expect(res.status).toBe(200);
    });
});
