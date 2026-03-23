# План рефакторинга InfraSafe по результатам архитектурного аудита

**Версия:** 1.0
**Дата:** 2026-03-07
**Основание:** [Архитектурный аудит](ARCHITECTURE_REVIEW.md) — оценка 5.5/10
**Статус:** Утверждён к исполнению

---

## Контекст

Архитектурный аудит выявил критические проблемы безопасности (секреты в git, in-memory blacklist), нарушения трёхслойной архитектуры в 60% модулей, N+1 запросы, утечки таймеров и отсутствие стандартизации API. Продукт **не готов к production**. План устраняет все найденные проблемы в 8 спринтов, каждый — отдельная ветка и PR.

## Приоритизация

| Уровень | Описание | Спринты |
|---------|----------|---------|
| **P0** | Критические уязвимости — блокируют production | 1 |
| **P1** | Высокий риск — DoS, XSS, God Object | 2, 5 |
| **P2** | Архитектурные — нарушения слоёв, N+1, утечки | 3, 4, 6, 7 |
| **P3** | Стратегические — масштабируемость, observability | 8 |

## Граф зависимостей

```
Спринт 1 (P0) ──┐
                 ├──> Спринт 3 (P2) ──> Спринт 4 (P2) ──> Спринт 5 (P1/P2) ──> Спринт 8 (P3)
Спринт 2 (P1) ──┘                                    └──> Спринт 6 (P2)
                                                            Спринт 7 (P2) ─────────────────────┘
```

- Спринты 1 и 2 — можно параллельно
- Спринты 3 → 4 → 5 — строго последовательно
- Спринт 6 — после 4
- Спринт 7 — параллельно с 5-6
- Спринт 8 — финальный

## Общая оценка трудозатрат

| Спринт | Длительность | Новые файлы | Изменяемые файлы |
|--------|-------------|-------------|-----------------|
| 1 | 1 день | 3 | 3 |
| 2 | 1 день | 0 | 13 |
| 3 | 2 дня | 1 | 4 |
| 4 | 2 дня | 6 | 6 |
| 5 | 2-3 дня | 9 | 2 |
| 6 | 1-2 дня | 0 | 3 |
| 7 | 1 день | 0 | 3 |
| 8 | 2-3 дня | 3 | 2 |
| **Итого** | **12-16 дней** | **22** | **36** |

---

## Спринт 1: Секреты и токен-безопасность (P0)

**Ветка:** `refactor/sprint-1-secrets-and-token-blacklist`
**Длительность:** 1 день
**Проблема из аудита:** Секреты в git (2.1), token blacklist в памяти (2.4)

### Задача 1.1: Удалить .env файлы из git-tracking

**Что:** `.env`, `.env.prod`, `generator/.env` отслеживаются в git, несмотря на .gitignore. Содержат JWT-секреты и пароли БД.

**Действия:**
1. `git rm --cached .env .env.prod generator/.env`
2. Создать `.env.example` — шаблон со всеми переменными, placeholder-значениями (`JWT_SECRET=CHANGE_ME`)
3. Создать `generator/.env.example` — аналогично
4. Документировать необходимость ротации секретов из `.env.prod` строки 27-28 (остаются в git-истории)

**Файлы:**
| Действие | Файл |
|----------|------|
| Создать | `.env.example` |
| Создать | `generator/.env.example` |
| git rm --cached | `.env`, `.env.prod`, `generator/.env` |

### Задача 1.2: Перенести token blacklist в БД

**Что:** Таблица `token_blacklist` существует в БД (`database/init/01_init_database.sql` строки 53-58), но `authService.js` использует только in-memory cache. При перезапуске сервера все отозванные токены снова валидны.

**Действия:**
1. `authService.js` метод `blacklistToken()` (строки 422-434): вместо `cacheService.set()` делать `INSERT INTO token_blacklist (token_hash, expires_at)` с `crypto.createHash('sha256')`. Оставить memory cache как L1-кэш
2. `authService.js` метод `isTokenBlacklisted()` (строки 438-445): проверять сначала memory cache, при miss — `SELECT FROM token_blacklist WHERE token_hash = $1 AND expires_at > NOW()`
3. Добавить `cleanupExpiredTokens()` — `DELETE FROM token_blacklist WHERE expires_at < NOW()`, запуск каждый час
4. `database.js` строка 11: добавить `max: 20, min: 2, idleTimeoutMillis: 30000` (также закрывает P3: connection pooling)

**Файлы:**
| Действие | Файл | Строки |
|----------|------|--------|
| Изменить | `src/services/authService.js` | 422-446 |
| Изменить | `src/config/database.js` | 11-17 |
| Создать | `database/migrations/009_token_blacklist_index.sql` | — |

### Верификация спринта 1
- [ ] `git ls-files | grep .env` — пустой результат
- [ ] `npm test` — все тесты проходят
- [ ] Тест: login → logout → использовать старый токен → 401
- [ ] Тест: login → logout → **перезапуск сервера** → старый токен → 401 (персистентность)
- [ ] Написать `tests/jest/unit/tokenBlacklist.test.js`

---

## Спринт 2: Rate limiting и CSP (P1)

**Ветка:** `refactor/sprint-2-rate-limiting-and-csp`
**Длительность:** 1 день
**Проблема из аудита:** Rate limiter не подключён (2.5), unsafe-eval в CSP (2.3)

### Задача 2.1: Подключить rate limiter ко всем маршрутам

**Что:** `rateLimiter.js` экспортирует `applyCrudRateLimit` (60 req/min), но он не подключён к 11 из 16 route-файлов. Критично: `POST /api/metrics/telemetry` — публичный, без auth, без rate limit = DoS вектор.

**Действия:**
1. `routes/index.js` строка 75: добавить `telemetryLimiter` (120 req/min) к `/metrics/telemetry`
2. Добавить `applyCrudRateLimit` на POST/PUT/DELETE в 11 route-файлов

**Файлы:**
| Действие | Файл |
|----------|------|
| Изменить | `src/routes/index.js` (строка 75) |
| Изменить | `src/routes/buildingRoutes.js` |
| Изменить | `src/routes/controllerRoutes.js` |
| Изменить | `src/routes/metricRoutes.js` |
| Изменить | `src/routes/transformerRoutes.js` |
| Изменить | `src/routes/lineRoutes.js` |
| Изменить | `src/routes/waterSourceRoutes.js` |
| Изменить | `src/routes/heatSourceRoutes.js` |
| Изменить | `src/routes/waterLineRoutes.js` |
| Изменить | `src/routes/waterSupplierRoutes.js` |
| Изменить | `src/routes/powerAnalyticsRoutes.js` |
| Изменить | `src/routes/buildingMetricsRoutes.js` |

### Задача 2.2: Условный CSP для production

**Что:** `server.js` строки 23-39 содержат `unsafe-inline` + `unsafe-eval` в scriptSrc для Swagger UI, но Swagger отключён в production.

**Действия:**
- `server.js`: если `NODE_ENV === 'production'` — строгий CSP без `unsafe-*`; иначе — текущий CSP

**Файлы:**
| Действие | Файл | Строки |
|----------|------|--------|
| Изменить | `src/server.js` | 23-39 |

### Задача 2.3: Cleanup таймеров rate limiter

**Что:** `rateLimiter.js` создаёт 5+ инстансов с `setInterval` без `clearInterval`.

**Действия:**
- Сохранить interval ID в конструкторе
- Добавить `destroy()` метод
- Экспортировать `destroyAll()`

**Файлы:**
| Действие | Файл |
|----------|------|
| Изменить | `src/middleware/rateLimiter.js` |

### Верификация спринта 2
- [ ] `npm test` — все тесты проходят
- [ ] 150 POST к `/api/metrics/telemetry` — 429 после 120 запросов
- [ ] `curl -I /api/ -H "NODE_ENV: production"` — CSP без unsafe-eval
- [ ] Swagger UI доступен в development по `/api-docs/`

---

## Спринт 3: Стандартизация API-контракта (P2)

**Ветка:** `refactor/sprint-3-api-contract-standardization`
**Длительность:** 2 дня
**Проблема из аудита:** Inconsistent error handling (5.3), разные форматы ответов (1.2)

### Задача 3.1: Утилита ответов API

**Что:** Три формата ответов в разных контроллерах: `{ data, pagination }`, `{ success: true, data }`, `{ error: { message } }`.

**Действия:**
- Создать `src/utils/apiResponse.js`:
  - `sendSuccess(res, data, meta, statusCode)` → `{ success: true, data, pagination? }`
  - `sendError(res, message, statusCode)` → `{ success: false, error: { message, status } }`

**Файлы:**
| Действие | Файл |
|----------|------|
| Создать | `src/utils/apiResponse.js` |

### Задача 3.2: Исправить error handling в analyticsController

**Что:** Ни один из ~15 методов `AnalyticsController` не вызывает `next(error)` — все ловят ошибку и возвращают `res.status(500).json()` напрямую, минуя `errorHandler.js`.

**Действия:**
- Добавить `next` в сигнатуры всех методов
- Заменить все `res.status(500).json(...)` на `next(error)` в catch-блоках

**Файлы:**
| Действие | Файл |
|----------|------|
| Изменить | `src/controllers/analyticsController.js` |

### Задача 3.3: Привести контроллеры к единому формату ответов

**Действия:**
- `buildingController.js`, `buildingMetricsController.js`, `metricController.js`: обернуть ответы в `{ success: true, data, pagination }`
- `errorHandler.js`: формат `{ success: false, error: { message, status } }`

**Файлы:**
| Действие | Файл |
|----------|------|
| Изменить | `src/controllers/buildingController.js` |
| Изменить | `src/controllers/buildingMetricsController.js` |
| Изменить | `src/controllers/metricController.js` |
| Изменить | `src/middleware/errorHandler.js` |

### Верификация спринта 3
- [ ] `npm test` — все тесты проходят
- [ ] GET /api/buildings — `{ success: true, data: [...], pagination: {...} }`
- [ ] GET /api/buildings/99999 — `{ success: false, error: { message: "...", status: 404 } }`
- [ ] Ошибка analytics — проходит через errorHandler (единый формат)

---

## Спринт 4: Трёхслойная архитектура — водная инфраструктура (P2)

**Ветка:** `refactor/sprint-4-three-layer-water-infra`
**Длительность:** 2 дня
**Проблема из аудита:** SQL в route-файлах (1.1), отсутствие Service-слоя (1.1)

### Задача 4.1: Model + Controller для water/heat sources

**Что:** `waterSourceRoutes.js` и `heatSourceRoutes.js` содержат полный CRUD с SQL прямо в route-файлах (`const { query } = require('../config/database')`).

**Новые файлы:**
| Файл | Образец |
|------|---------|
| `src/models/ColdWaterSource.js` | По образцу `Transformer.js` |
| `src/models/HeatSource.js` | По образцу `Transformer.js` |
| `src/controllers/coldWaterSourceController.js` | По образцу `transformerController.js` |
| `src/controllers/heatSourceController.js` | По образцу `transformerController.js` |

**Изменяемые файлы:**
| Файл | Что делать |
|------|-----------|
| `src/routes/waterSourceRoutes.js` | Удалить SQL, делегировать в controller |
| `src/routes/heatSourceRoutes.js` | Удалить SQL, делегировать в controller |

### Задача 4.2: Service-слой для transformer и line

**Что:** `transformerController.js` и `lineController.js` обращаются к Model напрямую, без Service.

**Новые файлы:**
| Файл | Образец |
|------|---------|
| `src/services/transformerService.js` | По образцу `buildingService.js` |
| `src/services/lineService.js` | По образцу `buildingService.js` |

**Изменяемые файлы:**
| Файл | Что делать |
|------|-----------|
| `src/controllers/transformerController.js` | Использовать Service вместо Model |
| `src/controllers/lineController.js` | Аналогично |

### Задача 4.3: Service-слой для buildingMetrics и powerAnalytics

**Что:** `powerAnalyticsController.js` и `buildingMetricsController.js` содержат SQL прямо в контроллере. В powerAnalytics — дублирование: getBuildingsPower/getBuildingPower идентичный SQL CTE.

**Новые файлы:**
| Файл | Описание |
|------|----------|
| `src/services/powerAnalyticsService.js` | SQL + устранение дублирования CTE |
| `src/services/buildingMetricsService.js` | SQL из buildingMetricsController |

**Изменяемые файлы:**
| Файл | Что делать |
|------|-----------|
| `src/controllers/powerAnalyticsController.js` | Убрать `require('../config/database')`, делегировать в Service |
| `src/controllers/buildingMetricsController.js` | Аналогично |

### Верификация спринта 4
- [ ] `npm test` — все тесты проходят
- [ ] CRUD cold-water-sources: GET list, GET by id, POST, PUT, DELETE
- [ ] CRUD heat-sources: аналогично
- [ ] Power analytics: все 8 эндпоинтов работают
- [ ] `grep -r "require.*config/database" src/controllers src/routes` — пустой результат (кроме adminController)

---

## Спринт 5: Декомпозиция adminController (P1/P2)

**Ветка:** `refactor/sprint-5-admin-controller-decomposition`
**Длительность:** 2-3 дня
**Проблема из аудита:** God Object 1830 строк (5.2), SQL в контроллере (1.1)
**Зависит от:** Спринт 4 (Service-слой для transformer, line, water)

### Задача 5.1: Разбить God Object

**Что:** `adminController.js` — 1830 строк с `const pool = require('../config/database')` на строке 1. Содержит CRUD для 8 сущностей, batch-операции, search, stats, export.

**Новые файлы (модули admin/):**
| Файл | Ответственность | Делегирует в |
|------|-----------------|-------------|
| `src/controllers/admin/adminBuildingController.js` | CRUD зданий | buildingService |
| `src/controllers/admin/adminControllerController.js` | CRUD контроллеров | controllerService |
| `src/controllers/admin/adminMetricController.js` | CRUD метрик | metricService |
| `src/controllers/admin/adminTransformerController.js` | CRUD трансформаторов | transformerService |
| `src/controllers/admin/adminLineController.js` | CRUD линий | lineService |
| `src/controllers/admin/adminWaterController.js` | Водные сущности | Models |
| `src/controllers/admin/adminDashboardController.js` | search, stats, export | adminService |
| `src/controllers/admin/index.js` | re-export всех модулей | — |

### Задача 5.2: adminService для batch-операций

**Новый файл:**
| Файл | Описание |
|------|----------|
| `src/services/adminService.js` | Generic batch: `executeBatch(entityType, action, ids)` |

**Изменяемые файлы:**
| Файл | Что делать |
|------|-----------|
| `src/routes/adminRoutes.js` | Обновить импорты |
| `src/controllers/adminController.js` | Удалить (заменён модулями) |

### Верификация спринта 5
- [ ] `npm test` — все тесты проходят
- [ ] `ls src/controllers/adminController.js` — файл не существует
- [ ] Все 30+ admin-эндпоинтов работают
- [ ] Batch-операции: POST /admin/buildings/batch — работает
- [ ] `grep -r "require.*config/database" src/controllers` — пустой результат

---

## Спринт 6: N+1, PostGIS и health check (P2)

**Ветка:** `refactor/sprint-6-n-plus-1-and-postgis`
**Длительность:** 1-2 дня
**Проблема из аудита:** N+1 запросы (3.1), игнорирование PostGIS (3.1), health check без БД (8.3)

### Задача 6.1: PostGIS для findBuildingsInRadius

**Что:** `buildingService.js` строка 168 загружает ВСЕ здания (`Building.findAll(1, 1000)`) и фильтрует в JS. PostGIS и GIST-индексы уже установлены.

**Файлы:**
| Действие | Файл | Что делать |
|----------|------|-----------|
| Изменить | `src/models/Building.js` | Добавить `findInRadius(lat, lng, meters)` с `ST_DWithin` |
| Изменить | `src/services/buildingService.js` | строка 168: использовать `Building.findInRadius()` |

### Задача 6.2: N+1 в getBuildingById

**Что:** Два отдельных запроса: `Building.findById()` + `Controller.findByBuildingId()`.

**Файлы:**
| Действие | Файл | Что делать |
|----------|------|-----------|
| Изменить | `src/models/Building.js` | Добавить `findByIdWithControllers(id)` с LEFT JOIN + json_agg |
| Изменить | `src/services/buildingService.js` | строка 50: один запрос вместо двух |

### Задача 6.3: N+1 в getBuildingsStatistics

**Что:** Загружает 10000 записей для подсчёта, который можно сделать одним SQL.

**Файлы:**
| Действие | Файл | Что делать |
|----------|------|-----------|
| Изменить | `src/models/Building.js` | Добавить `getStatistics()` с COUNT + GROUP BY |
| Изменить | `src/services/buildingService.js` | строка 210: один SQL вместо JS-подсчёта |

### Задача 6.4: DRY в Building.js

Вынести общий JOIN на 8 таблиц (дублируется в `findAll` и `findById`) в `BASE_QUERY` константу.

### Задача 6.5: Health check с проверкой БД

**Что:** `server.js` строки 50-52: `res.send('healthy')` без проверки БД.

**Файлы:**
| Действие | Файл | Что делать |
|----------|------|-----------|
| Изменить | `src/server.js` | строки 50-52: `await db.query('SELECT 1')`, вернуть 503 при ошибке |

### Верификация спринта 6
- [ ] `npm test` — все тесты проходят
- [ ] `EXPLAIN ANALYZE` на findInRadius — GIST Index Scan
- [ ] GET /api/buildings/1 — контроллеры включены в ответ (1 запрос)
- [ ] GET /api/buildings/statistics — быстрый ответ
- [ ] GET /health при остановленной БД — 503

---

## Спринт 7: Утечки таймеров и graceful shutdown (P2)

**Ветка:** `refactor/sprint-7-timer-leaks-and-stability`
**Длительность:** 1 день
**Проблема из аудита:** 10+ неочищаемых setInterval (Приложение B), отсутствие graceful shutdown

### Задача 7.1: Устранить утечки таймеров

**Файлы:**
| Файл | Строка | Что делать |
|------|--------|-----------|
| `src/utils/circuitBreaker.js` | 161 | Сохранить ID, добавить `destroy()`, `stopMonitoring()` |
| `src/services/cacheService.js` | 53 | Сохранить ID, добавить `destroy()` |
| `src/middleware/rateLimiter.js` | 19, 156 | Уже частично из спринта 2, доделать |

### Задача 7.2: Graceful shutdown

**Файлы:**
| Действие | Файл | Что делать |
|----------|------|-----------|
| Изменить | `src/server.js` | SIGTERM/SIGINT: server.close() → destroyAll() → db.close() → exit |

### Верификация спринта 7
- [ ] `npm test` — все тесты проходят
- [ ] `kill -TERM <pid>` — чистое завершение без warning
- [ ] Jest завершается без timeout
- [ ] Логи: нет сообщений об утечках

---

## Спринт 8: Стратегические улучшения (P3)

**Ветка:** `refactor/sprint-8-strategic-improvements`
**Длительность:** 2-3 дня
**Проблема из аудита:** Metrics без партиционирования (4.3), недостающие индексы (3.3), отсутствие log rotation (8.4)

### Задача 8.1: Партиционирование таблицы metrics

**Что:** Непартиционированная таблица для IoT-платформы. При 10000 контроллеров: 2.88M строк/день.

**Файлы:**
| Действие | Файл | Описание |
|----------|------|----------|
| Создать | `database/migrations/010_partition_metrics.sql` | PARTITION BY RANGE(timestamp), помесячно, автосоздание |

### Задача 8.2: Недостающие индексы

**Файлы:**
| Действие | Файл | Описание |
|----------|------|----------|
| Создать | `database/migrations/011_add_missing_indexes.sql` | idx на buildings.primary_transformer_id, backup_transformer_id, cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id |

### Задача 8.3: Log rotation

**Файлы:**
| Действие | Файл | Что делать |
|----------|------|-----------|
| Изменить | `src/utils/logger.js` | `maxsize: 5242880, maxFiles: 5` в файловые транспорты |

### Задача 8.4: Correlation ID

**Файлы:**
| Действие | Файл | Что делать |
|----------|------|-----------|
| Создать | `src/middleware/requestId.js` | uuid для каждого запроса, X-Request-ID заголовок |
| Изменить | `src/server.js` | Подключить requestId middleware до morgan |

### Верификация спринта 8
- [ ] `npm test` — все тесты проходят
- [ ] `EXPLAIN` на metrics запрос — partition pruning
- [ ] Лог > 5MB — ротируется автоматически
- [ ] `curl -I /api/health` — содержит X-Request-ID

---

## За рамками этого плана

Следующие улучшения требуют отдельного планирования:

| # | Улучшение | Причина отложения |
|---|----------|------------------|
| 1 | Консолидация transformers / power_transformers | Высокий риск, отдельный дизайн миграции данных |
| 2 | Декомпозиция frontend (admin.js 3243, script.js 2377 строк) | Отдельный проект, возможен переход на Vite + ES modules |
| 3 | CI/CD (GitHub Actions) | Отдельный DevOps спринт |
| 4 | Мониторинг (Prometheus + Grafana) | Инфраструктурный проект |
| 5 | Миграция на Node.js 20 | Dockerfile.dev использует node:18-alpine |
| 6 | WebSocket для real-time | Замена polling (30s) на push |

---

## Ожидаемый результат

После выполнения всех 8 спринтов:

| Метрика | До | После |
|---------|-----|-------|
| Оценка архитектуры | 5.5/10 | ~7.5-8/10 |
| Production readiness | Не готов | Готов (до 100 зданий) |
| Соблюдение трёхслойности | 40% | 100% |
| Секреты в git | Да | Нет |
| Token blacklist persist | Нет | Да |
| Rate limiting | 30% маршрутов | 100% маршрутов |
| CSP unsafe-eval | Да (production) | Нет |
| N+1 запросы | 3 критических | 0 |
| Утечки таймеров | 10+ | 0 |
| API формат | 3 варианта | 1 стандарт |
| Health check БД | Нет | Да |
| Metrics партиционирование | Нет | Да |
| Log rotation | Нет | Да |

---

*Документ подготовлен на основе архитектурного аудита от 2026-03-07.*
