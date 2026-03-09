const request = require('supertest');
const { testUtils } = require('../helpers/testHelper');

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

// Set required env vars
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-security-tests';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-for-security-tests';

let app;

describe('Security Tests', () => {
    beforeAll(async () => {
        setupQueryMock(db);
        app = require('../../../src/server');
    });

    beforeEach(() => {
        setupQueryMock(db);
    });

    // Helper: get auth token
    const getToken = async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'testuser', password: 'TestPass123' });
        return res.body.accessToken;
    };

    describe('JWT Authentication Security', () => {
        test('Защищенные endpoints требуют JWT токен', async () => {
            const protectedEndpoints = [
                { method: 'post', path: '/api/buildings' },
                { method: 'put', path: '/api/buildings/1' },
                { method: 'delete', path: '/api/buildings/1' },
                { method: 'post', path: '/api/controllers' },
                { method: 'post', path: '/api/alerts' }
            ];

            for (const ep of protectedEndpoints) {
                const response = await request(app)[ep.method](ep.path);
                expect(response.status).toBe(401);
                expect(response.body).toHaveProperty('message');
            }
        });

        test('Неверный JWT токен отклоняется', async () => {
            const response = await request(app)
                .post('/api/buildings')
                .set('Authorization', 'Bearer invalid-token');

            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('message');
        });

        test('Истекший JWT токен отклоняется', async () => {
            const jwt = require('jsonwebtoken');
            const expiredToken = jwt.sign(
                { user_id: 1, username: 'test', role: 'user' },
                process.env.JWT_SECRET,
                { expiresIn: '1ms' }
            );

            await testUtils.wait(10);

            const response = await request(app)
                .post('/api/buildings')
                .set('Authorization', `Bearer ${expiredToken}`);

            expect(response.status).toBe(401);
        });
    });

    describe('Input Validation Security', () => {
        let authToken;

        beforeAll(async () => {
            setupQueryMock(db);
            authToken = await getToken();
        });

        test('SQL Injection защита в зданиях', async () => {
            const maliciousInputs = [
                "'; DROP TABLE buildings; --",
                "' OR '1'='1",
                "'; INSERT INTO buildings VALUES (999, 'hacked'); --"
            ];

            for (const input of maliciousInputs) {
                const response = await request(app)
                    .post('/api/buildings')
                    .set('Authorization', `Bearer ${authToken}`)
                    .send({
                        name: input,
                        address: 'Test Address',
                        latitude: 55.7558,
                        longitude: 37.6176
                    });

                expect(response.status).toBe(400);
            }
        });

        test('XSS защита в контроллерах', async () => {
            const xssPayloads = [
                '<script>alert("xss")</script>',
                'javascript:alert("xss")',
                '<img src="x" onerror="alert(\'xss\')">'
            ];

            for (const payload of xssPayloads) {
                const response = await request(app)
                    .post('/api/controllers')
                    .set('Authorization', `Bearer ${authToken}`)
                    .send({
                        serial_number: payload,
                        vendor: 'Test Vendor',
                        model: 'Test Model',
                        building_id: 1,
                        status: 'online'
                    });

                expect(response.status).toBe(400);
            }
        });

        test('Валидация типов данных', async () => {
            const invalidData = [
                { name: 123, address: 'Test' },
                { name: 'Test', latitude: 'invalid' },
                { name: 'Test', longitude: null }
            ];

            for (const data of invalidData) {
                const response = await request(app)
                    .post('/api/buildings')
                    .set('Authorization', `Bearer ${authToken}`)
                    .send(data);

                expect(response.status).toBe(400);
            }
        });
    });

    describe('CORS Security', () => {
        test('CORS заголовки присутствуют', async () => {
            const response = await request(app).get('/api/');

            expect(response.headers).toHaveProperty('access-control-allow-origin');
        });

        test('Preflight запросы обрабатываются', async () => {
            const response = await request(app)
                .options('/api/buildings')
                .set('Origin', 'http://localhost:3000')
                .set('Access-Control-Request-Method', 'POST')
                .set('Access-Control-Request-Headers', 'Content-Type, Authorization');

            expect(response.status).toBe(204);
            expect(response.headers).toHaveProperty('access-control-allow-origin');
        });
    });

    describe('Error Handling Security', () => {
        test('Чувствительная информация не раскрывается в ошибках', async () => {
            // Non-public routes return 401 (default-deny), so test with auth
            const token = await getToken();
            const response = await request(app)
                .get('/api/nonexistent-endpoint')
                .set('Authorization', `Bearer ${token}`);

            // Either 404 (not found) or 401 (default-deny) — both are acceptable
            expect([401, 404]).toContain(response.status);
            expect(response.body).not.toHaveProperty('stack');
            expect(response.body).not.toHaveProperty('sql');
            expect(response.body).not.toHaveProperty('password');
        });

        test('Валидация JSON payload', async () => {
            const response = await request(app)
                .post('/api/buildings')
                .set('Content-Type', 'application/json')
                .send('invalid json');

            expect(response.status).toBe(400);
        });
    });
});
