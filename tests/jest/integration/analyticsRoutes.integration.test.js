'use strict';

/**
 * [DE-7] Тринадцать эндпоинтов `/api/analytics/*` — в собранном роутере.
 *
 * Бэклог: «около трети публичной API-поверхности дёргают только bash-смоки:
 * `analyticsRoutes` — 13 эндпоинтов, фронт вызывает один». Юнит-тесты на
 * `analyticsController` и `analyticsService` есть и зелены, но они вызывают
 * функции НАПРЯМУЮ. Всё, что лежит между маршрутом и функцией, ими не
 * проверяется вовсе:
 *
 *   - подключён ли `isAdmin` к четырём изменяющим эндпоинтам (его пропуск —
 *     это повышение привилегий, и юнит-тест контроллера останется зелёным);
 *   - действует ли default-deny на остальных;
 *   - подключён ли `validateIntParam` там, где в пути стоит `:transformerId`;
 *   - и главное — КУДА попадает путь. `/transformers/statistics` объявлен
 *     ПОСЛЕ `/transformers/:transformerId/load`, `/transformers/overloaded` и
 *     `/transformers/search` — тоже. Express берёт первый подошедший маршрут,
 *     и одна лишняя однорсегментная `:transformerId`-ветка превратила бы
 *     `statistics` в идентификатор трансформатора. Проверить это можно только
 *     подняв роутер.
 *
 * Поэтому тест интеграционный: он поднимает настоящее приложение (supertest) и
 * ходит по путям, а не зовёт обработчики.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { setupQueryMock } = require('../helpers/dbMock');

// Лимитеры пропускают: предмет проверки — маршрутизация и guard'ы, а не
// ограничение частоты (у аналитики 30/мин плюс slow-down после 20 — полный
// прогон упёрся бы в них и стал медленным и плавающим).
jest.mock('../../../src/middleware/rateLimiter', () => {
    const passThrough = (_req, _res, next) => next();
    const limiterObj = { middleware: () => passThrough, destroy: () => {} };
    return {
        SimpleRateLimiter: jest.fn().mockImplementation(() => limiterObj),
        applyTelemetryRateLimit: passThrough,
        applyCrudRateLimit: passThrough,
        applyAnalyticsRateLimit: passThrough,
        applyAdminRateLimit: passThrough,
        applyUkInventoryRateLimit: passThrough,
        applyMapDataRateLimit: passThrough,
        rateLimitStrict: passThrough,
        authLimiter: limiterObj,
        refreshLimiter: limiterObj,
        twoFaLimiter: limiterObj,
        disable2faLimiter: limiterObj,
        registerLimiter: limiterObj,
        passwordChangeLimiter: limiterObj,
    };
});

jest.mock('../../../src/config/database', () => ({
    init: jest.fn().mockResolvedValue(true),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    close: jest.fn().mockResolvedValue(undefined),
    getPool: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

// Сервис заглушён целиком: проверяется путь ДО него. Каждый вызов
// записывается — так тест отличает «маршрут привёл в НУЖНЫЙ обработчик» от
// «маршрут вернул не-401 откуда-то ещё». Имена взяты из самого контроллера, а
// не придуманы: они местами расходятся с именами маршрутов (в частности
// `getLoadAnalysByZone` — опечатка, живущая в публичном методе сервиса).
const calls = [];
const stub = (name) => jest.fn(async (...args) => {
    calls.push({ name, args });
    return {};
});
const syncStub = (name) => jest.fn((...args) => {
    calls.push({ name, args });
    return {};
});
jest.mock('../../../src/services/analyticsService', () => ({
    getAllTransformersWithAnalytics: stub('getAllTransformersWithAnalytics'),
    getTransformerLoad: stub('getTransformerLoad'),
    getOverloadedTransformers: stub('getOverloadedTransformers'),
    findTransformersInRadius: stub('findTransformersInRadius'),
    findNearestBuildings: stub('findNearestBuildings'),
    getPeakLoadForecast: stub('getPeakLoadForecast'),
    getLoadAnalysByZone: stub('getLoadAnalysByZone'),
    getTransformerStatistics: stub('getTransformerStatistics'),
    // Синхронный: контроллер зовёт его БЕЗ await, и промис здесь сломал бы ответ.
    getCircuitBreakerStatus: syncStub('getCircuitBreakerStatus'),
    refreshTransformerAnalytics: stub('refreshTransformerAnalytics'),
    invalidateTransformerCaches: stub('invalidateTransformerCaches'),
    resetCircuitBreakers: stub('resetCircuitBreakers'),
    updateThresholds: stub('updateThresholds'),
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-analytics-itest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-analytics-itest';

const token = (role) => jwt.sign(
    { user_id: role === 'admin' ? 999 : 1, username: role, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
);

let app;
let adminAuth;
let userAuth;

beforeAll(() => {
    // Общая обвязка мока БД: `authenticateJWT` берёт роль ИЗ БАЗЫ, а не из
    // токена, поэтому без неё любой запрос с валидным токеном — 401
    // «пользователь не найден». Сентинел user_id 999 разрешается как админ.
    setupQueryMock(require('../../../src/config/database'));
    app = require('../../../src/server');
    adminAuth = `Bearer ${token('admin')}`;
    userAuth = `Bearer ${token('operator')}`;
});

beforeEach(() => { calls.length = 0; });

// Полная поверхность роутера — тринадцать штук, как в бэклоге.
const READ_ENDPOINTS = [
    ['get', '/api/analytics/transformers'],
    ['get', '/api/analytics/transformers/7/load'],
    ['get', '/api/analytics/transformers/overloaded'],
    ['get', '/api/analytics/transformers/search'],
    ['get', '/api/analytics/transformers/7/buildings'],
    ['get', '/api/analytics/transformers/7/forecast'],
    ['get', '/api/analytics/zones/load'],
    ['get', '/api/analytics/transformers/statistics'],
    ['get', '/api/analytics/status'],
];

const ADMIN_ENDPOINTS = [
    ['post', '/api/analytics/refresh'],
    ['post', '/api/analytics/cache/invalidate'],
    ['post', '/api/analytics/circuit-breakers/reset'],
    ['put', '/api/analytics/thresholds'],
];

const ALL = [...READ_ENDPOINTS, ...ADMIN_ENDPOINTS];

describe('[DE-7] вся поверхность /api/analytics закрыта default-deny', () => {
    test.each(ALL)('%s %s без токена → 401', async (method, url) => {
        const res = await request(app)[method](url);
        expect([method, url, res.status]).toEqual([method, url, 401]);
    });
});

describe('[DE-7] изменяющие эндпоинты требуют админа', () => {
    // Пропуск isAdmin здесь — повышение привилегий, и юнит-тест контроллера
    // остался бы зелёным: он зовёт обработчик мимо middleware.
    test.each(ADMIN_ENDPOINTS)('%s %s: обычный пользователь → 403', async (method, url) => {
        const res = await request(app)[method](url).set('Authorization', userAuth);
        expect([url, res.status]).toEqual([url, 403]);
    });

    test.each(ADMIN_ENDPOINTS)('%s %s: админ проходит guard', async (method, url) => {
        const res = await request(app)[method](url).set('Authorization', adminAuth).send({});
        expect([url, res.status === 401 || res.status === 403]).toEqual([url, false]);
    });
});

describe('[DE-7] путь ведёт в тот обработчик, что написан в маршруте', () => {
    const EXPECTED = [
        ['/api/analytics/transformers', 'getAllTransformersWithAnalytics'],
        ['/api/analytics/transformers/overloaded', 'getOverloadedTransformers'],
        ['/api/analytics/transformers/statistics', 'getTransformerStatistics'],
        ['/api/analytics/zones/load', 'getLoadAnalysByZone'],
        ['/api/analytics/status', 'getCircuitBreakerStatus'],
        ['/api/analytics/transformers/7/load', 'getTransformerLoad'],
        ['/api/analytics/transformers/7/buildings', 'findNearestBuildings'],
        ['/api/analytics/transformers/7/forecast', 'getPeakLoadForecast'],
    ];

    test.each(EXPECTED)('GET %s → %s', async (url, expected) => {
        await request(app).get(url).set('Authorization', adminAuth);
        expect([url, calls.map((c) => c.name)]).toEqual([url, expect.arrayContaining([expected])]);
    });

    test('«overloaded» и «statistics» не принимаются за :transformerId', async () => {
        // Они объявлены ПОСЛЕ маршрутов с параметром. Появись однасегментная
        // ветка `/transformers/:transformerId` — слово ушло бы в неё, и
        // validateIntParam вернул бы 400 на осмысленный путь.
        for (const url of ['/api/analytics/transformers/overloaded', '/api/analytics/transformers/statistics']) {
            const res = await request(app).get(url).set('Authorization', adminAuth);
            expect([url, res.status]).not.toEqual([url, 400]);
        }
    });
});

describe('[DE-7] :transformerId проверяется, а не уезжает в Postgres', () => {
    const WITH_PARAM = [
        '/api/analytics/transformers/%s/load',
        '/api/analytics/transformers/%s/buildings',
        '/api/analytics/transformers/%s/forecast',
    ];

    test.each(WITH_PARAM)('%s с нечисловым параметром → 400', async (template) => {
        const url = template.replace('%s', 'abc');
        const res = await request(app).get(url).set('Authorization', adminAuth);
        expect([url, res.status]).toEqual([url, 400]);
    });

    test.each(WITH_PARAM)('%s с числовым параметром доходит до сервиса', async (template) => {
        const url = template.replace('%s', '7');
        const res = await request(app).get(url).set('Authorization', adminAuth);
        expect([url, res.status]).not.toEqual([url, 400]);
        expect([url, calls.length > 0]).toEqual([url, true]);
    });
});
