'use strict';

/**
 * [C-3 / S-INJ-5, аудит 05.11.2026] Один валидатор `ids` на все шесть
 * batch-маршрутов админки. У transformers/lines/water-lines проверки не было:
 * `['x']` уходил в ANY($1::int[]) → 22P02 → 500 вместо 400.
 */

const express = require('express');
const request = require('supertest');

const { validateBatchIds, validateIntParam } = require('../../../src/middleware/validators');

const app = express();
app.use(express.json());
app.post('/batch', validateBatchIds, (req, res) => res.json({ ok: true, n: req.body.ids.length }));
app.get('/items/:id', validateIntParam('id'), (req, res) => res.json({ id: req.params.id }));

describe('[C-3] validateBatchIds', () => {
    test('массив положительных целых — проходит', async () => {
        const res = await request(app).post('/batch').send({ action: 'delete', ids: [1, 2, 3] });
        expect(res.status).toBe(200);
        expect(res.body.n).toBe(3);
    });

    test.each([
        ['строки вместо чисел', ['x']],
        ['дробные', [1.5]],
        ['ноль и отрицательные', [0, -1]],
        ['пустой массив', []],
        ['не массив', 'abc'],
        ['за пределами int4', [2147483648]],
        ['длиннее 1000', Array.from({ length: 1001 }, (_, i) => i + 1)],
    ])('%s → 400', async (_label, ids) => {
        const res = await request(app).post('/batch').send({ action: 'delete', ids });
        expect(res.status).toBe(400);
    });

    test('ровно 1000 — проходит', async () => {
        const res = await request(app).post('/batch').send({ ids: Array.from({ length: 1000 }, (_, i) => i + 1) });
        expect(res.status).toBe(200);
    });
});

describe('[S-INJ-5] validateIntParam — границы int4', () => {
    test('99999999999 → 400, а не 500 из pg (22003)', async () => {
        expect((await request(app).get('/items/99999999999')).status).toBe(400);
        expect((await request(app).get('/items/0')).status).toBe(400);
        expect((await request(app).get('/items/2147483647')).status).toBe(200);
    });
});
