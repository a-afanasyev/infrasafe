/**
 * [AR-7] Прикладной лимитер на публичном /api/buildings-metrics.
 *
 * До этой правки роут был единственным тяжёлым публичным эндпоинтом без
 * прикладного лимитера: у CRUD, аналитики, телеметрии и UK-инвентаря они есть,
 * а здесь защита была только краевая (20 r/s на IP в nginx).
 *
 * Лимитер отдельный, а не переиспользованный `applyAnalyticsRateLimit`,
 * намеренно: у аналитики есть slow-down (задержка после 20 запросов в минуту),
 * и на публичной карте он бил бы по офису за одним NAT — двадцать сотрудников,
 * открывших карту, это законный трафик, а не атака. Здесь нужен потолок против
 * одного назойливого клиента, а не штраф за плотность.
 *
 * Кэш (15 с) снимает повторные запросы с одинаковыми параметрами, поэтому
 * реальная работа лимитера — по запросам, которые кэш промахивают: клиент,
 * дёргающий эндпоинт со случайным bbox, каждым запросом платит LATERAL-скан.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../../src/services/buildingMetricsService', () => ({
    getBuildingsWithMetrics: jest.fn().mockResolvedValue({ data: [], pagination: {} }),
    parseBbox: jest.fn().mockReturnValue(null),
    parseLimit: jest.fn().mockReturnValue(5000)
}));
jest.mock('../../../src/middleware/auth', () => ({
    optionalAuth: (req, res, next) => next()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const { resetAllRateLimits, destroyAllLimiters } = require('../../../src/middleware/rateLimiter');

const buildApp = () => {
    const app = express();
    app.set('trust proxy', true);
    app.use('/api/buildings-metrics', require('../../../src/routes/buildingMetricsRoutes'));
    return app;
};

beforeEach(async () => {
    await resetAllRateLimits();
});

afterAll(() => {
    destroyAllLimiters();
});

// [FLAKE-1] Оба цикловых теста шлют десятки ПОСЛЕДОВАТЕЛЬНЫХ HTTP-запросов
// (supertest поднимает эфемерный сервер на каждый). В одиночном прогоне это
// миллисекунды, но в полном прогоне CPU делится между jest-воркерами, и
// дефолтных 5 с изредка не хватало — сьют падал по таймауту и был зелёным при
// повторе. Потому явный запас по времени; а потолок второго цикла срезан с 200
// до квоты (60) + запас: лишние ~140 запросов только растили окно флейка.
const LIMIT_TEST_TIMEOUT_MS = 15000;

describe('[AR-7] лимитер на /buildings-metrics', () => {
    test('обычная карточная нагрузка проходит без штрафа', async () => {
        const app = buildApp();

        for (let i = 0; i < 20; i++) {
            const res = await request(app).get('/api/buildings-metrics');
            expect(res.status).toBe(200);
        }
    }, LIMIT_TEST_TIMEOUT_MS);

    test('поток запросов с одного IP упирается в 429', async () => {
        const app = buildApp();

        let limited = false;
        for (let i = 0; i < 70 && !limited; i++) {
            const res = await request(app).get('/api/buildings-metrics');
            if (res.status === 429) limited = true;
        }

        expect(limited).toBe(true);
    }, LIMIT_TEST_TIMEOUT_MS);

    // Проект использует X-RateLimit-* (см. SimpleRateLimiter.middleware),
    // а не draft-заголовки RateLimit-*; проверяем принятую здесь конвенцию.
    test('лимитер отдаёт заголовки квоты', async () => {
        const app = buildApp();

        const res = await request(app).get('/api/buildings-metrics');

        expect(res.headers['x-ratelimit-limit']).toBe('60');
        expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });
});
