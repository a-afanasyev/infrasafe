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
            expect(response.body).toHaveProperty('accessToken');
            expect(response.body).toHaveProperty('user');
        });

        test('POST /api/auth/login - неверные учетные данные', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'wrongpassword' });

            expect(response.status).toBe(401);
        });

        test('POST /api/auth/register - регистрация нового пользователя', async () => {
            const testUser = {
                username: `testuser${testUtils.randomId()}`,
                password: 'TestPass123',
                email: `test${testUtils.randomId()}@example.com`
            };

            const response = await request(app)
                .post('/api/auth/register')
                .send(testUser);

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('user');
            expect(response.body.user.username).toBe(testUser.username);
        });
    });

    describe('Buildings Endpoints', () => {
        let authToken;

        beforeAll(async () => {
            setupQueryMock(db);
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'TestPass123' });
            authToken = loginRes.body.accessToken;
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

        test('POST /api/buildings - создание нового здания', async () => {
            const buildingData = testHelper.createTestBuilding();

            const response = await request(app)
                .post('/api/buildings')
                .set('Authorization', `Bearer ${authToken}`)
                .send(buildingData);

            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('building_id');
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
                .set('Authorization', `Bearer ${authToken}`)
                .send(updateData);

            expect(response.status).toBe(200);
        });

        test('DELETE /api/buildings/:id - удаление здания', async () => {
            const response = await request(app)
                .delete('/api/buildings/1')
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).toBe(200);
        });
    });

    describe('Controllers Endpoints', () => {
        let authToken;

        beforeAll(async () => {
            setupQueryMock(db);
            const loginRes = await request(app)
                .post('/api/auth/login')
                .send({ username: 'testuser', password: 'TestPass123' });
            authToken = loginRes.body.accessToken;
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
            authToken = loginRes.body.accessToken;
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
