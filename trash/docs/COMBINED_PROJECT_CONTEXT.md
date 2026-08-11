# Объединённый контекст проектов: InfraSafe + UK Management

> Дата формирования: 28 марта 2026
> Цель: передача полного контекста двух взаимосвязанных проектов в рамках экосистемы управления жилой недвижимостью

---

# ЧАСТЬ 1: INFRASAFE — Платформа IoT-мониторинга инфраструктуры

## 1.1 Обзор проекта

**InfraSafe** (v1.0.1, Apache 2.0) — цифровая платформа мониторинга и управления многоквартирными домами. Система собирает данные с интеллектуальных контроллеров (промышленных ПК с датчиками), обрабатывает метрики и предоставляет визуализацию через интерактивные Leaflet-карты и аналитические дашборды. Мониторит электроснабжение, водоснабжение, отопление и окружающую среду с автоматическими алертами.

**Репозиторий:** https://github.com/a-afanasyev/infrasafe.git

## 1.2 Технологический стек

### Бэкенд
- **Платформа:** Node.js 20+ / Express.js
- **База данных:** PostgreSQL 15+ с PostGIS (SRID 4326)
- **Авторизация:** JWT (access + refresh tokens, blacklist, account locking)
- **API документация:** Swagger/OpenAPI 3.0
- **Логирование:** Winston + daily-rotate-file
- **Контейнеризация:** Docker & Docker Compose

### Фронтенд
- **Основа:** HTML5, CSS3, Vanilla JavaScript (ES6+) — без фреймворков
- **Карты:** Leaflet.js с кластеризацией маркеров и множеством слоёв
- **Визуализация:** Chart.js для графиков и аналитики
- **Безопасность:** DOMPurify для защиты от XSS, Helmet CSP

### DevOps
- **Оркестрация:** Docker Compose (dev, prod, unified, generator)
- **Reverse Proxy:** Nginx
- **Тестирование:** Jest (175 тестов, 16 test suites)
- **Линтинг:** ESLint

## 1.3 Структура проекта

```
├── src/                              # Бэкенд (трёхслойная архитектура)
│   ├── config/database.js            # Подключение к PostgreSQL
│   ├── controllers/                  # HTTP-обработка, валидация, ответы
│   │   ├── admin/                    # Админ-контроллеры (9 модулей + index)
│   │   ├── authController.js         # Авторизация
│   │   ├── buildingController.js     # Здания
│   │   ├── controllerController.js   # Контроллеры IoT
│   │   ├── metricController.js       # Метрики
│   │   ├── alertController.js        # Алерты
│   │   ├── analyticsController.js    # Аналитика
│   │   ├── buildingMetricsController.js # Данные для карты
│   │   ├── powerAnalyticsController.js  # Анализ электросетей
│   │   ├── transformerController.js  # Трансформаторы
│   │   ├── lineController.js         # Линии электропередач
│   │   ├── coldWaterSourceController.js # Источники холодной воды
│   │   └── heatSourceController.js   # Источники тепла
│   ├── services/                     # Бизнес-логика
│   │   ├── authService.js            # JWT, refresh, blacklist
│   │   ├── alertService.js           # Алерты с cooldown
│   │   ├── analyticsService.js       # Аналитика с Circuit Breaker
│   │   ├── buildingService.js        # Бизнес-логика зданий
│   │   ├── buildingMetricsService.js # Агрегация для карты
│   │   ├── cacheService.js           # Кэширование (in-memory, Redis-ready)
│   │   ├── controllerService.js      # IoT-контроллеры
│   │   ├── metricService.js          # Метрики
│   │   ├── powerAnalyticsService.js  # Анализ электросетей
│   │   └── adminService.js           # Batch-операции
│   ├── models/                       # SQL-запросы через pg Pool (без ORM)
│   ├── middleware/
│   │   ├── auth.js                   # JWT: authenticateJWT, isAdmin, optionalAuth
│   │   ├── correlationId.js          # x-correlation-id для трейсинга
│   │   ├── errorHandler.js           # Централизованная обработка ошибок
│   │   ├── rateLimiter.js            # Rate limiting
│   │   └── validators.js             # Валидация входных данных
│   ├── routes/                       # API-маршруты (16 файлов)
│   │   └── index.js                  # Главный роутер с default-deny JWT
│   ├── utils/
│   │   ├── apiResponse.js            # Стандартизированные ответы API
│   │   ├── circuitBreaker.js         # Circuit Breaker паттерн
│   │   ├── queryValidation.js        # Whitelist для sort/order (SQL injection)
│   │   └── logger.js                 # Winston логирование
│   └── server.js                     # Точка входа, graceful shutdown, health check
├── public/                           # Статические ресурсы фронтенда
│   ├── admin.js, script.js           # Основные скрипты (~2300 и ~1400 строк)
│   ├── admin-auth.js                 # Авторизация в админке
│   ├── admin-coordinate-editor.js    # Редактор координат
│   ├── map-layers-control.js         # Управление слоями карты
│   ├── infrastructure-line-editor.js # Редактор инфраструктурных линий
│   └── utils/                        # domSecurity, rateLimiter, safeJsonParser, csrf, powerUtils
├── database/
│   ├── init/
│   │   ├── 01_init_database.sql      # Схема БД (PostGIS, все таблицы, ~990 строк)
│   │   └── 02_seed_data.sql          # Тестовые данные (17 зданий, Ташкент)
│   └── migrations/                   # Миграции 003-010
├── generator/                        # Сервис генерации метрик (отдельный package.json)
├── tests/jest/                       # unit/, integration/, security/
├── docker-compose.dev.yml            # Docker для разработки
├── docker-compose.prod.yml           # Docker для production
├── index.html                        # Главная страница (карта)
├── admin.html                        # Административная панель
└── package.json                      # v1.0.1, Apache-2.0
```

## 1.4 Архитектура

### Поток запросов
```
Nginx (8080) → /api/* → Express (3000) → src/routes/index.js → per-entity routes → controllers → services → models → PostgreSQL
```

### Трёхслойная архитектура бэкенда
1. **Controllers** — HTTP-обработка, валидация, форматирование ответов
2. **Services** — бизнес-логика, кэширование, circuit breaker
3. **Models** — прямые SQL-запросы через `pg` Pool (без ORM)

### Ключевые паттерны
- **Default-deny JWT** — все маршруты защищены по умолчанию, публичные заданы явным allowlist
- **Circuit Breaker** — `src/utils/circuitBreaker.js`, используется в analyticsService
- **Multi-layer Caching** — in-memory + Redis-ready
- **Alert Cooldown** — 15-минутный cooldown между одинаковыми алертами
- **SQL Injection Prevention** — whitelist-валидация для sort/order параметров
- **Rate Limiting** — 7 стратегий (auth: 10/мин, register: 5/мин, CRUD: 60/мин, analytics: 30/мин, admin: 20/мин, telemetry: 120/мин)
- **Correlation ID** — трейсинг запросов через `x-correlation-id`
- **Graceful Shutdown** — SIGTERM/SIGINT в `src/server.js`

## 1.5 Матрица аутентификации API

### Глобальная политика: Default-deny
Все маршруты требуют JWT, кроме явного allowlist:

**Публичные маршруты:**
- `POST /auth/login` (rate limit: 10/мин)
- `POST /auth/register` (rate limit: 5/мин)
- `POST /auth/refresh`
- `POST /metrics/telemetry` (rate limit: 120/мин) — приём телеметрии от устройств
- `GET /buildings-metrics` (optionalAuth — анонимы получают урезанные данные)
- `GET /` — информация об API

**Защищённые JWT:**
- `/buildings`, `/controllers`, `/metrics` — Core CRUD
- `/transformers`, `/lines` — Электрическая инфраструктура
- `/cold-water-sources`, `/heat-sources`, `/water-lines`, `/water-suppliers` — Водная инфраструктура
- `/analytics` — 25+ аналитических эндпоинтов
- `/alerts` — жизненный цикл алертов
- `/power-analytics` — анализ электросетей

**JWT + Admin:**
- `/admin/*` — массовые операции
- `/alerts/thresholds`, `/alerts/check/*` — управление порогами
- `/analytics/transformers` — CRUD для трансформаторной аналитики
- `/power-analytics/refresh` — обновление материализованных представлений
- `/controllers/update-status-by-activity` — обновление статусов контроллеров

### Двухуровневый `/buildings-metrics`

| Пользователь | Получает |
|---|---|
| Анонимный | building_id, name, address, town, coordinates, has_controller |
| Авторизованный | Все поля + метрики: electricity, water, temperature, humidity, leak_sensor |

## 1.6 API Power Analytics

### Формула мощности по фазе
```
P (кВт) = U (В) × I (А) × cos(φ) / 1000
cos(φ) = 0.85 (для жилых зданий)
```

### Эндпоинты

| Эндпоинт | Описание |
|---|---|
| `GET /api/power-analytics/buildings` | Мощность всех зданий по фазам |
| `GET /api/power-analytics/buildings/:id` | Мощность конкретного здания |
| `GET /api/power-analytics/lines` | Суммарная мощность линий электропередач |
| `GET /api/power-analytics/transformers` | Загрузка трансформаторов (load_percent) |
| `GET /api/power-analytics/phase-imbalance` | Анализ дисбаланса фаз |
| `POST /api/power-analytics/refresh` | Обновление материализованных представлений (JWT+Admin) |

**Статусы дисбаланса фаз:**
- `OK` — отклонение < 10%
- `WARNING` — отклонение 10-20%
- `CRITICAL` — отклонение > 20%

## 1.7 Схема базы данных (PostgreSQL 15 + PostGIS)

### Система аутентификации
- **users** — user_id, username, email, password_hash, full_name, role, is_active, failed_login_attempts, account_locked_until, timestamps
- **refresh_tokens** — token_id, user_id, token_hash, expires_at
- **token_blacklist** — id, token_hash, expires_at

### Основные таблицы инфраструктуры
- **buildings** — building_id, name, address, town, lat/lng, region, management_company, hot_water, geom(POINT 4326), связи с инфраструктурой (power_transformer_id, cold_water_source_id, heat_source_id, primary/backup_transformer_id, primary/backup_line_id, water_line_ids, water_supplier_ids)
- **controllers** — controller_id, serial_number, vendor, model, building_id, status, last_heartbeat
- **metrics** — metric_id, controller_id, timestamp, electricity_ph1-3, amperage_ph1-3, cold_water_pressure/temp, hot_water_in/out_pressure/temp, air_temp, humidity, leak_sensor

### Электрическая инфраструктура
- **transformers** — transformer_id, name, power_kva, voltage_kv, location, lat/lng, geom, installation_date, manufacturer, model, status
- **lines** — line_id, name, voltage_kv, length_km, transformer_id, start/end coordinates, main_path(JSONB), branches(JSONB), cable_type, commissioning_year, geom(LINESTRING 4326)
- **power_transformers** (legacy) — id(varchar), name, address, lat/lng, capacity_kva, voltage_primary/secondary, status, geom

### Водная инфраструктура
- **water_lines** — line_id, name, description, diameter_mm, material, pressure_bar, installation_date, status, coordinates, main_path/branches(JSONB), geom(LINESTRING 4326)
- **water_suppliers** — supplier_id, name, supplier_type, contact, tariff_per_m3, contract_number/date, status
- **water_measurement_points** — point_id, building_id, point_type, location, meter_serial, last_reading
- **cold_water_sources** — id, name, address, lat/lng, source_type, capacity_m3_per_hour, operating_pressure_bar, geom
- **heat_sources** — id, name, address, lat/lng, source_type, capacity_mw, fuel_type, geom

### Алерты и аналитика
- **infrastructure_alerts** — alert_id, type, infrastructure_id/type, severity(INFO/WARNING/CRITICAL), status(active/acknowledged/resolved), message, affected_buildings, data(JSONB)
- **alerts** (legacy) — alert_id, metric_id, alert_type_id, severity, status
- **alert_types** — alert_type_id, type_name, description
- **analytics_history** (партиционированная по месяцам) — id, analysis_type, infrastructure_id/type, analysis_date, analysis_data(JSONB)

### Материализованные представления
- **mv_transformer_load_realtime** — загрузка трансформаторов в реальном времени (buildings_count, controllers_count, avg_voltage, avg_amperage, load_percent)

### Ключевые функции БД
- `update_geom_on_coordinates_change()` — автообновление PostGIS геометрии
- `update_controller_heartbeat()` — обновление heartbeat при новых метриках
- `convert_line_endpoints_to_path()` — конвертация координат начала/конца в main_path
- `update_line_geom_from_path()` — построение LINESTRING из JSONB-массива точек
- `refresh_transformer_analytics()` — обновление MV
- `archive_daily_analytics()` — архивирование ежедневной аналитики
- `find_nearest_buildings_to_transformer()` — поиск ближайших зданий (PostGIS)

## 1.8 Docker-сервисы

| Сервис | Описание | Порт |
|---|---|---|
| frontend | Nginx (статика + API proxy) | 8080 (dev: 8088) |
| app | Node.js Express | 3000 |
| postgres | PostgreSQL 15 + PostGIS | 5435 (host) → 5432 (container) |

### Переменные окружения
```bash
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD  # обязательные
JWT_SECRET, JWT_REFRESH_SECRET                    # обязательные
NODE_ENV=development|production                   # опционально
PORT=3000
CORS_ORIGINS=http://localhost:8080
LOG_LEVEL=info|debug|warn|error
```

## 1.9 Тестирование

- **175 тестов** в 16 test suites, все проходят
- Unit: `tests/jest/unit/` (10 файлов — сервисы, контроллеры, модели, middleware)
- Integration: `tests/jest/integration/` (API, default-deny auth)
- Security: `tests/jest/security/` (SQL injection, XSS, общая безопасность)

**Тестовые данные:** admin/admin123 (администратор), testuser/TestPass123 (пользователь), 17 зданий в Ташкенте, 34 записи метрик.

## 1.10 Известные проблемы архитектуры
- `public/admin.js` (~2300 строк) и `public/script.js` (~1400 строк) — монолитные файлы
- Модели выполняют SQL напрямую (нет repository pattern) — затрудняет unit-тестирование
- Часть бэкенда использует `console.error` вместо Winston logger
- Дублирование кода в water-related route файлах

---

# ЧАСТЬ 2: UK MANAGEMENT — Система управления заявками ЖК

## 2.1 Обзор проекта

**UK Management Bot** — enterprise-grade система управления заявками жилого комплекса через Telegram-бот (aiogram 3 + Python 3.11), REST API (FastAPI) и React-дашборд (Vite + TypeScript + shadcn/ui). Жители подают заявки, исполнители выполняют, менеджеры контролируют. Три роли: applicant, executor, manager. Два языка: RU, UZ.

**Статус:** Production-deployed (Phase 2B live с 20.10.2025), 12,500+ строк кода, 38 сервисов.

## 2.2 Технологический стек

### Бот
- **Framework:** Aiogram 3.x (Telegram Bot)
- **Runtime:** Python 3.11

### API
- **Framework:** FastAPI + Uvicorn
- **ORM:** SQLAlchemy 2.x + Alembic (миграции)
- **Auth:** JWT (python-jose) + passlib (bcrypt)
- **Rate limiting:** slowapi

### Фронтенд
- **Framework:** React 18+ TypeScript
- **UI:** shadcn/ui (ранее Vuetify 3)
- **State:** Zustand (auth), TanStack Query (data fetching)
- **Routing:** React Router v6
- **Build:** Vite
- **i18n:** i18next (ru, uz, en)

### Инфраструктура
- **DB:** PostgreSQL 15
- **Cache:** Redis 7 (rate limiting, caching, pub/sub)
- **Scheduling:** APScheduler
- **Async HTTP:** httpx

## 2.3 Структура проекта

```
uk_management_bot/   — бот: handlers, services, middlewares, keyboards, states, utils, config/locales
uk_management_api/   — FastAPI backend (REST + WebSocket)
frontend/            — React SPA (Vite, TanStack Query, Zustand, i18next)
alembic/             — миграции PostgreSQL
docker-compose.yml   — dev-окружение (bot, api, frontend, postgres, redis)
```

## 2.4 Роли и функции

### Жители (applicant)
- Создание заявок с фото, категорией, срочностью
- Просмотр своих заявок и статусов
- Приёмка выполненных работ
- Оценка качества

### Исполнители (executor)
- Просмотр назначенных заявок
- Обновление статусов, загрузка фото-отчётов
- Управление сменами
- Передача смен

### Менеджеры (manager)
- Kanban-доска всех заявок
- Назначение исполнителей (ручное и AI)
- Аналитика и KPI-дашборд
- Управление сменами, календарь
- Справочник адресов

## 2.5 Обработчики бота (30 handlers)

**Аутентификация и пользователи:** auth, onboarding, user_management, user_verification, profile_editing

**Управление заявками (core):** requests, request_status_management, request_comments, request_reports, request_acceptance, request_assignment, unaccepted_requests

**Смены:** shifts, shift_management, my_shifts, shift_transfer, quarterly_planning

**Справочник адресов:** address_yards, address_buildings, address_apartments, address_moderation, user_apartment_selection, user_apartments, user_yards_management

**Администрирование:** admin, base, health, clarification_replies, employee_management

## 2.6 Сервисы (38 total)

### Асинхронные (9):
AsyncAuthService, AsyncRequestService, AsyncShiftService, AsyncSmartDispatcher, AsyncAssignmentOptimizer, AsyncNotificationService, и базовые классы

### Синхронные (29):
AuthService, RequestService, AddressService, ShiftService, ShiftPlanningService, ShiftAssignmentService, RequestAssignmentService, InviteService, NotificationService, UserVerificationService, CommentService, RatingService, MetricsManager, SpecializationService, AuditService, AnalyticsService, ShiftTransferService, RequestNumberService, RecommendationEngine, TemplateManager, ShiftAnalytics, Redis Pub/Sub

### AI-компоненты:
- **SmartDispatcher** — AI-подбор исполнителя (4 алгоритма: greedy, genetic, annealing, hybrid)
- **AssignmentOptimizer** — оптимизация загрузки
- **GeoOptimizer** — географическая оптимизация

## 2.7 API эндпоинты (FastAPI)

Base URL: `/api/v2/` (v1 для legacy)

### Auth
- `POST /auth/users` — get/create user
- `POST /auth/users/{telegram_id}/approve` — approve pending user
- `POST /auth/login` — JWT login
- `POST /auth/refresh` — refresh token

### Requests
- `GET /requests` — список с фильтрами (status, category, urgency, executor)
- `POST /requests` — создание заявки
- `GET /requests/{request_number}` — детали (формат YYMMDD-NNN)
- `PATCH /requests/{request_number}/status` — обновление статуса
- `POST /requests/{request_number}/assign` — назначение исполнителя
- `POST /requests/{request_number}/comments` — добавление комментария
- `GET /requests/stats/overview` — метрики для дашборда

### Shifts
- `GET/POST /shifts` — список / создание смен
- `PATCH /shifts/{shift_id}` — обновление
- `POST /shifts/{shift_id}/transfer` — передача смены
- `GET /shifts/calendar` — месячный вид

### Addresses
- `GET /addresses/yards` — жилые комплексы
- `GET /addresses/buildings/{yard_id}` — здания в комплексе
- `GET/POST /addresses/apartments/{building_id}` — квартиры

### Manager WebApp API
- `GET /api/manager/requests` — заявки с фильтрацией
- `GET /api/manager/executors` — исполнители
- `GET /api/manager/shifts` — смены
- `GET /api/manager/stats` — статистика
- `POST /api/manager/assignments/assign` — ручное назначение
- `POST /api/manager/assignments/ai-assign` — AI-назначение
- `POST /api/manager/assignments/bulk-assign` — массовое назначение
- `WS /api/manager/ws/{manager_id}` — WebSocket real-time

### WebSocket события
request.created, request.status_changed, request.assigned, request.ai_assigned, requests.bulk_assigned, request.unassigned, request.comment_added, shift.started, shift.ended

## 2.8 Фронтенд (React Dashboard)

### Страницы
- `/login` — Telegram аутентификация
- `/dashboard` — Kanban-доска заявок
- `/dashboard/analytics` — KPI-дашборд
- `/dashboard/shifts` — календарь смен
- `/dashboard/employees` — реестр исполнителей
- `/dashboard/templates` — шаблоны смен
- `/dashboard/addresses` — справочник адресов
- `/resident-board` — доска заявок жителя
- `/twa/create` — создание заявки (Telegram WebApp)
- `/twa/requests/:number` — детали заявки

### Ключевые компоненты
KanbanBoard (drag-drop), RequestCard, RequestDetail (модальное окно), FilterBar, ShiftCalendar, EmployeeList, AnalyticsDashboard, AddressTree

## 2.9 Схема базы данных (PostgreSQL 15)

### Основные таблицы (23)
- **users** — telegram_id, username, first_name, role, active_role, roles(JSON-массив), status
- **requests** — request_number(YYMMDD-NNN), status, category, urgency, executor_id, timestamps
- **apartments** — apartment_number, building_id, entrance, floor, rooms_count, area
- **buildings** — address, yard_id, gps_coords, entrance_count, floor_count
- **yards** — name, description, is_active
- **shifts** — name, date, start/end_time, executor_id, shift_type
- **shift_schedules**, **shift_assignments**, **shift_transfers**
- **request_assignments** — request_id, executor_id, assignment_type
- **user_apartments**, **user_documents**, **user_verifications**
- **notifications** — user_id, type, message, read_at
- **ratings** — request_id, rating, comment
- **audit_logs** — user_id, action, details, ip_address
- **quarterly_plans**, **quarterly_shift_schedules**, **shift_templates**
- **access_rights** — user_id, access_level, expires_at
- **webhook_outbox** — webhook_url, payload, status, retry_count

### Формат номеров заявок
`YYMMDD-NNN` (строка, не int). Пример: `251027-001`. Генерируется `RequestNumberService` с fallback для конкурентных вставок.

### Роли в БД
`user.roles` — JSON-массив строк, `user.active_role` — текущая активная роль. Поле `user.role` устарело.

## 2.10 Docker-сервисы

| Контейнер | Описание | Порт |
|---|---|---|
| uk-management-bot | Telegram бот (Python) | — |
| uk-management-api | FastAPI REST API | 8085→8080 |
| uk-web-registration | Регистрация по приглашениям | 8000 |
| uk-postgres | PostgreSQL 15 | 5432 |
| uk-redis | Redis 7 (cache + pub/sub) | 6379 |
| uk-frontend | React (Vite, nginx) | 3002→80 |

### Переменные окружения (из .env)
```
DATABASE_URL=postgresql://uk_bot:uk_bot_password@postgres:5432/uk_management
REDIS_URL=redis://redis:6379/0
REDIS_PUBSUB_URL=redis://redis:6379/1
INFRASAFE_WEBHOOK_ENABLED, INFRASAFE_WEBHOOK_URL, INFRASAFE_WEBHOOK_SECRET  # интеграция с InfraSafe
```

## 2.11 Локализация

**Текущее состояние:** инфраструктура на месте (ru.json, uz.json), функция `get_text()`, но ~38 хардкодированных строк остаются.

**Фронтенд:** i18next с файлами `frontend/src/i18n/locales/{ru,uz,en}.json`

**Бот:** `config/locales/ru.json`, `config/locales/uz.json`, статусы через `utils/status_display.py`, адреса через `utils/address_helpers.py:localize_address()`

## 2.12 Текущие критические баги

- **BOT-3:** Исполнители не могут начать смену (проверка legacy-поля role вместо active_role)
- **BOT-4:** Декоратор `@require_role` не работает для callback handlers
- **WEB-3:** WebSocket 403 блокирует real-time обновления

## 2.13 Ключевые команды

```bash
# Бот
docker compose build uk-management-bot && docker compose up -d uk-management-bot
docker exec uk-management-bot pytest  # тесты только внутри контейнера
docker logs uk-management-bot --tail 20

# Фронтенд
cd frontend && npm test  # или npx vitest

# Полный стек
docker compose up -d
docker compose down
```

---

# ЧАСТЬ 3: ВЗАИМОСВЯЗЬ ПРОЕКТОВ

## 3.1 Общий домен
Оба проекта работают в домене управления жилой недвижимостью в Ташкенте (Узбекистан):
- **InfraSafe** — мониторинг инженерных систем (электро, вода, тепло, IoT-датчики)
- **UK Management** — операционное управление заявками жителей

## 3.2 Интеграция через Webhook
В docker-compose.yml UK Management есть переменные для интеграции:
```
INFRASAFE_WEBHOOK_ENABLED
INFRASAFE_WEBHOOK_URL
INFRASAFE_WEBHOOK_SECRET
```

Таблица `webhook_outbox` в UK Management хранит исходящие вебхуки с ретраями.

## 3.3 Точки пересечения

| Аспект | InfraSafe | UK Management |
|---|---|---|
| Здания | buildings (17 зданий, PostGIS) | buildings (address, yard_id) |
| Пользователи | JWT (admin/user) | JWT (applicant/executor/manager) |
| БД | PostgreSQL 15 + PostGIS | PostgreSQL 15 |
| Алерты | Автоматические по порогам | Заявки от жителей |
| Контейнеризация | Docker Compose | Docker Compose |
| Язык | RU | RU/UZ |

## 3.4 Потенциальная интеграция
- Алерты InfraSafe (перегрузка трансформатора, утечка воды) → автоматическое создание заявок в UK Management
- Данные о здании из InfraSafe → контекст для заявок в UK Management
- Единая карта: здания InfraSafe + статусы заявок UK Management

---

# ЧАСТЬ 4: ПРАВИЛА РАБОТЫ

## Для InfraSafe
- Docker dev: `docker compose -f docker-compose.dev.yml up --build`
- Тесты: `npm test` (175 тестов)
- API Docs: http://localhost:8080/api-docs
- БД: `psql postgresql://postgres:postgres@localhost:5435/infrasafe`

## Для UK Management
- Язык общения: русский
- Перед правкой файла — прочитать его
- После правки бота — ребилд и рестарт контейнера
- Не коммитить и не пушить без явной просьбы
- Секреты (.env, ключи) — никогда не коммитить, не выводить
- Роли: `user.roles` (JSON-массив), `user.active_role`. НЕ использовать `user.role`
- Номера заявок: `YYMMDD-NNN` (строка). Сервис: `RequestNumberService`
- Баг-репорты: `docs/bugs-YYYY-MM-DD.md`
- Избегать over-engineering за пределами задачи
