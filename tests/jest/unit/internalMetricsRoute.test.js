/**
 * [AR-2 / Task 6] Эндпоинт /internal/metrics.
 *
 * Путь и способ авторизации заданы строфой скрейпа в profk-observability
 * (alloy/config.alloy): `metrics_path = "/internal/metrics"`, `bearer_token_file`,
 * то есть заголовок `Authorization: Bearer <token>`.
 *
 * Fail-closed по токену — намеренно строже, чем requireServiceToken (тот
 * «спит, пока не настроен»). Метрики раскрывают операционную картину
 * (сколько объектов, идёт ли телеметрия), поэтому «не настроено» здесь должно
 * означать «выключено», а не «открыто всем». Публичный эдж этот путь и так не
 * проксирует — в приложение уходит только /api/ — но полагаться на одну
 * лишь топологию не стоит.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

jest.mock('../../../src/config/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] })
}));

const express = require('express');
const request = require('supertest');
const { mountInternalMetrics } = require('../../../src/observability/metricsRoute');

const TOKEN = 'test-metrics-token-0123456789abcdef';

function makeApp() {
    const app = express();
    mountInternalMetrics(app);
    return app;
}

describe('[AR-2] /internal/metrics', () => {
    const ORIGINAL = process.env.INTERNAL_METRICS_TOKEN;

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.INTERNAL_METRICS_TOKEN;
        else process.env.INTERNAL_METRICS_TOKEN = ORIGINAL;
    });

    test('токен не задан → эндпоинт выключен (503), метрики не отдаются', async () => {
        delete process.env.INTERNAL_METRICS_TOKEN;

        const res = await request(makeApp()).get('/internal/metrics');

        expect(res.status).toBe(503);
        expect(res.text).not.toContain('infrasafe_');
    });

    test('без заголовка Authorization → 401', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp()).get('/internal/metrics');

        expect(res.status).toBe(401);
    });

    test('чужой токен → 401, и метрики не утекают', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp())
            .get('/internal/metrics')
            .set('Authorization', 'Bearer wrong-token-0123456789abcdefgh');

        expect(res.status).toBe(401);
        expect(res.text).not.toContain('infrasafe_');
    });

    test('токен другой длины отвергается без исключения timingSafeEqual', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp())
            .get('/internal/metrics')
            .set('Authorization', 'Bearer short');

        expect(res.status).toBe(401);
    });

    test('верный токен → 200 и формат Prometheus', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp())
            .get('/internal/metrics')
            .set('Authorization', `Bearer ${TOKEN}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.text).toContain('infrasafe_alert_checks_total');
    });

    // Разбор заголовка стал строковым (без регулярки) после CodeQL
    // polynomial-redos — семантику фиксируем явно.
    test('"BearerXYZ" без разделителя не принимается за схему', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp())
            .get('/internal/metrics')
            .set('Authorization', `Bearer${TOKEN}`);

        expect(res.status).toBe(401);
    });

    test('лишние пробелы после схемы допускаются', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp())
            .get('/internal/metrics')
            .set('Authorization', `Bearer   ${TOKEN}`);

        expect(res.status).toBe(200);
    });

    test('пустой токен после схемы отвергается', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp())
            .get('/internal/metrics')
            .set('Authorization', 'Bearer    ');

        expect(res.status).toBe(401);
    });

    test('схема Basic не принимается вместо Bearer', async () => {
        process.env.INTERNAL_METRICS_TOKEN = TOKEN;

        const res = await request(makeApp())
            .get('/internal/metrics')
            .set('Authorization', `Basic ${TOKEN}`);

        expect(res.status).toBe(401);
    });
});
