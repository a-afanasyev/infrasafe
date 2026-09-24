/**
 * [N-52] Открытый circuit breaker отвечает клиенту 503, а не 500.
 *
 * `_rejectWithFallback` бросал голый `Error('Сервис временно недоступен')` без
 * `statusCode` и `code`, и `errorHandler` превращал его в 500 «Внутренняя
 * ошибка сервера». Временное, стоящее повтора состояние выглядело как поломка —
 * это было видно вживую при проверке N-05.
 *
 * Правка сделана в двух общих местах, а не в каждом контроллере: у ошибки
 * отказа свой `code` (CIRCUIT_OPEN), `statusCode` 503 и срок до следующей
 * попытки, а `errorHandler` показывает её текст и ставит `Retry-After`.
 *
 * Собрано из настоящих частей — express, CircuitBreaker, errorHandler: мок любой
 * из них проверял бы договорённость теста с самим собой.
 */
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { CircuitBreaker, CIRCUIT_OPEN } = require('../../../src/utils/circuitBreaker');
const errorHandler = require('../../../src/middleware/errorHandler');

const RESET_MS = 30000;

function makeApp(breaker, fallback) {
    const app = express();
    app.get('/guarded', async (req, res, next) => {
        try {
            res.json({ ok: await breaker.execute(() => Promise.resolve('live'), fallback) });
        } catch (error) {
            next(error);
        }
    });
    app.use(errorHandler);
    return app;
}

async function openBreaker() {
    const breaker = new CircuitBreaker({ name: 'N52', failureThreshold: 2, resetTimeout: RESET_MS });
    for (let i = 0; i < 2; i++) {
        await breaker.execute(() => Promise.reject(new Error('db down'))).catch(() => {});
    }
    expect(breaker.state).toBe('OPEN');
    return breaker;
}

afterEach(() => jest.useRealTimers());

describe('[N-52] ошибка открытого breaker', () => {
    test('несёт code, statusCode 503 и срок до следующей попытки', async () => {
        const breaker = await openBreaker();

        const error = await breaker.execute(() => Promise.resolve('x')).catch((e) => e);

        expect(error.code).toBe(CIRCUIT_OPEN);
        expect(error.statusCode).toBe(503);
        expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(error.retryAfterSeconds).toBeLessThanOrEqual(RESET_MS / 1000);
        // Сообщение прежнее — на него опираются существующие проверки.
        expect(error.message).toBe('Сервис временно недоступен');
    });

    test('упавший fallback даёт ту же ошибку, с причиной', async () => {
        const breaker = await openBreaker();

        const error = await breaker
            .execute(() => Promise.resolve('x'), () => Promise.reject(new Error('fallback-fail')))
            .catch((e) => e);

        expect(error.code).toBe(CIRCUIT_OPEN);
        expect(error.statusCode).toBe(503);
        expect(error.cause.message).toBe('fallback-fail');
    });

    test('исправный fallback по-прежнему отвечает вместо отказа', async () => {
        const breaker = await openBreaker();
        await expect(breaker.execute(() => Promise.resolve('x'), () => 'cached')).resolves.toBe('cached');
    });
});

describe('[N-52] ответ клиенту', () => {
    test('503 с понятным текстом и Retry-After, а не 500 «Внутренняя ошибка»', async () => {
        const res = await request(makeApp(await openBreaker())).get('/guarded');

        expect(res.status).toBe(503);
        expect(res.body.error.message).toBe('Сервис временно недоступен');
        expect(res.body.error.status).toBe(503);
        const retryAfter = Number(res.headers['retry-after']);
        expect(retryAfter).toBeGreaterThanOrEqual(1);
        expect(retryAfter).toBeLessThanOrEqual(RESET_MS / 1000);
    });

    test('закрытый breaker отвечает как обычно', async () => {
        const breaker = new CircuitBreaker({ name: 'N52-closed', failureThreshold: 2, resetTimeout: RESET_MS });
        const res = await request(makeApp(breaker)).get('/guarded');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: 'live' });
    });

    test('обычная 500 по-прежнему прячет текст', async () => {
        const app = express();
        app.get('/boom', (req, res, next) => next(new Error('password=hunter2 leaked in pg error')));
        app.use(errorHandler);

        const res = await request(app).get('/boom');

        expect(res.status).toBe(500);
        expect(res.body.error.message).toBe('Внутренняя ошибка сервера');
        expect(res.headers['retry-after']).toBeUndefined();
    });

    test('503 без явного expose текст тоже прячет', async () => {
        const app = express();
        app.get('/busy', (req, res, next) => next(Object.assign(new Error('pool: host=10.0.0.5 refused'), { statusCode: 503 })));
        app.use(errorHandler);

        const res = await request(app).get('/busy');

        expect(res.status).toBe(503);
        expect(res.body.error.message).toBe('Внутренняя ошибка сервера');
    });
});
