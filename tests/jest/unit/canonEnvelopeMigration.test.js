/**
 * [AR-4] Перевод трёх форм-нарушителей на канон.
 *
 * Это ЛОМАЮЩЕЕ изменение контракта, поэтому формы закрепляются тестами: если
 * кто-то вернёт старую, тест назовёт её по имени.
 *
 *   express-validator  {errors:[…]}                  → {success:false, error:{…, details}}
 *   лимитер            {success:false, message, error:'КОД'} → error.code, error остаётся объектом
 *   листинги           {data, pagination}            → {success:true, data, pagination}
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const request = require('supertest');
const express = require('express');

describe('[AR-4] express-validator → канон', () => {
    const { validateBuildingCreate } = require('../../../src/middleware/validators');

    const app = express();
    app.use(express.json());
    app.post('/b', validateBuildingCreate, (req, res) => res.json({ success: true, data: 'ok' }));

    test('ошибка валидации приходит в каноническом конверте', async () => {
        const res = await request(app).post('/b').send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(typeof res.body.error).toBe('object');
        expect(res.body.error.status).toBe(400);
        expect(typeof res.body.error.message).toBe('string');
    });

    test('по-полевые ошибки сохранены в details — иначе нечего исправлять', async () => {
        const res = await request(app).post('/b').send({ name: 'Дом' });

        const details = res.body.error.details;
        expect(Array.isArray(details)).toBe(true);
        expect(details.length).toBeGreaterThan(0);

        const fields = details.map(d => d.field);
        expect(fields).toContain('address');
        expect(details.every(d => typeof d.message === 'string' && d.message.length > 0)).toBe(true);
    });

    test('старой формы {errors:[…]} без success больше нет', async () => {
        const res = await request(app).post('/b').send({});

        expect(res.body).not.toHaveProperty('errors');
        expect(res.body).toHaveProperty('success');
    });

    test('валидное тело проходит насквозь', async () => {
        const res = await request(app).post('/b').send({
            name: 'Дом', address: 'ул. Тестовая, 1', town: 'Ташкент',
            latitude: 41.3, longitude: 69.2
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('[AR-4] лимитер → канон', () => {
    const { SimpleRateLimiter, resetAllRateLimits, destroyAllLimiters } =
        require('../../../src/middleware/rateLimiter');

    afterAll(() => destroyAllLimiters());
    beforeEach(async () => { await resetAllRateLimits(); });

    const appWithLimit = () => {
        const limiter = new SimpleRateLimiter({
            windowMs: 60000, max: 1, message: 'Слишком много запросов', namespace: 'canon-test'
        });
        const app = express();
        app.set('trust proxy', true);
        app.get('/x', limiter.middleware(), (req, res) => res.json({ success: true, data: 'ok' }));
        return app;
    };

    test('429 приходит в каноническом конверте, error — ОБЪЕКТ', async () => {
        const app = appWithLimit();
        await request(app).get('/x');
        const res = await request(app).get('/x');

        expect(res.status).toBe(429);
        expect(res.body.success).toBe(false);
        expect(typeof res.body.error).toBe('object');
    });

    test('машинный код переехал в error.code, а не в error-строку', async () => {
        const app = appWithLimit();
        await request(app).get('/x');
        const res = await request(app).get('/x');

        expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(typeof res.body.error).not.toBe('string');
    });

    test('лимиты и retryAfter — в meta, человеку показывается message', async () => {
        const app = appWithLimit();
        await request(app).get('/x');
        const res = await request(app).get('/x');

        expect(res.body.error.message).toBe('Слишком много запросов');
        expect(res.body.error.meta.limit).toBe(1);
        expect(typeof res.body.error.meta.retryAfter).toBe('number');
    });

    test('заголовок Retry-After сохранён — на него смотрят клиенты, а не только люди', async () => {
        const app = appWithLimit();
        await request(app).get('/x');
        const res = await request(app).get('/x');

        expect(res.headers['retry-after']).toBeDefined();
    });
});
