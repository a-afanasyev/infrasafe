# План рефакторинга бэкенда для проекта InfraSafe

## 1. Модульная архитектура

### Предлагаемая структура директорий:
```
src/
├── config/                  # Конфигурация приложения
│   ├── database.js          # Настройки подключения к БД
│   └── app.js               # Настройки Express
├── routes/                  # Маршруты API
│   ├── index.js             # Объединение всех маршрутов
│   ├── buildings.js         # Маршруты для зданий
│   ├── controllers.js       # Маршруты для контроллеров
│   └── metrics.js           # Маршруты для метрик
├── controllers/             # Контроллеры для обработки запросов
│   ├── buildingController.js
│   ├── controllerController.js
│   └── metricController.js
├── services/                # Бизнес-логика
│   ├── buildingService.js
│   ├── controllerService.js
│   └── metricService.js
├── models/                  # Модели данных
│   ├── Building.js
│   ├── Controller.js
│   └── Metric.js
├── middleware/              # Промежуточное ПО
│   ├── auth.js              # Аутентификация
│   ├── errorHandler.js      # Обработка ошибок
│   └── validators.js        # Валидация запросов
├── utils/                   # Вспомогательные функции
│   ├── logger.js            # Система логирования
│   └── helpers.js           # Другие утилиты
└── server.js                # Точка входа приложения
```

## 2. Примеры реализации ключевых файлов

### src/config/database.js
```javascript
require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'smart_building_monitoring',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432'),
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    getPool: () => pool,
};
```

### src/routes/buildings.js
```javascript
const express = require('express');
const router = express.Router();
const buildingController = require('../controllers/buildingController');
const { validateBuildingCreate } = require('../middleware/validators');

// GET /api/buildings
router.get('/', buildingController.getAllBuildings);

// GET /api/buildings/:id
router.get('/:id', buildingController.getBuildingById);

// POST /api/buildings
router.post('/', validateBuildingCreate, buildingController.createBuilding);

// PUT /api/buildings/:id
router.put('/:id', validateBuildingCreate, buildingController.updateBuilding);

// DELETE /api/buildings/:id
router.delete('/:id', buildingController.deleteBuilding);

module.exports = router;
```

### src/controllers/buildingController.js
```javascript
const buildingService = require('../services/buildingService');
const logger = require('../utils/logger');

// Получить все здания
const getAllBuildings = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'building_id', order = 'asc' } = req.query;
        const result = await buildingService.getAllBuildings(parseInt(page), parseInt(limit), sort, order);
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in getAllBuildings: ${error.message}`);
        next(error);
    }
};

// Получить здание по ID
const getBuildingById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const building = await buildingService.getBuildingById(id);
        
        if (!building) {
            return res.status(404).json({ error: 'Building not found' });
        }
        
        return res.status(200).json(building);
    } catch (error) {
        logger.error(`Error in getBuildingById: ${error.message}`);
        next(error);
    }
};

// Создать новое здание
const createBuilding = async (req, res, next) => {
    try {
        const newBuilding = await buildingService.createBuilding(req.body);
        return res.status(201).json(newBuilding);
    } catch (error) {
        logger.error(`Error in createBuilding: ${error.message}`);
        next(error);
    }
};

// Обновить здание
const updateBuilding = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updatedBuilding = await buildingService.updateBuilding(id, req.body);
        
        if (!updatedBuilding) {
            return res.status(404).json({ error: 'Building not found' });
        }
        
        return res.status(200).json(updatedBuilding);
    } catch (error) {
        logger.error(`Error in updateBuilding: ${error.message}`);
        next(error);
    }
};

// Удалить здание
const deleteBuilding = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await buildingService.deleteBuilding(id);
        
        if (!result) {
            return res.status(404).json({ error: 'Building not found' });
        }
        
        return res.status(200).json({ message: 'Building deleted successfully', deleted: result });
    } catch (error) {
        logger.error(`Error in deleteBuilding: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getAllBuildings,
    getBuildingById,
    createBuilding,
    updateBuilding,
    deleteBuilding
};
```

### src/services/buildingService.js
```javascript
const db = require('../config/database');

// Получить все здания с пагинацией и сортировкой
const getAllBuildings = async (page, limit, sort, order) => {
    const offset = (page - 1) * limit;
    const validOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order : 'asc';
    
    // Убедимся, что поле сортировки существует в таблице
    const validColumns = ['building_id', 'name', 'address', 'town'];
    const sortColumn = validColumns.includes(sort) ? sort : 'building_id';
    
    const { rows: buildings } = await db.query(
        `SELECT * FROM buildings 
         ORDER BY ${sortColumn} ${validOrder} 
         LIMIT $1 OFFSET $2`,
        [limit, offset]
    );
    
    const { rows: countResult } = await db.query('SELECT COUNT(*) FROM buildings');
    const totalCount = parseInt(countResult[0].count);
    
    return {
        data: buildings,
        pagination: {
            total: totalCount,
            page,
            limit,
            totalPages: Math.ceil(totalCount / limit)
        }
    };
};

// Получить здание по ID
const getBuildingById = async (id) => {
    const { rows } = await db.query(
        'SELECT * FROM buildings WHERE building_id = $1',
        [id]
    );
    return rows.length ? rows[0] : null;
};

// Создать новое здание
const createBuilding = async (buildingData) => {
    const { name, address, town, latitude, longitude, management_company } = buildingData;
    
    const { rows } = await db.query(
        `INSERT INTO buildings 
        (name, address, town, latitude, longitude, management_company) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING *`,
        [name, address, town, latitude, longitude, management_company]
    );
    
    return rows[0];
};

// Обновить здание
const updateBuilding = async (id, buildingData) => {
    const { name, address, town, latitude, longitude, management_company } = buildingData;
    
    const { rows } = await db.query(
        `UPDATE buildings 
        SET name = $1, address = $2, town = $3, latitude = $4, longitude = $5, management_company = $6, updated_at = NOW() 
        WHERE building_id = $7 
        RETURNING *`,
        [name, address, town, latitude, longitude, management_company, id]
    );
    
    return rows.length ? rows[0] : null;
};

// Удалить здание
const deleteBuilding = async (id) => {
    const { rows } = await db.query(
        'DELETE FROM buildings WHERE building_id = $1 RETURNING *',
        [id]
    );
    
    return rows.length ? rows[0] : null;
};

module.exports = {
    getAllBuildings,
    getBuildingById,
    createBuilding,
    updateBuilding,
    deleteBuilding
};
```

## 3. Улучшение безопасности

### Создание .env файла (не добавляется в git)
```
# Настройки сервера
PORT=8080
NODE_ENV=development

# Настройки базы данных
DB_USER=postgres
DB_PASSWORD=secure_password_here
DB_HOST=localhost
DB_PORT=5432
DB_NAME=smart_building_monitoring

# Настройки JWT (для аутентификации)
JWT_SECRET=your_very_secure_jwt_secret_key
JWT_EXPIRES_IN=1d
```

### src/middleware/auth.js (базовый пример аутентификации)
```javascript
const jwt = require('jsonwebtoken');

const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ message: 'Access token is missing' });
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }

        req.user = user;
        next();
    });
};

// Проверка наличия прав администратора
const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Requires admin privileges' });
    }
    next();
};

module.exports = {
    authenticateJWT,
    isAdmin
};
```

## 4. Добавление транзакций

### Пример использования транзакций в services/controllerService.js
```javascript
const db = require('../config/database');

// Создание контроллера с одновременной инициализацией метрик
const createControllerWithMetrics = async (controllerData, initialMetrics) => {
    const client = await db.getPool().connect();
    
    try {
        // Начало транзакции
        await client.query('BEGIN');
        
        // Создание контроллера
        const { rows: controllerRows } = await client.query(
            `INSERT INTO controllers 
            (serial_number, vendor, model, building_id, status) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING *`,
            [controllerData.serial_number, controllerData.vendor, 
             controllerData.model, controllerData.building_id, 
             controllerData.status]
        );
        
        const newController = controllerRows[0];
        
        // Создание начальных метрик
        const metricsValues = [
            newController.controller_id,
            initialMetrics.timestamp || new Date(),
            initialMetrics.electricity_ph1,
            initialMetrics.electricity_ph2,
            initialMetrics.electricity_ph3,
            // ... другие поля метрик
        ];
        
        const { rows: metricsRows } = await client.query(
            `INSERT INTO metrics 
            (controller_id, timestamp, electricity_ph1, electricity_ph2, electricity_ph3) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING *`,
            metricsValues
        );
        
        // Коммит транзакции
        await client.query('COMMIT');
        
        return {
            controller: newController,
            initialMetrics: metricsRows[0]
        };
    } catch (error) {
        // Откат транзакции в случае ошибки
        await client.query('ROLLBACK');
        throw error;
    } finally {
        // Освобождение клиента
        client.release();
    }
};

module.exports = {
    createControllerWithMetrics,
    // ... другие методы
};
```

## 5. Добавление кэширования

### Установка Redis для кэширования
```bash
npm install redis
```

### src/utils/cache.js
```javascript
const redis = require('redis');
const { promisify } = require('util');

const client = redis.createClient({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
});

client.on('error', (err) => {
    console.error('Redis error:', err);
});

// Промисификация методов Redis
const getAsync = promisify(client.get).bind(client);
const setAsync = promisify(client.set).bind(client);
const delAsync = promisify(client.del).bind(client);

/**
 * Получение данных из кэша
 * @param {string} key - Ключ кэша
 * @returns {Promise<Object|null>} - Данные из кэша или null
 */
const getCache = async (key) => {
    const data = await getAsync(key);
    return data ? JSON.parse(data) : null;
};

/**
 * Сохранение данных в кэш
 * @param {string} key - Ключ кэша
 * @param {Object} data - Данные для сохранения
 * @param {number} expireSeconds - Время жизни кэша в секундах
 */
const setCache = async (key, data, expireSeconds = 3600) => {
    await setAsync(key, JSON.stringify(data), 'EX', expireSeconds);
};

/**
 * Удаление данных из кэша
 * @param {string} key - Ключ кэша
 */
const deleteCache = async (key) => {
    await delAsync(key);
};

/**
 * Очистка кэша по шаблону ключа
 * @param {string} pattern - Шаблон ключей для удаления
 */
const clearCachePattern = async (pattern) => {
    const keys = await promisify(client.keys).bind(client)(pattern);
    if (keys.length > 0) {
        await delAsync(keys);
    }
};

module.exports = {
    getCache,
    setCache,
    deleteCache,
    clearCachePattern
};
```

## 6. Добавление документации API с помощью Swagger

### Установка
```bash
npm install swagger-jsdoc swagger-ui-express
```

### Пример документации для маршрутов buildings
```javascript
/**
 * @swagger
 * /api/buildings:
 *   get:
 *     summary: Получение списка всех зданий
 *     description: Возвращает список всех зданий с поддержкой пагинации и сортировки
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Номер страницы
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Количество элементов на странице
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: building_id
 *         description: Поле для сортировки
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Порядок сортировки
 *     responses:
 *       200:
 *         description: Успешный запрос
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Building'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 */
```

## 7. Интеграция с WebSocket для обновлений в реальном времени

### src/websocket.js
```javascript
const WebSocket = require('ws');
const http = require('http');
const jwt = require('jsonwebtoken');
const logger = require('./utils/logger');

let wss;

const setupWebSocket = (server) => {
    wss = new WebSocket.Server({ server });

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        
        // Аутентификация через WebSocket
        const token = req.url.split('token=')[1];
        
        if (!token) {
            ws.terminate();
            return;
        }
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            ws.user = decoded;
        } catch (err) {
            logger.warn(`Invalid WebSocket authentication: ${err.message}`);
            ws.terminate();
            return;
        }
        
        ws.on('pong', () => {
            ws.isAlive = true;
        });
        
        // Обработка сообщений от клиента
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                logger.info(`WebSocket message received: ${data.type}`);
                
                // Здесь может быть логика обработки сообщений
            } catch (err) {
                logger.error(`Error processing WebSocket message: ${err.message}`);
            }
        });
        
        // Отправляем подтверждение соединения
        ws.send(JSON.stringify({ type: 'connection', status: 'connected' }));
    });
    
    // Пинг для проверки активности соединений
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) {
                return ws.terminate();
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);
    
    wss.on('close', () => {
        clearInterval(interval);
    });
    
    return wss;
};

// Функция для отправки обновлений всем подключенным клиентам
const broadcastUpdate = (data) => {
    if (!wss) return;
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
};

// Отправка обновления конкретному зданию
const sendBuildingUpdate = (buildingId, data) => {
    if (!wss) return;
    
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && 
            client.user && 
            (client.user.role === 'admin' || client.user.buildings.includes(buildingId))) {
            client.send(JSON.stringify({
                type: 'building_update',
                buildingId,
                data
            }));
        }
    });
};

module.exports = {
    setupWebSocket,
    broadcastUpdate,
    sendBuildingUpdate
};
```

## 8. Добавление тестирования

### Установка зависимостей
```bash
npm install --save-dev jest supertest
```

### Пример теста для API зданий (tests/buildings.test.js)
```javascript
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');

// Мокируем базу данных
jest.mock('../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn()
}));

describe('Buildings API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    
    describe('GET /api/buildings', () => {
        it('should return all buildings', async () => {
            const mockBuildings = [
                { building_id: 1, name: 'Test Building 1', address: '123 Test St', latitude: 40.1, longitude: -73.1 },
                { building_id: 2, name: 'Test Building 2', address: '456 Test Ave', latitude: 40.2, longitude: -73.2 }
            ];
            
            db.query.mockResolvedValueOnce({ rows: mockBuildings });
            db.query.mockResolvedValueOnce({ rows: [{ count: '2' }] });
            
            const response = await request(app)
                .get('/api/buildings')
                .expect('Content-Type', /json/)
                .expect(200);
                
            expect(response.body.data).toHaveLength(2);
            expect(response.body.data[0].name).toBe('Test Building 1');
            expect(response.body.pagination.total).toBe(2);
        });
    });
    
    describe('POST /api/buildings', () => {
        it('should create a new building', async () => {
            const newBuilding = {
                name: 'New Building',
                address: '789 New St',
                town: 'Newtown',
                latitude: 41.1,
                longitude: -74.1,
                management_company: 'Test Co'
            };
            
            db.query.mockResolvedValueOnce({ 
                rows: [{ ...newBuilding, building_id: 3 }] 
            });
            
            const response = await request(app)
                .post('/api/buildings')
                .send(newBuilding)
                .expect('Content-Type', /json/)
                .expect(201);
                
            expect(response.body).toHaveProperty('building_id', 3);
            expect(response.body.name).toBe('New Building');
            
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO buildings'),
                expect.arrayContaining([newBuilding.name, newBuilding.address])
            );
        });
        
        it('should validate required fields', async () => {
            const invalidBuilding = {
                name: 'Invalid Building',
                // address отсутствует - обязательное поле
                latitude: 41.1,
                longitude: -74.1
            };
            
            const response = await request(app)
                .post('/api/buildings')
                .send(invalidBuilding)
                .expect('Content-Type', /json/)
                .expect(400);
                
            expect(response.body).toHaveProperty('errors');
            expect(response.body.errors[0].param).toBe('address');
        });
    });
});
```

## 9. Шаги по внедрению

1. Создать новую структуру директорий
2. Перенести и разделить существующую логику по модулям
3. Внедрить middleware для валидации и аутентификации
4. Настроить переменные окружения
5. Добавить документацию API
6. Внедрить логирование
7. Настроить тесты
8. Добавить интеграцию с WebSocket (опционально)
9. Настроить кэширование (опционально)

## 10. Зависимости для установки

```bash
# Основные
npm install express pg dotenv cors express-validator

# Логирование
npm install winston 

# Аутентификация
npm install jsonwebtoken bcrypt

# Документация API
npm install swagger-jsdoc swagger-ui-express

# Реальное время
npm install ws

# Кэширование
npm install redis

# Тестирование
npm install --save-dev jest supertest
``` 