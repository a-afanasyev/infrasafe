/**
 * [M-6] `/api/auth/revoke-sessions` в собранном пайплайне.
 *
 * Юнит-тест сервиса не отвечает на два вопроса, из-за которых эндпоинт может
 * оказаться бесполезным или опасным: закрыт ли он авторизацией (default-deny
 * работает по allowlist в routes/index.js — забыть добавить маршрут туда
 * нельзя, а вот наоборот, случайно внести в PUBLIC_ROUTES, вполне) и
 * действительно ли отзыв доходит до модели, а не тонет в контроллере.
 */

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

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-revoke-itest';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-revoke-itest';

const userToken = () => jwt.sign(
    { user_id: 999, username: 'admin', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
);

let app;

beforeAll(() => {
    setupQueryMock(db);
    app = require('../../../src/server');
});

describe('[M-6] POST /api/auth/revoke-sessions', () => {
    test('без авторизации — 401', async () => {
        const res = await request(app).post('/api/auth/revoke-sessions');

        // Эндпоинт, отзывающий чужие сессии, обязан быть под default-deny.
        expect(res.status).toBe(401);
    });

    test('с авторизацией отзывает сессии и чистит куки', async () => {
        const res = await request(app)
            .post('/api/auth/revoke-sessions')
            .set('Authorization', `Bearer ${userToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Отметка отзыва действительно записана.
        const revoked = db.query.mock.calls.some(
            ([sql]) => String(sql).includes('sessions_revoked_at = NOW()')
        );
        expect(revoked).toBe(true);

        // Текущая сессия тоже завершена — иначе «выйти на всех устройствах»
        // оставляло бы живым ровно то устройство, с которого могли угнать токен.
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.join(';')).toMatch(/access_token=/);
    });
});
