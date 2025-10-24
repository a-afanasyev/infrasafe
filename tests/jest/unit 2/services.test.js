const { ApiTestHelper, testUtils } = require('../helpers/testHelper');

// Мокаем базу данных
jest.mock('../../../src/config/database', () => ({
  query: jest.fn(),
  pool: {
    connect: jest.fn()
  }
}));

// Мокаем модели
jest.mock('../../../src/models/Building', () => ({
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn()
}));

jest.mock('../../../src/models/Controller', () => ({
  findAll: jest.fn(),
  findById: jest.fn(),
  findByBuildingId: jest.fn(),
  create: jest.fn()
}));

jest.mock('../../../src/models/Metric', () => ({
  create: jest.fn(),
  findByController: jest.fn(),
  findByControllerId: jest.fn()
}));

// Мокаем кэш сервис
jest.mock('../../../src/services/cacheService', () => ({
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn(),
  invalidatePattern: jest.fn()
}));

// Импортируем сервисы
const buildingService = require('../../../src/services/buildingService');
const controllerService = require('../../../src/services/controllerService');
const metricService = require('../../../src/services/metricService');
const authService = require('../../../src/services/authService');

// Импортируем моки
const Building = require('../../../src/models/Building');
const Controller = require('../../../src/models/Controller');
const Metric = require('../../../src/models/Metric');
const cacheService = require('../../../src/services/cacheService');

describe('Service Layer Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Building Service', () => {
    beforeEach(() => {
      // Сбрасываем кэш моки
      cacheService.get.mockResolvedValue(null);
      cacheService.set.mockResolvedValue(undefined);
    });

    test('getAllBuildings - успешное получение всех зданий', async () => {
      const mockBuildings = [
        { building_id: 1, name: 'Building 1', address: 'Address 1' },
        { building_id: 2, name: 'Building 2', address: 'Address 2' }
      ];

      const mockResult = {
        data: mockBuildings,
        pagination: { page: 1, limit: 10, total: 2, totalPages: 1 }
      };

      Building.findAll.mockResolvedValue(mockResult);

      const result = await buildingService.getAllBuildings();

      expect(result).toEqual(mockResult);
      expect(Building.findAll).toHaveBeenCalledWith(1, 10, 'building_id', 'asc');
    });

    test('getBuildingById - успешное получение здания по ID', async () => {
      const mockBuilding = {
        building_id: 1,
        name: 'Test Building',
        address: 'Test Address'
      };

      const mockControllers = [
        { controller_id: 1, name: 'Test Controller', building_id: 1 }
      ];

      const expectedResult = {
        ...mockBuilding,
        controllers: mockControllers
      };

      Building.findById.mockResolvedValue(mockBuilding);
      Controller.findByBuildingId.mockResolvedValue(mockControllers);

      const result = await buildingService.getBuildingById(1);

      expect(result).toEqual(expectedResult);
      expect(Building.findById).toHaveBeenCalledWith(1);
      expect(Controller.findByBuildingId).toHaveBeenCalledWith(1);
    });

    test('createBuilding - успешное создание здания', async () => {
      const buildingData = {
        name: 'New Building',
        address: 'New Address',
        latitude: 55.7558,
        longitude: 37.6176
      };

      const mockCreatedBuilding = { building_id: 3, ...buildingData };
      
      Building.create.mockResolvedValue(mockCreatedBuilding);

      const result = await buildingService.createBuilding(buildingData);

      expect(result).toEqual(mockCreatedBuilding);
      expect(Building.create).toHaveBeenCalledWith(buildingData);
    });
  });

  describe('Controller Service', () => {
    beforeEach(() => {
      // Сбрасываем кэш моки
      cacheService.get.mockResolvedValue(null);
      cacheService.set.mockResolvedValue(undefined);
    });

    test('getAllControllers - успешное получение всех контроллеров', async () => {
      const mockControllers = [
        { controller_id: 1, name: 'Controller 1', type: 'temperature' },
        { controller_id: 2, name: 'Controller 2', type: 'humidity' }
      ];

      const mockResult = {
        data: mockControllers,
        pagination: { page: 1, limit: 10, total: 2, totalPages: 1 }
      };

      Controller.findAll.mockResolvedValue(mockResult);

      const result = await controllerService.getAllControllers();

      expect(result).toEqual(mockResult);
      expect(Controller.findAll).toHaveBeenCalledWith(1, 10, 'controller_id', 'asc');
    });

    test('getControllersByBuildingId - получение контроллеров здания', async () => {
      const mockControllers = [
        { controller_id: 1, name: 'Controller 1', type: 'temperature' },
        { controller_id: 2, name: 'Controller 2', type: 'humidity' }
      ];

      Controller.findByBuildingId.mockResolvedValue(mockControllers);

      const result = await controllerService.getControllersByBuildingId(1);

      expect(result).toEqual(mockControllers);
      expect(Controller.findByBuildingId).toHaveBeenCalledWith(1);
    });
  });

  describe('Metric Service', () => {
    beforeEach(() => {
      // Сбрасываем кэш моки
      cacheService.get.mockResolvedValue(null);
      cacheService.set.mockResolvedValue(undefined);
    });

    test('createMetric - успешное создание метрики', async () => {
      const metricData = {
        controller_id: 1,
        metric_type: 'temperature',
        value: 22.5,
        unit: 'celsius'
      };

      const mockController = { controller_id: 1, name: 'Test Controller' };
      const mockSavedMetric = { metric_id: 1, ...metricData, timestamp: new Date() };
      
      Controller.findById.mockResolvedValue(mockController);
      Metric.create.mockResolvedValue(mockSavedMetric);

      const result = await metricService.createMetric(metricData);

      expect(result).toEqual(mockSavedMetric);
      expect(Controller.findById).toHaveBeenCalledWith(1);
      expect(Metric.create).toHaveBeenCalledWith(metricData);
    });

    test('getMetricsByControllerId - получение метрик контроллера', async () => {
      const mockController = { controller_id: 1, name: 'Test Controller' };
      const mockMetrics = [
        { metric_id: 1, controller_id: 1, metric_type: 'temperature', value: 22.5 },
        { metric_id: 2, controller_id: 1, metric_type: 'humidity', value: 60.0 }
      ];

      Controller.findById.mockResolvedValue(mockController);
      Metric.findByControllerId.mockResolvedValue(mockMetrics);

      const result = await metricService.getMetricsByControllerId(1);

      expect(result).toEqual(mockMetrics);
      expect(Controller.findById).toHaveBeenCalledWith(1);
      expect(Metric.findByControllerId).toHaveBeenCalledWith(1, undefined, undefined);
    });
  });

  describe('Auth Service', () => {
    beforeEach(() => {
      // Сбрасываем кэш моки
      cacheService.get.mockResolvedValue(null);
      cacheService.set.mockResolvedValue(undefined);
    });

    test('authenticateUser - успешная аутентификация пользователя', async () => {
      const mockUser = {
        user_id: 1,
        username: 'admin',
        password_hash: '$2b$10$hashedpassword',
        is_active: true
      };

      const db = require('../../../src/config/database');
      db.query.mockResolvedValue({ rows: [mockUser] });

      // Мокаем bcrypt
      const bcrypt = require('bcrypt');
      bcrypt.compare = jest.fn().mockResolvedValue(true);

      const result = await authService.authenticateUser('admin', 'Admin123');

      expect(result).toBeTruthy();
      expect(result).toHaveProperty('user_id');
      expect(result).toHaveProperty('username');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('role');
      expect(result).toHaveProperty('is_active');
    });

    test('authenticateUser - неверный пароль', async () => {
      const mockUser = {
        user_id: 1,
        username: 'admin',
        password_hash: '$2b$10$hashedpassword',
        is_active: true
      };

      const db = require('../../../src/config/database');
      db.query.mockResolvedValue({ rows: [mockUser] });

      const bcrypt = require('bcrypt');
      bcrypt.compare = jest.fn().mockResolvedValue(false);

      await expect(authService.authenticateUser('admin', 'WrongPassword'))
        .rejects.toThrow('Неверное имя пользователя или пароль');
    });

    test('authenticateUser - пользователь не найден', async () => {
      const db = require('../../../src/config/database');
      db.query.mockResolvedValue({ rows: [] });

      await expect(authService.authenticateUser('nonexistent', 'password'))
        .rejects.toThrow('Неверное имя пользователя или пароль');
    });
  });
}); 