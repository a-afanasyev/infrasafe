// [R2-16] Guard на числовые path-параметры — интеграционно, в собранном /api.
//
// Просили общий guard на все `:id`. Сделали его только для per-entity/alerts/
// metrics/analytics, а весь admin-роутер, power-analytics и именованные
// `:buildingId`/`:transformerId`/`:lineId` остались без него: нечисловой
// параметр доходил до Postgres и возвращался как 500 (`invalid input syntax for
// type integer`). Severity низкая (admin-only), но поведение неотличимо от
// настоящей поломки сервера, а в логах копятся pg-ошибки.
//
// Тест намеренно интеграционный: unit-тест на validateIntParam уже есть и
// остаётся зелёным, даже если middleware НЕ подключён к маршруту — а пропуск
// подключения и был сутью пункта.

const request = require('supertest');

jest.mock('../../../src/config/database', () => ({
    init: jest.fn().mockResolvedValue(true),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    close: jest.fn().mockResolvedValue(undefined),
    getPool: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../../../src/config/database');
const { setupQueryMock } = require('../helpers/dbMock');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-intparam-itest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-intparam-itest';

const adminToken = () => jwt.sign(
    { user_id: 999, username: 'admin', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
);

let app;
let auth;

beforeAll(() => {
    setupQueryMock(db);
    app = require('../../../src/server');
    auth = `Bearer ${adminToken()}`;
});

// Значения, которые раньше улетали в pg как есть.
const BAD = ['abc', '1abc', '../1', '1;drop', '%20'];

const ADMIN_GET = [
    '/api/admin/buildings',
    '/api/admin/controllers',
    '/api/admin/metrics',
    '/api/admin/transformers',
    '/api/admin/lines',
    '/api/admin/water-lines',
    '/api/admin/cold-water-sources',
    '/api/admin/heat-sources',
];

describe('[R2-16] admin-роутер: нечисловой :id → 400, не 500', () => {
    test.each(ADMIN_GET)('GET %s/:id', async (base) => {
        const res = await request(app).get(`${base}/abc`).set('Authorization', auth);
        expect(res.status).toBe(400);
    });

    test.each(ADMIN_GET)('DELETE %s/:id', async (base) => {
        const res = await request(app).delete(`${base}/abc`).set('Authorization', auth);
        expect(res.status).toBe(400);
    });

    test.each(BAD)('разные формы мусора отвергаются одинаково: %p', async (bad) => {
        const res = await request(app)
            .get(`/api/admin/buildings/${encodeURIComponent(bad)}`)
            .set('Authorization', auth);
        expect(res.status).toBe(400);
    });

    test('числовой :id проходит guard (не 400)', async () => {
        const res = await request(app).get('/api/admin/buildings/7').set('Authorization', auth);
        expect(res.status).not.toBe(400);
    });
});

describe('[R2-16] power-analytics: именованные параметры', () => {
    test.each([
        ['/api/power-analytics/buildings/abc'],
        ['/api/power-analytics/lines/abc'],
        ['/api/power-analytics/transformers/abc'],
    ])('GET %s → 400', async (url) => {
        const res = await request(app).get(url).set('Authorization', auth);
        expect(res.status).toBe(400);
    });
});

describe('[R2-16] прочие именованные параметры', () => {
    test.each([
        ['/api/controllers/building/abc'],
        ['/api/controllers/abc/metrics'],
        ['/api/transformers/building/abc'],
        ['/api/lines/transformer/abc'],
        ['/api/integration/logs/abc'],
        ['/api/integration/rules/abc/history'],
    ])('GET %s → 400', async (url) => {
        const res = await request(app).get(url).set('Authorization', auth);
        expect(res.status).toBe(400);
    });

    test('PATCH /api/integration/rules/:id → 400 на нечисловом id', async () => {
        const res = await request(app)
            .patch('/api/integration/rules/abc')
            .set('Authorization', auth)
            .send({ fields: { enabled: true } });
        expect(res.status).toBe(400);
    });

    test('UUID :externalId НЕ ломается int-гардом (у него своя валидация)', async () => {
        const uuid = '11111111-2222-3333-4444-555555555555';
        const res = await request(app)
            .get(`/api/integration/building-requests/${uuid}`)
            .set('Authorization', auth);
        expect(res.status).not.toBe(400);
    });
});
