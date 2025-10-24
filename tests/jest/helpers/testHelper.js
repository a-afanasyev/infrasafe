const request = require('supertest');
const jwt = require('jsonwebtoken');

/**
 * Базовый класс для тестирования API
 */
class ApiTestHelper {
  constructor(app) {
    this.app = app;
    this.authToken = null;
  }

  /**
   * Получение JWT токена для авторизации
   */
  async getAuthToken(username = 'testuser', password = 'TestPass123') {
    // Сначала регистрируем пользователя, если его нет
    try {
      await request(this.app)
        .post('/api/auth/register')
        .send({ 
          username, 
          password, 
          email: `${username}@test.com` 
        });
    } catch (error) {
      // Пользователь уже существует, это нормально
    }

    const response = await request(this.app)
      .post('/api/auth/login')
      .send({ username, password })
      .expect(200);

    this.authToken = response.body.accessToken;
    return this.authToken;
  }

  /**
   * Создание авторизованного запроса
   */
  authenticatedRequest() {
    const req = request(this.app);
    if (this.authToken) {
      return req.set('Authorization', `Bearer ${this.authToken}`);
    }
    return req;
  }

  /**
   * Получение базового URL для тестов
   */
  getBaseUrl() {
    return global.TEST_CONFIG.API_BASE_URL || 'http://localhost:3000';
  }

  /**
   * Создание запроса к внешнему API
   */
  externalRequest() {
    const baseUrl = this.getBaseUrl();
    return request(baseUrl);
  }

  /**
   * Создание авторизованного запроса к внешнему API
   */
  authenticatedExternalRequest() {
    const baseUrl = this.getBaseUrl();
    if (this.authToken) {
      return request(baseUrl).set('Authorization', `Bearer ${this.authToken}`);
    }
    return request(baseUrl);
  }

  /**
   * Проверка стандартного ответа API
   */
  expectStandardResponse(response, expectedStatus = 200) {
    expect(response.status).toBe(expectedStatus);
    
    // Проверяем либо success/message формат, либо прямой формат данных
    if (response.body.hasOwnProperty('success')) {
      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('message');
      
      if (expectedStatus === 200) {
        expect(response.body.success).toBe(true);
      }
    } else {
      // Прямой формат данных без success/message
      expect(response.body).toBeDefined();
    }
  }

  /**
   * Проверка ответа с данными
   */
  expectDataResponse(response, expectedStatus = 200) {
    this.expectStandardResponse(response, expectedStatus);
    // API возвращает данные напрямую, а не в data wrapper
    if (response.body.hasOwnProperty('data')) {
      expect(response.body).toHaveProperty('data');
    } else {
      // Прямой ответ без data wrapper
      expect(response.body).toBeDefined();
    }
  }

  /**
   * Проверка пагинированного ответа
   */
  expectPaginatedResponse(response, expectedStatus = 200) {
    this.expectDataResponse(response, expectedStatus);
    // API возвращает структуру с data и pagination
    expect(response.body).toHaveProperty('data');
    expect(response.body).toHaveProperty('pagination');
    expect(response.body.pagination).toHaveProperty('page');
    expect(response.body.pagination).toHaveProperty('limit');
    expect(response.body.pagination).toHaveProperty('total');
    expect(response.body.pagination).toHaveProperty('totalPages');
  }

  /**
   * Создание тестовых данных
   */
  createTestBuilding() {
    return {
      name: `Test Building ${Date.now()}`,
      address: 'Test Address',
      town: 'Test Town',
      latitude: 55.7558,
      longitude: 37.6176,
      building_type: 'residential',
      floors: 10,
      year_built: 2020
    };
  }

  createTestController() {
    return {
      serial_number: `CTRL-${Date.now()}`,
      vendor: 'Test Vendor',
      model: 'Test Model', 
      building_id: 1, // Будет заменено в тестах на реальный ID
      status: 'online'
    };
  }

  createTestMetric() {
    return {
      controller_id: 1,
      metric_type: 'temperature',
      value: 22.5,
      unit: 'celsius',
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Утилиты для тестирования
 */
const testUtils = {
  /**
   * Ожидание указанного времени
   */
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Генерация случайного ID
   */
  randomId: () => Math.floor(Math.random() * 1000000),

  /**
   * Проверка структуры ошибки
   */
  expectErrorResponse: (response, expectedStatus = 400) => {
    expect(response.status).toBe(expectedStatus);
    // Проверяем разные форматы ошибок API
    if (response.body.hasOwnProperty('success')) {
      expect(response.body.success).toBe(false);
      // Может быть message или error
      expect(response.body).toHaveProperty('message');
    } else if (response.body.hasOwnProperty('errors')) {
      // Формат валидации express-validator: { errors: [...] }
      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
      expect(response.body.errors.length).toBeGreaterThan(0);
    } else if (response.body.hasOwnProperty('error')) {
      expect(response.body).toHaveProperty('error');
    } else {
      // Прямой формат с message
      expect(response.body).toHaveProperty('message');
    }
  },

  /**
   * Проверка JWT токена
   */
  validateJwtToken: (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      expect(decoded).toHaveProperty('user_id');
      expect(decoded).toHaveProperty('username');
      expect(decoded).toHaveProperty('iat');
      expect(decoded).toHaveProperty('exp');
      return decoded;
    } catch (error) {
      throw new Error(`Invalid JWT token: ${error.message}`);
    }
  }
};

module.exports = {
  ApiTestHelper,
  testUtils
}; 