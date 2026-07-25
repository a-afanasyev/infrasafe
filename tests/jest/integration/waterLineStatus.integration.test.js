// [M-12] Integration — доказывает, что whitelist статусов реально работает в
// собранном /api пайплайне, а 400 из модели ДОХОДИТ до клиента.
//
// Юнит-тестов здесь мало: до этой пачки оба контроллера схлопывали любую ошибку
// в 500 (`sendError(res, 500, ...)` / `createError('Internal server error')`),
// так что валидный whitelist в модели выглядел бы для клиента как «сервер упал».
// Проверяем оба конца: невалидный статус → 400, валидный → 201/200.
//
// Авторизация — Bearer admin (dbMock-сентинел user_id 999 = admin). Bearer
// by design минует CSRF Origin-guard, поэтому проверка статусов не смешивается
// с CSRF-логикой (её покрывает csrfOriginGuard.integration.test.js).

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

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-waterline-itest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-waterline-itest';

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

const VALID_BODY = { name: 'ITest WL', diameter_mm: 100, material: 'steel' };

describe('[M-12] POST /api/water-lines — status whitelist', () => {
    test('rejects an out-of-domain status with 400 (not a 500)', async () => {
        const res = await request(app)
            .post('/api/water-lines')
            .set('Authorization', auth)
            .send({ ...VALID_BODY, status: 'broken' });

        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/status/i);
    });

    test('accepts a valid status', async () => {
        const res = await request(app)
            .post('/api/water-lines')
            .set('Authorization', auth)
            .send({ ...VALID_BODY, status: 'maintenance' });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('maintenance');
    });
});

describe('[M-12] PUT /api/water-lines/:id — status whitelist', () => {
    test('rejects an out-of-domain status with 400', async () => {
        const res = await request(app)
            .put('/api/water-lines/1')
            .set('Authorization', auth)
            .send({ status: 'broken' });

        expect(res.status).toBe(400);
    });

    test('accepts a valid status', async () => {
        const res = await request(app)
            .put('/api/water-lines/1')
            .set('Authorization', auth)
            .send({ status: 'inactive' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('inactive');
    });
});

describe('[M-12] POST /api/admin/water-lines/batch — status whitelist', () => {
    test('rejects an out-of-domain status with 400', async () => {
        const res = await request(app)
            .post('/api/admin/water-lines/batch')
            .set('Authorization', auth)
            .send({ action: 'update_status', ids: [1], data: { status: 'broken' } });

        expect(res.status).toBe(400);
    });

    test('accepts a valid status', async () => {
        const res = await request(app)
            .post('/api/admin/water-lines/batch')
            .set('Authorization', auth)
            .send({ action: 'update_status', ids: [1], data: { status: 'active' } });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
