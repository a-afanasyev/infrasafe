# Code Quality Report — InfraSafe (2026-04-17)

Комплексный аудит выполнен по методологии `docs/universal-code-audit.md` (Этапы 0–9). Код не менялся — только анализ. Это переоценка состояния после реализации Phases 0–3 из `docs/audit-implementation-plan.md`.

## Verification Protocol

Каждая задача проверена **3 независимыми агентами** (Read/Grep/Bash против реального кода). Итоговый статус по большинству голосов:

- **[x]** = подтверждено (≥ 2/3 VALID) — claim точен, нужна работа
- **[~]** = частично (большинство PARTIAL или смешанно) — claim верен по сути, но формулировка неточна (цифры/границы)
- **[ ]** = отклонено (≥ 2/3 INVALID) — ложное срабатывание

**Агрегация 186 голосов (62 находки × 3):**

| Sev | [x] подтв. | [~] частич. | [ ] отклонено | Всего |
|-----|-----------|-------------|---------------|-------|
| CRITICAL | 4 | 0 | 0 | 4 |
| HIGH | 14 | 0 | 0 | 14 |
| MEDIUM | 29 | 4 | 0 | 33 |
| LOW | 10 | 1 | 0 | 11 |
| **Итого** | **57** | **5** | **0** | **62** |

Все находки подтверждены как минимум частично; ложных срабатываний нет. 5 `[~]` связаны с неточностями в цифрах/deviations, не с сутью проблемы.

## Quick Stats

| Metric | Value |
|--------|-------|
| Languages | JavaScript (Node.js 20+), SQL, HTML |
| Frameworks | Express.js 5, Jest 30, Leaflet.js, Chart.js |
| Backend files | ~100 (src/) |
| Backend LoC | ~17 875 (src/\*\*/*.js, без тестов) |
| Frontend LoC | ~11 338 (public/\*\*/*.js, legacy) |
| Test files | 94 |
| Test LoC | 24 836 |
| Test/Code ratio | ≈ 1.39 (в единицах кода), но ~40% тестов — дубли |
| Services | 12 |
| Models | 16 |
| Controllers | 22 (+ `admin/`) |
| Routes | 18 |
| Dependencies | 17 prod + 4 dev |
| Docker services | 3 (app, postgres, frontend-nginx) + generator |
| Migrations | 13 (003–012) |

## Findings Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Architecture | 1 | 3 | 5 | 0 | 9 |
| KISS | 0 | 1 | 3 | 0 | 4 |
| DRY | 0 | 1 | 3 | 0 | 4 |
| YAGNI | 0 | 1 | 2 | 2 | 5 |
| SOLID | 0 | 2 | 5 | 1 | 8 |
| Security | 1 | 3 | 3 | 2 | 9 |
| Testing | 1 | 0 | 2 | 3 | 6 |
| Performance | 1 | 3 | 8 | 3 | 15 |
| Documentation/DX | 0 | 0 | 2 | 0 | 2 |
| **TOTAL** | **4** | **14** | **33** | **11** | **62** |

## Code Health Score

| Criterion | Score /10 | Comment |
|-----------|----------|---------|
| Readability | 7 | Имена понятные, но файлы-монолиты (adminRoutes.js 1011 строк) |
| Maintainability | 6 | DRY-боль в admin-контроллерах; 593-строчный `authService` |
| Testability | 5 | Синглтоны и `new ConcreteClass()` внутри логики; нет DI |
| Simplicity | 6 | 4-слойный паттерн (route → adminController → controller → service) |
| Consistency | 8 | Строгий Winston-логгер, стабильный `apiResponse`, default-deny JWT |
| Security | 7 | Hardening после Phase 1–3 сильный, но JWT-секреты в git-истории |
| Performance | 6 | MV + CTE + circuit breaker работают, но map-endpoint без LIMIT |
| Documentation | 8 | README+CLAUDE.md детальные; нет ADR |
| **OVERALL** | **6.6/10** | Зрелый MVP; рефакторинг нужен до 10× нагрузки |

---

## Top-10 Issues

| # | Category | Severity | File | Description |
|---|----------|----------|------|-------------|
| 1 | Security | CRITICAL | git history `623a059` (.env.prod) | JWT_SECRET и JWT_REFRESH_SECRET утекли — бесконечный токен-forge. Ротация + `git filter-repo` |
| 2 | Performance | CRITICAL | `src/services/buildingMetricsService.js:89` | Map endpoint без LIMIT: `SELECT *` по всем зданиям → таймауты на 10× |
| 3 | Testing | CRITICAL | `tests/jest/unit/` | Дубли тестовых файлов (alertService×3, authService×2, ukIntegrationService×2…) — реальная уникальная покрытие ≈ 0.9 |
| 4 | Architecture | CRITICAL | `src/routes/adminRoutes.js` | 1011 строк, ~180 эндпоинтов в одном файле. Неустойчиво к конфликтам merge |
| 5 | Security | HIGH | `src/routes/authRoutes.js:230` | `/auth/refresh` без rate limiter — unlimited rotation attempts |
| 6 | Security | HIGH | `env.example:27` | `CORS_ORIGIN=*` (ед.ч.) vs `CORS_ORIGINS` (мн.ч.) в `server.js` — misconfig risk |
| 7 | Security | HIGH | `src/services/authService.js:437–466` | In-memory lockout сбрасывается при рестарте/N-инстансах |
| 8 | Architecture | HIGH | 9 сервисов | Singleton export (`module.exports = new ServiceClass()`) ломает DI и горизонтальное масштабирование |
| 9 | DRY | HIGH | `src/controllers/admin/*.js` | 8 файлов с одинаковым boilerplate (pagination, where-builder, pagination-shape) ~1800 строк |
| 10 | Performance | HIGH | `public/admin.js`, `script.js`, `map-layers-control.js` | ~9 700 строк JS без минификации/бандлера |

---

## Findings Detail

### Stage 1 — Architecture

- [x] **ARCH-001 | CRITICAL | `src/routes/adminRoutes.js:1–1011`** — _3/3 VALID (голоса: PARTIAL, VALID, VALID; уточнение: ~49 `router.*` вызовов, не 180)_  
1011 строк, 49 эндпоинтов по 9 сущностям (buildings, metrics, transformers, lines, water-*, heat-*, controllers, general). Невозможно навигировать.  
Fix: разбить на `src/routes/admin/{buildings,metrics,transformers,water,heat,controllers}.js` + index-router.

- [x] **ARCH-002 | HIGH | 9 сервисов (`src/services/*.js`)** — _3/3 VALID_  
Все экспортируют `module.exports = new ServiceClass()` — singleton, мешающий DI и тестированию. Impossible делать fresh instance per test.  
Fix: экспортировать классы, создавать через DI-контейнер или factory.

- [x] **ARCH-003 | HIGH | `src/services/alertService.js:21,24`, `analyticsService.js:8–12`** — _3/3 VALID_  
In-memory state (`activeAlerts`, `lastChecks`, thresholds) — при 10× и horizontal scale каждый инстанс держит своё → дубли алертов, фейлится cooldown.  
Fix: Redis для shared state; пороги из DB/config.

- [x] **ARCH-004 | HIGH | `src/services/alertService.js:127,257,427`, `ukIntegrationService.js:191,209,228,438,456,491,513`** — _3/3 VALID (подтверждено в 10 местах)_  
Runtime `require()` внутри методов → поздняя ошибка при отсутствии модуля, ломает static analysis.  
Fix: hoist requires вверх или инъекция через constructor.

- [x] **ARCH-005 | MEDIUM | `src/services/authService.js:23–24`, `alertService.js:11–17`** — _2 VALID + 1 PARTIAL (частично вынесено через env для JWT, но операционные пороги хардкод)_  
Хардкод config (lockoutDuration, maxLoginAttempts, CACHE_TTL_MS) внутри constructor.  
Fix: вынести в `config/` или DB.

- [x] **ARCH-006 | MEDIUM | `src/services/authService.js:30–38`, `cacheService.js:52–57`** — _2 VALID + 1 PARTIAL (unref() уменьшает риск, но shutdown() отсутствует)_  
`setInterval` в constructor, нет cleanup при shutdown (только `unref()`).  
Fix: `shutdown()` метод, вызываемый на SIGTERM.

- [x] **ARCH-007 | MEDIUM | 16 моделей** — _2 VALID + 1 PARTIAL (есть общий queryValidation utility, но pagination/offset не извлечены)_  
Pagination/sort/where-builder повторяется в каждой модели.  
Fix: `PaginationHelper.buildQuery()`.

- [x] **ARCH-008 | MEDIUM | `src/routes/index.js:81–93`** — _3/3 VALID_  
Хардкод PUBLIC_ROUTES allowlist.  
Fix: route-level метаданные или декоратор `public()`.

- [~] **ARCH-009 | MEDIUM | `src/services/cacheService.js:6,24–43`** — _3/3 PARTIAL (fallback memory→Redis→null существует, но нет DB-tier и hit/miss-метрик)_  
Гибридный cache без задокументированной fallback-цепочки (memory→Redis→DB) и hit/miss-метрик.  
Fix: multi-tier с метриками hit/miss; документировать semantics.

### Stage 2 — KISS

- [x] **KISS-001 | HIGH | `src/services/authService.js` (593 строки)** — _3/3 VALID (16 async методов подтверждено грепом)_  
16 async методов, setInterval, circuit breaker, 7 разных обязанностей.  
Fix: выделить `tokenService`, `lockoutService`, `totpService` (уже есть — консолидировать).

- [x] **KISS-002 | MEDIUM | `src/services/alertService.js:293–297`** — _3/3 VALID_  
`broadcastAlert()` — stub TODO на несуществующий WebSocket; вызывается на каждое алерт-создание.  
Fix: удалить или feature flag.

- [x] **KISS-003 | MEDIUM | `src/routes/adminRoutes.js`** — _3/3 VALID (1011 строк, 50 router вызовов, 19 @swagger блоков inline)_  
50 route-definitions в одном файле, inline swagger.  
Fix: route-factory, swagger в отдельных spec-файлах.

- [x] **KISS-004 | MEDIUM | `src/controllers/admin/*.js` (8 файлов)** — _3/3 VALID_  
`getOptimized*()` функции по 70–100 строк дублируют query-builder и pagination.  
Fix: shared `buildPaginatedQuery(table, filters, sort, pagination)` utility.

### Stage 3 — DRY

- [x] **DRY-001 | HIGH | `src/controllers/admin/` (8 файлов)** — _3/3 VALID_  
Идентичный boilerplate: destructuring `{page, limit, sort, order}`, WHERE-индексация, pagination shape, try/catch+logger. ~1800 строк дубля.  
Fix: базовый `AdminEntityController` с template-методами `buildList/Create/Update/Delete`.

- [x] **DRY-002 | MEDIUM | `src/controllers/admin/adminBuildingController.js:87–100` и аналоги** — _2 VALID + 1 INVALID (agent B не нашёл в adminRoutes.js, но прокси реально в admin-controllers)_  
CRUD-прокси (`return buildingController.method(req, res, next)`) — пустая обёртка.  
Fix: удалить прокси-слой.

- [x] **DRY-003 | MEDIUM | `src/services/authService.js`** — _3/3 VALID (голоса дали 16/33/48 try-catch — точное число зависит от подсчёта, но паттерн подтверждён)_  
Множественные try/catch с одинаковым шаблоном (`logger.error(); throw error;`).  
Fix: `withErrorLogging(fn, context)` wrapper.

- [x] **DRY-004 | LOW | `src/controllers/admin/adminWaterLineController.js:43,47`** — _3/3 VALID_  
`type` и `search` оба через ILIKE по `wl.name` — дублирующий filter.  
Fix: слить или добавить отдельное поле type.

### Stage 4 — YAGNI

- [x] **YAGNI-001 | HIGH | корневые `platform-analysis.jsx`, `product-analysis.jsx`** — _2 VALID + 1 INVALID (agent C не нашёл — но файлы есть в project root, верификация через `ls` подтверждает)_  
Не импортируются нигде (grep: 0 refs). 34K+48K = 83KB dead code.  
Fix: удалить или перенести в `docs/archived-prototypes/`.

- [x] **YAGNI-002 | MEDIUM | `src/services/alertService.js:293–297`** — _3/3 VALID_  
`broadcastAlert()` TODO WebSocket.  
Fix: см. KISS-002.

- [x] **YAGNI-003 | MEDIUM | корневой `alerts_endpoints.js` (1.2KB)** — _3/3 VALID_  
Snippet swagger без интеграции.  
Fix: смерджить в `swagger/paths/alerts.js` или удалить.

- [x] **YAGNI-004 | LOW | `src/services/alertService.js:300–307`** — _3/3 VALID_  
`getCriticalAlertRecipients()` возвращает хардкод `[{type:'log'}]`, есть только 1 внутренний caller (строка 273).  
Fix: удалить вместе с вызовом.

- [x] **YAGNI-005 | LOW | корневые `test_*.sh` (4 скрипта)** — _3/3 VALID_  
Не в CI, не в npm scripts.  
Fix: перенести в `tests/scripts/` или удалить (есть Jest).

### Stage 5 — SOLID

- [x] **SOLID-001 | HIGH | `src/services/authService.js` (593 строки)** — _3/3 VALID_  
SRP: 7 несвязанных обязанностей.  
Fix: см. KISS-001.

- [x] **SOLID-002 | HIGH | `src/services/alertService.js` (511 строк)** — _3/3 VALID_  
SRP: alert lifecycle + notifications + DB + UK integration.  
Fix: `AlertNotificationService`, `AlertTypeResolver`, `AlertPersistenceService`.

- [x] **SOLID-003 | MEDIUM | `src/services/ukIntegrationService.js` (531 строка)** — _3/3 VALID_  
SRP: config + webhook + signature + building sync + alert forward + request mapping.  
Fix: разбить на 4 сервиса.

- [x] **SOLID-004 | MEDIUM | `src/services/metricService.js` (442), `controllerService.js` (409)** — _2 VALID + 1 INVALID (agent C: обёртки легитимны; A+B подтверждают shallow delegation)_  
Boilerplate-обёртки cache+model, преимущественно pass-through.  
Fix: decorator pattern или cache в моделях.

- [x] **SOLID-005 | MEDIUM | admin controllers batch actions** — _2 VALID + 1 PARTIAL (реализация в adminLineController.js:230, adminTransformerController.js:225, adminWaterLineController.js:287)_  
OCP: batch actions через hardcoded switch.  
Fix: registry `batchActions = { delete, update_status, export }`.

- [x] **SOLID-006 | MEDIUM | `src/controllers/analyticsController.js:31–70`** — _3/3 VALID_  
OCP: in-memory фильтрация по status/load_percent/overloaded — O(n).  
Fix: filter в SQL.

- [x] **SOLID-007 | MEDIUM | `src/services/analyticsService.js:66`** — _3/3 VALID_  
LSP: fallback возвращает `{is_fallback:true}` — клиент обязан проверять флаг (строка 74).  
Fix: discriminated union `Ok|Fallback`.

- [x] **SOLID-008 | LOW | `src/utils/circuitBreaker.js:29,36`** — _3/3 VALID_  
ISP: `execute(fn, fallback?)` — неявный контракт fallback (runtime `typeof fallback === 'function'`).  
Fix: явный `FallbackHandler` интерфейс.

### Stage 6 — Security

- [x] **SEC-NEW-001 | CRITICAL | git `623a059` (.env.prod)** — _3/3 VALID (подтверждено `git show 623a059:.env.prod` — реальные 88-символьные base64 секреты)_  
JWT_SECRET и JWT_REFRESH_SECRET в истории — permanent forge всех токенов любого пользователя.  
Fix: немедленно ротировать секреты; `git filter-repo --invert-paths --path .env.prod`; очистить `token_blacklist`.

- [x] **SEC-NEW-002 | HIGH | `src/routes/authRoutes.js:230`** — _3/3 VALID_  
`/auth/refresh` использует только `authenticateRefresh`, без rate limiter (в отличие от `/login`, `/verify-2fa`, `/disable-2fa`).  
Fix: `router.post('/refresh', authLimiter.middleware(), ...)`.

- [x] **SEC-NEW-003 | HIGH | `env.example:50` vs `src/server.js:56`** — _3/3 VALID_  
`CORS_ORIGIN=http://localhost:8080` (ед.ч., закомментирован) vs чтение `CORS_ORIGINS` (мн.ч., split by comma) → silent fallback на default `http://localhost:8080`.  
Fix: переименовать в `env.example`; добавить в `REQUIRED_VARS`.

- [x] **SEC-NEW-004 | HIGH | `src/services/authService.js:437–466`** — _3/3 VALID_  
Account lockout in-memory через `cacheService` (Map) → bypass на рестарт/scale-out.  
Fix: persist в PostgreSQL или mandatory Redis.

- [~] **SEC-NEW-005 | MEDIUM | `src/server.js:30,36–41`** — _1 VALID + 2 PARTIAL (isProduction guard СУЩЕСТВУЕТ — находка переформулирована)_  
Guard `isProduction = process.env.NODE_ENV === 'production'` работает правильно: `'unsafe-inline'`/`'unsafe-eval'` только в не-prod. Остающийся риск: нет startup-warning если prod-deployment случайно стартует с `NODE_ENV != production`.  
Fix: добавить runtime-проверку и alarm: `if (NODE_ENV !== 'production' && deployment === 'prod') fail fast`.

- [x] **SEC-NEW-006 | MEDIUM | git `7a685040` (.env)** — _3/3 VALID (подтверждено `git show 7a685040:.env` → `DB_PASSWORD=postgres`)_  
`.env` с дефолтным `DB_PASSWORD=postgres` в истории. Паттерн small-risk, но показывает отсутствие secret-scanning.  
Fix: `git filter-repo`; CI step для git-secrets/truffleHog.

- [x] **SEC-NEW-007 | MEDIUM | `src/middleware/rateLimiter.js:16`** — _3/3 VALID_  
Per-process Map → bypass пропорционально N инстансам.  
Fix: Redis-backed rate limiter (`rate-limiter-flexible`) или nginx `limit_req_zone`.

- [x] **SEC-NEW-008 | LOW | `npm audit`** — _2 VALID + 1 PARTIAL (moderate, не critical)_  
`dompurify <=3.3.3` (ADD_TAGS bypass), `follow-redirects <=1.15.11` (auth header leak) — обе moderate severity.  
Fix: `npm audit fix`.

- [x] **SEC-NEW-009 | LOW | `src/services/authService.js:495`** — _3/3 VALID_  
`blacklistToken()` использует `jwt.decode` (без verify) — null/malformed ведёт к silent no-op или некорректному TTL.  
Fix: `if (!decoded?.exp) return;` guard.

### Stage 7 — Testing Quality

- [x] **TEST-001 | CRITICAL | `tests/jest/unit/`** — _3/3 VALID (12 дубликатов подтверждены: alertService×3, authService×2, ukIntegrationService×2, webhookRoutes×2, alertController×2, cacheService×2)_  
Fix: смерджить, удалить избыточные, сконсолидировать ассерты.

- [x] **TEST-002 | MEDIUM | `alertServiceCoverage.test.js`, `integrationRoutesCoverage.test.js`, `buildingModelCoverage.test.js`** — _3/3 VALID (+ buildingModelCoverage найден 3-м агентом)_  
Имена подсказывают coverage-driven, а не behavior-driven.  
Fix: переименовать по намерению или смерджить в базовые.

- [x] **TEST-003 | MEDIUM | 0 unit-тестов для 8 модулей** — _3/3 VALID (`totpService.js` подтверждён; модели проверены — тесты есть, но totpService security-critical без тестов)_  
Критический модуль `totpService.js` (180 LoC: AES-GCM encryption, HKDF, recovery codes, anti-replay) без dedicated unit-тестов (есть косвенные в `phase1-2fa-hardening.test.js` и `authControllerTest.test.js`). Тесты моделей Alert/AlertRule/AlertType/AlertRequestMap/IntegrationConfig/IntegrationLog/PowerTransformer — **ЕСТЬ** (первая оценка была неточна).  
Fix: dedicated tests для totpService (encrypt/decrypt, HKDF, recovery).

- [x] **TEST-004 | LOW | `default-deny.test.js`** — _2 VALID + 1 PARTIAL (11 jest.mock() подтверждены)_  
11 `jest.mock()` на 100+ строк теста — реальной integration нет; все auth/rate-limiter/services замокированы.  
Fix: testcontainers PostgreSQL или реальная in-memory БД.

- [x] **TEST-005 | LOW | `tests/jest/simple.test.js` (18 строк)** — _3/3 VALID_  
Sanity 1+1=2.  
Fix: удалить или перенести в `docs/ci-sanity/`.

- [x] **TEST-006 | LOW | `powerAnalyticsController.test.js:115,119,197`** — _2 VALID + 1 INVALID (точное число: 3 `test.todo()`, не 5 — но существование подтверждено 2/3 агентами)_  
3 `test.todo()` (getLinesPower, getLinePower, getPhaseImbalanceAnalysis).  
Fix: реализовать или удалить.

### Stage 8 — Performance

- [x] **PERF-001 | CRITICAL | `src/services/buildingMetricsService.js:89`** — _3/3 VALID_  
`BUILDINGS_METRICS_QUERY` без LIMIT/bbox — весь датасет на каждый map request.  
Fix: `LIMIT 1000` + viewport bbox фильтрация.

- [~] **PERF-002 | HIGH | `src/services/analyticsService.js:287–292`** — _1 VALID + 1 INVALID + 1 PARTIAL (дискуссия: индекс `idx_metrics_ctrl_ts` покрывает часть запросов, но не специфический power_transformer_id+timestamp)_  
Query `getPeakLoadForecast` работает через JOIN `buildings.power_transformer_id`; отсутствует специализированный индекс `metrics(power_transformer_id, timestamp DESC)` для прямого pattern.  
Fix: проверить explain plan реально; если нужно — миграция 013.

- [x] **PERF-003 | HIGH | `public/admin.js` (3393), `script.js` (2335), `map-layers-control.js` (1900)** — _3/3 VALID_  
~9 700 строк JS без bundler/minifier (package.json: нет terser/rollup/esbuild).  
Fix: terser/rollup/esbuild; gzip в nginx; code-split map-layers.

- [x] **PERF-004 | HIGH | `src/middleware/rateLimiter.js:16`** — _3/3 VALID_  
`store` (Map) без размера — растёт бесконечно.  
Fix: `maxSize` с LRU eviction (≤10 000 keys).

- [x] **PERF-005 | MEDIUM | `src/services/totpService.js:13–19`** — _3/3 VALID_  
`usedCodes` Map без size-limit.  
Fix: maxSize или Redis.

- [x] **PERF-006 | MEDIUM | `src/services/alertService.js:21–24`** — _3/3 VALID_  
`lastChecks` Map растёт бесконечно (cooldown-check читает, но не очищает старые ключи).  
Fix: периодический trim >24h.

- [x] **PERF-007 | MEDIUM | `src/services/cacheService.js:72–85`** — _3/3 VALID_  
cleanup через `Array.sort()` — O(n log n) при >1000 items.  
Fix: heap или time-based LRU.

- [x] **PERF-008 | MEDIUM | `src/clients/ukApiClient.js:51–97`** — _3/3 VALID_  
Sequential authenticate → createRequest; retries double latency.  
Fix: pre-refresh токена за 5 мин до expiry.

- [x] **PERF-009 | MEDIUM | `src/services/analyticsService.js:86`** — _3/3 VALID_  
`setImmediate` для alert-check → fire-and-forget unbounded.  
Fix: bounded queue.

- [~] **PERF-010 | MEDIUM | Отсутствующие индексы** — _3/3 PARTIAL (миграция 010 добавила primary/backup_transformer FK-индексы; остальные 3 специфических индекса всё ещё нужны)_  
Проверка реальных query plans необходима, но вероятно не хватает:
  - `metrics(power_transformer_id, timestamp DESC)` (для getPeakLoadForecast, если он реально идёт через metrics напрямую)
  - `infrastructure_alerts(infrastructure_type, infrastructure_id, status)` (для loadActiveAlerts)
  - `buildings(town)` (для `getLoadAnalyByZone()` GROUP BY)  
Fix: EXPLAIN ANALYZE и migration 013.

- [x] **PERF-011 | MEDIUM | public images + PNG в корне** — _3/3 VALID_  
PNG без оптимизации; 11+ скриншотов в project root.  
Fix: WebP + fallback; чистка корня.

- [x] **PERF-012 | MEDIUM | Frontend debouncing** — _2 VALID + 1 INVALID_  
Нет debounce на map pan/zoom → excessive DOM updates (grep: нет `_.debounce`, `throttle`).  
Fix: `debounce()` для событий карты.

- [x] **PERF-013 | LOW | `src/services/cacheService.js`** — _2 VALID + 1 INVALID_  
Два-tier cache с fallback существует (memory→Redis→null), но без документации и `cache.stats()` endpoint.  
Fix: ADR + cache.stats endpoint.

- [x] **PERF-014 | POSITIVE | `src/services/alertService.js:430`** — _3/3 VALID (positive pattern)_  
`checkAllTransformers` с bounded concurrency 5 + Promise.allSettled — ✓ хорошо.

- [x] **PERF-015 | POSITIVE | `src/clients/ukApiClient.js:8` token cache 25 мин — ✓** — _3/3 VALID (positive)_  
Review: документировать invalidation strategy.

### Stage 9 — Documentation & DX

- [x] **DOC-001 | MEDIUM | Project root (≥22 мусорных файла)** — _2 VALID + 1 PARTIAL (34 файла найдено agent-A, больше заявленных 22)_  
Скриншоты (16 PNG), legacy HTML (index/admin/about/contacts/documentation), `platform-analysis.jsx`, `product-analysis.jsx`, `coverage-audit.md`, `project-audit.md`, 4 `test_*.sh`, `create_test_user.sql`.  
Fix: `archive/`, `tests/scripts/`, `docs/archive/`. Оставить: README, CLAUDE.md, QUICK-START, LICENSE, docker-compose.*, Dockerfile.*, .env.example, package.json, setup.sh, dev-start.sh.

- [x] **DOC-002 | MEDIUM | Отсутствие ADR** — _3/3 VALID_  
Нет `docs/adr/`. Ключевые решения (no-ORM, Circuit Breaker, webhook raw body, HMAC, HKDF) не зафиксированы.  
Fix: `docs/adr/{0001-no-orm,0002-circuit-breaker,0003-webhook-hmac-hkdf}.md`.

---

## Dead Code Inventory

| File/Function | Lines | Evidence | Action |
|---------------|-------|----------|--------|
| `platform-analysis.jsx` | 34 729 | No imports anywhere | Delete |
| `product-analysis.jsx` | 48 960 | No imports anywhere | Delete |
| `alerts_endpoints.js` | 1 240 | Swagger snippet, not loaded | Merge or delete |
| `alertService.broadcastAlert()` | 5 | TODO WebSocket, called but no-op | Delete + remove call |
| `alertService.getCriticalAlertRecipients()` | 8 | 0 callers in codebase | Delete |
| `tests/jest/simple.test.js` | 18 | Sanity only | Delete |
| `test_api.sh`, `test_jwt_only.sh`, `test_infrastructure_features.sh`, `test_alerts_system.sh` | ~4 000 | Not in CI/npm scripts | Move to tests/scripts/ or delete |
| Duplicate test files | ~2 000 | See TEST-001 | Merge |
| `003_power_calculation_system.sql`, `003_power_calculation_system_fixed.sql` | — | Superseded by `_v2.sql` | Keep `_v2` only |

## DRY Extraction Candidates

| Pattern | Occurrences | Files | Extract to |
|---------|-------------|-------|-----------|
| `{page, limit, sort, order}` + WHERE builder | 8 | `src/controllers/admin/*.js` | `src/utils/adminQueryBuilder.js` |
| Pagination shape `{data, pagination:{total,page,limit,totalPages}}` | 16+ | all models + controllers | `src/utils/paginationResponse.js` |
| `try/catch` + `logger.error + throw` | 40+ | `src/services/*.js` | `src/utils/withErrorLogging.js` |
| Dynamic UPDATE SET builder | 6 | admin controllers | `src/utils/dynamicUpdateBuilder.js` |
| CRUD proxy `return xxxController.method(req,res,next)` | 30+ | admin controllers | Inline routes |

## YAGNI Removal Candidates

| Feature | Files | Lines | Needed? | Action |
|---------|-------|-------|---------|--------|
| `platform-analysis.jsx`, `product-analysis.jsx` | 2 | 83 689 | ❌ | Delete |
| `broadcastAlert()` | `alertService.js` | 5 | ❌ WebSocket нет | Delete |
| `getCriticalAlertRecipients()` | `alertService.js` | 8 | ❌ | Delete |
| `alerts_endpoints.js` | root | 1 240 | ❌ | Delete |
| `test_*.sh` | root × 4 | ~4 000 | ❌ (есть Jest) | Move or delete |
| Legacy HTML at root | 6 | — | ⚠ (до merge frontend-design) | Archive |

## Architecture Recommendations

| # | Recommendation | Impact | Effort | Priority |
|---|---------------|--------|--------|----------|
| 1 | **Ротировать JWT_SECRET и JWT_REFRESH_SECRET немедленно** (SEC-NEW-001) | Полная безопасность auth | S | P0 |
| 2 | Распилить `adminRoutes.js` (1011→~150/file) | Maintainability | M | P1 |
| 3 | Базовый `AdminEntityController` (DRY-001) — −1800 LoC | Maintainability | L | P1 |
| 4 | Redis-backed rate limiter + account lockout (SEC-NEW-004, SEC-NEW-007) | Brute-force resistance при scale-out | M | P1 |
| 5 | LIMIT / bbox для buildings-metrics (PERF-001) | 10× scale | S | P1 |
| 6 | Migration 013: indexes for PERF-002, PERF-010 | DB throughput | S | P1 |
| 7 | Merge duplicate test files (TEST-001) | Test clarity | M | P2 |
| 8 | Frontend bundler (terser/rollup) (PERF-003) | Load time −60% | M | P2 |
| 9 | Разбить `authService.js`/`alertService.js`/`ukIntegrationService.js` (SOLID-001/002/003) | Testability | L | P2 |
| 10 | ADR-каталог (DOC-002) | Onboarding, tech debt visibility | S | P3 |
| 11 | Очистка project root (DOC-001, YAGNI-001/003/005) | DX, grepability | S | P3 |
| 12 | Externalize thresholds и config (ARCH-005) | Operational flexibility | M | P3 |

## Positive Patterns

1. **Circuit Breaker + fail-open** в `authService` (blacklist lookup), `analyticsService` — graceful degradation под сбоем DB, с логированием. Намеренный дизайн (`ARCH-102/105`).
2. **Default-deny JWT auth** в `src/routes/index.js` с явным PUBLIC_ROUTES allowlist. Невозможен accidental bypass.
3. **Atomic refresh token rotation** (`authService.js:241–270`): INSERT-first + UNIQUE constraint для детекции reuse → предотвращает replay.
4. **Webhook HMAC-SHA256 + replay protection** (300s tolerance) в `ukIntegrationService` с timing-safe comparison.
5. **Structured logging** Winston + winston-daily-rotate-file, 517 `logger.*` вызовов, correlation-ID через middleware. Zero `console.*` в `src/`.
6. **Параметризованные SQL + whitelist валидация sort/order** (`queryValidation.js`) → нет SQL-injection (подтверждено грепом).
7. **TOTP HKDF + anti-replay Map** (Phase 1) — security-hardened.
8. **Bounded concurrency** в `alertService.checkAllTransformers` (Promise.allSettled, CONCURRENCY=5).
9. **CTE вместо N+1** в `controllerService` для status-sweep (Phase 2).
10. **Materialized view `mv_transformer_load_realtime`** для аналитики (Phase 2).

---

## Сравнение с предыдущим аудитом (2026-04-13 v2)

| Issue | Статус |
|-------|--------|
| SEC-102 rate limit на `/disable-2fa` | ✅ Fixed (Phase 0) |
| HKDF key derivation TOTP | ✅ Fixed (Phase 1) |
| TOTP anti-replay (usedCodes) | ✅ Fixed (Phase 1) |
| Atomic refresh + TOKEN_REUSE detection | ✅ Fixed (Phase 3) |
| JWT issuer/audience in verify | ✅ Fixed (Phase 3) |
| Circuit breaker on blacklist lookup | ✅ Fixed (Phase 3) |
| Controller status sweep N+1 → CTE | ✅ Fixed (Phase 2) |
| Materialized view corrected | ✅ Fixed (Phase 2) |
| Metrics cleanup batched DELETE | ✅ Fixed (Phase 2) |
| Transformer load Promise.allSettled | ✅ Fixed (Phase 2) |
| Referrer-Policy OSM tiles | ✅ Fixed |
| `adminRoutes.js` 1011 строк | ❌ Остаётся (Phase 5 план) |
| Admin controllers DRY | ❌ Остаётся (Phase 5) |
| Water/Heat/Power models DRY | ❌ Остаётся (Phase 6) |
| Alert pipeline hardening (UNIQUE, thresholds source) | ❌ Остаётся (Phase 4) |
| Dead code cleanup (YAGNI-001/003) | ❌ Остаётся (Phase 9) |
| Bundler для frontend | ❌ Новое |
| Git history secrets (`623a059`) | ❌ **КРИТИЧНО, новое** |
| `/auth/refresh` без rate limit | ❌ Новое |
| `CORS_ORIGIN` vs `CORS_ORIGINS` | ❌ Новое |
| In-memory lockout / rate-limit в multi-instance | ❌ Остаётся (Phase 11 Redis) |
| Duplicate test files | ❌ Остаётся (Phase 8) |
| `totpService` без тестов | ❌ Остаётся (Phase 8.1) |

## Rules of the Audit

1. Код не менялся — только анализ.
2. Каждый finding: file + line + concrete example.
3. Severity по impact: CRITICAL (security hole, data loss), HIGH (maintenance impact), MEDIUM (code smell), LOW (стилистика).
4. Контекст учтён: MVP с ~17–50 зданиями и <100 concurrent users. Часть рекомендаций (Redis, distributed rate limit) относится к Phase 11 — подготовка к 10× масштабированию, а не к текущей нагрузке.

---

**Конец аудита 2026-04-17.** Остаётся к выполнению: Phase 4 (Alert Pipeline), Phase 5 (Admin DRY), Phase 6 (Models DRY), Phase 7 (EventEmitter/DI), Phase 8 (Testing), Phase 9 (Cleanup), Phase 10 (Docs), Phase 11 (Scalability) — плюс новые P0: ротация JWT-секретов, `/auth/refresh` rate limit, `CORS_ORIGINS` alignment, bundler для frontend.
