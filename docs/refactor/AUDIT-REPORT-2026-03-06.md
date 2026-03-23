# InfraSafe — Комплексный аудит проекта

**Дата:** 2026-03-06
**Анализ:** 4 агента (архитектура, безопасность, фронтенд, тесты+БД)

---

## Вердикт: ИНКРЕМЕНТАЛЬНАЯ ДОРАБОТКА, НЕ ПОЛНЫЙ РЕФАКТОРИНГ

Базовая архитектура корректна (MVC + Service Layer), инфраструктура зрелая (Docker, PostGIS, Circuit Breaker). Проблемы — архитектурная неконсистентность и технический долг, не фундаментальные дефекты. Переписка нецелесообразна.

---

## Риск-модель

| Приоритет | Scope | Срок | Суть |
|-----------|-------|------|------|
| **P0** | Безопасность | 1-2 дня | Эксплуатируемые уязвимости, блокеры production |
| **P1** | Гигиена кода | 2-4 дня | Мёртвый код, рассинхрон модель/схема, missing indexes |
| **P2** | Архитектурный долг | 5-10 дней | Унификация паттернов, response contract, фронтенд-декомпозиция |
| **P3** | Стабилизация | 3-5 дней | Тестовая инфра, покрытие, DevOps-консолидация |

**Итого: 11-21 день инкрементальной работы** (vs 2-4 месяца полного рефакторинга).

---

## P0 — Немедленно (1-2 дня)

### P0-1. Privilege Escalation: произвольная роль при регистрации
- **Файл:** `src/controllers/authController.js:54`
- **Вектор:** `POST /api/auth/register` с `{"role":"admin"}` = аккаунт администратора
- **Fix:** Игнорировать `role` из body, hardcode `'user'`. Admin-создание — через защищённый `POST /api/admin/users`

### P0-2. Refresh token использует тот же секрет, что и access token
- **Файл:** `src/services/authService.js:130,136,201`
- **Вектор:** `JWT_REFRESH_SECRET` из env не используется. Оба токена подписаны `JWT_SECRET` → access token предъявляется как refresh
- **Fix:** `jwt.sign(payload, this.jwtRefreshSecret)` для refresh. При обновлении — старый refresh в blacklist (rotation)

### P0-3. Rate limiting отсутствует на auth-маршрутах
- **Файл:** `src/routes/authRoutes.js:61,121`
- **Вектор:** Brute-force login без ограничений. Account lockout (5 попыток) — in-memory, сбрасывается при рестарте. `adminLimiter = 100 req/min` (комментарий: "увеличено для тестирования")
- **Fix:** loginLimiter: 10 req/15min на `/auth/login`, 5 req/hour на `/auth/register`. adminLimiter → 10-20 req/min

### P0-4. CORS = wildcard
- **Файл:** `src/server.js:40`
- **Вектор:** `app.use(cors())` → `Access-Control-Allow-Origin: *`. `CORS_ORIGIN` из `.env.prod` есть, но не читается
- **Fix:** `cors({ origin: process.env.CORS_ORIGIN?.split(',') || 'http://localhost:3000' })`

### P0-5. Swagger UI открыт в production
- **Файл:** `src/server.js:83`
- **Вектор:** `SWAGGER_ENABLED=false` из `.env.prod` не проверяется. `/api-docs` раскрывает полную API-схему
- **Fix:** `if (NODE_ENV !== 'production') { app.use('/api-docs', ...) }`

### P0-6. Body size не ограничен
- **Файл:** `src/server.js:41`
- **Вектор:** DoS через огромный JSON payload
- **Fix:** `express.json({ limit: '1mb' })`

### P0-7. SQL Injection: INTERVAL интерполяция
- **Файл:** `src/services/alertService.js:437`
- **Вектор:** `INTERVAL '${days} days'` — прямая подстановка из query param. `parseInt` в контроллере частично защищает, но нарушает принцип параметризации
- **Fix:** `WHERE created_at >= NOW() - INTERVAL '1 day' * $1` + `[parseInt(days)]`

### P0 — Отложенные решения (осознанно не в P0)

| Проблема | Почему не P0 |
|----------|-------------|
| GET-эндпоинты без JWT (index.js:89-95) | Дизайн-решение: публичные GET — для карты и мониторинга. Требует product-ревью, не hotfix |
| CSP unsafe-inline (server.js:26) | Нейтрализует CSP, но требует nonce-инфраструктуры — объём > hotfix |
| JWT в localStorage (admin-auth.js) | Стандартная SPA-практика. Риск только при XSS, который закрыт DOMPurify |
| .env.prod с секретами | Файл в `.gitignore`. Проверить `git log` → если в истории, тогда P0 |

---

## P1 — Следом (2-4 дня)

### P1-1. Удалить артефакты iCloud и мёртвый код
- 30+ файлов `* 2.*` в src/, public/, database/, tests/ — артефакты iCloud Drive
- `*.bak*` файлы в src/routes/
- `src/config/app.js` — альтернативный Express app, нигде не импортируется (entry: index.js → server.js)
- **Действие:** `find . -name "* 2.*" -not -path "*/node_modules/*" -delete` + удалить bak + удалить app.js

### P1-2. WaterLine модель vs схема БД
- **Файл:** `src/models/WaterLine.js`
- **Суть:** Модель ссылается на `pressure_rating`, `line_type`, `maintenance_contact`, `notes`, `supplier_id` — полей нет в БД. Init SQL v2.3: "Исправлена структура: `pressure_bar` вместо `pressure_rating`, удалены `line_type`, `maintenance_contact`, `notes`"
- **Fix:** Привести модель к реальной схеме. Рантайм-ошибки при любом UPDATE на water_lines

### P1-3. Индекс metrics(controller_id, timestamp DESC)
- **Суть:** Основной запрос "последняя метрика контроллера X" не покрыт составным индексом → sequential scan
- **Fix:** `CREATE INDEX CONCURRENTLY idx_metrics_ctrl_ts ON metrics(controller_id, timestamp DESC);`

### P1-4. Удалить debug-логи из production-кода
- `admin.js:1` — `console.log('НОВАЯ ВЕРСИЯ ФАЙЛА ЗАГРУЖЕНА - v=1749768508')`
- `admin.js` — 106 вызовов `console.log/error/warn`
- `analytics.js` — 30 вызовов с emoji-маркерами (`'📞 Вызываем loadBuildings()...'`)
- **Fix:** grep + удалить. Оставить только `console.error` для реальных ошибок

### P1-5. Дублирующий Console transport в logger
- **Файл:** `src/utils/logger.js:17-46`
- **Суть:** Console transport в `createLogger` + второй в non-production → двойной вывод
- **Fix:** Убрать дублирующий

### P1-6. Дублирующее поле hot_water в buildings
- **Суть:** `hot_water boolean` и `has_hot_water boolean DEFAULT false` — одно лишнее
- **Fix:** Миграция: `UPDATE buildings SET has_hot_water = hot_water WHERE hot_water IS NOT NULL; ALTER TABLE DROP COLUMN hot_water;`

### P1-7. Mock-данные в production analytics
- **Файл:** `public/analytics/js/analytics.js:162-194`
- **Суть:** При ошибке API автоматически генерируются фиктивные данные. Пользователь видит графики без предупреждения
- **Fix:** Показывать состояние ошибки, не фейковые данные

---

## P2 — Плановый долг (5-10 дней)

### P2-1. Унификация data-access паттернов

Сейчас три паттерна в одном проекте:

| Паттерн | Маршруты | Проблема |
|---------|----------|----------|
| Route → Controller → Service → Model → DB | buildings, controllers, metrics | Эталон |
| Route → Model → DB | waterLines, waterSuppliers, transformers, lines | Нет бизнес-логики |
| Route → DB.query() | waterSourceRoutes, heatSourceRoutes | SQL в route handler |

**Действия:**
1. Создать модели `ColdWaterSource.js`, `HeatSource.js` — вынести SQL из route handlers
2. Извлечь `BaseModel` с `buildDynamicInsert()`, `buildDynamicUpdate()`, `findAll()`, `findById()`, `delete()` — устранить дублирование в Line.js (347), WaterLine.js (404), Transformer.js (272), WaterSupplier.js (255)
3. Добавить `express-validator` middleware на все POST/PUT без валидации (waterSource, heatSource, waterLine, waterSupplier routes — сейчас 0 валидации)

### P2-2. Единый response contract

Сейчас:
- Buildings: `{ data: [...], pagination: { totalPages } }`
- Alerts: `{ success: true, data: [...], count: N }`
- WaterSources: `{ data: [...], pagination: { pages } }` (без success)
- Ошибки: `{ error: "..." }` vs `{ success: false, message: "..." }`

**Fix:** Middleware-обёртка `{ success: boolean, data: any, pagination?: { page, limit, total, totalPages }, error?: string }`

### P2-3. Фронтенд-декомпозиция и единый HTTP-клиент

**Монолиты:**
| Файл | Строк | Содержимое |
|------|-------|-----------|
| `public/admin.js` | 3246 | CRUD 8 сущностей, пагинация, фильтры, модальные окна |
| `public/script.js` | 2377 | Карта, маркеры, APIClient, IndustrialPushPanel, ToastManager |
| `css/style.css` | 2267 | Все стили |

**4 несогласованных подхода к fetch:**
1. `APIClient` (script.js) — с rate limiter, JWT, CSRF
2. Monkey-patch `window.fetch` (admin-auth.js)
3. Прямой fetch + ручной header (admin.js:3144)
4. Прямой fetch + localStorage (map-layers-control.js)

**12+ глобальных переменных** в `window.*` с неявными зависимостями.

**Действия:**
1. Установить Vite/esbuild, настроить entry points
2. Единый `HttpClient` модуль (заменить 4 подхода)
3. Разбить script.js → map.js, api.js, layers.js, theme.js, toast.js
4. Разбить admin.js → crud.js, pagination.js, filters.js, modals.js
5. CSS из JS (script.js:1086-1353) → в .css файл
6. Экранирование в `powerUtils.js` (HTML-интерполяция данных API без escapeHTML)
7. Удалить или реализовать нефункциональные фильтры (script.js:900-1050 — `applyFilters()` не определён)

### P2-4. Консолидация дублирующих систем в БД

**Двойные алерты:**
- `alerts` (legacy, связана с `alert_types`, `metrics`) — используется `Alert.js`
- `infrastructure_alerts` (новая, `severity`, `data jsonb`, `acknowledged_by`) — используется `alertService.js`
- **Fix:** Мигрировать на `infrastructure_alerts`, удалить legacy

**Двойные трансформаторы:**
- `power_transformers` (varchar ID, legacy) — используется `PowerTransformer.js`, `mv_transformer_load_realtime`
- `transformers` (serial ID, новая) — используется `Transformer.js`, `lines` FK
- **Fix:** Определить source of truth, миграция, обновить MV

**Тройное хранение координат линий:**
- `latitude_start/end, longitude_start/end` + `main_path JSONB` + `geom GEOMETRY`
- Триггеры конвертируют, но 3 представления — избыточность
- **Fix:** Оставить `main_path` + `geom`, удалить отдельные lat/lng

---

## P3 — Стабилизация (3-5 дней)

### P3-1. Тестовая инфраструктура с отдельной БД

**Текущее покрытие:**
| Слой | Покрыто | Процент |
|------|---------|---------|
| Services (методы) | ~10 / ~30 | ~33% |
| Controllers | 0 / 8 | 0% |
| Models | 0 / 10 | 0% |
| Utils | 0 / 3 | 0% |
| Routes/Endpoints | ~8 / ~15 | ~60% |

**Блокеры CI:** Integration + security тесты требуют живой PostgreSQL. Без БД работают только `simple.test.js` (3 тривиальных теста) и `xss-protection.test.js` (статический анализ).

**Действия:**
1. docker-compose.test.yml с изолированной PostgreSQL
2. Исправить мок bcrypt в services.test.js (прямое присвоение → `jest.mock('bcrypt')`)
3. Исправить хрупкий fallback `testBuildingId = body.data?.building_id || ... || 1` → assert + fail fast
4. Удалить дубликат `tests/jest/unit 2/`

### P3-2. Покрытие сервисов/контроллеров

**Приоритетные targets:**
- `alertService` — 0 тестов, содержит SQL injection (P0-7)
- `analyticsService` — 0 тестов, Circuit Breaker-логика
- `authController` — 0 тестов, privilege escalation (P0-1)
- `cacheService` — 0 тестов, TTL/eviction-логика

### P3-3. DevOps-консолидация

| Тип | Сейчас | Цель |
|-----|--------|------|
| Dockerfile | 6 | 2 (multi-stage prod + dev) |
| docker-compose | 4 | 2 (prod + dev) + 1 test |
| nginx config | 5 | 2 (prod + dev) |

**Дополнительно:**
- Автосоздание партиций `analytics_history` (сейчас статические, нет pg_cron)
- Добавить `destroy()` в CircuitBreaker/CacheService/RateLimiter — `setInterval` в конструкторе без cleanup → утечки в тестах
- Добавить недостающие индексы: `token_blacklist(expires_at)`, `infrastructure_alerts(status, created_at DESC)`, `refresh_tokens(user_id, expires_at)`

---

## Позитивные стороны проекта

| Аспект | Деталь |
|--------|--------|
| SQL параметризация | Полностью в Building, Controller, Metric моделях |
| Whitelist сортировки | `queryValidation.js` с allowedSortColumns |
| bcrypt 12 rounds | Корректный выбор |
| JWT Blacklist | Токен инвалидируется при logout |
| DOMPurify | sanitizePopupContent, createSecureTableCell через textContent |
| Error handler | Не раскрывает stack trace в production |
| Circuit Breaker | analyticsService.js — зрелая реализация |
| Multi-layer Cache | cacheService.js — memory + Redis-ready |
| Alert Cooldown | 15 мин между одинаковыми алертами |
| PostGIS + GIST | Корректное пространственное индексирование |
| Docker multi-stage | Зрелые Dockerfile-ы |
| nginx production | SSL/HSTS/OCSP в nginx.production.conf |
| Инкапсуляция компонентов | InfrastructureLineEditor, CoordinateEditor, AdminAuth |
| Темизация | CSS-переменные для light/dark, persist в localStorage |
| Skeleton-loader | Правильная UX-практика |

---

## Трассировка: откуда что найдено

| Агент | Scope | Ключевые находки |
|-------|-------|-----------------|
| Senior Architect | Бэкенд, архитектура, Docker | 3 паттерна данных, дублирование моделей, мёртвый код, двойные системы |
| Security Debugger | OWASP Top 10, auth, XSS, SQLi | Role escalation, refresh secret, CORS, rate limiting, CSP |
| Code Explorer (Frontend) | JS, HTML, CSS, UX | 4 подхода к fetch, монолиты, глобальные переменные, mock в production |
| Code Explorer (Tests+DB) | Jest, схема, индексы, generator | 0% покрытие controllers/models, missing indexes, двойные таблицы |
