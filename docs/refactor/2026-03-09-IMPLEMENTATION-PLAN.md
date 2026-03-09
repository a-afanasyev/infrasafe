# План рефакторинга InfraSafe — Актуальный на 2026-03-09

## Контекст

Ветка `fix/p0-p1-security-and-hygiene` закрыла все 7 P0-уязвимостей и 5 из 7 P1-задач. Оставшаяся работа — P1 завершение (frontend console.log) и P2 архитектурный долг: 3 route-файла с прямым SQL, 3 контроллера без сервисного слоя, монолитный adminController (1852 строки), нет graceful shutdown.

**Цель:** Привести кодовую базу к чистой трёхслойной архитектуре (routes → controllers → services → models), устранить оставшийся технический долг, НЕ ломая фронтенд.

**Важные корректировки по результатам аудита:**
- Token blacklist УЖЕ реализован двухуровнево (L1 memory + L2 PostgreSQL) — задача закрыта
- Timer leaks УЖЕ исправлены (destroy() есть у circuitBreaker, cacheService, rateLimiter) — задача закрыта
- innerHTML — ВСЕ использования безопасны (DOMPurify / static / clearing) — задача закрыта
- Mock data в production — НЕ обнаружены (ложное срабатывание) — задача закрыта
- Backend console.log — 0 штук, весь бэкенд на Winston — задача закрыта

---

## Фаза 1: P1 — Очистка console.log фронтенда [S, ~1ч]

**Зависимости:** нет

### 1.1 Удалить 83 debug console.log

| Файл | console.log | Действие |
|------|------------|----------|
| `public/admin.js` | 51 | Удалить все (отладка: `loadSectionData called`, `editBuilding вызвана` и т.п.) |
| `public/script.js` | 27 | Удалить все (инициализация, переключение тем/табов) |
| `public/map-layers-control.js` | 5 | Удалить все (загрузка слоёв) |

### 1.2 Удалить 4 init-лога из утилит

- `public/utils/domSecurity.js:269` — `console.log('✅ DOMSecurity...')`
- `public/utils/csrf.js:95` — `console.log('✅ CSRF Protection...')`
- `public/utils/rateLimiter.js:90` — `console.log('✅ RateLimiter...')`
- `public/utils/safeJsonParser.js:111` — `console.log('✅ SafeJsonParser...')`

### 1.3 console.error — НЕ трогать

70 `console.error` в catch-блоках фронтенда — легитимная обработка ошибок. На клиенте нет Winston, console.error — единственный инструмент.

### Верификация

```bash
grep -c "console.log" public/admin.js public/script.js public/map-layers-control.js
# Ожидание: 0 во всех
grep -c "console.log" public/utils/*.js
# Ожидание: 0
npm test  # Все тесты проходят
```

Ручная проверка: карта, слои, авторизация, админка.

---

## Фаза 2: Стандартизация API-ошибок + утилита ответов [M, ~3ч]

**Зависимости:** нет (параллельно с Фазой 1)

### Архитектурное решение

> **НЕ оборачиваем success-ответы в `{ success, data }` для существующих контроллеров** — это сломает фронтенд, который в ~30 местах делает `const data = await response.json()` и работает с сырым результатом. Фронтенд уже обрабатывает оба формата через `result.data || result` в некоторых местах, но не везде.
>
> Стратегия: создать утилиту, использовать её в НОВЫХ контроллерах (Фаза 3+), а в существующих — только стандартизировать ошибки.

### 2.1 Создать `src/utils/apiResponse.js` (новый файл)

```javascript
const sendSuccess = (res, data, { status = 200, pagination, message } = {}) => {
    const response = { success: true, data };
    if (pagination) response.pagination = pagination;
    if (message) response.message = message;
    return res.status(status).json(response);
};
const sendError = (res, statusCode, message) => {
    return res.status(statusCode).json({
        success: false, error: { message, status: statusCode }
    });
};
const sendCreated = (res, data, message) => sendSuccess(res, data, { status: 201, message });
const sendNotFound = (res, message = 'Ресурс не найден') => sendError(res, 404, message);
module.exports = { sendSuccess, sendError, sendCreated, sendNotFound };
```

### 2.2 Обновить `src/middleware/errorHandler.js`

Добавить `success: false` к формату:

```javascript
// БЫЛО: { error: { message, status } }
// СТАЛО: { success: false, error: { message, status } }
```

### 2.3 Стандартизировать ошибки в существующих контроллерах

Только заменить разнородные ошибки на единый формат. **НЕ менять success-ответы.**

| Контроллер | Текущая ошибка | Замена |
|-----------|---------------|--------|
| `buildingController.js` | `{ error: 'Building not found' }` | `sendNotFound(res, 'Building not found')` |
| `metricController.js` | `{ error: 'Metric not found' }` | `sendNotFound(res, 'Metric not found')` |
| `controllerController.js` | `{ error: '...' }` | `sendNotFound(res)` / `sendError(res, 400, msg)` |

Контроллеры `alertController`, `analyticsController`, `lineController`, `transformerController` — уже используют `{ success: true/false }`, оставить как есть.

### Верификация

```bash
npm test
npm run test:integration
```

Фронтенд: CRUD зданий, контроллеров, метрик — проверить что 404 теперь в формате `{ success: false, error: {...} }`.

---

## Фаза 3: Трёхслойная архитектура — устранение прямого SQL [L, ~6ч]

**Зависимости:** Фаза 2 (используем apiResponse в новых контроллерах)

### Нарушения для исправления

| Файл | Проблема |
|------|----------|
| `src/routes/waterSourceRoutes.js` | 7 прямых `query()` — весь CRUD в route-файле |
| `src/routes/heatSourceRoutes.js` | 7 прямых `query()` — весь CRUD в route-файле |
| `src/routes/waterLineRoutes.js:52` | 1 прямой `db.query()` в GET /:id/supplier |
| `src/controllers/buildingMetricsController.js:1` | Импорт `db`, 50 строк SQL |
| `src/controllers/powerAnalyticsController.js:10` | Импорт `db`, множество SQL-запросов |

### НЕ делаем (архитектурная коррекция)

> **lineController** и **transformerController** уже работают через модели (Line, Transformer). Создание пустых сервисов-прокси (lineService, transformerService) — over-engineering. Для простого CRUD паттерн controller→model допустим. Сервис нужен только при наличии бизнес-логики, кэширования или валидации.

### 3.1 Создать модель `src/models/ColdWaterSource.js` (новый файл)

По образцу `src/models/Transformer.js`. Методы: `findAll(page, limit, filters)`, `findById(id)`, `create(data)`, `update(id, data)`, `delete(id)`. Таблица `cold_water_sources` (схема из `01_init_database.sql`).

### 3.2 Создать модель `src/models/HeatSource.js` (новый файл)

Аналогично ColdWaterSource. Таблица `heat_sources`.

### 3.3 Создать контроллер `src/controllers/coldWaterSourceController.js` (новый файл)

По образцу `buildingController.js`. 5 методов: getAll, getById, create, update, delete. Использует apiResponse из Фазы 2. Вызывает ColdWaterSource модель напрямую (без сервиса — простой CRUD).

### 3.4 Создать контроллер `src/controllers/heatSourceController.js` (новый файл)

Аналогично.

### 3.5 Рефакторинг `src/routes/waterSourceRoutes.js`

Убрать `const { query } = require('../config/database')` (строка 3). Заменить все 7 inline-хендлеров на вызовы `coldWaterSourceController`. Swagger-аннотации сохранить.

### 3.6 Рефакторинг `src/routes/heatSourceRoutes.js`

Аналогично — вызовы `heatSourceController`.

### 3.7 Исправить `src/routes/waterLineRoutes.js:52`

Извлечь SQL в метод `WaterLine.findSuppliersForLine(lineId)` в `src/models/WaterLine.js`. Убрать `db.query()` из route-файла.

### 3.8 Создать `src/services/buildingMetricsService.js` (новый файл)

Извлечь SQL-запрос (строки 10-49 из buildingMetricsController.js) + маппинг в сервис. Метод: `getBuildingsWithMetrics(isAuthenticated)`.

### 3.9 Рефакторинг `src/controllers/buildingMetricsController.js`

Убрать `const db = require('../config/database')` (строка 1). Заменить на импорт сервиса.

### 3.10 Создать `src/services/powerAnalyticsService.js` (новый файл)

Извлечь SQL-запросы из `powerAnalyticsController.js`. Методы: `getBuildingsPower()`, `getBuildingPower(id)`, `getTransformersPower()`, `getTransformerPower(id)`. Вспомогательная `calculatePower()`.

### 3.11 Рефакторинг `src/controllers/powerAnalyticsController.js`

Убрать `const db = require('../config/database')` (строка 10). Делегировать SQL в сервис.

### Новые файлы: 6

- `src/models/ColdWaterSource.js`
- `src/models/HeatSource.js`
- `src/controllers/coldWaterSourceController.js`
- `src/controllers/heatSourceController.js`
- `src/services/buildingMetricsService.js`
- `src/services/powerAnalyticsService.js`

### Изменяемые файлы: 6

- `src/routes/waterSourceRoutes.js`
- `src/routes/heatSourceRoutes.js`
- `src/routes/waterLineRoutes.js`
- `src/controllers/buildingMetricsController.js`
- `src/controllers/powerAnalyticsController.js`
- `src/models/WaterLine.js` (добавить метод)

### Верификация

```bash
# Ни один route/controller не импортирует database напрямую:
grep -r "require.*config/database" src/routes/ src/controllers/
# Ожидание: только adminController (он в Фазе 4)

npm test
npm run test:integration
```

Ручная проверка: CRUD через Swagger для `/api/cold-water-sources`, `/api/heat-sources`, `/api/water-lines`, `/api/buildings-metrics`, `/api/power-analytics/*`.

---

## Фаза 4: Декомпозиция AdminController [L, ~6ч]

**Зависимости:** Фаза 3 (модели ColdWaterSource, HeatSource должны существовать)

### 4.1 Создать `src/controllers/admin/` с модулями

```
src/controllers/admin/
  index.js                          — реэкспорт (тот же API что у старого adminController)
  adminBuildingController.js        — getOptimized, batch для buildings
  adminControllerController.js      — getOptimized, batch для controllers
  adminMetricController.js          — getOptimized, batch для metrics
  adminTransformerController.js     — getOptimized, CRUD, batch для transformers
  adminLineController.js            — getOptimized, CRUD, batch для lines
  adminWaterLineController.js       — getOptimized, CRUD, batch для water lines
  adminInfrastructureController.js  — cold_water_sources + heat_sources CRUD
  adminGeneralController.js         — globalSearch, getAdminStats, exportData
```

Каждый модуль <= 250 строк. Прямой `pool.query()` заменяется на вызовы моделей/сервисов (из Фазы 3).

### 4.2 Создать `src/services/adminService.js` (новый файл)

Общая логика batch-операций:

```javascript
async batchDelete(model, ids) { ... }
async batchUpdateStatus(model, ids, status) { ... }
```

Устранит дублирование batch-логики (сейчас ~40 строк на каждую сущность x 6 сущностей).

### 4.3 Обновить `src/routes/adminRoutes.js`

Строка 2: заменить `require('../controllers/adminController')` на `require('../controllers/admin')`.

### 4.4 Удалить `src/controllers/adminController.js`

После проверки работоспособности.

### Новые файлы: 10

### Изменяемые файлы: 1 (`adminRoutes.js`)

### Удаляемые файлы: 1 (`adminController.js`)

### Верификация

```bash
npm test
# Swagger: все /api/admin/* маршруты работают
# ls src/controllers/admin/ — 9 файлов
# wc -l src/controllers/admin/*.js — каждый <= 250
```

Ручная проверка: админ-панель — CRUD, batch, поиск, экспорт.

---

## Фаза 5: Graceful Shutdown + Health Check + N+1 [M, ~2ч]

**Зависимости:** Фаза 3

### 5.1 Graceful shutdown в `src/server.js`

Сохранить ссылку на server:

```javascript
// Строка 113: БЫЛО app.listen(...) -> СТАЛО const server = app.listen(...)
```

Добавить обработчики после строки 120:

```javascript
const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    server.close(() => logger.info('HTTP server closed'));
    try { await db.close(); } catch (e) { logger.error('DB close error:', e); }
    setTimeout(() => process.exit(1), 10000).unref();
    process.exit(0);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

### 5.2 Улучшенный health check в `src/server.js`

Строки 52-54 — заменить stub на проверку БД:

```javascript
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).json({ status: 'healthy', db: 'connected' });
    } catch {
        res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
    }
});
```

### 5.3 N+1 в `src/models/Building.js`

Добавить метод `findByIdWithControllers(id)` — один запрос с LEFT JOIN + json_agg вместо двух отдельных запросов в `buildingService.getBuildingById()`.

### Изменяемые файлы: 3

- `src/server.js`
- `src/models/Building.js`
- `src/services/buildingService.js`

### Верификация

```bash
docker compose -f docker-compose.dev.yml up --build
docker compose down  # Проверить логи: "Received SIGTERM..."
curl localhost:3000/health  # { status: "healthy", db: "connected" }
npm test
```

---

## Фаза 6: Стратегические улучшения [M, ~2ч]

**Зависимости:** Фаза 5

### 6.1 Winston log rotation

Установить `winston-daily-rotate-file`. Обновить `src/utils/logger.js`: `maxSize: '20m'`, `maxFiles: '14d'`.

### 6.2 Correlation ID middleware

Новый файл `src/middleware/correlationId.js`. Установить `uuid`. Подключить в `src/server.js` перед Morgan.

### 6.3 Недостающие индексы

Новая миграция `database/migrations/010_add_missing_indexes.sql`:

- `idx_buildings_primary_transformer ON buildings(primary_transformer_id)`
- `idx_buildings_backup_transformer ON buildings(backup_transformer_id)`
- `idx_cold_water_sources_status ON cold_water_sources(status)`
- `idx_heat_sources_status ON heat_sources(status)`

### Новые файлы: 2 (`correlationId.js`, миграция)

### Изменяемые файлы: 2 (`logger.js`, `server.js`)

### Новые зависимости: `winston-daily-rotate-file`, `uuid`

### Верификация

```bash
ls logs/  # Файлы с датой: combined-2026-03-09.log
curl -v localhost:3000/api/  # Заголовок x-correlation-id в ответе
npm test
```

---

## Сводка

| Фаза | Scope | Новые файлы | Изменяемые | Зависит от | Параллелизм |
|------|-------|------------|-----------|-----------|-------------|
| 1. Console.log | S, ~1ч | 0 | 7 | -- | Фаза 2 |
| 2. API ошибки | M, ~3ч | 1 | ~5 | -- | Фаза 1 |
| 3. Трёхслойка | L, ~6ч | 6 | 6 | Фаза 2 | -- |
| 4. Admin decomp | L, ~6ч | 10 | 1+del | Фаза 3 | Фаза 5 |
| 5. Shutdown+N+1 | M, ~2ч | 0 | 3 | Фаза 3 | Фаза 4 |
| 6. Strategic | M, ~2ч | 2 | 2+migr | Фаза 5 | -- |

**Порядок:** Фазы 1+2 параллельно -> Фаза 3 -> Фазы 4+5 параллельно -> Фаза 6

**Итого:** ~19 новых файлов, ~24 изменённых, 1 удалённый. ~20ч работы.

---

## Ключевые файлы для реализации

| Файл | Роль в плане |
|------|-------------|
| `src/server.js` | Точка входа, Фазы 5+6 |
| `src/controllers/adminController.js` (1852 строки) | Декомпозиция в Фазе 4 |
| `src/routes/waterSourceRoutes.js` | Прямой SQL, Фаза 3 |
| `src/routes/heatSourceRoutes.js` | Прямой SQL, Фаза 3 |
| `src/controllers/buildingMetricsController.js` | Прямой SQL, Фаза 3 |
| `src/controllers/powerAnalyticsController.js` | Прямой SQL, Фаза 3 |
| `src/controllers/buildingController.js` | ЭТАЛОН паттерна controller->service->model |
| `src/middleware/errorHandler.js` | Стандартизация ошибок, Фаза 2 |
| `public/admin.js` | 51 console.log, Фаза 1 |
| `public/script.js` | 27 console.log, Фаза 1 |
