const request = require('supertest');
const { ApiTestHelper, testUtils } = require('../helpers/testHelper');

// Mock database — allows running without live PostgreSQL
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

// Set required env vars before importing server
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-api-tests';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-api-tests';

// [R2-01/R2-02] Registration and infrastructure writes are now admin-only. Forge a
// role=admin access token (same claims as authService.generateTokens) so these
// tests exercise the authorized path without driving the mandatory-2FA admin login.
const jwt = require('jsonwebtoken');
// user_id 999 = admin sentinel in dbMock (authenticateJWT resolves role from DB, not token).
const forgeAdminToken = () => jwt.sign(
    { user_id: 999, username: 'admin', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
);

let app;

describe('API Integration Tests', () => {
    let testHelper;

    beforeAll(async () => {
        setupQueryMock(db);
        app = require('../../../src/server');
        testHelper = new ApiTestHelper(app);
    });

    beforeEach(() => {
        setupQueryMock(db);
    });

    describe('Authentication Endpoints', () => {
        test('POST /api/auth/login - успешная авторизация', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'TestPass123' });

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('user');
            // [1A-FU2-S-M2] accessToken/refreshToken must NOT be in body —
            // they ship as HttpOnly cookies (Set-Cookie header).
            expect(response.body).not.toHaveProperty('accessToken');
            expect(response.body).not.toHaveProperty('refreshToken');
            // Sanity: cookies are emitted.
            const setCookies = response.headers['set-cookie'] || [];
            const cookieJoined = Array.isArray(setCookies) ? setCookies.join(';') : String(setCookies);
            expect(cookieJoined).toMatch(/access_token=/);
        });

        test('POST /api/auth/login - неверные учетные данные', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'wrongpassword' });

            expect(response.status).toBe(401);
        });

        test('POST /api/auth/register - admin создаёт пользователя (R2-01)', async () => {
            const testUser = {
                username: `testuser${testUtils.randomId()}`,
                password: 'TestPass123',
                email: `test${testUtils.randomId()}@example.com`
            };

            const response = await request(app)
                .post('/api/auth/register')
                .set('Authorization', `Bearer ${forgeAdminToken()}`)
                .send(testUser);

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('user');
            expect(response.body.user.username).toBe(testUser.username);
        });

        test('POST /api/auth/register - без токена → 401 (R2-01: больше не публичный)', async () => {
            const response = await request(app)
                .post('/api/auth/register')
                .send({ username: 'anon', password: 'TestPass123', email: 'anon@test.com' });

            expect(response.status).toBe(401);
        });
    });

    describe('Buildings Endpoints', () => {
        let authToken;

        beforeAll(async () => {
            setupQueryMock(db);
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'TestPass123' });
            // [1A-FU2-S-M2] tokens no longer in body — extract from Set-Cookie.
            // Server sends Set-Cookie: access_token=...; HttpOnly;... — we read it
            // and feed it back as a Cookie header on subsequent requests, OR pull
            // the raw JWT out and use Authorization: Bearer for tests that asserted
            // that path.
            const cookies = loginRes.headers['set-cookie'] || [];
            const accessCookie = (Array.isArray(cookies) ? cookies : [cookies]).find(c => /^access_token=/.test(c));
            const match = accessCookie && accessCookie.match(/^access_token=([^;]+)/);
            authToken = match ? decodeURIComponent(match[1]) : null;
        });

        test('GET /api/buildings - получение списка зданий', async () => {
            const response = await request(app)
                .get('/api/buildings')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body).toHaveProperty('pagination');
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test('POST /api/buildings - создание нового здания (admin)', async () => {
            const buildingData = testHelper.createTestBuilding();

            const response = await request(app)
                .post('/api/buildings')
                .set('Authorization', `Bearer ${forgeAdminToken()}`)
                .send(buildingData);

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('building_id');
        });

        test('POST /api/buildings - обычный пользователь → 403 (R2-02: writes = admin-only)', async () => {
            const response = await request(app)
                .post('/api/buildings')
                .set('Authorization', `Bearer ${authToken}`)
                .send(testHelper.createTestBuilding());

            expect(response.status).toBe(403);
        });

        test('GET /api/buildings/:id - получение здания по ID', async () => {
            const response = await request(app)
                .get('/api/buildings/1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('building_id');
        });

        test('PUT /api/buildings/:id - обновление здания', async () => {
            const updateData = {
                name: 'Updated Test Building',
                address: 'Updated Test Address',
                town: 'Updated Test Town',
                latitude: 55.7558,
                longitude: 37.6176,
                floors: 15
            };

            const response = await request(app)
                .put('/api/buildings/1')
                .set('Authorization', `Bearer ${forgeAdminToken()}`)
                .send(updateData);

            expect(response.status).toBe(200);
        });

        test('DELETE /api/buildings/:id - удаление здания', async () => {
            const response = await request(app)
                .delete('/api/buildings/1')
                .set('Authorization', `Bearer ${forgeAdminToken()}`);

            expect(response.status).toBe(200);
        });

        test('DELETE /api/buildings/:id - нечисловой id → 400, не 500 (R2-16)', async () => {
            const response = await request(app)
                .delete('/api/buildings/not-a-number')
                .set('Authorization', `Bearer ${forgeAdminToken()}`);

            expect(response.status).toBe(400);
        });

        test('GET /api/buildings/:id - нечисловой id → 400, не 500 (R2-16, live-QA gap)', async () => {
            const response = await request(app)
                .get('/api/buildings/not-a-number')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(400);
        });
    });

    describe('Controllers Endpoints', () => {
        let authToken;

        beforeAll(async () => {
            setupQueryMock(db);
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'TestPass123' });
            // [1A-FU2-S-M2] tokens no longer in body — extract from Set-Cookie.
            // Server sends Set-Cookie: access_token=...; HttpOnly;... — we read it
            // and feed it back as a Cookie header on subsequent requests, OR pull
            // the raw JWT out and use Authorization: Bearer for tests that asserted
            // that path.
            const cookies = loginRes.headers['set-cookie'] || [];
            const accessCookie = (Array.isArray(cookies) ? cookies : [cookies]).find(c => /^access_token=/.test(c));
            const match = accessCookie && accessCookie.match(/^access_token=([^;]+)/);
            authToken = match ? decodeURIComponent(match[1]) : null;
        });

        test('GET /api/controllers - получение списка контроллеров', async () => {
            const response = await request(app)
                .get('/api/controllers')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body).toHaveProperty('pagination');
        });
    });

    describe('Metrics Endpoints', () => {
        let authToken;

        beforeAll(async () => {
            setupQueryMock(db);
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'TestPass123' });
            // [1A-FU2-S-M2] tokens no longer in body — extract from Set-Cookie.
            // Server sends Set-Cookie: access_token=...; HttpOnly;... — we read it
            // and feed it back as a Cookie header on subsequent requests, OR pull
            // the raw JWT out and use Authorization: Bearer for tests that asserted
            // that path.
            const cookies = loginRes.headers['set-cookie'] || [];
            const accessCookie = (Array.isArray(cookies) ? cookies : [cookies]).find(c => /^access_token=/.test(c));
            const match = accessCookie && accessCookie.match(/^access_token=([^;]+)/);
            authToken = match ? decodeURIComponent(match[1]) : null;
        });

        test('POST /api/metrics/telemetry - контроллер не найден', async () => {
            // Mock: controller lookup returns empty
            db.query.mockImplementation(async (sql) => {
                if (sql.includes('FROM controllers') && sql.includes('serial_number')) {
                    return { rows: [], rowCount: 0 };
                }
                return { rows: [], rowCount: 0 };
            });

            const response = await request(app)
                .post('/api/metrics/telemetry')
                .send({
                    serial_number: 'NONEXISTENT-001',
                    electricity_ph1: 220.5,
                    cold_water_pressure: 5.2
                });

            expect(response.status).toBe(404);
        });

        test('GET /api/metrics - получение метрик', async () => {
            setupQueryMock(db);
            const response = await request(app)
                .get('/api/metrics')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('data');
            expect(response.body).toHaveProperty('pagination');
        });
    });

    describe('Health Check', () => {
        test('GET /health - проверка здоровья', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });

            const response = await request(app).get('/health');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'healthy');
            expect(response.body).toHaveProperty('db', 'connected');
        });
    });
});
