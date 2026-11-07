'use strict';

/**
 * [S-INJ-2, аудит 05.11.2026] Контракт диапазона дат для выборки метрик.
 *
 * До правки startDate/endDate из query шли в SQL и в ключ кэша как есть, а без
 * дат отдавалась вся история контроллера: каждый уникальный запрос — новая
 * запись в L1-кэше и десятки тысяч строк в куче. Здесь — четыре случая
 * (обе даты / одна / другая / ни одной), порядок границ, потолок окна и
 * закрытый список timeFrame. Через настоящий Express: валидатор — это цепочка
 * express-validator + нормализатор, и смотреть надо на то, что приходит в
 * следующий обработчик.
 */

const express = require('express');
const request = require('supertest');

const { validateMetricsRange } = require('../../../src/middleware/validators');
const { metricsQuery } = require('../../../src/config/thresholds');

const DAY_MS = 24 * 60 * 60 * 1000;

const app = express();
app.get('/m', validateMetricsRange, (req, res) => res.json(req.metricsRange));

const span = (r) => Date.parse(r.end) - Date.parse(r.start);

describe('[S-INJ-2] validateMetricsRange', () => {
    test('обе даты в пределах окна — проходят как есть, в каноническом ISO', async () => {
        const res = await request(app).get('/m?startDate=2026-01-01&endDate=2026-01-31');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ start: '2026-01-01T00:00:00.000Z', end: '2026-01-31T00:00:00.000Z' });
    });

    test('startDate позже endDate → 400', async () => {
        const res = await request(app).get('/m?startDate=2026-02-01&endDate=2026-01-01');
        expect(res.status).toBe(400);
    });

    test(`окно шире ${metricsQuery.rangeMaxDays} дней → 400`, async () => {
        const res = await request(app).get('/m?startDate=2025-01-01&endDate=2026-01-01');
        expect(res.status).toBe(400);
    });

    test('только startDate — end = start + окно, но не позже now', async () => {
        const res = await request(app).get('/m?startDate=2024-01-01T00:00:00Z');
        expect(res.status).toBe(200);
        expect(span(res.body)).toBe(metricsQuery.rangeMaxDays * DAY_MS);
    });

    test('только startDate в будущем — end не раньше start', async () => {
        const res = await request(app).get('/m?startDate=2999-01-01T00:00:00Z');
        expect(res.status).toBe(200);
        expect(Date.parse(res.body.end)).toBeGreaterThanOrEqual(Date.parse(res.body.start));
    });

    test('только endDate — start = end − окно', async () => {
        const res = await request(app).get('/m?endDate=2026-06-01T00:00:00Z');
        expect(res.status).toBe(200);
        expect(span(res.body)).toBe(metricsQuery.rangeMaxDays * DAY_MS);
        expect(res.body.end).toBe('2026-06-01T00:00:00.000Z');
    });

    test(`ни одной даты — последние ${metricsQuery.rangeDefaultHours} часов (а не вся история)`, async () => {
        const before = Date.now();
        const res = await request(app).get('/m');
        expect(res.status).toBe(200);
        expect(span(res.body)).toBe(metricsQuery.rangeDefaultHours * 60 * 60 * 1000);
        expect(Date.parse(res.body.end)).toBeGreaterThanOrEqual(before);
    });

    test('не-ISO дата → 400', async () => {
        const res = await request(app).get('/m?startDate=yesterday');
        expect(res.status).toBe(400);
    });

    test('timeFrame вне списка → 400, из списка — ok', async () => {
        expect((await request(app).get('/m?timeFrame=30d')).status).toBe(400);
        expect((await request(app).get('/m?timeFrame=7d')).status).toBe(200);
    });
});
