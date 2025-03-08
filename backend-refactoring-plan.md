# План рефакторинга бэкенда для проекта InfraSafe - Оставшиеся задачи

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

## 9. Оставшиеся шаги по внедрению

1. Завершить перенос бизнес-логики в сервисные слои
2. Завершить реализацию контроллеров
3. Завершить создание моделей данных
4. Внедрить аутентификацию и авторизацию
5. Настроить тесты
6. Провести тестирование и отладку
7. Подготовить документацию для команды
8. Добавить интеграцию с WebSocket (опционально)
9. Настроить кэширование (опционально)

``` 

## 11. Текущий статус рефакторинга (обновлено)

### Текущая ветка
Рефакторинг в настоящее время ведется в ветке `refactored-backend`.

### Прогресс рефакторинга
1. ✅ Создана новая структура директорий согласно плану
2. ✅ Настроены основные конфигурационные файлы
3. ✅ Настроена документация API с помощью Swagger
4. ✅ Внедрено логирование с использованием Winston
5. ✅ Настроены базовые middleware (безопасность, CORS, обработка ошибок)
6. ✅ Реорганизованы маршруты API
7. ⏳ В процессе: Перенос бизнес-логики в сервисные слои
8. ⏳ В процессе: Реализация контроллеров
9. ⏳ В процессе: Создание моделей данных
10. 🔜 Запланировано: Настройка аутентификации и авторизации
11. 🔜 Запланировано: Внедрение тестирования
12. 🔜 Запланировано: Интеграция WebSocket (опционально)
13. 🔜 Запланировано: Настройка кэширования (опционально)

### Следующие шаги
1. Завершить перенос бизнес-логики в сервисные слои
2. Завершить реализацию контроллеров
3. Завершить создание моделей данных
4. Внедрить аутентификацию и авторизацию
5. Настроить тесты
6. Провести тестирование и отладку
7. Подготовить документацию для команды

### Примечания
- Важно сохранить совместимость с текущим фронтендом, который использует URL API: `https://172.17.0.1/api/metrics` или `http://localhost:3000/api/metrics`
- В ветке `refactored-backend` продолжается работа по модульной реорганизации бэкенда с сохранением совместимости API 