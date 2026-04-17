# Code Quality Report — InfraSafe

**Дата:** 2026-04-13
**Аудитор:** Claude Opus 4.6
**Режим:** read-only (код не изменялся)

---

## VALIDATION STATUS (Authoritative)

Этот документ полезен как сырой аудит, но не все метрики, severity и формулировки воспроизводятся по текущему состоянию репозитория.
Этот блок следует считать авторитетным; детальные таблицы ниже — raw findings и требуют выборочной перепроверки перед превращением в backlog.

### Verified Quick Facts

| Metric | Verified value |
|--------|----------------|
| JS source files (`src/` + `public/`) | 100 (`src`: 85, `public`: 15) |
| Lines of code (`src/`) | 17,753 |
| Lines of code (`public/`) | 11,338 |
| Lines of tests (`tests/`) | 25,920 |
| Test files | 93 |
| Architecture | 3-layer monolith (routes/controllers/services/models over PostgreSQL) |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`) |

### Confirmed High-Signal Findings

1. `PERF-001` — подтверждается N+1 / per-controller loop в `controllerService.updateControllersStatusByActivity`.
2. `ARCH-007` / `SOLID-010` — подтверждается циклическая зависимость `alertService <-> ukIntegrationService` через deferred `require()`.
3. Threshold divergence — `alertService` использует `transformer_overload = 85`, а `analyticsService` использует `80` для того же доменного понятия.
4. `adminGeneralController.globalSearch` — реальный stub, всегда возвращает пустой результат.
5. `totpService` — в текущем дереве нет выделенных unit-тестов самого сервиса; есть только mock-использование в тестах контроллера.
6. README реально устарел по портам и тестам.
7. UK integration / webhook routes действительно не покрыты Swagger JSDoc-аннотациями.

### Findings To Rephrase Or Downgrade

- `SEC-001`: подтверждается exposure реального `UK_WEBHOOK_SECRET` в локальном workspace и в tracked docs examples, но не подтверждается тезис "` .env` tracked in git". В текущем дереве `.env` игнорируется через `.gitignore`.
- `ARCH-009/010/011/012`: это реальные риски для multi-replica deployment, но не текущие single-instance defect'ы. SOT описывает одну Express app behind Nginx.
- `PERF-002`: последовательная обработка есть, но рекомендация должна быть не "слепой `Promise.all()`", а bounded concurrency / batched execution, чтобы не переложить bottleneck в БД.
- `TEST-002`: в текущем репозитории неверно. CRUD-тесты для `AlertType` присутствуют.
- `YAGNI-004/005/006`: это cleanup/test-only candidates, а не high-severity production findings.

---

## ЭТАП 0: Quick Stats

| Metric | Value |
|--------|-------|
| Languages | JavaScript (ES2020+) |
| Frameworks | Express.js 4.18, Leaflet.js, Chart.js |
| Total source files | 100 (.js in `src/` + `public/`) |
| Lines of code (src/) | 17,753 |
| Lines of code (public/) | 11,338 |
| Lines of tests | 25,920 |
| Test/Code ratio (src) | 1.46:1 |
| Test count | Not independently reproduced in this validation pass |
| Services/Modules | 3-layer monolith (controllers → services → models) |
| Dependencies | 17 prod + 4 dev |
| Docker containers | 3 (nginx, app, postgres) |
| CI/CD | GitHub Actions (ci.yml) |

---

## Findings Summary

| Category | Critical | High | Medium | Low | Info | Total |
|----------|----------|------|--------|-----|------|-------|
| Architecture | 0 | 3 | 5 | 5 | 1 | **14** |
| KISS | 0 | 1 | 5 | 5 | 0 | **11** |
| DRY | 0 | 5 | 4 | 1 | 0 | **10** |
| YAGNI | 0 | 8 | 3 | 2 | 0 | **13** |
| SOLID | 0 | 1 | 3 | 3 | 4 | **11** |
| Security | 1 | 0 | 2 | 2 | 4 | **9** |
| Testing | 0 | 0 | 2 | 2 | 3 | **7** |
| Performance | 0 | 2 | 2 | 3 | 0 | **7** |
| Documentation | 0 | 0 | 3 | 5 | 4 | **12** |
| **TOTAL** | **1** | **20** | **26** | **25** | **16** | **94** |

---

## Top-10 Issues

| # | ID | Severity | File(s) | Description |
|---|-----|----------|---------|-------------|
| 1 | SEC-001 | **CRITICAL** | `.env:3` + tracked docs examples | Real `UK_WEBHOOK_SECRET` present in local workspace and duplicated in tracked docs examples. Rotate if active; scrub tracked docs/history where applicable |
| 2 | PERF-001 | HIGH | `controllerService.js:254-307` | N+1 query: fetches up to 10,000 controllers, then 2 DB calls per controller (1+2N queries) in `updateControllersStatusByActivity` |
| 3 | PERF-002 | HIGH | `alertService.js:423-455` | Sequential `checkTransformerLoad()` in loop for all transformers; should use bounded concurrency / batching |
| 4 | ARCH-007 | HIGH | `ukIntegrationService.js:191-513` + `alertService.js:127,257` | Circular dependency via 8+ deferred `require()` calls between alertService and ukIntegrationService |
| 5 | ARCH-009 | HIGH | `alertService.js:21` | `activeAlerts` in-memory Map is per-process SPOF; breaks with horizontal scaling |
| 6 | ARCH-010 | HIGH | `rateLimiter.js:4` | Rate limiter store is per-process Map; effective limit = `max * replica_count` |
| 7 | DRY-003 | HIGH | 7 admin controller files | `getOptimized*` function body is verbatim copy-paste across every admin controller (~70 lines each) |
| 8 | DRY-001/002 | HIGH | `coldWaterSource*.js` / `heatSource*.js` | Controllers (71 lines each) and models (152 lines each) are structurally identical — only entity noun differs |
| 9 | YAGNI-001/002/003 | HIGH | `swagger_init_debug.js`, `swagger_update.js`, `alerts_endpoints.js` | 3 orphaned root-level scripts totalling ~150 lines; zero imports anywhere |
| 10 | KISS-001 | HIGH | `ukIntegrationService.js:204-314` | `sendAlertToUK` is 111 lines with nesting depth 5 (try → for → try → if/else) |

---

## ЭТАП 1: АРХИТЕКТУРА

### 1.1 Структура проекта

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| ARCH-001 | LOW | `models/Transformer.js` + `models/PowerTransformer.js` | Dual transformer model/table confusion — `transformers` (grid) vs `power_transformers` (analytics). Разработчик не может определить какой "трансформатор" применим к контексту без чтения нескольких файлов |
| ARCH-002 | LOW | `adminRoutes.js:1-1011` | ~850 строк — Swagger JSDoc; фактический routing ~160 строк. Не God-object, а documentation inflation. Стоит вынести Swagger-схемы в отдельную директорию |

### 1.2 Разделение ответственности

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| ARCH-003 | MEDIUM | `authService.js:6,58,295,352,464,519` | authService выполняет raw SQL напрямую через `db`; нет User model. Несогласованно с другими сущностями (Building, Metric, Controller имеют модели) |
| ARCH-004 | MEDIUM | `alertService.js:1-508` | Смешивает 5 обязанностей: DB polling (55-73), in-memory state (21), threshold logic (140-149), CRUD (199-218), notification dispatch (245-268) |
| ARCH-005 | MEDIUM | `adminBuildingController.js:103`, `adminGeneralController.js:6,39` | В admin-layer есть operator-visible stubs: `globalSearch` всегда возвращает пустой результат, `exportData` всегда возвращает 501, часть batch handlers требует отдельной перепроверки |
| ARCH-006 | LOW | `analyticsController.js:315-401` | Смешивает read-only аналитику и CRUD мутации трансформаторов под `/api/analytics`. URL подразумевает read-only, но POST создаёт записи |

### 1.3 Зависимости между модулями

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| ARCH-007 | **HIGH** | `ukIntegrationService.js:191,209,228,438,456,491,513` + `alertService.js:127,257` | Circular dependency через 8+ deferred `require()`. Оба сервиса — singleton (module.exports = new ...()), взаимно ссылаются. Скрывает coupling, ломает статический анализ |
| ARCH-008 | LOW | `analyticsService.js:88-91` | Тот же pattern — deferred require alertService внутри `setImmediate` |

### 1.4 Масштабируемость

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| ARCH-009 | **HIGH** | `alertService.js:21` | `this.activeAlerts` in-memory Map — per-process SPOF. При горизонтальном масштабировании каждый процесс имеет изолированную Map. Process B создаст дублирующий алерт для того же события. `loadActiveAlerts` при старте восстанавливает из БД, но горизонтальное масштабирование сломано |
| ARCH-010 | **HIGH** | `rateLimiter.js:4-147` | SimpleRateLimiter хранит hit counts в `this.store = new Map()`. С 2 репликами реальный лимит = `max * 2`. Auth limiter (`max: 10`) становится 20 реальных попыток. Redis поддерживается в cacheService, но не подключён к rate limiter |
| ARCH-011 | MEDIUM | `cacheService.js:11` | CacheService in-memory Map. Redis условно загружается при `REDIS_URL` (строка 22), но в продакшене не подключён. 2 реплики имеют расходящиеся кеши |
| ARCH-012 | MEDIUM | `ukApiClient.js:15-17` | UK API auth token хранится per-process. N реплик = N независимых auth-сессий |
| ARCH-013 | LOW | `alertService.js:55-73` | 30-секундный polling loop при старте (`SELECT 1` x30 с интервалом 1с). Задерживает readiness |
| ARCH-014 | MEDIUM | `config/database.js` | Размер пула не сконфигурирован. При 10x нагрузке materialized view locks + analytics reads могут исчерпать дефолтные 10 соединений |

---

## ЭТАП 2: KISS

### 2.1 Функции > 50 строк / Глубокая вложенность

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| KISS-001 | **HIGH** | `ukIntegrationService.js:204-314` | `sendAlertToUK`: 111 строк, вложенность 5 (function → try → for → try → if/else). Inner `for (const building of buildings)` — ~80 строк. Idempotency state machine (244-271) внутри цикла аллокации. Извлечь `_createOrReuseMapping(alertId, buildingExternalId)` |
| KISS-002 | MEDIUM | `alertService.js:111-192` | `checkTransformerLoad`: 82 строки. Смешивает cooldown guard, data fetch, alert type resolution (140-149), dedup check, object construction (165-181), creation, cooldown update |
| KISS-003 | MEDIUM | `auth.js:44,140,223` | `authenticateJWT` — async function, но `jwt.verify` вызван с callback (строка 44). Outer try/catch не ловит ошибки из callback. Повторяется в `authenticateRefresh` (110-191) и `optionalAuth` (194-252). Решение: `util.promisify(jwt.verify)` |
| KISS-004 | MEDIUM | `adminBuildingController.js:38-52` | Ручное отслеживание индекса параметров SQL (`params.length + 1`) в каждом admin controller. Хрупко: добавление условия в неверном порядке ломает индексы |

### 2.2 Over-Abstraction

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| KISS-006 | MEDIUM | `controllers/admin/index.js` (84 строки) | Barrel file — чистый re-export из 9 sub-controller файлов. Ноль логики. Если `adminRoutes.js` require() каждый controller напрямую, barrel не нужен. ColdWaterSources и HeatSources (строки 67-78) даже не в barrel — inconsistent |
| KISS-007 | LOW | `analyticsService.js:35-68` | Двойная вложенность circuit breakers на одном DB пути: `transformerAnalyticsBreaker.execute()` внутри `materializedViewBreaker.execute()`. Оба защищают один PostgreSQL connection — double-tripping при одном failure |
| KISS-011 | LOW | `adminBuildingController.js:87-101` | 4 однострочных async wrapper-а (`createBuilding`, `getBuildingById`, `updateBuilding`, `deleteBuilding`) — просто проксируют к существующему controller. Ноль добавленной логики |

### 2.3 Unnecessary Complexity

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| KISS-008 | MEDIUM | `alertService.js:11` + `analyticsService.js:15` + `metricService.js:13` | Thresholds дублированы и **расходятся**: alertService `transformer_overload: 85`, analyticsService `transformer_overload: 80`. Разные числа для одного понятия. Admin обновляет thresholds через один endpoint — второй сервис не затрагивается |
| KISS-009 | LOW | `webhookRoutes.js:24` | `isEnabled()` — DB query на каждый входящий webhook перед HMAC. Если интеграция отключена → 503, что раскрывает конфигурацию системы неаутентифицированному вызывающему |
| KISS-010 | LOW | `webhookRoutes.js:86` | `isDuplicateEvent` pre-check в route — избыточен: сервис уже обрабатывает через UNIQUE constraint. Route-level check добавляет DB round-trip без гарантий корректности |
| KISS-005 | LOW | `ukIntegrationService.js:403,506` | `TERMINAL_STATUSES` и UUID regex определяются локально при каждом вызове метода вместо module-level констант |

---

## ЭТАП 3: DRY

### 3.1 Copy-Paste Code

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| DRY-001 | **HIGH** | `coldWaterSourceController.js` + `heatSourceController.js` | Два файла по 71 строке — структурно идентичны. Каждая функция (`getAll`, `getById`, `create`, `update`, `remove`) — один шаблон, отличается только noun сущности и текст ошибки |
| DRY-002 | **HIGH** | `ColdWaterSource.js` + `HeatSource.js` | 152 строки каждый. `findAll`, `findById`, `create`, `update`, `delete` — copy-paste. `delete` — byte-for-byte идентичен кроме имени таблицы |

### 3.2 Repeated Patterns

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| DRY-003 | **HIGH** | 7 admin controller files: `adminBuildingController.js:13-85`, `adminControllerController.js:13-85`, `adminTransformerController.js:11-90`, `adminLineController.js:11-95`, `adminWaterLineController.js:10-98`, `adminColdWaterSourceController.js:10-72`, `adminHeatSourceController.js:10-72` | `getOptimized*` — verbatim copy-paste: `whereConditions.push(... + (params.length + 1))`, `Promise.all`, pagination object. ~70 строк x 7 файлов = ~490 строк дубликата |
| DRY-004 | **HIGH** | `adminTransformerController.js:153-191`, `adminLineController.js:159-196`, `adminColdWaterSourceController.js:138-181`, `adminHeatSourceController.js:137-181`, `adminWaterLineController.js:199-215`, `Transformer.js:159-204`, `WaterLine.js:177-253`, `Line.js:153-224` | Dynamic `update*` SQL builder: `updateFields = []; if (field !== undefined) push(...)`. `WaterLine.update` — 76 строк, `Line.update` — 71 строка. `PowerTransformer.update` (143-165) использует `allowedFields` array — DRY-паттерн для остальных |
| DRY-005 | **HIGH** | `waterLineRoutes.js` (126 строк) + `waterSupplierRoutes.js` (105 строк) | Water routes встраивают inline handlers, вызывая модели напрямую; cold/heat routes используют controllers. 3 разных архитектуры для одинакового CRUD |
| DRY-007 | MEDIUM | `ColdWaterSource.js`, `HeatSource.js`, `Transformer.js`, `WaterLine.js`, `WaterSupplier.js`, `Line.js` | Two-query pagination boilerplate (COUNT + data) copy-paste в 6 моделях. Несогласованность ключей: `pages` в одних, `totalPages` в других |

### 3.3 Configuration Duplication

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| DRY-006 | MEDIUM | across controllers | 3 стиля response envelope: bare object (`coldWater*.js:9`), `{success, data, pagination}` (`transformerController.js:18`), bare model (`waterLineRoutes.js:13`). `apiResponse.js` существует но применяется частично |
| DRY-008 | MEDIUM | `Transformer.js` + `PowerTransformer.js` | Два отдельных model файла для "трансформатор" с дублированным CRUD boilerplate |
| DRY-009 | LOW | `config/env.js`, `CLAUDE.md`, `.env.example` | Имена env vars объявлены в нескольких местах без single source of truth |

---

## ЭТАП 4: YAGNI

### 4.1 Dead Code

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| YAGNI-001 | **HIGH** | `swagger_init_debug.js` (60 строк) | Заброшенный browser-скрипт в корне проекта (`window.onload`, `SwaggerUIBundle`). Ссылается на несуществующий путь. Zero imports. Артефакт ранней попытки swagger setup |
| YAGNI-002 | **HIGH** | `swagger_update.js` (49 строк) | Мёртвый one-shot скрипт — читает файл, конструирует JSON строки, только вызывает `console.log`. Никогда ничего не пишет. Не в `package.json` scripts |
| YAGNI-003 | **HIGH** | `alerts_endpoints.js` (42 строки) | Orphaned `module.exports` со Swagger path definition. Zero imports в проекте. Никогда не интегрирован в swagger spec |
| YAGNI-004 | **HIGH** | `queryValidation.js:242-267` | `buildSecureQuery` exported но zero call sites. Реализация сломана: `params.length` на объекте (не массиве) в строке 251 |
| YAGNI-005 | **HIGH** | `helpers.js:18-20` | `formatDateForDB` exported; единственная ссылка — unit test. Все модели используют `NOW()` в SQL |
| YAGNI-006 | **HIGH** | `helpers.js:37-63` | `calculateBuildingStatus` exported; no production caller в `src/`. Дублирует логику в `buildingMetricsService.js` |

### 4.2 Unused Features / Stubs

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| YAGNI-007 | **HIGH** | `adminGeneralController.js:4-17` | `globalSearch` на `GET /admin/search` — всегда возвращает `{results: [], total: 0, message: 'Search completed (stub)'}` |
| YAGNI-008 | **HIGH** | `adminGeneralController.js:39-47` | `exportData` на `POST /admin/export` — безусловно возвращает HTTP 501. Занимает route, документацию и rate limiting middleware для нулевой ценности |
| YAGNI-009 | MEDIUM | `adminBuildingController.js:103-114`, `adminControllerController.js:103-114`, `adminMetricController.js:96-107` | 3 batch operation stubs возвращают `(stub)` на живых routes. Transformers + lines реализованы полностью — inconsistent |
| YAGNI-010 | MEDIUM | `alertService.js:293-297` | `broadcastAlert` — WebSocket stub с TODO; no WebSocket инфраструктуры в проекте. Вызывается из alert pipeline, создавая ложное впечатление broadcast |
| YAGNI-011 | LOW | `src/index.js` (2 строки) | Однострочный re-export `./server`. `package.json` может указывать на `server.js` напрямую |
| YAGNI-012 | LOW | `queryValidation.js:269-277` | `allowedSortColumns`, `allowedOrderDirections`, `defaultSortParams` exported но never imported другими модулями — internal-only |

---

## ЭТАП 5: SOLID

### 5.1 Single Responsibility

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| SOLID-001 | LOW | `authService.js` (557 строк) | 5 ответственностей: persistence (raw SQL), crypto (bcrypt), JWT lifecycle (generate/verify/refresh/blacklist), account lockout, background cleanup interval. Нет User model |
| SOLID-002 | LOW | `alertService.js` (507 строк) | 4 ответственности: DB poll, state management, CRUD, notification dispatch. `sendNotifications` явно сигнализирует расширение ("email, SMS, Telegram") — потребует изменения alertService |
| SOLID-003 | LOW | `adminRoutes.js` (1,011 строк) | 8 entity domains в одном route файле; должен повторять per-entity структуру admin controllers |

### 5.2 Open/Closed

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| SOLID-005 | MEDIUM | `metricService.js:253` | `switch (timeFrame)` hardcoded (`'1h'`, `'24h'`, `'7d'`); новый time-frame требует редактирования функции. Map object решает проблему |
| SOLID-006 | MEDIUM | `adminTransformerController.js:225`, `adminLineController.js:230`, `adminWaterLineController.js:287` | `switch (action)` blocks для batch ops повторяется per entity; command-map pattern предпочтительнее |
| SOLID-007 | MEDIUM | `analyticsController.js:57` | Hardcoded threshold `80` в controller отличается от alertService `85` — одно понятие, два значения |

### 5.3 Dependency Inversion

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| SOLID-009 | INFO | All services | Сервисы напрямую `require()` конкретные модели. Нет interface/DI. Unit тесты используют `jest.mock`. Для vanilla JS контекста — приемлемое design decision |
| SOLID-010 | **HIGH** | `alertService.js:127,257` ↔ `ukIntegrationService.js:191,209,228,438,456` | Circular singleton dependency resolved через runtime `require()`. Сигнал отсутствующего event bus/DIP. Решение: event emitter (`alert.created` → ukIntegrationService подписывается) |
| SOLID-011 | INFO | `analyticsService.js:83,89` | `checkForAlerts` вызывает `require('./alertService')` внутри `setImmediate` — та же root cause что SOLID-010 |

### SRP Summary Table

| File | Lines | Distinct responsibilities | Verdict |
|------|-------|--------------------------|---------|
| `authService.js` | 557 | 5 (persistence, crypto, JWT, lockout, cleanup) | Too broad |
| `ukIntegrationService.js` | 531 | 3 (config, webhook verify/handling, API proxy) | Acceptable but large |
| `alertService.js` | 507 | 4 (DB poll, state, CRUD, notifications) | Too broad |
| `metricService.js` | 443 | 2 (CRUD+cache, anomaly detection) | Acceptable |
| `controllerService.js` | 401 | 2 (CRUD+cache, status sweep) | Acceptable |
| `analyticsService.js` | 384 | 2 (analytics+circuit breaker, forecasting) | Acceptable |
| `adminRoutes.js` | 1,011 | 1 (routing only, 8 domains) | Route bloat, not logic violation |

---

## ЭТАП 6: SECURITY

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| **SEC-001** | **CRITICAL** | `.env:3` + tracked docs examples | **Real `UK_WEBHOOK_SECRET` exposed in local workspace and duplicated in tracked docs examples** (64-char hex: `ca3b1db0...`). В текущем дереве `.env` игнорируется `.gitignore`, поэтому тезис "` .env` уже tracked" не подтверждён в рамках этой валидации. Необходимо: 1) ротация секрета, если он когда-либо был активен 2) удалить точное значение из tracked docs 3) при подтверждении попадания в историю — очистить git history |
| SEC-002 | MEDIUM | `Metric.js:94-118` | `findByControllerId` без LIMIT. `controllerService.js:264` передаёт 4-й аргумент `1`, но сигнатура модели `(controllerId, startDate, endDate)` — `1` попадает в `startDate` и молча игнорируется |
| SEC-003 | MEDIUM | `AlertType.js:12`, `AlertRule.js:8` | `findAll()` — `SELECT *` без LIMIT. Сейчас маленькие таблицы, но нет защиты при росте |
| SEC-005 | LOW | `urlValidation.js:37-40` | В `isDevelopment` mode localhost разрешён как hostname. Если `NODE_ENV=development` утечёт в staging — SSRF через `uk_api_url` = `http://localhost:3000/...` |
| SEC-006 | LOW | `totpService.js:16-21` | TOTP key derivation проверяет длину строки (>= 32), не энтропию. 32 повторяющихся символа пройдут валидацию |
| SEC-008 | INFO | `ukIntegrationService.js:109-121` | HMAC: `crypto.timingSafeEqual` + buffer length check + replay protection 300s — **корректно** |
| SEC-009 | INFO | `queryValidation.js` | SQL injection: strict allowlist для sort/order + parameterized queries ($1, $2...) повсюду — **надёжно** |
| SEC-007 | INFO | `auth.js:44,140,223` | JWT `verify` в callback внутри async — теоретический edge case при синхронном throw |
| SEC-004 | INFO | `alertService.js:287` | Emoji в logger.warn (`🚨`) — может вызвать проблемы encoding в некоторых log aggregators |

---

## ЭТАП 7: TESTING

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| TEST-001 | MEDIUM | `totpService.js` (198 строк) | **Zero dedicated unit tests** для новейшего security-critical кода (2FA TOTP). Только mock в `authControllerTest.test.js:12`. `generateSetup`, `confirmSetup`, `verifyCode`, `encrypt`, `decrypt`, `generateRecoveryCodes` — все непротестированы |
| TEST-002 | INFO | `AlertType.js` | **Validation note:** в текущем репозитории CRUD-тесты для `AlertType` присутствуют; исходная формулировка raw-аудита не подтверждена |
| TEST-003 | LOW | 4 `test.todo` в active test files | `adminMetricControllerTest.test.js:183` (`batchMetricsOperation`), `powerAnalyticsController.test.js:115,119,197` (`getLinesPower`, `getLinePower`, `getPhaseImbalanceAnalysis`) — документированные пробелы |
| TEST-004 | LOW | `xss-protection.test.js:52-70` | Baseline-count ratchet test: `innerHTMLMatches.length <= 16` для admin.js. Пропускает регрессии до baseline. Комментарий "цель: уменьшить до 10" |
| TEST-005 | INFO | Overall | ~1.46:1 test/code ratio по `tests/` к `src/`; no `.skip`/`.only` — **здоровый** показатель |
| TEST-006 | INFO | Integration tests | Mock БД через `jest.mock('../../../src/config/database')` — тестируют routing/controller, не SQL execution. Реальный SQL — только в E2E (Docker) |
| TEST-007 | INFO | `sql-injection.test.js` | Mocks DB, проверяет что bad `sort` params sanitized перед SQL. Не детектирует регрессии в SQL-building step напрямую. Приемлемо при whitelist подходе |

---

## ЭТАП 8: PERFORMANCE

### 8.1 Database

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| **PERF-001** | **HIGH** | `controllerService.js:254-307` | **N+1 query**: `Controller.findAll(1, 10000, ...)` → `for...of` → `Metric.findByControllerId` + `Controller.updateStatus` per controller. 100 controllers = 201 queries. Заменить на один SQL с lateral join / CTE |
| **PERF-002** | **HIGH** | `alertService.js:423-455` | **Sequential loop**: `for...of transformers` → `checkTransformerLoad()` per transformer. Каждый call может trigger materialized view query + db.query + cache. Нужна bounded concurrency / batch execution, а не безлимитный fan-out |
| PERF-003 | MEDIUM | `buildingMetricsService.js:89-106` | Full-table scan buildings + controllers + lateral subquery metrics на каждый запрос карты. Нет LIMIT, нет pagination, нет кеширования на уровне сервиса. С ростом с 17 до тысяч зданий — bottleneck |
| PERF-004 | MEDIUM | `PowerTransformer.js:211-218` | `getAllWithLoadAnalytics()` — `SELECT * FROM mv_transformer_load_realtime` без LIMIT. Кеш 2 мин смягчает, но большой парк трансформаторов → большой payload в память |

### 8.2 Memory / Network

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| PERF-006 | LOW | `rateLimiter.js` | In-memory Map; нет Redis для cross-process rate limiting (дублирует ARCH-010) |
| PERF-007 | LOW | `authService.js:26-34` | Token cleanup interval без backoff при DB failure; blacklist table может расти при длительном outage |
| PERF-008 | LOW | `cacheService.js:53-57` | Cleanup timer 60s; entries с TTL < 60s могут задержаться (mitigation: eager eviction при read) |

---

## ЭТАП 9: DOCUMENTATION & DX

### 9.1 Документация

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| DOC-001 | MEDIUM | `README.md:182` | Указано "175 тестов (16 suites)" — реально 677 тестов. Сильно устарело |
| DOC-002 | LOW | `README.md:174` | Port 8080 в таблице; реальный dev port 8088. Новый разработчик получит connection refused |
| DOC-003 | LOW | `README.md:126` | Migrations "003-010"; migration 011 (UK integration) отсутствует |
| DOC-004 | INFO | `CLAUDE.md` | Comprehensive и accurate — корректно описывает архитектуру, routes, UK integration, тесты. **Авторитетный справочник** |
| DOC-010 | INFO | `README.md:190-198` | Production secret generation commands (`openssl rand`) присутствуют. `.env.example` хорошо прокомментирован с `CHANGE_ME` placeholders. **Сильная сторона** |

### 9.2 API Documentation (Swagger)

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| DOC-005 | MEDIUM | `integrationRoutes.js`, `webhookRoutes.js` | **Zero Swagger annotations** для всей UK integration API. Config, logs, alert rules, request-counts, building-requests, webhooks — отсутствуют в Swagger UI |
| DOC-006 | LOW | `server.js:107` | Swagger генерируется из `./src/routes/*.js` only. JSDoc в controllers игнорируется |
| DOC-007 | LOW | `server.js:80` | Swagger UI отключён в production. Нет статического `swagger.json` в repo как fallback |
| DOC-008 | MEDIUM | `authRoutes.js:86` | Swagger документирует password `minLength: 6`; `authService.js:409` проверяет `< 8`. Расхождение |

### 9.3 Setup & DX

| ID | Sev | Location | Finding |
|----|-----|----------|---------|
| DOC-009 | LOW | `README.md:156-167` | Quick Start — 3 строки (clone, docker up). Нет инструкции `cp .env.example .env`. Без `.env` — JWT_SECRET validation fail |
| DOC-015 | LOW | `authController.js:59-67` | `toLocaleString()` без locale — server-dependent формат даты в error messages |
| DOC-016 | INFO | across 12 controllers | `apiResponse.js` utility — только 5 из 17 controllers используют consistently |
| DOC-017 | INFO | `package.json:6-19` | Scripts comprehensive: test/lint/dev/start. Отсутствуют: `migrate`, `db:seed`, `export:swagger`. `test:all` не включает e2e |

---

## Dead Code Inventory

| File/Function | Lines | Action |
|-------------|-------|--------|
| `swagger_init_debug.js` | 60 | Delete |
| `swagger_update.js` | 49 | Delete |
| `alerts_endpoints.js` | 42 | Delete |
| `helpers.js:formatDateForDB` | 3 | Remove export (test-only) |
| `helpers.js:calculateBuildingStatus` | 27 | Remove export (test-only) |
| `queryValidation.js:buildSecureQuery` | 26 | Delete (broken implementation) |
| `queryValidation.js:allowedSortColumns,etc.` | 9 | Un-export (internal only) |
| `adminGeneralController.js:globalSearch` | 14 | Delete stub + route |
| `adminGeneralController.js:exportData` | 9 | Delete stub + route |
| `alertService.js:broadcastAlert` | 5 | Delete WebSocket stub |
| `alertService.js:getCriticalAlertRecipients` | 6 | Delete (returns hardcoded array) |
| `metricService.js:cleanupOldMetrics` | 4 | Delete stub or implement |
| `src/index.js` | 2 | Remove; point package.json to server.js |
| **Total dead code** | **~256 строк** | |

---

## DRY Extraction Candidates

| Pattern | Occurrences | Files | Extract to |
|---------|-------------|-------|-----------|
| `getOptimized*` (admin pagination + filter + dual query) | 7 | 7 admin controllers | `src/utils/adminQueryBuilder.js` |
| Dynamic `update*` SQL builder | 8 | 5 admin controllers + 3 models | `src/utils/dynamicUpdateBuilder.js` |
| CRUD controller (getAll/getById/create/update/delete) | 4+ | coldWater/heat controllers + models | Generic `createCrudController(model, entityName)` factory |
| Two-query pagination boilerplate | 6 | 6 models | `src/utils/paginatedQuery.js` |
| Response envelope formatting | 17 | all controllers | Adopt `apiResponse.js` consistently |
| UUID regex validation | 3+ | ukIntegrationService, integrationRoutes | Module-level constant в `src/utils/constants.js` |

---

## YAGNI Removal Candidates

| Feature | Files | Lines | Needed? | Action |
|---------|-------|-------|---------|--------|
| swagger_init_debug.js | 1 | 60 | No | Delete |
| swagger_update.js | 1 | 49 | No | Delete |
| alerts_endpoints.js | 1 | 42 | No | Delete |
| buildSecureQuery | queryValidation.js | 26 | No (broken) | Delete |
| formatDateForDB | helpers.js | 3 | No (test-only) | Un-export |
| calculateBuildingStatus | helpers.js | 27 | No (duplicated) | Un-export |
| globalSearch stub | adminGeneralController.js + adminRoutes.js | ~20 | Not yet | Delete route + stub |
| exportData stub | adminGeneralController.js + adminRoutes.js | ~15 | Not yet | Delete route + stub |
| broadcastAlert | alertService.js | 5 | Not yet (no WS) | Delete |
| getCriticalAlertRecipients | alertService.js | 6 | No | Delete |
| cleanupOldMetrics | metricService.js | 4 | Not yet | Delete or implement |

---

## Architecture Recommendations

| # | Recommendation | Impact | Effort | Priority |
|---|---------------|--------|--------|----------|
| 1 | **Rotate exposed UK secret and scrub tracked docs/history if needed** | Security | Low | **P0** |
| 2 | Fix N+1 in `updateControllersStatusByActivity` with single SQL + CTE | Performance | Medium | P1 |
| 3 | Extract `adminQueryBuilder.js` — eliminate 7x copy-paste `getOptimized*` | Maintainability | Low | P1 |
| 4 | Create generic CRUD controller/model factories for water/heat entities | Maintainability | Medium | P1 |
| 5 | Break circular dep (alertService ↔ ukIntegration) with EventEmitter | Architecture | Medium | P2 |
| 6 | Add User model — extract raw SQL from authService | Architecture | Medium | P2 |
| 7 | Wire rate limiter to Redis for multi-replica deployments | Scalability | Medium | P2 |
| 8 | Add unit tests for `totpService.js` (2FA) | Testing | Low | P2 |
| 9 | Parallelize `checkAllTransformers` with bounded concurrency | Performance | Low | P2 |
| 10 | Unify threshold source of truth (alertService 85% vs analyticsService 80%) | Correctness | Low | P2 |
| 11 | Update README.md (test count 677, port 8088, migration 011) | Documentation | Low | P3 |
| 12 | Add Swagger annotations for integration/webhook routes | Documentation | Low | P3 |
| 13 | Delete 3 orphaned root-level scripts (~150 lines) | Cleanup | Trivial | P3 |
| 14 | Standardize response envelope — adopt `apiResponse.js` across all controllers | Consistency | Medium | P3 |
| 15 | Add pagination LIMIT to `buildingMetricsService` map query | Performance | Low | P3 |

---

## Positive Patterns

Что сделано хорошо — конкретные примеры:

1. **SQL injection protection** — strict allowlist в `queryValidation.js` + parameterized queries ($1, $2...) повсюду. Ноль string concatenation user input в SQL
2. **HMAC webhook verification** — `crypto.timingSafeEqual`, buffer length check, replay protection (300s tolerance) в `ukIntegrationService.js:109-121`
3. **Default-deny auth** — `src/routes/index.js` требует JWT на всех routes по умолчанию; public routes — explicit allowlist
4. **Test coverage ratio** — 1.42:1 test-to-code ratio с 677 тестами, 3,160 assertions. Нет skipped тестов
5. **TOCTOU-safe webhooks** — insert-first UNIQUE constraint guard для idempotent event processing
6. **Circuit breaker** на analytics queries с proper state machine (open/half-open/closed)
7. **DOMPurify** integration на frontend для XSS protection
8. **Graceful shutdown** в `server.js` — SIGTERM/SIGINT handlers закрывают HTTP server + DB pool
9. **Correlation ID** middleware для request tracing
10. **UK API client** с retry + exponential backoff + 401 re-auth logic
11. **Rate limiting** на auth endpoints с account lockout после 5 неудачных попыток
12. **Helmet** security headers из коробки
13. **CLAUDE.md** — comprehensive, accurate, актуальный. Авторитетный справочник проекта

---

## Code Health Score

| Criterion | Score /10 | Comment |
|-----------|----------|---------|
| Readability | 7 | Clean naming, consistent русские комментарии; крупные функции снижают |
| Maintainability | 5 | Heavy copy-paste (DRY), circular deps, нет generic CRUD patterns |
| Testability | 6 | Хорошее покрытие но нет DI; все тесты через jest.mock(); totpService untested |
| Simplicity | 6 | Core logic ясна; admin layer — over-duplicated; threshold divergence запутывает |
| Consistency | 5 | 3 response формата, 3 CRUD архитектуры для одинаковых entity types, pages vs totalPages |
| Security | 7 | Сильные паттерны (HMAC, allowlist SQL, default-deny); .env leak — critical но единичный |
| Performance | 6 | N+1 patterns и unbounded queries компенсируются хорошим caching и circuit breakers |
| Documentation | 5 | CLAUDE.md отличный; README устарел; Swagger неполный для UK integration |
| **OVERALL** | **5.9 /10** | **Solid security foundation + good test coverage; held back by DRY violations and scalability gaps** |
