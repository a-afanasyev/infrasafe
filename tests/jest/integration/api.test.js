
const request = require('supertest');
const { ApiTestHelper, testUtils } = require('../helpers/testHelper');

// Импортируем приложение
let app;

describe('API Integration Tests', () => {
  let testHelper;

  beforeAll(async () => {
    // Импортируем приложение
    app = require('../../../src/server');
    testHelper = new ApiTestHelper(app);
  });

  afterAll(async () => {
    // Закрываем соединения
    if (app && app.close) {
      await app.close();
    }
  });

  describe('Authentication Endpoints', () => {
    test('POST /api/auth/login - успешная авторизация', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'TestPass123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('user');
      
      // Проверяем JWT токен
      const decoded = testUtils.validateJwtToken(response.body.accessToken);
      expect(decoded.username).toBe('testuser');
    });

    test('POST /api/auth/login - неверные учетные данные', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: 'wrongpassword'
        })
        .expect(401);

      testUtils.expectErrorResponse(response, 401);
    });

    test('POST /api/auth/register - регистрация нового пользователя', async () => {
      const testUser = {
        username: `testuser${testUtils.randomId()}`,
        password: 'TestPass123',
        email: `test${testUtils.randomId()}@example.com`
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      testHelper.expectStandardResponse(response, 201);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe(testUser.username);
    });
  });

  describe('Buildings Endpoints', () => {
    let authToken;
    let testBuildingId;

    beforeAll(async () => {
      authToken = await testHelper.getAuthToken();
    });

    test('GET /api/buildings - получение списка зданий', async () => {
      const response = await request(app)
        .get('/api/buildings')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      testHelper.expectPaginatedResponse(response);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('POST /api/buildings - создание нового здания', async () => {
      const buildingData = testHelper.createTestBuilding();

      const response = await request(app)
        .post('/api/buildings')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(buildingData)
        .expect(201);

      // API возвращает данные напрямую
      expect(response.body).toHaveProperty('building_id');
      testBuildingId = response.body.building_id;
    });

    test('GET /api/buildings/:id - получение здания по ID', async () => {
      const response = await request(app)
        .get(`/api/buildings/${testBuildingId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      testHelper.expectDataResponse(response);
      expect(response.body.building_id).toBe(testBuildingId);
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
        .put(`/api/buildings/${testBuildingId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(updateData)
        .expect(200);

      testHelper.expectDataResponse(response);
      expect(response.body.name).toBe(updateData.name);
    });

    test('DELETE /api/buildings/:id - удаление здания', async () => {
      const response = await request(app)
        .delete(`/api/buildings/${testBuildingId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      testHelper.expectStandardResponse(response);
    });
  });

  describe('Controllers Endpoints', () => {
    let authToken;
    let testControllerId;
    let testBuildingId;

    beforeAll(async () => {
      authToken = await testHelper.getAuthToken();
      
      // Создаём тестовое здание для контроллеров
      const buildingResponse = await request(app)
        .post('/api/buildings')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Building for Controllers Integration',
          address: 'Test Address',
          town: 'Test Town', 
          latitude: 55.7558,
          longitude: 37.6176
        });
        
      if (buildingResponse.status === 201) {
        testBuildingId = buildingResponse.body.data?.building_id || 
                        buildingResponse.body.building_id || 
                        buildingResponse.body.id || 1;
      } else {
        testBuildingId = 1; // Fallback
      }
    });

    test('GET /api/controllers - получение списка контроллеров', async () => {
      const response = await request(app)
        .get('/api/controllers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      testHelper.expectPaginatedResponse(response);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('POST /api/controllers - создание нового контроллера', async () => {
      const controllerData = testHelper.createTestController();
      controllerData.building_id = testBuildingId; // Используем реальный building_id

      const response = await request(app)
        .post('/api/controllers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(controllerData)
        .expect(201);

      // API возвращает данные напрямую
      expect(response.body).toHaveProperty('controller_id');
      testControllerId = response.body.controller_id;
    });

    test('GET /api/controllers/:id - получение контроллера по ID', async () => {
      const response = await request(app)
        .get(`/api/controllers/${testControllerId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      testHelper.expectDataResponse(response);
      expect(response.body.controller_id).toBe(testControllerId);
    });
  });

  describe('Metrics Endpoints', () => {
    let authToken;

    beforeAll(async () => {
      authToken = await testHelper.getAuthToken();
    });

    test('POST /api/metrics/telemetry - отправка телеметрии (без авторизации)', async () => {
      const telemetryData = {
        serial_number: 'API-TEST-001-UPD',
        electricity_ph1: 220.5,
        electricity_ph2: 218.3,
        electricity_ph3: 219.1,
        amperage_ph1: 45.2,
        amperage_ph2: 42.8,
        amperage_ph3: 44.1,
        cold_water_pressure: 5.2,
        cold_water_temp: 15.5,
        hot_water_in_pressure: 3.1,
        hot_water_out_pressure: 2.8,
        hot_water_in_temp: 60.2,
        hot_water_out_temp: 55.8,
        air_temp: 22.5,
        humidity: 45.3,
        leak_sensor: false
      };

      const response = await request(app)
        .post('/api/metrics/telemetry')
        .send(telemetryData)
        .expect(404); // Ожидаем 404 - контроллер не найден

      // Проверяем что получили ошибку о контроллере
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('не найден');
    });

    test('GET /api/metrics - получение метрик', async () => {
      const response = await request(app)
        .get('/api/metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      testHelper.expectPaginatedResponse(response);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('Analytics Endpoints', () => {
    let authToken;

    beforeAll(async () => {
      authToken = await testHelper.getAuthToken();
    });

    test('GET /api/analytics/transformers - аналитика по трансформаторам', async () => {
      const response = await request(app)
        .get('/api/analytics/transformers')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      // API возвращает структуру с success, data, count
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('count');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('GET /api/analytics/transformers/overloaded - перегруженные трансформаторы', async () => {
      const response = await request(app)
        .get('/api/analytics/transformers/overloaded')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      // API возвращает структуру с success, data, count, threshold
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('threshold');
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('Alerts Endpoints', () => {
    let authToken;

    beforeAll(async () => {
      authToken = await testHelper.getAuthToken();
    });

    test('GET /api/alerts - получение списка алертов', async () => {
      const response = await request(app)
        .get('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .expect(200);

      // API возвращает структуру с count, data, filters, success
      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('success');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('POST /api/alerts - создание нового алерта', async () => {
      const alertData = {
        type: 'TEMPERATURE_HIGH',
        infrastructure_id: 'TEST-INFRA-001',
        infrastructure_type: 'controller',
        severity: 'WARNING',
        message: 'High temperature detected in test controller',
        affected_buildings: 1,
        data: {
          temperature: 35.5,
          threshold: 30.0
        }
      };

      const response = await request(app)
        .post('/api/alerts')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send(alertData)
        .expect(201);

      testHelper.expectDataResponse(response, 201);
    });
  });
}); 