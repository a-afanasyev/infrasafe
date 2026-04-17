# InfraSafe — Single Source of Truth (SOT)

> **Актуальность:** 2026-04-17  
> **Версия проекта:** 1.0.1  
> **Лицензия:** Apache 2.0  
> **Репозиторий:** git, main branch  
> **Изменения с 2026-04-12:** Phase 12B.3 (persistent account lockout, migration 013), Phase 12B.4 (esbuild bundler активирован, public/dist/), 2FA-фикс (admin-auth redirect + идемпотентный setup-2fa), migrations 012-015.  

---

## 1. Назначение проекта

InfraSafe — цифровая IoT-платформа мониторинга инженерной инфраструктуры многоквартирных жилых домов. Платформа собирает данные с интеллектуальных контроллеров (промышленные ПК с датчиками), обрабатывает метрики и предоставляет визуализацию в реальном времени через интерактивные карты и аналитические дашборды.

**Мониторируемые системы:**
- Электроснабжение (3-фазное: напряжение, ток, мощность)
- Холодное водоснабжение (давление, температура)
- Горячее водоснабжение (давление/температура подачи и обратка)
- Отопление (теплоисточники, мощность)
- Микроклимат (температура воздуха, влажность, датчик протечек)

**Регион:** Ташкент, Узбекистан. Интерфейс на русском языке.

---

## 2. Технологический стек

| Слой | Технология | Версия |
|------|-----------|--------|
| Runtime | Node.js | 20+ |
| Backend framework | Express.js | 4.x |
| База данных | PostgreSQL + PostGIS | 15+ |
| Frontend | Vanilla JavaScript (без фреймворка) | ES6+ |
| Карты | Leaflet.js | 1.9.4 |
| Графики | Chart.js | 4.4.1 |
| XSS-защита | DOMPurify | 3.2.7 |
| Контейнеризация | Docker Compose | - |
| Reverse proxy | Nginx | Alpine |
| Тесты | Jest | - |
| CI/CD | GitHub Actions | - |
| Логирование | Winston | - |
| API документация | Swagger/OpenAPI | - |

**Зависимости (production):** axios, bcrypt, cors, dompurify, dotenv, express, express-validator, helmet, jsonwebtoken, morgan, otplib, pg, qrcode, swagger-jsdoc, swagger-ui-express, winston, winston-daily-rotate-file
**Зависимости (dev):** esbuild, eslint, jest, nodemon, supertest

---

## 3. Архитектура

### 3.1 Системная архитектура

```
                    Internet
                       |
              +--------+--------+
              |   Nginx (8088)  |  Reverse proxy, SSL, статика
              +--------+--------+
                       |
          +------------+------------+
          |                         |
    Статика (HTML/CSS/JS)    /api/* proxy
          |                         |
    Frontend (browser)      +-------+-------+
                            | Express (3000) |  Node.js backend
                            +-------+-------+
                                    |
                            +-------+-------+
                            | PostgreSQL     |  PostGIS, порт 5435
                            | (5432 внутри)  |
                            +---------------+
                                    
    +------------------+
    | Generator (8081) |  Генератор тестовых данных (опционально)
    +------------------+
```

### 3.2 Трёхслойный бэкенд

```
HTTP Request
    |
    v
[Middleware]  -->  correlationId, authenticateJWT, rateLimiter, helmet, CORS
    |
    v
[Routes]     -->  src/routes/ — маршрутизация, валидация входных данных
    |
    v
[Controllers] --> src/controllers/ — HTTP-обработка, форматирование ответов
    |
    v
[Services]   -->  src/services/ — бизнес-логика, кеширование, circuit breaker
    |
    v
[Models]     -->  src/models/ — прямые SQL-запросы через pg Pool (без ORM)
    |
    v
[PostgreSQL + PostGIS]
```

### 3.3 Ключевые паттерны

| Паттерн | Файл | Описание |
|---------|------|----------|
| Circuit Breaker | `src/utils/circuitBreaker.js` | Защита от каскадных сбоев (аналитика, БД, materialized views) |
| Multi-layer Cache | `src/services/cacheService.js` | In-memory кеш (Redis-ready), TTL, инвалидация |
| Alert Cooldown | `src/services/alertService.js` | 15-минутный cooldown между одинаковыми алертами |
| SQL Injection Prevention | `src/utils/queryValidation.js` | Whitelist валидация sort/order параметров |
| Standardized Responses | `src/utils/apiResponse.js` | sendError, sendNotFound, sendCreated, sendSuccess |
| Correlation ID | `src/middleware/correlationId.js` | Трейсинг запросов через x-correlation-id |
| Rate Limiting | `src/middleware/rateLimiter.js` | Brute-force и DDoS защита |
| Graceful Shutdown | `src/server.js` | SIGTERM/SIGINT — закрытие HTTP-сервера и пула БД |
| HMAC Verification | `src/services/ukIntegrationService.js` | HMAC-SHA256 подписи webhook с replay protection |
| Raw Body Preservation | `src/server.js` | req.rawBody для верификации подписей webhook |
| Alert Event Bus (Phase 7) | `src/events/alertEvents.js` | EventEmitter — разрывает циклическую зависимость controllerService ↔ alertService ↔ ukIntegrationService |
| CRUD Factory (Phase 6) | `src/models/factories/createCrudModel.js`, `src/controllers/factories/createCrudController.js` | Генерация CRUD-моделей и контроллеров из описания таблицы (используется ColdWaterSource, HeatSource) |
| Admin Query Builder (Phase 5) | `src/utils/adminQueryBuilder.js`, `src/utils/dynamicUpdateBuilder.js` | Пагинация/фильтры/сорт с whitelist-валидацией IDENT_RE, ALLOWED_UPDATE_TABLES |
| Persistent Account Lockout (Phase 12B.3) | `src/models/AccountLockout.js` + migration 013 | Блокировка аккаунта в БД (раньше была in-memory Map — не переживала рестарт) |
| Frontend Bundle (Phase 12B.4) | `build/esbuild.config.mjs`, `public/dist/` | esbuild минифицирует JS в `public/dist/`, gzip в nginx; production-nginx запрещает `.map` файлы; postinstall hook пересобирает при `npm ci` |
| Idempotent 2FA Setup (2026-04-17) | `src/services/totpService.js generateSetup()` | Переиспользует незаконфирмленный `totp_secret` — два QR подряд не ломают друг друга |
| Admin redirect-only auth (2026-04-17) | `public/admin-auth.js` | `admin.html` не держит свою логин-форму; при отсутствии токена → `/login.html` (там полный 2FA-flow) |

---

## 4. API — полный каталог эндпоинтов

### 4.1 Модель безопасности

**Default-deny JWT** — все маршруты требуют аутентификации, кроме явно указанных публичных.

**Публичные маршруты (без JWT):**
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/refresh`
- `POST /api/metrics/telemetry`
- `GET /api/buildings-metrics` (optionalAuth — анонимные получают урезанные данные)
- `GET /api/` (root info)
- `GET /api/health`
- `POST /api/webhooks/uk/building` (HMAC-аутентификация)
- `POST /api/webhooks/uk/request` (HMAC-аутентификация)

### 4.2 Rate Limiting

| Лимитер | Окно | Лимит | Применение |
|---------|------|-------|-----------|
| authLimiter | 15 мин | 10 req | /auth/login |
| registerLimiter | 1 час | 5 req | /auth/register |
| crudLimiter | 1 мин | 60 req | CRUD-операции |
| analyticsLimiter | 1 мин | 30 req | Аналитика (+ slowDown после 20 req) |
| adminLimiter | 1 мин | 20 req | Админ-операции |
| telemetryLimiter | 1 мин | 120 req | Телеметрия от устройств |
| webhookLimiter | 1 мин | 60 req | Webhook от UK-системы |

### 4.3 Аутентификация (`/api/auth`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| POST | `/auth/login` | Нет | Логин, возврат JWT + refresh token |
| POST | `/auth/register` | Нет | Регистрация пользователя |
| POST | `/auth/refresh` | Refresh token | Обновление токенов |
| GET | `/auth/profile` | JWT | Профиль текущего пользователя |
| POST | `/auth/logout` | JWT | Выход, токен в blacklist |
| POST | `/auth/change-password` | JWT | Смена пароля (min 8 символов) |

**Механизмы:** bcrypt (12 salt rounds), JWT HS256, account lockout (5 попыток = 15 мин блокировка), token blacklist (in-memory, очистка каждый час).

### 4.4 Здания (`/api/buildings`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/buildings` | JWT | Список зданий (пагинация: page, limit, sort, order) |
| GET | `/buildings/search` | JWT | Поиск по координатам и радиусу (lat, lng, radius_km) |
| GET | `/buildings/statistics` | JWT | Статистика: общее количество, по городам, по УК |
| GET | `/buildings/:id` | JWT | Здание по ID |
| POST | `/buildings` | JWT | Создание здания |
| PUT | `/buildings/:id` | JWT | Обновление здания |
| DELETE | `/buildings/:id` | JWT | Удаление (нельзя при наличии контроллеров) |

### 4.5 Контроллеры (`/api/controllers`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/controllers` | JWT | Список с пагинацией |
| GET | `/controllers/statistics` | JWT | Статистика по статусам и зданиям |
| GET | `/controllers/:id` | JWT | Контроллер по ID |
| GET | `/controllers/building/:buildingId` | JWT | Контроллеры здания |
| GET | `/controllers/:id/metrics` | JWT | Метрики контроллера (date range) |
| POST | `/controllers/update-status-by-activity` | JWT+Admin | Автообновление статусов по heartbeat |
| POST | `/controllers` | JWT | Создание |
| PUT | `/controllers/:id` | JWT | Обновление |
| PATCH | `/controllers/:id/status` | JWT | Обновление статуса (online/offline/maintenance) |
| DELETE | `/controllers/:id` | JWT | Удаление |

### 4.6 Метрики (`/api/metrics`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/metrics` | JWT | Все метрики (пагинация, сортировка) |
| GET | `/metrics/latest` | Нет | Последняя метрика каждого контроллера |
| GET | `/metrics/:id` | JWT | Метрика по ID |
| GET | `/metrics/controller/:controllerId` | JWT | Метрики контроллера (date range) |
| GET | `/metrics/controller/:controllerId/aggregated` | JWT | Агрегация (min/max/avg) по timeFrame |
| POST | `/metrics/telemetry` | Нет | Приём телеметрии от устройств |
| POST | `/metrics` | JWT | Ручное создание метрики |
| DELETE | `/metrics/cleanup` | JWT | Очистка метрик старше N дней |
| DELETE | `/metrics/:id` | JWT | Удаление метрики |

**Поля метрики:** controller_id, timestamp, electricity_ph1/ph2/ph3, amperage_ph1/ph2/ph3, cold_water_pressure/temp, hot_water_in/out_pressure/temp, air_temp, humidity, leak_sensor

### 4.7 Электрическая инфраструктура

#### Трансформаторы (`/api/transformers`)
| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/transformers` | JWT | Все трансформаторы |
| GET | `/transformers/:id` | JWT | По ID |
| GET | `/transformers/building/:buildingId` | JWT | По зданию |
| POST | `/transformers` | JWT | Создание |
| PUT | `/transformers/:id` | JWT | Обновление |
| DELETE | `/transformers/:id` | JWT | Удаление |

#### Линии электропередач (`/api/lines`)
| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/lines` | JWT | Все линии |
| GET | `/lines/:id` | JWT | По ID |
| GET | `/lines/transformer/:transformerId` | JWT | По трансформатору |
| POST | `/lines` | JWT | Создание |
| PUT | `/lines/:id` | JWT | Обновление |
| DELETE | `/lines/:id` | JWT | Удаление |

### 4.8 Водная инфраструктура

#### Источники холодной воды (`/api/cold-water-sources`)
CRUD: GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id` — JWT required

#### Теплоисточники (`/api/heat-sources`)
CRUD: GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id` — JWT required

#### Водопроводные линии (`/api/water-lines`)
CRUD + GET `/:id/supplier` — JWT required

#### Поставщики воды (`/api/water-suppliers`)
CRUD: GET `/`, GET `/:id`, POST `/`, PUT `/:id`, DELETE `/:id` — JWT required

### 4.9 Аналитика (`/api/analytics`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/transformers` | JWT | Аналитика нагрузки всех трансформаторов |
| GET | `/transformers/:id/load` | JWT | Нагрузка трансформатора |
| GET | `/transformers/overloaded` | JWT | Перегруженные (>80%) |
| GET | `/transformers/search` | JWT | Гео-поиск (lat, lng, radius_m) |
| GET | `/transformers/:id/buildings` | JWT | Ближайшие здания |
| GET | `/transformers/:id/forecast` | JWT | Прогноз нагрузки (1-168 часов) |
| GET | `/zones/load` | JWT | Аналитика по зонам |
| GET | `/transformers/statistics` | JWT | Статистика трансформаторов |
| GET | `/status` | JWT | Статус circuit breaker и кеша |
| POST | `/refresh` | JWT+Admin | Обновление materialized views |
| POST | `/cache/invalidate` | JWT+Admin | Очистка кешей |
| POST | `/circuit-breakers/reset` | JWT+Admin | Сброс circuit breakers |
| PUT | `/thresholds` | JWT+Admin | Обновление пороговых значений |
| POST | `/transformers` | JWT+Admin | Создание трансформатора (с координатами) |
| PUT | `/transformers/:id` | JWT+Admin | Обновление |
| DELETE | `/transformers/:id` | JWT+Admin | Удаление |

### 4.10 Алерты (`/api/alerts`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/` | JWT | Активные алерты (фильтры: severity, infrastructure_type) |
| GET | `/statistics` | JWT | Статистика за период (1-365 дней) |
| GET | `/status` | JWT | Статус системы алертов |
| GET | `/thresholds` | JWT | Текущие пороговые значения |
| POST | `/check/transformer/:id` | JWT+Admin | Проверка трансформатора |
| POST | `/check/all-transformers` | JWT+Admin | Проверка всех трансформаторов |
| POST | `/` | JWT | Ручное создание алерта |
| PATCH | `/:alertId/acknowledge` | JWT+Admin | Подтверждение алерта |
| PATCH | `/:alertId/resolve` | JWT+Admin | Разрешение алерта |
| PUT | `/thresholds` | JWT+Admin | Обновление порогов |

**Жизненный цикл:** active → acknowledged → resolved  
**Severity:** INFO, WARNING, CRITICAL  
**Infrastructure types:** transformer, water_source, heat_source, controller

### 4.11 Энергоаналитика (`/api/power-analytics`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/buildings` | JWT | Потребление зданий по фазам |
| GET | `/buildings/:id` | JWT | Потребление здания |
| GET | `/lines` | JWT | Мощность по линиям |
| GET | `/lines/:id` | JWT | Мощность линии |
| GET | `/transformers` | JWT | Нагрузка трансформаторов |
| GET | `/transformers/:id` | JWT | Нагрузка трансформатора |
| GET | `/phase-imbalance` | JWT | Анализ фазового дисбаланса |
| POST | `/refresh` | JWT+Admin | Обновление materialized views |

**Формула:** P = U x I x cos(phi) / 1000 (kW), cos(phi) = 0.85

### 4.12 Карта зданий (`/api/buildings-metrics`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/` | optionalAuth | Здания + последние метрики для карты |

Анонимные — урезанные данные, авторизованные — полные.

### 4.13 Админ-панель (`/api/admin`) — все JWT+Admin

Полные CRUD + batch-операции для: buildings, controllers, metrics, transformers, lines, water-lines, cold-water-sources, heat-sources.

Дополнительно:
- `GET /search` — глобальный поиск
- `GET /stats` — статистика для дашборда
- `POST /export` — экспорт в CSV/XLSX/JSON

### 4.14 Webhooks UK-системы (`/api/webhooks/uk`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| POST | `/building` | HMAC-SHA256 | Синхронизация зданий из UK |
| POST | `/request` | HMAC-SHA256 | Обратная связь по заявкам из UK |

**Верификация:** заголовок `x-webhook-signature`, формат `t=<timestamp>,v1=<hex>`, replay protection (300s), timing-safe comparison.

### 4.15 Интеграция UK (`/api/integration`)

| Метод | Путь | Авторизация | Описание |
|-------|------|------------|----------|
| GET | `/request-counts` | JWT | Статистика заявок (60s кеш) |
| GET | `/building-requests/:externalId` | JWT | Заявки по зданию (UUID) |
| GET | `/config` | JWT+Admin | Конфигурация (маскированные секреты) |
| PUT | `/config` | JWT+Admin | Обновление конфигурации |
| GET | `/logs` | JWT+Admin | Логи интеграции (фильтры) |
| GET | `/logs/:id` | JWT+Admin | Лог-запись по ID |
| POST | `/logs/retry/:id` | JWT+Admin | Повтор неудачной операции |
| GET | `/rules` | JWT+Admin | Правила маппинга алертов |

---

## 5. Схема базы данных

### 5.1 Расширения
- **PostGIS** — пространственные типы (POINT, LINESTRING), функции (ST_Distance, ST_DWithin)

### 5.2 Таблицы

#### Аутентификация и пользователи

**users** (PK: user_id serial)
| Поле | Тип | Описание |
|------|-----|----------|
| user_id | serial PK | |
| username | varchar(50) UNIQUE NOT NULL | |
| email | varchar(100) UNIQUE NOT NULL | |
| password_hash | varchar(255) NOT NULL | bcrypt |
| full_name | varchar(100) | |
| role | varchar(20) DEFAULT 'user' | admin/operator/user |
| is_active | boolean DEFAULT true | |
| failed_login_attempts | integer DEFAULT 0 | |
| account_locked_until | timestamptz | |
| created_at, updated_at, last_login | timestamptz | |

**refresh_tokens** (PK: token_id bigserial) — FK: user_id → users  
**token_blacklist** (PK: id bigserial) — token_hash UNIQUE, expires_at

#### Здания и контроллеры

**buildings** (PK: building_id serial)
| Поле | Тип | Описание |
|------|-----|----------|
| building_id | serial PK | |
| name | varchar(100) NOT NULL | |
| address | text NOT NULL | |
| town | varchar(100) NOT NULL | |
| latitude, longitude | numeric(9,6) | |
| region | varchar(50) | |
| management_company | varchar(100) | |
| has_hot_water | boolean DEFAULT false | |
| geom | geometry(POINT, 4326) | PostGIS, auto-trigger |
| primary_transformer_id | integer FK → transformers | |
| backup_transformer_id | integer FK → transformers | |
| primary_line_id, backup_line_id | integer FK → lines | |
| cold_water_source_id | varchar(50) FK → cold_water_sources | |
| heat_source_id | varchar(50) FK → heat_sources | |
| cold_water_line_id, hot_water_line_id | integer FK → water_lines | |
| cold_water_supplier_id, hot_water_supplier_id | integer FK → water_suppliers | |
| power_transformer_id | varchar(50) FK → power_transformers | |
| **external_id** | uuid UNIQUE | UK-интеграция |
| **uk_deleted_at** | timestamptz | Soft delete из UK |

**controllers** (PK: controller_id serial)
- serial_number (UNIQUE), vendor, model, building_id FK → buildings, status (active/inactive), last_heartbeat

#### Электрическая инфраструктура

**transformers** (PK: transformer_id serial) — name, power_kva, voltage_kv, lat/lng/geom, manufacturer, model, status  
**lines** (PK: line_id serial) — name, voltage_kv, length_km, transformer_id FK, main_path (JSONB), branches (JSONB), cable_type, geom (LINESTRING)  
**power_transformers** (PK: id varchar(50)) — legacy, capacity_kva, voltage_primary/secondary

#### Водная инфраструктура

**cold_water_sources** (PK: id varchar(50)) — source_type (pumping_station/well/reservoir), capacity_m3_per_hour, operating_pressure_bar  
**heat_sources** (PK: id varchar(50)) — source_type (boiler_house/heat_plant/chp), capacity_mw, fuel_type  
**water_lines** (PK: line_id serial) — diameter_mm, material, pressure_bar, main_path (JSONB), branches (JSONB)  
**water_suppliers** (PK: supplier_id serial) — supplier_type (cold_water/hot_water/both), tariff_per_m3, contract_number  
**water_measurement_points** (PK: point_id serial) — building_id FK, point_type, meter_serial

#### Метрики

**metrics** (PK: metric_id bigserial)
| Поле | Тип | Описание |
|------|-----|----------|
| controller_id | integer FK → controllers | |
| timestamp | timestamptz NOT NULL | |
| electricity_ph1/ph2/ph3 | numeric(6,2) | Напряжение фаз, В |
| amperage_ph1/ph2/ph3 | numeric(6,2) | Ток фаз, А |
| cold_water_pressure | numeric(5,2) | Давление ХВС, бар |
| cold_water_temp | numeric(5,2) | Температура ХВС, C |
| hot_water_in/out_pressure | numeric(5,2) | Давление ГВС подача/обратка |
| hot_water_in/out_temp | numeric(5,2) | Температура ГВС подача/обратка |
| air_temp | numeric(5,2) | Температура воздуха, C |
| humidity | numeric(5,2) | Влажность, % |
| leak_sensor | boolean | Датчик протечки |

#### Система алертов

**alert_types** (PK: alert_type_id serial) — type_name UNIQUE, description  
**alerts** (PK: alert_id serial) — legacy, metric_id FK, alert_type_id FK, severity, status  
**infrastructure_alerts** (PK: alert_id bigserial) — основная таблица: type, infrastructure_id, infrastructure_type, severity (INFO/WARNING/CRITICAL), status (active/acknowledged/resolved), message, affected_buildings, data (JSONB), acknowledged_by/resolved_by FK → users

#### UK-интеграция (Migration 011)

**integration_config** (PK: key varchar(50)) — key-value конфигурация  
**alert_rules** (PK: id serial) — alert_type, severity, uk_category (Электрика/Сантехника), uk_urgency (Средняя/Критическая/Срочная), UNIQUE(alert_type, severity)  
**alert_request_map** (PK: id serial) — infrasafe_alert_id, uk_request_number, building_external_id (uuid), idempotency_key (uuid UNIQUE), status, UNIQUE(infrasafe_alert_id, building_external_id)  
**integration_log** (PK: id serial) — event_id (uuid UNIQUE), direction, entity_type, entity_id, action, payload (JSONB), status, error_message, retry_count

#### Аналитика

**analytics_history** — партиционирована по RANGE(analysis_date), analysis_type, infrastructure_id/type, data (JSONB)  
**logs** (PK: log_id bigserial) — системный аудит-лог

### 5.3 Materialized Views

**mv_transformer_load_realtime** — агрегация нагрузки трансформаторов: load_percent, buildings_count, controllers_count, avg voltage/amperage по фазам, количество метрик за 24 часа. Обновляется concurrently.

### 5.4 Представления (Views)

**v_phase_imbalance_analysis** — анализ фазового дисбаланса: phase_imbalance_percent, imbalance_status (OK/WARNING/CRITICAL). Пороги: >20% CRITICAL, >10% WARNING.

### 5.5 Ключевые функции

| Функция | Описание |
|---------|----------|
| `calculate_phase_power(V, A, pf)` | P = U * I * cos(phi) / 1000 (kW) |
| `calculate_three_phase_power(...)` | Возвращает JSONB с мощностью по фазам |
| `update_geom_on_coordinates_change()` | Триггер: автообновление geom из lat/lng |
| `convert_line_endpoints_to_path()` | Триггер: конвертация start/end координат в main_path |
| `update_line_geom_from_path()` | Триггер: LINESTRING из main_path JSONB |
| `update_controller_heartbeat()` | Триггер: last_heartbeat при INSERT в metrics |
| `refresh_power_materialized_views()` | Обновление materialized views concurrently |
| `find_nearest_buildings_to_transformer(id, radius)` | PostGIS пространственный запрос |
| `archive_daily_analytics()` | Архивирование снапшотов в analytics_history |

### 5.6 Триггеры

**Геометрия (9 триггеров):** автообновление geom (POINT/LINESTRING) при изменении координат для buildings, transformers, power_transformers, cold_water_sources, heat_sources, lines, water_lines.

**Мониторинг:** `trig_update_heartbeat` — обновление last_heartbeat контроллера при INSERT в metrics.

**Аудит (3 триггера):** автообновление updated_at для transformers, lines, water_lines.

### 5.7 История миграций

| # | Описание |
|---|----------|
| 001 | Инициализация схемы — все core таблицы, PostGIS, индексы |
| 002 | Seed data — тестовые данные (17 зданий в Ташкенте) |
| 003 | Система расчёта мощности — функции, materialized views |
| 004 | Координаты и расширенные поля трансформаторов и линий |
| 005 | Поддержка путей и ответвлений (main_path, branches JSONB) |
| 006 | Очистка: миграция infrastructure_lines → lines/water_lines |
| 007 | Compound индекс метрик (controller_id, timestamp DESC) |
| 008 | Консолидация hot_water → has_hot_water |
| 009 | Индексы token blacklist |
| 010 | FK-индексы трансформаторов и статусов |
| 011 | UK-интеграция: external_id, integration_config, alert_rules, alert_request_map, integration_log |

### 5.8 Связи (ER-модель)

```
buildings (hub)
  ├── controllers → metrics
  ├── primary/backup_transformer_id → transformers → lines
  ├── primary/backup_line_id → lines
  ├── cold_water_source_id → cold_water_sources
  ├── heat_source_id → heat_sources
  ├── cold/hot_water_line_id → water_lines
  ├── cold/hot_water_supplier_id → water_suppliers
  ├── power_transformer_id → power_transformers (legacy)
  └── external_id ← alert_request_map → UK system

infrastructure_alerts
  ├── alert_rules (маппинг type+severity → UK category+urgency)
  └── alert_request_map → UK request tracking

integration_log — аудит всех синхронизаций
analytics_history — ежедневные снапшоты (партиционирована по месяцам)
```

---

## 6. Внешние взаимодействия

### 6.1 UK-интеграция (Управляющая Компания)

Двунаправленная интеграция с ботом Управляющей Компании. Все 5 фаз завершены.

```
InfraSafe                         UK Bot
   |                                |
   |  <-- POST /webhooks/uk/building   |  Phase 2: Синхронизация зданий UK→InfraSafe
   |                                |
   |  --> POST UK API /requests     |  Phase 3: Алерт → Заявка InfraSafe→UK
   |      (JWT auth, retry+backoff) |
   |                                |
   |  <-- POST /webhooks/uk/request |  Phase 4: Статус заявки UK→InfraSafe
   |                                |
   |  --> GET UK API /request-counts|  Phase 5: Проксирование данных UK→Frontend
   |  --> GET UK API /requests      |
```

**Компоненты:**
- `src/services/ukIntegrationService.js` — ядро: верификация webhook, синхронизация зданий, пайплайн алерт→заявка, обратная связь, кеширование
- `src/clients/ukApiClient.js` — JWT-аутентификация (25-мин кеш токена), createRequest() с retry + exponential backoff, get() с 401-retry
- `src/routes/webhookRoutes.js` — входящие webhook с полной валидацией, TOCTOU-safe
- `src/routes/integrationRoutes.js` — админ API + public-auth эндпоинты

**Безопасность интеграции:**
- HMAC-SHA256 подписи (webhook secret из ENV)
- Replay protection (300s tolerance)
- Timing-safe comparison
- Idempotent маппинг (UNIQUE constraint + insert-first)
- Секреты: UK_WEBHOOK_SECRET, UK_SERVICE_USER, UK_SERVICE_PASSWORD — только в ENV

**Фазы:**
1. Фундамент (БД, модели, маршруты, админ UI, логирование) — DONE
2. Синхронизация зданий UK → InfraSafe — DONE
3. Пайплайн Алерт → Заявка InfraSafe → UK — DONE (feature/uk-integration-phase3-5)
4. Обратная связь Заявка → Алерт UK → InfraSafe — DONE (feature/uk-integration-phase3-5)
5. Бэкенд карты (request counts, кеширование, external_id) — DONE (feature/uk-integration-phase3-5)

### 6.2 Контроллеры IoT

```
IoT Controller (Industrial PC)
    |
    POST /api/metrics/telemetry  (без JWT, rate limit 120/min)
    |
    v
Express → metricController.receiveTelemetry → DB insert + trigger update_heartbeat
```

Контроллеры отправляют телеметрию напрямую по HTTP. Требуется только controller_id.

### 6.3 Генератор тестовых данных

Отдельный сервис (`generator/`, порт 8081) для генерации симулированных метрик:
- ESM-модуль, Express + node-cron
- Генерирует данные в диапазонах по building_id
- Режимы: ручной и по расписанию
- UI на порту 8081

---

## 7. Фронтенд

### 7.1 Legacy Frontend (main branch — production)

**Стек:** Vanilla JS (без фреймворка), HTML на корне проекта, ассеты в `public/`

**Страницы:**
| Страница | Файл | Назначение |
|----------|------|-----------|
| Карта мониторинга | `index.html` + `public/script.js` | Leaflet карта со слоями, попапы, фильтры |
| Админ-панель | `admin.html` + `public/admin.js` | CRUD всех сущностей, batch-операции |
| Логин | `public/login.html` + `public/admin-auth.js` | JWT-аутентификация |
| Аналитика | `public/analytics/index.html` | Chart.js дашборд (электричество, вода, температура) |
| О системе | `about.html` | Описание возможностей |
| Документация | `documentation.html` | Placeholder |
| Контакты | `contacts.html` | Контактная информация |

**Компоненты:**
- `public/map-layers-control.js` — управление слоями карты (здания, инфраструктура)
- `public/infrastructure-line-editor.js` — редактор линий на карте (пути, ответвления)
- `public/admin-coordinate-editor.js` — редактор координат объектов
- `public/utils/domSecurity.js` — XSS-защита через DOMPurify
- `public/utils/csrf.js` — CSRF-токены
- `public/utils/rateLimiter.js` — клиентский rate limiter
- `public/utils/safeJsonParser.js` — защита от JSON bomb
- `public/utils/powerUtils.js` — визуализация нагрузки (SVG progress rings)

**Дизайн:** CSS-переменные для тем (light/dark), шрифт Inter, акцент #00BFA5, неоморфный стиль.

**Известные проблемы:**
- `admin.js` ~2,600 строк — монолитный
- `script.js` ~1,400 строк — монолитный
- Нет фреймворка, нет сборщика (прямая загрузка в браузер)

### 7.2 Frontend Redesign (feature/frontend-redesign)

**Директория:** `frontend-design/` — в процессе разработки  
**Статус:** Минимальная реализация (только images subdirectory на момент аудита main branch)

---

## 8. Инфраструктура и деплой

### 8.1 Docker Compose конфигурации

| Файл | Назначение |
|------|-----------|
| `docker-compose.dev.yml` | Разработка: hot reload, порты 8088/3000/5435 |
| `docker-compose.prod.yml` | Продакшн: ресурсные лимиты, JSON-логи |
| `docker-compose.unified.yml` | Единый стек с Nginx reverse proxy |
| `docker-compose.generator.yml` | Генератор тестовых данных |

### 8.2 Сервисы

| Сервис | Порт | Образ | Ресурсы (prod) |
|--------|------|-------|---------------|
| frontend | 8088 (dev) / 8080 (prod) | Nginx Alpine | 0.5 CPU, 128M RAM |
| app | 3000 | Node.js 20 | 1 CPU, 512M RAM |
| postgres | 5435 (dev) / 5432 | PostGIS 15 | 2 CPU, 1G RAM |
| nginx proxy | 80/443 | Nginx Alpine | - |
| generator | 8081 | Node.js | - |

### 8.3 Nginx

- **Dev:** порт 8080, API proxy → app:3000, статическое кеширование (CSS/JS 12h)
- **Prod:** HTTPS only (TLS 1.2/1.3), HSTS, OCSP stapling, gzip, статика 1 год immutable, домен infrasafe.aisolutions.uz

### 8.4 CI/CD (GitHub Actions)

**Workflow:** `.github/workflows/ci.yml`
- **Lint job:** Node 20, eslint
- **Test job:** PostgreSQL 15 PostGIS service, coverage, upload artifacts (14 days retention)

### 8.5 Переменные окружения

**Обязательные:**
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`

**Опциональные:**
- `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `LOG_LEVEL`, `LOG_FILE`

**UK-интеграция (только ENV, не в БД):**
- `UK_WEBHOOK_SECRET` — HMAC-SHA256 shared secret
- `UK_SERVICE_USER` — сервисная учётная запись
- `UK_SERVICE_PASSWORD` — пароль сервисной учётной записи

**UK-интеграция (в БД, управляется через admin UI):**
- `uk_integration_enabled`, `uk_api_url`, `uk_frontend_url`

---

## 9. Тестирование

### 9.1 Обзор

| Тип | Количество файлов | Тесты | Расположение |
|-----|-------------------|-------|-------------|
| Unit | 83 | ~1700+ | `tests/jest/unit/` |
| Integration | 2 | ~30+ | `tests/jest/integration/` |
| Security | 3 | ~70+ | `tests/jest/security/` |
| **Итого `npm test`** | **89 suites** | **1804** (Apr 2026) | |
| E2E | 10 | ~57 | `tests/jest/e2e/` (отдельно, `npm run test:e2e`) |
| Smoke | - | - | `tests/smoke/` (bash) |
| Load | - | - | `tests/load/` (bash) |

**Порог покрытия:** 80% (branches, functions, lines, statements) — настроен в `package.json`.

### 9.2 Команды

```bash
npm test                     # Все Jest тесты (без E2E)
npm run test:unit            # Только unit
npm run test:integration     # Только интеграционные
npm run test:security        # Только security
npm run test:e2e             # E2E (требует запущенные Docker контейнеры)
npm run test:coverage        # С отчётом покрытия
npm run test:watch           # Watch mode
```

### 9.3 E2E особенности

- Требуют запущенные Docker-контейнеры
- `globalSetup.js` кеширует auth-токены чтобы не упираться в rate limiter
- Исключены из default `npm test` через testPathIgnorePatterns
- Отдельный jest.e2e.config.js с timeout 15000ms

### 9.4 Тестовые данные

- **Admin:** admin / admin123
- **Test user:** testuser / TestPass123
- **17 зданий** в Ташкенте с координатами
- **34 записи метрик**

---

## 10. Ветки и состояние разработки

### 10.1 Активные ветки

| Ветка | Статус | Содержание |
|-------|--------|-----------|
| `main` | Production | Бэкенд + legacy фронтенд + UK Phase 1-2 |
| `feature/uk-integration-phase3-5` | Ready to merge | UK Phase 3-5 (алерт→заявка, обратная связь, карта) |
| `feature/frontend-redesign` | In progress | Новый фронтенд (дизайн-система, темы) |
| `fix/p0-p1-security-and-hygiene` | Completed | Security и production hardening |

### 10.2 Локальные (архивные) ветки
- `feature/uk-integration-phase1` — завершена, смёржена
- `frontend`, `frontend-development` — предыдущие итерации фронтенда
- `refactored-backend` — рефакторинг бэкенда

### 10.3 Ключевые метрики проекта

| Метрика | Значение |
|---------|---------|
| Версия | 1.0.1 |
| Backend LOC | ~15,200 строк |
| Тесты | 1,955 (Jest) |
| Покрытие | 80%+ (target) |
| API эндпоинтов | 100+ |
| Таблиц в БД | 15+ core + 4 integration |
| Миграций | 11 |
| Docker-сервисов | 5 |
| Target response time | <100ms |
| Target uptime | 99.9% |

---

## 11. Известные архитектурные проблемы

1. **Монолитные фронтенд-файлы:** `admin.js` (~2,600 LOC), `script.js` (~1,400 LOC)
2. **Нет ORM:** Модели выполняют SQL напрямую, усложняя unit-тестирование
3. **console.error** используется в некоторых местах вместо Winston
4. **Дублирование кода** в water-related route files
5. **Нет WebSocket:** отсутствует real-time push (только polling)
6. **Два вида трансформаторов:** `transformers` (serial PK) и `power_transformers` (varchar PK) — legacy дублирование
7. **Frontend redesign** не завершён — два параллельных фронтенда
8. **Нет TypeScript** — отсутствует статическая типизация

---

## 12. Структура файлов проекта

```
/
├── src/
│   ├── server.js              # Express app, middleware, graceful shutdown
│   ├── index.js               # Entry point
│   ├── config/                # Database pool config
│   ├── routes/                # 12 route files
│   │   ├── index.js           # Main router (default-deny JWT)
│   │   ├── authRoutes.js
│   │   ├── buildingRoutes.js
│   │   ├── controllerRoutes.js
│   │   ├── metricRoutes.js
│   │   ├── analyticsRoutes.js
│   │   ├── alertRoutes.js
│   │   ├── adminRoutes.js
│   │   ├── powerAnalyticsRoutes.js
│   │   ├── webhookRoutes.js
│   │   ├── integrationRoutes.js
│   │   └── ... (water, heat, transformers, lines)
│   ├── controllers/           # HTTP handlers
│   ├── services/              # Business logic
│   │   ├── cacheService.js
│   │   ├── analyticsService.js
│   │   ├── alertService.js
│   │   ├── ukIntegrationService.js
│   │   └── ...
│   ├── models/                # SQL queries (pg Pool)
│   │   ├── Building.js
│   │   ├── Controller.js
│   │   ├── Metric.js
│   │   ├── IntegrationConfig.js
│   │   ├── IntegrationLog.js
│   │   ├── AlertRule.js
│   │   ├── AlertRequestMap.js
│   │   └── ...
│   ├── middleware/
│   │   ├── auth.js            # JWT + admin + optional
│   │   ├── rateLimiter.js     # 7 rate limiters
│   │   ├── correlationId.js
│   │   ├── errorHandler.js
│   │   └── validators.js
│   ├── utils/
│   │   ├── circuitBreaker.js
│   │   ├── apiResponse.js
│   │   ├── queryValidation.js
│   │   └── webhookValidation.js
│   └── clients/
│       └── ukApiClient.js     # UK API JWT client
├── database/
│   ├── init/
│   │   ├── 01_init_database.sql
│   │   └── 02_seed_data.sql
│   └── migrations/            # 003-011
├── public/                    # Legacy frontend assets
├── css/                       # Legacy frontend styles
├── frontend-design/           # New frontend (WIP)
├── generator/                 # Test data generator
├── tests/
│   ├── jest/
│   │   ├── unit/ (98 files)
│   │   ├── integration/ (2 files)
│   │   ├── security/ (3 files)
│   │   └── e2e/ (13 files)
│   ├── smoke/, load/, orchestrator/
│   └── config/
├── nginx.conf, nginx.production.conf
├── docker-compose.dev.yml, docker-compose.prod.yml, docker-compose.unified.yml
├── Dockerfile.*, Dockerfile.frontend.*
├── swagger/                   # API documentation
├── docs/                      # Project documentation
│   ├── SOT.md                 # THIS FILE
│   ├── superpowers/specs/     # Design specs
│   ├── superpowers/plans/     # Implementation plans
│   ├── archive/               # Obsolete docs
│   └── ...
├── .github/workflows/ci.yml  # CI pipeline
├── package.json
├── CLAUDE.md
├── README.md
└── QUICK-START.md
```

---

## 13. Документация проекта — индекс

### Корневые документы
| Файл | Назначение |
|------|-----------|
| `README.md` | Общее описание проекта, быстрый старт |
| `QUICK-START.md` | Краткое руководство по запуску |
| `CLAUDE.md` | Контекст для AI-ассистента |
| `PROJECT_CONTEXT.md` | Подробный сгенерированный контекст |
| `.env.example` | Шаблон переменных окружения |

### docs/
| Файл | Назначение |
|------|-----------|
| `SOT.md` | **Single Source of Truth (этот документ)** |
| `INDEX.md` | Индекс документации |
| `API_AUTH_MATRIX.md` | Матрица авторизации API |
| `POWER-ANALYTICS-API.md` | API энергоаналитики |
| `ARCHITECTURE_ANALYSIS.md` | Архитектурный анализ |
| `systemPatterns.md` | Паттерны системы |
| `DEVELOPMENT_DOCKER_GUIDE.md` | Docker для разработки |
| `PRODUCTION-DEPLOYMENT.md` | Развёртывание в production |
| `PRODUCTION_SETUP.md` | Настройка production |
| `GENERATOR.md` | Генератор тестовых данных |

### docs/superpowers/specs/
| Файл | Назначение |
|------|-----------|
| `2026-03-22-admin-panel-full-fix-design.md` | Спека редизайна админ-панели |
| `2026-03-23-infrasafe-uk-integration-design.md` | Спека UK-интеграции v1 |
| `2026-03-24-infrasafe-uk-integration-v2-design.md` | Спека UK-интеграции v2 (актуальная) |

### docs/superpowers/plans/
17 планов реализации, включая UK-интеграцию (5 фаз), CI/CD, production readiness, E2E-тесты, фронтенд-улучшения.

---

## 14. Безопасность — чеклист

- [x] JWT аутентификация с refresh token и blacklist
- [x] Account lockout (5 попыток = 15 мин)
- [x] bcrypt hashing (12 salt rounds)
- [x] Rate limiting на всех эндпоинтах (7 лимитеров)
- [x] HMAC-SHA256 webhook verification с replay protection
- [x] Input validation (express-validator)
- [x] XSS prevention (DOMPurify frontend, sanitization backend)
- [x] SQL injection prevention (parameterized queries + whitelist validation)
- [x] CORS configuration
- [x] Helmet.js (CSP, X-Frame-Options, HSTS)
- [x] Correlation ID для трейсинга
- [x] Секреты только в ENV (не в коде, не в БД)
- [x] Timing-safe comparison для HMAC
- [x] Graceful shutdown
- [x] Error handler не раскрывает stack traces в production
- [x] Default-deny JWT (все маршруты закрыты по умолчанию)

---

*Документ сформирован автоматически на основе аудита всех файлов проекта. Для обновления — выполнить повторный аудит.*
