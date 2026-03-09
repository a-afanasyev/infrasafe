
# Техническое задание: InfraSafe Habitat IQ

**Версия документа:** 1.0
**Дата создания:** 2026-03-07
**Статус:** Актуальное
**Версия системы:** 1.0.1
**Лицензия:** Apache-2.0

---

## Содержание

1. [Общие сведения](#1-общие-сведения)
2. [Описание предметной области](#2-описание-предметной-области)
3. [Технологический стек](#3-технологический-стек)
4. [Архитектура системы](#4-архитектура-системы)
5. [Функциональные требования](#5-функциональные-требования)
6. [Модель данных](#6-модель-данных)
7. [API и интерфейсы](#7-api-и-интерфейсы)
8. [Frontend: страницы и компоненты](#8-frontend-страницы-и-компоненты)
9. [Аутентификация и авторизация](#9-аутентификация-и-авторизация)
10. [Бизнес-логика](#10-бизнес-логика)
11. [Нефункциональные требования](#11-нефункциональные-требования)
12. [Конфигурация и развертывание](#12-конфигурация-и-развертывание)
13. [Тестирование](#13-тестирование)
14. [Генератор данных](#14-генератор-данных)
15. [Диаграммы потоков данных](#15-диаграммы-потоков-данных)
16. [Известные ограничения и технический долг](#16-известные-ограничения-и-технический-долг)

---

## 1. Общие сведения

### 1.1 Название проекта

**InfraSafe Habitat IQ** -- цифровая IoT-платформа мониторинга инженерных систем многоквартирных жилых домов.

### 1.2 Назначение и цели системы

Система предназначена для непрерывного дистанционного мониторинга состояния инженерной инфраструктуры жилых зданий: электроснабжения, холодного и горячего водоснабжения, отопления, а также параметров окружающей среды (температура, влажность, протечки).

Основные цели:

- Сбор телеметрических данных с интеллектуальных контроллеров (промышленных ПК с датчиками), установленных в зданиях
- Визуализация состояния объектов инфраструктуры на интерактивной карте в реальном времени
- Аналитика загрузки электрических трансформаторов, давления в водопроводных сетях, температурных режимов
- Автоматическое обнаружение аварийных ситуаций и оповещение (алерты)
- Прогнозирование пиковых нагрузок и предупреждение аварий

### 1.3 Целевая аудитория

- Управляющие компании многоквартирных домов
- Инженерные службы ЖКХ
- Диспетчерские службы энергоснабжающих организаций
- Администраторы городской инфраструктуры

### 1.4 Географический контекст

Текущая реализация ориентирована на город Ташкент (Узбекистан). Интерфейс на русском языке. Координаты по умолчанию: 41.2995, 69.2401.

---

## 2. Описание предметной области

### 2.1 Контекст

Многоквартирные жилые дома подключены к инженерным сетям: электрическим трансформаторам через линии электропередач, источникам холодного водоснабжения через водопроводные линии, источникам тепла (котельные, ТЭЦ). В каждом здании установлены интеллектуальные контроллеры с датчиками, которые замеряют параметры среды и передают телеметрию на сервер.

### 2.2 Бизнес-процессы

| # | Процесс | Описание |
|---|---------|----------|
| 1 | Сбор телеметрии | Контроллеры отправляют метрики каждые 2-5 минут через POST /api/metrics/telemetry |
| 2 | Визуализация на карте | Отображение зданий, трансформаторов, линий, источников воды/тепла на Leaflet карте |
| 3 | Мониторинг загрузки | Расчет процента загрузки трансформаторов, давления в водопроводе |
| 4 | Обнаружение аварий | Автоматическое сравнение метрик с пороговыми значениями, генерация алертов |
| 5 | Управление жизненным циклом алертов | Создание -> Подтверждение (acknowledge) -> Закрытие (resolve) |
| 6 | Административное управление | CRUD операции над всеми сущностями через админ-панель |
| 7 | Аналитика и прогнозирование | Расчет тенденций, прогноз пиковых нагрузок |

---

## 3. Технологический стек

### 3.1 Backend

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Runtime | Node.js | 18+ (Alpine) |
| Фреймворк | Express.js | 4.18.2 |
| БД драйвер | pg (node-postgres) | 8.11.3 |
| Аутентификация | jsonwebtoken | 9.0.2 |
| Хеширование | bcrypt | 5.1.1 |
| Валидация | express-validator | 7.2.1 |
| Логирование | winston | 3.11.0 |
| HTTP логирование | morgan | 1.10.0 |
| Безопасность | helmet | 7.1.0 |
| CORS | cors | 2.8.5 |
| API документация | swagger-jsdoc + swagger-ui-express | 6.2.8 / 5.0.0 |
| XSS защита (server) | dompurify | 3.2.7 |
| Env переменные | dotenv | 16.3.1 |

### 3.2 Frontend

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Язык | Vanilla JavaScript (ES6+) | - |
| Карта | Leaflet.js | встроена (public/libs/) |
| Кластеризация | leaflet.markercluster | встроена (public/libs/) |
| Графики | Chart.js | CDN |
| XSS защита | DOMPurify | 3.2.7 CDN |
| Шрифты | Inter, Roboto | Google Fonts |
| Тайлы карты | OpenStreetMap, ArcGIS Imagery | CDN |

### 3.3 База данных

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| СУБД | PostgreSQL | 15+ |
| Геопространственное расширение | PostGIS | 3.3 |
| SRID | WGS 84 | 4326 |

### 3.4 Инфраструктура

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Контейнеризация | Docker + Docker Compose | - |
| Reverse proxy | Nginx | Alpine |
| Оркестрация | Docker Compose | v3.8 |

### 3.5 Тестирование

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Test runner | Jest | 29.7.0 |
| HTTP assertions | Supertest | 6.3.3 |
| HTTP клиент (тесты) | Axios | 1.11.0 |
| Линтер | ESLint | 8.56.0 |
| Hot reload | Nodemon | 3.0.2 |

---

## 4. Архитектура системы

### 4.1 Общая архитектура

```
+----------------------------------------------------------------+
|                        КЛИЕНТ (Браузер)                         |
|  +--------------+  +--------------+  +--------------------+    |
|  |  index.html   |  |  admin.html  |  |  analytics/        |    |
|  |  (Leaflet     |  |  (CRUD       |  |  index.html        |    |
|  |   карта)      |  |   админка)   |  |  (Chart.js)        |    |
|  +------+-------+  +------+-------+  +--------+-----------+    |
|         |                 |                    |                |
+---------+-----------------+--------------------+----------------+
          |                 |                    |
          v                 v                    v
+-----------------------------------------------------------------+
|                    NGINX (порт 8080)                             |
|  +--------------------+  +----------------------------------+   |
|  |  Статические файлы  |  |  /api/* -> proxy_pass app:3000   |   |
|  |  HTML, CSS, JS      |  |  Security headers, Gzip, Cache   |   |
|  +--------------------+  +----------------------------------+   |
+---------------------------------+-------------------------------+
                                  |
                                  v
+-----------------------------------------------------------------+
|                   EXPRESS.JS (порт 3000)                         |
|                                                                  |
|  Middleware chain:                                                |
|  helmet -> cors -> json -> morgan -> static -> routes -> error   |
|                                                                  |
|  +----------------+  +----------------+  +----------------+     |
|  |  Controllers   |->|   Services     |->|    Models       |     |
|  |  (HTTP layer)  |  |  (Business     |  |  (SQL queries   |     |
|  |                |  |   logic)       |  |   via pg Pool)  |     |
|  +----------------+  +----------------+  +-------+--------+     |
|                                                   |              |
+---------------------------------------------------+--------------+
                                                    |
                                                    v
+-----------------------------------------------------------------+
|              POSTGRESQL 15 + PostGIS (порт 5432/5435)           |
|                                                                  |
|  Таблицы: users, buildings, controllers, metrics, alerts, ...    |
|  Materialized views: mv_transformer_load_realtime                |
|  Функции: 10+, Триггеры: 12+, Индексы: 35+                     |
|  Партиционирование: analytics_history по месяцам                 |
+-----------------------------------------------------------------+
```

### 4.2 Трехслойная архитектура backend

```
src/
├── controllers/          # Слой 1: HTTP обработка, валидация, форматирование ответа
│   ├── alertController.js
│   ├── analyticsController.js
│   ├── authController.js
│   ├── buildingController.js
│   ├── buildingMetricsController.js
│   ├── controllerController.js
│   ├── lineController.js
│   ├── metricController.js
│   ├── powerAnalyticsController.js
│   ├── transformerController.js
│   └── adminController.js
│
├── services/             # Слой 2: Бизнес-логика, кэширование, circuit breaker
│   ├── alertService.js
│   ├── analyticsService.js
│   ├── authService.js
│   ├── buildingService.js
│   ├── cacheService.js
│   ├── controllerService.js
│   └── metricService.js
│
├── models/               # Слой 3: SQL запросы через pg Pool (без ORM)
│   ├── Alert.js
│   ├── AlertType.js
│   ├── Building.js
│   ├── Controller.js
│   ├── Line.js
│   ├── Metric.js
│   ├── PowerTransformer.js
│   ├── Transformer.js
│   ├── WaterLine.js
│   └── WaterSupplier.js
│
├── routes/               # Маршрутизация
│   ├── index.js           # Главный роутер
│   ├── adminRoutes.js
│   ├── alertRoutes.js
│   ├── analyticsRoutes.js
│   ├── authRoutes.js
│   ├── buildingMetricsRoutes.js
│   ├── buildingRoutes.js
│   ├── controllerRoutes.js
│   ├── heatSourceRoutes.js
│   ├── lineRoutes.js
│   ├── metricRoutes.js
│   ├── powerAnalyticsRoutes.js
│   ├── transformerRoutes.js
│   ├── waterLineRoutes.js
│   ├── waterSourceRoutes.js
│   └── waterSupplierRoutes.js
│
├── middleware/            # Промежуточные обработчики
│   ├── auth.js            # JWT аутентификация + isAdmin
│   ├── errorHandler.js    # Централизованная обработка ошибок
│   ├── rateLimiter.js     # Rate limiting (in-memory)
│   └── validators.js      # express-validator правила
│
├── utils/                 # Утилиты
│   ├── circuitBreaker.js  # Circuit Breaker pattern
│   ├── helpers.js         # Вспомогательные функции
│   ├── logger.js          # Winston логирование
│   └── queryValidation.js # Защита от SQL injection
│
├── config/
│   └── database.js        # PostgreSQL Pool конфигурация
│
├── server.js              # Express app setup, middleware chain
└── index.js               # Точка входа
```

### 4.3 Поток запроса

```
Клиент (браузер)
    |
    v
Nginx (8080) ---- Статические файлы (HTML, CSS, JS)
    |
    | /api/* -> proxy_pass
    v
Express (3000)
    |
    +-- helmet() --- Security headers
    +-- cors() ----- CORS policy
    +-- json() ----- Body parsing (limit: 1mb)
    +-- morgan() --- HTTP logging
    |
    v
src/routes/index.js (главный роутер)
    |
    +-- GET /api/health --- Публичный healthcheck
    +-- POST /api/metrics/telemetry --- Публичный (без auth)
    |
    +-- /api/auth/* --- Без JWT проверки
    |   +-- POST /login
    |   +-- POST /register
    |   +-- POST /refresh
    |   +-- POST /logout
    |
    +-- authenticateJWT middleware (для остальных)
    |   +-- GET --- Публичные (без токена)
    |   +-- POST/PUT/DELETE --- Требуют Bearer token
    |
    +-- Роуты -> Controllers -> Services -> Models -> PostgreSQL
```

---

## 5. Функциональные требования

### 5.1 Модуль "Здания" (Buildings)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/buildings | Список зданий с пагинацией и сортировкой |
| GET | /api/buildings/:id | Детали здания с контроллерами |
| POST | /api/buildings | Создание здания |
| PUT | /api/buildings/:id | Обновление здания |
| DELETE | /api/buildings/:id | Удаление здания (проверка связанных контроллеров) |
| GET | /api/buildings/radius?lat&lng&radius | Поиск зданий в радиусе (PostGIS) |
| GET | /api/buildings/statistics | Статистика зданий |

**Поля здания:** name, address, town, latitude, longitude, region, management_company, has_hot_water, связи с трансформаторами, линиями, поставщиками воды.

### 5.2 Модуль "Контроллеры" (Controllers)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/controllers | Список контроллеров с пагинацией |
| GET | /api/controllers/:id | Детали контроллера |
| GET | /api/controllers/building/:buildingId | Контроллеры здания |
| GET | /api/controllers/:id/metrics | Метрики контроллера |
| POST | /api/controllers | Создание контроллера |
| PUT | /api/controllers/:id | Обновление контроллера |
| PATCH | /api/controllers/:id/status | Обновление статуса |
| DELETE | /api/controllers/:id | Удаление контроллера |
| POST | /api/controllers/update-status | Массовое обновление статусов по активности |
| GET | /api/controllers/statistics | Статистика контроллеров |

**Статусы контроллеров:** online, offline, maintenance. Автоматический переход в offline при отсутствии heartbeat > 10 минут.

### 5.3 Модуль "Метрики" (Metrics)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/metrics | Список метрик с пагинацией |
| GET | /api/metrics/:id | Детали метрики |
| GET | /api/metrics/last | Последние метрики всех контроллеров |
| GET | /api/metrics/controller/:id | Метрики по контроллеру (с фильтрацией по датам) |
| POST | /api/metrics | Создание метрики (с обнаружением аномалий) |
| POST | /api/metrics/telemetry | **Публичный** прием телеметрии от контроллеров |
| DELETE | /api/metrics/:id | Удаление метрики |
| GET | /api/metrics/aggregated/:controllerId | Агрегированные метрики |
| DELETE | /api/metrics/cleanup | Очистка старых метрик |

**Параметры метрики:**
- Электричество: electricity_ph1/ph2/ph3 (В)
- Ток: amperage_ph1/ph2/ph3 (А)
- Холодная вода: cold_water_pressure (бар), cold_water_temp (C)
- Горячая вода: hot_water_in/out_pressure (бар), hot_water_in/out_temp (C)
- Окружение: air_temp (C), humidity (%), leak_sensor (boolean)

### 5.4 Модуль "Аналитика" (Analytics)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/analytics/transformer/:id | Загрузка трансформатора |
| GET | /api/analytics/transformers | Все трансформаторы с аналитикой |
| GET | /api/analytics/overloaded | Перегруженные трансформаторы |
| GET | /api/analytics/radius | Трансформаторы в радиусе |
| GET | /api/analytics/nearest/:id | Ближайшие здания к трансформатору |
| GET | /api/analytics/zones | Аналитика по зонам |
| GET | /api/analytics/forecast/:id | Прогноз пиковой нагрузки |
| GET | /api/analytics/statistics | Общая статистика |
| POST | /api/analytics/refresh | Обновление materialized views |
| POST | /api/analytics/invalidate-caches | Инвалидация кэшей |
| GET | /api/analytics/status | Статус circuit breakers |
| POST | /api/analytics/reset-breakers | Сброс circuit breakers |
| PUT | /api/analytics/thresholds | Обновление пороговых значений |
| POST | /api/analytics/transformers | Создание трансформатора |
| PUT | /api/analytics/transformers/:id | Обновление трансформатора |
| DELETE | /api/analytics/transformers/:id | Удаление трансформатора |

Все аналитические операции защищены Circuit Breaker pattern с fallback-данными.

### 5.5 Модуль "Алерты" (Alerts)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/alerts | Активные алерты с фильтрацией |
| POST | /api/alerts | Создание алерта |
| PATCH | /api/alerts/:id/acknowledge | Подтверждение алерта |
| PATCH | /api/alerts/:id/resolve | Закрытие алерта |
| POST | /api/alerts/check/:transformerId | Проверка трансформатора |
| POST | /api/alerts/check-all | Проверка всех трансформаторов |
| GET | /api/alerts/statistics | Статистика алертов |
| GET | /api/alerts/thresholds | Пороговые значения |
| PUT | /api/alerts/thresholds | Обновление порогов |
| GET | /api/alerts/status | Системный статус |

**Жизненный цикл алерта:** active -> acknowledged -> resolved

**Типы severity:** INFO, WARNING, CRITICAL

**Cooldown:** 15 минут между одинаковыми алертами для предотвращения спама.

### 5.6 Модуль "Аутентификация" (Auth)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| POST | /api/auth/login | Вход (username/email + password) |
| POST | /api/auth/register | Регистрация нового пользователя |
| POST | /api/auth/refresh | Обновление access token |
| POST | /api/auth/logout | Выход (blacklist токена) |
| GET | /api/auth/profile | Профиль текущего пользователя |
| PUT | /api/auth/change-password | Смена пароля |

### 5.7 Модуль "Администрирование" (Admin)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/admin/buildings | Оптимизированный список зданий |
| GET | /api/admin/controllers | Оптимизированный список контроллеров |
| POST | /api/admin/controllers/bulk-status | Массовое обновление статусов |
| DELETE | /api/admin/controllers/bulk-delete | Массовое удаление |
| GET | /api/admin/health | Статус системы |
| GET | /api/admin/export | Экспорт данных |

### 5.8 Модуль "Трансформаторы" (Transformers)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/transformers | Список трансформаторов |
| GET | /api/transformers/:id | Детали трансформатора |
| POST | /api/transformers | Создание трансформатора |
| PUT | /api/transformers/:id | Обновление |
| DELETE | /api/transformers/:id | Удаление |
| GET | /api/transformers/building/:id | Трансформаторы здания |

### 5.9 Модуль "Линии электропередач" (Lines)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/lines | Список линий |
| GET | /api/lines/:id | Детали линии |
| POST | /api/lines | Создание (с JSONB main_path и branches) |
| PUT | /api/lines/:id | Обновление |
| DELETE | /api/lines/:id | Удаление |
| GET | /api/lines/transformer/:id | Линии трансформатора |

### 5.10 Модули водоснабжения

**Источники холодной воды (Cold Water Sources):** CRUD через /api/cold-water-sources

**Источники тепла (Heat Sources):** CRUD через /api/heat-sources

**Водопроводные линии (Water Lines):** CRUD через /api/water-lines (с JSONB main_path/branches)

**Поставщики воды (Water Suppliers):** CRUD через /api/water-suppliers

### 5.11 Модуль "Карта и агрегация" (Buildings-Metrics)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/buildings-metrics | Агрегированные данные для карты (здания + последние метрики) |

### 5.12 Модуль "Аналитика электроэнергии" (Power Analytics)

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /api/power-analytics/... | Расширенные аналитические эндпоинты для расчета мощности |

---

## 6. Модель данных

### 6.1 ER-диаграмма (текстовая)

```
                         +---------------+
                         |    users      |
                         |---------------|
                         | user_id (PK)  |
                         | username      |
                         | email         |
                         | password_hash |
                         | role          |
                         | is_active     |
                         +-------+-------+
                                 |
                    +------------+------------+
                    |            |            |
            +-------v-------+   |   +--------v--------+
            |refresh_tokens |   |   | token_blacklist  |
            |---------------|   |   |-----------------|
            | token_id (PK) |   |   | id (PK)         |
            | user_id (FK)  |   |   | token_hash      |
            | token_hash    |   |   | expires_at       |
            | expires_at    |   |   | blacklisted_at   |
            +---------------+   |   +-----------------+
                                |
                                |
       +------------------------v--------------------------+
       |                   buildings                        |
       |----------------------------------------------------+
       | building_id (PK)                                   |
       | name, address, town, latitude, longitude           |
       | region, management_company, has_hot_water           |
       | geom (PostGIS POINT)                               |
       | power_transformer_id (FK->power_transformers)      |
       | cold_water_source_id (FK->cold_water_sources)      |
       | heat_source_id (FK->heat_sources)                  |
       | primary_transformer_id (FK->transformers)          |
       | primary_line_id (FK->lines)                        |
       | cold_water_line_id (FK->water_lines)               |
       | cold_water_supplier_id (FK->water_suppliers)       |
       +------------------------+---------------------------+
                                |
                       +--------v--------+
                       |  controllers    |
                       |----------------|
                       | controller_id   |
                       | serial_number   |
                       | building_id(FK) |
                       | status          |
                       | last_heartbeat  |
                       +--------+-------+
                                |
                       +--------v--------+
                       |    metrics      |
                       |----------------|
                       | metric_id (PK)  |
                       | controller_id   |
                       | timestamp       |
                       | electricity_*   |
                       | amperage_*      |
                       | water_*         |
                       | air_temp        |
                       | humidity        |
                       | leak_sensor     |
                       +----------------+


  +------------------+  +-------------------------+
  |  transformers    |  |  power_transformers      |
  |  (new system)    |  |  (legacy)                |
  |------------------|  |-------------------------|
  | transformer_id   |  | id (varchar PK)         |
  | name, power_kva  |  | name, capacity_kva      |
  | voltage_kv       |  | voltage_primary/sec     |
  | lat, lng, geom   |  | lat, lng, geom          |
  +--------+---------+  +-------------------------+
           |
  +--------v---------+
  |     lines        |
  |------------------|
  | line_id (PK)     |
  | transformer_id   |
  | voltage_kv       |
  | length_km        |
  | main_path (JSONB)|
  | branches (JSONB) |
  | geom (LINESTRING)|
  +------------------+

  +------------------+  +------------------+
  | cold_water_      |  |  heat_sources    |
  | sources          |  |------------------|
  |------------------|  | id (varchar PK)  |
  | id (varchar PK)  |  | source_type      |
  | source_type      |  | capacity_mw      |
  | capacity_m3/hour |  | fuel_type        |
  | operating_pres.  |  | lat, lng, geom   |
  | lat, lng, geom   |  +------------------+
  +------------------+

  +------------------+  +------------------+
  |  water_lines     |  | water_suppliers  |
  |------------------|  |------------------|
  | line_id (PK)     |  | supplier_id (PK) |
  | diameter_mm      |  | supplier_type    |
  | material         |  | tariff_per_m3    |
  | pressure_bar     |  | contract_number  |
  | main_path (JSONB)|  | phone, email     |
  | branches (JSONB) |  +------------------+
  | geom (LINESTRING)|
  +------------------+

  +----------------------+  +------------------------------+
  |    alert_types       |  |  infrastructure_alerts       |
  |----------------------|  |------------------------------|
  | alert_type_id (PK)   |  | alert_id (PK)               |
  | type_name            |  | type, infrastructure_id      |
  | description          |  | infrastructure_type          |
  +----------+-----------+  | severity (INFO/WARN/CRIT)    |
             |              | status (active/ack/resolved) |
  +----------v-----------+  | message, data (JSONB)        |
  |     alerts (legacy)  |  | acknowledged_by (FK->users)  |
  |----------------------|  | resolved_by (FK->users)      |
  | alert_id (PK)        |  +------------------------------+
  | metric_id (FK)       |
  | alert_type_id (FK)   |
  | severity, status     |
  +----------------------+

  +-------------------------------------+
  |  analytics_history (PARTITIONED)    |
  |-------------------------------------|
  | id, analysis_type                   |
  | infrastructure_id, type             |
  | analysis_date (PARTITION KEY)       |
  | analysis_data (JSONB)               |
  | PRIMARY KEY (id, analysis_date)     |
  |                                     |
  | Партиции:                           |
  |  - analytics_history_current        |
  |  - analytics_history_prev           |
  +-------------------------------------+
```

### 6.2 Таблицы базы данных

#### 6.2.1 users (пользователи)

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| user_id | serial | PRIMARY KEY |
| username | varchar(50) | NOT NULL UNIQUE |
| email | varchar(100) | NOT NULL UNIQUE |
| password_hash | varchar(255) | NOT NULL |
| full_name | varchar(100) | |
| role | varchar(20) | DEFAULT 'user' ('admin', 'operator', 'user') |
| is_active | boolean | DEFAULT true |
| failed_login_attempts | integer | DEFAULT 0 |
| last_failed_login | timestamptz | |
| account_locked_until | timestamptz | |
| created_at | timestamptz | DEFAULT NOW() |
| updated_at | timestamptz | DEFAULT NOW() |
| last_login | timestamptz | |

Индексы: idx_users_username, idx_users_email, idx_users_role, idx_users_active (partial WHERE is_active = true)

#### 6.2.2 buildings (здания)

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| building_id | serial | PRIMARY KEY |
| name | varchar(100) | NOT NULL |
| address | text | NOT NULL |
| town | varchar(100) | NOT NULL |
| latitude | numeric(9,6) | NOT NULL |
| longitude | numeric(9,6) | NOT NULL |
| region | varchar(50) | |
| management_company | varchar(100) | |
| has_hot_water | boolean | DEFAULT false |
| geom | geometry(POINT, 4326) | Автоматически через триггер |
| power_transformer_id | varchar(50) | FK -> power_transformers.id |
| cold_water_source_id | varchar(50) | FK -> cold_water_sources.id |
| heat_source_id | varchar(50) | FK -> heat_sources.id |
| primary_transformer_id | integer | FK -> transformers.transformer_id |
| backup_transformer_id | integer | FK -> transformers.transformer_id |
| primary_line_id | integer | FK -> lines.line_id |
| backup_line_id | integer | FK -> lines.line_id |
| cold_water_line_id | integer | FK -> water_lines.line_id |
| hot_water_line_id | integer | FK -> water_lines.line_id |
| cold_water_supplier_id | integer | FK -> water_suppliers.supplier_id |
| hot_water_supplier_id | integer | FK -> water_suppliers.supplier_id |

Индексы: idx_buildings_town, idx_buildings_geom (GIST), idx_buildings_name, idx_buildings_region, idx_buildings_management_company

#### 6.2.3 controllers (контроллеры)

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| controller_id | serial | PRIMARY KEY |
| serial_number | varchar(50) | NOT NULL UNIQUE |
| vendor | varchar(50) | |
| model | varchar(50) | |
| building_id | integer | FK -> buildings.building_id |
| status | varchar(20) | NOT NULL |
| installed_at | timestamptz | DEFAULT now() |
| last_heartbeat | timestamptz | |

Индексы: idx_controllers_building, idx_controllers_status, idx_controllers_heartbeat, idx_controllers_serial

#### 6.2.4 metrics (метрики)

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| metric_id | bigserial | PRIMARY KEY |
| controller_id | integer | FK -> controllers.controller_id |
| timestamp | timestamptz | NOT NULL |
| electricity_ph1 | numeric(6,2) | |
| electricity_ph2 | numeric(6,2) | |
| electricity_ph3 | numeric(6,2) | |
| amperage_ph1 | numeric(6,2) | |
| amperage_ph2 | numeric(6,2) | |
| amperage_ph3 | numeric(6,2) | |
| cold_water_pressure | numeric(5,2) | |
| cold_water_temp | numeric(5,2) | |
| hot_water_in_pressure | numeric(5,2) | |
| hot_water_out_pressure | numeric(5,2) | |
| hot_water_in_temp | numeric(5,2) | |
| hot_water_out_temp | numeric(5,2) | |
| air_temp | numeric(5,2) | |
| humidity | numeric(5,2) | |
| leak_sensor | boolean | |

Индексы: idx_metrics_controller, idx_metrics_timestamp, idx_metrics_leak (partial WHERE leak_sensor = true), idx_metrics_ctrl_ts (составной: controller_id, timestamp DESC)

#### 6.2.5 transformers (трансформаторы)

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| transformer_id | serial | PRIMARY KEY |
| name | varchar(255) | NOT NULL |
| power_kva | decimal(10,2) | NOT NULL CHECK > 0 |
| voltage_kv | decimal(10,2) | NOT NULL CHECK > 0 |
| location | varchar(255) | |
| latitude | numeric(9,6) | |
| longitude | numeric(9,6) | |
| geom | geometry(POINT, 4326) | |
| installation_date | date | |
| manufacturer | varchar(100) | |
| model | varchar(100) | |
| status | varchar(20) | DEFAULT 'active' |

Индексы: idx_transformers_name, idx_transformers_power, idx_transformers_voltage, idx_transformers_status, idx_transformers_geom (GIST), idx_transformers_coordinates (составной, partial)

#### 6.2.6 lines (линии электропередач)

| Колонка | Тип | Ограничения |
|---------|-----|-------------|
| line_id | serial | PRIMARY KEY |
| name | varchar(255) | NOT NULL |
| voltage_kv | decimal(10,2) | NOT NULL CHECK > 0 |
| length_km | decimal(10,3) | NOT NULL CHECK > 0 |
| transformer_id | integer | FK -> transformers ON DELETE CASCADE |
| latitude_start/end | numeric(9,6) | |
| longitude_start/end | numeric(9,6) | |
| main_path | jsonb | Массив [{lat, lng, order, description}] |
| branches | jsonb | DEFAULT '[]' |
| cable_type | varchar(100) | |
| commissioning_year | integer | CHECK >= 1900 AND <= 2100 |
| geom | geometry(LINESTRING, 4326) | |

Индексы: idx_lines_transformer_id, idx_lines_name, idx_lines_voltage, idx_lines_geom (GIST), idx_lines_main_path (GIN), idx_lines_branches (GIN)

#### 6.2.7 Таблицы водоснабжения

**water_lines** -- аналогичная структура lines, но с полями diameter_mm, material, pressure_bar.

**water_suppliers** -- поставщики: supplier_type (cold_water/hot_water/both), tariff_per_m3, contract_number.

**cold_water_sources** -- источники: source_type (pumping_station/well/reservoir), capacity_m3_per_hour, operating_pressure_bar.

**heat_sources** -- источники тепла: source_type (boiler_house/heat_plant/chp), capacity_mw, fuel_type.

**water_measurement_points** -- точки измерения: point_type (cold_water/hot_water_supply/hot_water_return).

#### 6.2.8 Таблицы оповещений

**alert_types** -- 7 предустановленных типов.

**alerts** (legacy) -- связаны с метриками через metric_id.

**infrastructure_alerts** -- современная система: type, infrastructure_id, infrastructure_type, severity, status, message, data (JSONB), acknowledged_by/resolved_by (FK -> users).

#### 6.2.9 analytics_history (партиционированная)

Партиционирование по RANGE(analysis_date). Партиции: analytics_history_current (текущий месяц), analytics_history_prev (предыдущий месяц).

### 6.3 Материализованное представление

**mv_transformer_load_realtime** -- агрегированные данные загрузки трансформаторов:
- Количество зданий и контроллеров
- Средние значения напряжения и тока
- Процент загрузки (load_percent)
- Время последней метрики
- Количество метрик за последние 24 часа

Обновляется через `REFRESH MATERIALIZED VIEW CONCURRENTLY`.

### 6.4 Функции базы данных (10+)

| Функция | Описание |
|---------|----------|
| update_geom_on_coordinates_change() | Синхронизация PostGIS geometry при изменении lat/lng |
| update_controller_heartbeat() | Обновление last_heartbeat при вставке метрики |
| update_updated_at_column() | Автоматическое обновление updated_at |
| convert_line_endpoints_to_path() | Конвертация start/end координат в JSONB main_path |
| update_line_geom_from_path() | Построение LINESTRING из main_path |
| update_transformers_geom() | Синхронизация геометрии трансформаторов |
| update_water_lines_geom_from_coordinates() | Построение geom для water_lines |
| refresh_transformer_analytics() | Обновление materialized view |
| find_nearest_buildings_to_transformer() | Поиск ближайших зданий в радиусе (PostGIS) |
| archive_daily_analytics() | Архивирование аналитики в analytics_history |

### 6.5 Триггеры (12+)

| Триггер | Таблица | Событие | Функция |
|---------|---------|---------|---------|
| trig_buildings_geom | buildings | BEFORE INSERT/UPDATE lat,lng | update_geom_on_coordinates_change |
| trig_transformers_geom | transformers | BEFORE INSERT/UPDATE lat,lng | update_transformers_geom |
| trig_power_transformers_geom | power_transformers | BEFORE INSERT/UPDATE lat,lng | update_geom_on_coordinates_change |
| trig_cold_water_sources_geom | cold_water_sources | BEFORE INSERT/UPDATE lat,lng | update_geom_on_coordinates_change |
| trig_heat_sources_geom | heat_sources | BEFORE INSERT/UPDATE lat,lng | update_geom_on_coordinates_change |
| trig_update_heartbeat | metrics | AFTER INSERT | update_controller_heartbeat |
| trigger_transformers_updated_at | transformers | BEFORE UPDATE | update_updated_at_column |
| trigger_lines_updated_at | lines | BEFORE UPDATE | update_updated_at_column |
| trigger_water_lines_updated_at | water_lines | BEFORE UPDATE | update_updated_at_column |
| trig_lines_convert_endpoints | lines | BEFORE INSERT/UPDATE | convert_line_endpoints_to_path |
| trig_lines_update_geom | lines | BEFORE INSERT/UPDATE | update_line_geom_from_path |
| trig_water_lines_geom_from_coordinates | water_lines | BEFORE INSERT/UPDATE lat coords | update_water_lines_geom_from_coordinates |

### 6.6 Миграции

| Файл | Описание |
|------|----------|
| 003_power_calculation_system.sql | Функции расчета мощности |
| 004_add_coordinates_and_extended_fields.sql | Координаты и PostGIS для transformers/lines |
| 005_add_paths_to_lines.sql | JSONB main_path и branches для lines |
| 006_cleanup_infrastructure_lines.sql | Миграция water_lines, удаление legacy infrastructure_lines |
| 007_add_metrics_compound_index.sql | Составной индекс idx_metrics_ctrl_ts |
| 008_remove_duplicate_hot_water.sql | Удаление дублирующей колонки hot_water |

---

## 7. API и интерфейсы

### 7.1 Формат ответа API

**Успешный ответ:**
```json
{
  "data": { },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

**Ответ с ошибкой:**
```json
{
  "error": {
    "message": "Описание ошибки",
    "status": 400
  }
}
```

### 7.2 Коды ответов

| Код | Значение |
|-----|----------|
| 200 | Успех |
| 201 | Создано |
| 400 | Ошибка валидации |
| 401 | Не авторизован |
| 403 | Доступ запрещен |
| 404 | Не найдено |
| 429 | Слишком много запросов |
| 500 | Внутренняя ошибка сервера |

### 7.3 Пагинация

Все списковые эндпоинты поддерживают:
- `page` (default: 1)
- `limit` (default: 20, max: 200)
- `sort` (whitelist допустимых колонок)
- `order` (ASC/DESC)

### 7.4 Swagger документация

Доступна по адресу `/api-docs` (только в development режиме, отключена в production).

---

## 8. Frontend: страницы и компоненты

### 8.1 Список страниц

| Файл | Назначение |
|------|-----------|
| index.html | Главная страница с интерактивной картой Leaflet |
| admin.html | Панель администратора (CRUD для всех сущностей) |
| about.html | Страница "О системе" |
| contacts.html | Контактная информация |
| documentation.html | Документация (заглушка) |
| public/login.html | Страница входа в админку |
| public/analytics/index.html | Аналитика энергопотребления с Chart.js |

### 8.2 JavaScript модули

#### script.js (~1400 строк) -- Основной скрипт карты

- **Переключение темы** (light/dark) с сохранением в localStorage
- **Баннер тестовых данных** со скрытием и запоминанием
- **API Client** класс с JWT токенами
- **Инициализация Leaflet карты** (центр: Ташкент 41.2995, 69.2401)
- **Управление слоями** через MapLayersControl
- **Real-time обновление** каждые 30 секунд
- **Безопасные popups** через DOMPurify

#### admin.js (~2300 строк) -- Логика админки

- CRUD операции для 8 сущностей: здания, контроллеры, трансформаторы, линии, водные линии, метрики, источники воды, источники тепла
- Таблицы с пагинацией (10 записей/страница)
- Фильтры и сортировка
- Batch операции (мультивыделение)
- Модальные окна редактирования
- Toast-уведомления
- XSS-безопасное создание ячеек таблицы

#### admin-auth.js (383 строки) -- Авторизация админки

- JWT аутентификация с localStorage
- Перехват fetch для добавления Authorization и CSRF заголовков
- Автоматический re-login при 401
- Модальная форма входа

#### map-layers-control.js (~800+ строк) -- Управление слоями карты

Слои:
- Базовые: OpenStreetMap, ArcGIS Satellite
- Оверлейные: Здания, Трансформаторы (с прогресс-кольцами загрузки), Линии электропередач, Источники воды, Линии водоснабжения, Источники тепла, Контроллеры, Алерты

Функциональность:
- Динамическая загрузка данных при включении слоя
- Счетчики объектов
- Маркер-кластеризация
- Цветовое кодирование по статусу

#### admin-coordinate-editor.js (~500+ строк)

Модальный редактор координат с мини-картой Leaflet для выбора точки кликом.

#### infrastructure-line-editor.js (~500+ строк)

Редактор линий с поддержкой main_path (точки изломов) и branches (ответвления). Мини-карта для визуализации.

### 8.3 Утилиты (public/utils/)

| Файл | Назначение |
|------|-----------|
| domSecurity.js | XSS защита: setSecureText, setSecureHTML, escapeHTML, sanitizePopupContent, validateToken |
| csrf.js | CSRF токены для защиты изменяющих запросов (POST/PUT/PATCH/DELETE) |
| safeJsonParser.js | Безопасный парсинг JSON с защитой от больших payload (лимит 1MB) |
| rateLimiter.js | Client-side rate limiting (10 запросов/минуту по умолчанию) |
| powerUtils.js | SVG прогресс-кольца для визуализации загрузки трансформаторов |

### 8.4 Стили

**css/style.css (~2000+ строк):**
- CSS-переменные для light/dark тем
- Neomorph эффект (мягкие тени)
- Glass morphism (размытие фона, полупрозрачность)
- Responsive дизайн (Flexbox + Grid)
- Анимации переходов
- Акцентный цвет: #00BFA5 (teal)

**public/css/map-layers.css:** Стили панели управления слоями карты.

**public/analytics/css/analytics.css:** Стили страницы аналитики.

### 8.5 CDN зависимости

| Библиотека | Версия | Использование |
|-----------|--------|---------------|
| DOMPurify | 3.2.7 | XSS защита |
| Leaflet.js | встроена | Интерактивная карта |
| Leaflet MarkerCluster | встроена | Кластеризация маркеров |
| Chart.js | CDN | Графики аналитики |
| Google Fonts (Inter, Roboto) | CDN | Типография |

---

## 9. Аутентификация и авторизация

### 9.1 JWT жизненный цикл

```
Клиент                           Сервер
  |                                 |
  |  POST /api/auth/login           |
  |  {username, password}           |
  +-------------------------------->|
  |                                 |  bcrypt.compare()
  |                                 |  checkAccountLockout()
  |  {accessToken, refreshToken}    |  generateTokens()
  |<--------------------------------+
  |                                 |
  |  GET /api/buildings             |
  |  Authorization: Bearer <token>  |
  +-------------------------------->|
  |                                 |  authenticateJWT()
  |                                 |  - Проверка blacklist
  |                                 |  - jwt.verify()
  |                                 |  - Проверка пользователя
  |  {data: [...]}                  |
  |<--------------------------------+
  |                                 |
  |  POST /api/auth/refresh         |
  |  {refreshToken}                 |
  +-------------------------------->|
  |                                 |  Проверка refresh token
  |  {accessToken, refreshToken}    |  Ротация токенов
  |<--------------------------------+
  |                                 |
  |  POST /api/auth/logout          |
  |  Authorization: Bearer <token>  |
  +-------------------------------->|
  |                                 |  Добавление в blacklist
  |  {message: "Logged out"}        |
  |<--------------------------------+
```

### 9.2 Конфигурация аутентификации

| Параметр | Значение |
|----------|----------|
| bcrypt salt rounds | 12 |
| Access token TTL | 24h (dev) / 15m (prod) |
| Refresh token TTL | 7d |
| Max login attempts | 5 |
| Lockout duration | 15 минут |
| Token blacklist | Хранение hash в БД |

### 9.3 Роли и доступ

| Роль | Описание | Доступ |
|------|----------|--------|
| admin | Администратор | Полный доступ ко всем операциям |
| operator | Оператор | Чтение + управление алертами |
| user | Обычный пользователь | Только чтение |

### 9.4 Политика доступа к маршрутам

| Маршрут | GET | POST/PUT/DELETE |
|---------|-----|-----------------|
| /api/auth/* | - | Публичный |
| /api/metrics/telemetry | - | Публичный (устройства) |
| /api/health | Публичный | - |
| /api/buildings, /api/controllers, ... | Публичный | Требует JWT |
| /api/admin/* | Требует JWT + admin | Требует JWT + admin |

### 9.5 Rate Limiting

| Пресет | Лимит | Окно |
|--------|-------|------|
| Общий | 100 запросов | 1 минута |
| Auth (login) | 5 попыток | 1 минута |
| Auth (register) | 3 регистрации | 1 день |
| Production | 100 запросов | 15 минут |

---

## 10. Бизнес-логика

### 10.1 Система алертов (InfrastructureAlertService)

#### Пороговые значения

| Параметр | Warning | Critical |
|----------|---------|----------|
| Загрузка трансформатора | > 85% | > 95% |
| Давление воды (низкое) | < 2.0 бар | < 1.5 бар |
| Дельта температуры отопления | < 15 C | < 10 C |

#### Cooldown механизм

Между алертами одного типа для одного объекта -- минимум **15 минут**. Предотвращает спам при флуктуации показателей вокруг порогового значения.

#### Жизненный цикл алерта

```
     Создание           Подтверждение          Закрытие
  +-----------+      +--------------+      +------------+
  |  ACTIVE   |----->| ACKNOWLEDGED |----->|  RESOLVED  |
  |           |      |              |      |            |
  | created_at|      | acknowledged_|      | resolved_at|
  |           |      | at, by       |      | by         |
  +-----------+      +--------------+      +------------+
```

### 10.2 Аналитический сервис (AnalyticsService)

#### Circuit Breaker

Три Circuit Breaker для разных операций:
- **transformerAnalyticsBreaker** -- расчеты загрузки трансформаторов
- **databaseBreaker** -- общие запросы к БД
- **materializedViewBreaker** -- обновление materialized views

**Состояния:**
```
         failureCount >= 5
  CLOSED ----------------------> OPEN
    ^                             |
    | 3 успешных запроса          | timeout 60s
    |                             v
    +------------------------ HALF_OPEN
```

**Параметры:**

| Параметр | Значение |
|----------|----------|
| Failure threshold | 5 ошибок |
| Reset timeout | 60 секунд |
| Success threshold (HALF_OPEN) | 3 успешных запроса |
| Monitoring interval | 10 секунд |

При срабатывании Circuit Breaker возвращаются fallback-данные (базовые/кэшированные).

#### Стратегия кэширования

```
Запрос
  |
  v
Memory Cache (TTL: 60s, max: 1000 items)
  | miss
  v
Redis (если доступен, TTL: 5 мин)
  | miss
  v
PostgreSQL (источник истины)
  |
  v
Сохранение в Memory + Redis
```

| Данные | TTL Memory | TTL Redis |
|--------|-----------|-----------|
| Аналитика трансформаторов | 60s | 5 мин |
| Список зданий | 300s | - |
| Детали здания | 300s | - |
| Список контроллеров | 300s | - |
| Все метрики | 60s | - |
| Последние метрики (realtime) | 30s | - |

### 10.3 Обнаружение аномалий (MetricService)

При создании метрики автоматически проверяются пороги:
- **Напряжение**: выход за пределы нормы
- **Ток**: превышение номинала
- **Температура**: экстремальные значения
- **Влажность**: выход за допустимый диапазон
- **Протечка**: leak_sensor = true -> немедленный алерт

### 10.4 Прогнозирование пиковых нагрузок

`getPeakLoadForecast(transformerId, forecastHours)` -- анализ исторических данных, расчет тренда, прогноз пиковой загрузки.

---

## 11. Нефункциональные требования

### 11.1 Производительность

| Метрика | Требование |
|---------|-----------|
| Время ответа API | < 200ms (p95) |
| Допустимая нагрузка | 100 запросов / 15 мин на IP |
| Период опроса карты | 30 секунд |
| Интервал телеметрии | 2-5 минут |
| Max JSON body | 1 MB |
| Max пагинация | 200 записей на страницу |

### 11.2 Безопасность

| Механизм | Реализация |
|----------|-----------|
| SQL Injection | Whitelist валидация sort/order, parameterized queries ($1 placeholders) |
| XSS | DOMPurify, setSecureText/setSecureHTML, sanitizePopupContent |
| CSRF | X-CSRF-Token заголовок для изменяющих запросов |
| Brute-force | Rate limiting + account lockout (5 попыток -> блокировка 15 мин) |
| Token hijacking | Blacklist при logout, проверка существования пользователя |
| Security headers | Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) |
| Непривилегированные пользователи | Все Docker контейнеры работают под non-root |

### 11.3 Надежность

| Механизм | Описание |
|----------|----------|
| Circuit Breaker | Защита от каскадных отказов при сбоях БД |
| Fallback данные | Возврат кэшированных данных при недоступности БД |
| Health checks | Docker + HTTP endpoint /api/health |
| Graceful shutdown | Обработка SIGTERM, закрытие подключений |
| Process handlers | uncaughtException -> log + exit, unhandledRejection -> log |

### 11.4 Масштабируемость

| Аспект | Текущая реализация | Готовность к масштабированию |
|--------|-------------------|----------------------------|
| Кэширование | In-memory | Redis-ready (код написан, нужен REDIS_URL) |
| БД подключения | pg Pool | Настраиваемый размер пула |
| Партиционирование | analytics_history | Можно добавить для metrics |
| Контейнеризация | Docker Compose | Готово к Kubernetes |

---

## 12. Конфигурация и развертывание

### 12.1 Переменные окружения

#### Обязательные

| Переменная | Описание | Пример |
|-----------|----------|--------|
| DB_HOST | Хост PostgreSQL | localhost / postgres |
| DB_PORT | Порт PostgreSQL | 5432 |
| DB_NAME | Имя базы данных | infrasafe |
| DB_USER | Пользователь БД | postgres |
| DB_PASSWORD | Пароль БД | postgres |
| JWT_SECRET | Секрет access token | 512-bit base64 |
| JWT_REFRESH_SECRET | Секрет refresh token | 512-bit base64 |

#### Опциональные

| Переменная | Описание | По умолчанию |
|-----------|----------|-------------|
| NODE_ENV | Окружение | development |
| PORT | Порт API | 3000 |
| CORS_ORIGINS | Разрешенные CORS origins | http://localhost:8080 |
| LOG_LEVEL | Уровень логирования | info |
| LOG_FILE | Файл лога | logs/app.log |
| REDIS_URL | URL Redis (опционально) | - |

#### Production-специфичные

| Переменная | Значение |
|-----------|----------|
| JWT_EXPIRES_IN | 15m |
| JWT_REFRESH_EXPIRES_IN | 7d |
| SWAGGER_ENABLED | false |
| RATE_LIMIT_WINDOW_MS | 900000 |
| MAX_REQUESTS | 100 |
| BCRYPT_ROUNDS | 12 |
| SECURE_COOKIES | true |
| TRUST_PROXY | true |

### 12.2 Docker Compose конфигурации

| Файл | Назначение | Сервисы |
|------|-----------|---------|
| docker-compose.dev.yml | Разработка (рекомендуется) | frontend, app, postgres |
| docker-compose.prod.yml | Production с лимитами ресурсов | frontend, app, postgres |
| docker-compose.generator.yml | Генератор тестовых данных | generator |
| docker-compose.unified.yml | Все вместе + опциональные | frontend, app, postgres |

### 12.3 Портовая карта

| Сервис | Порт контейнера | Порт хоста |
|--------|----------------|-----------|
| Nginx (frontend) | 8080 | 8080 |
| Express (app) | 3000 | 3000 |
| PostgreSQL | 5432 | 5435 (dev) |
| Генератор | 8081 | 8081 |
| Nginx production | 80, 443 | 80, 443 |

### 12.4 Nginx конфигурация

**Основные параметры:**
- Gzip сжатие (уровень 6) для JS, CSS, JSON, SVG
- Security headers: X-Frame-Options, X-Content-Type-Options, CSP, HSTS
- Кэширование статики: 12 часов
- Кэширование HTML/JSON: no-cache
- SPA fallback: try_files -> index.html
- Proxy для /api/ -> app:3000
- Server tokens: off (скрыта версия Nginx)
- Keep-alive: 65s, max 100 requests

### 12.5 Инициализация БД

При первом запуске Docker автоматически выполняются:
1. `database/init/01_init_database.sql` -- создание схемы (984 строки)
2. `database/init/02_seed_data.sql` -- тестовые данные (812 строк)

Миграции в `database/migrations/` выполняются вручную по необходимости.

### 12.6 Docker образы

| Образ | Base | Размер |
|-------|------|--------|
| Frontend | nginx:alpine | ~40 MB |
| Backend dev | node:18-alpine | ~150 MB |
| Backend prod | node:18-alpine (multi-stage) | ~120 MB |
| PostgreSQL | postgis/postgis:15-3.3 | ~300 MB |
| Generator | node:20-alpine (multi-stage) | ~120 MB |

### 12.7 Production лимиты ресурсов

| Сервис | CPU (limit/reserve) | Memory (limit/reserve) |
|--------|--------------------|-----------------------|
| Frontend | 0.5 / 0.1 | 128M / 64M |
| App | 1.0 / 0.5 | 512M / 256M |
| PostgreSQL | 2.0 / 1.0 | 1G / 512M |

---

## 13. Тестирование

### 13.1 Структура тестов

```
tests/
├── jest/
│   ├── setup.js                     # Global Jest setup (env, mocks)
│   ├── helpers/
│   │   └── testHelper.js            # ApiTestHelper, testUtils
│   ├── unit/
│   │   ├── alertService.test.js     # SQL injection protection
│   │   └── services.test.js         # Building/Controller/Metric services
│   ├── integration/
│   │   └── api.test.js              # API endpoints
│   ├── security/
│   │   ├── security.test.js         # General security
│   │   ├── sql-injection.test.js    # SQL injection vectors
│   │   └── xss-protection.test.js   # XSS protection audit
│   └── simple.test.js               # Smoke test
│
├── orchestrator/
│   └── unified-test-runner.sh       # Центральный оркестратор
│
├── config/
│   ├── unified-config.sh            # Bash конфигурация
│   └── test-config.json             # JSON конфигурация
│
├── utils/
│   ├── health-checker.sh            # Проверка готовности API
│   └── port-detector.js/sh          # Auto-detect API порт
│
├── smoke/
│   ├── run-smoke-tests.sh           # Базовые smoke тесты
│   └── smart-smoke-tests.sh         # Enhanced smoke тесты
│
├── load/
│   ├── run-load-tests.sh            # Базовые нагрузочные тесты
│   └── enhanced-load-tests.sh       # Расширенные нагрузочные тесты
│
├── bash/
│   ├── test_api.sh                  # Bash API тесты
│   ├── test_alerts_system.sh        # Тесты системы алертов
│   ├── test_jwt_only.sh             # JWT тесты
│   └── run-tests.sh                 # Запуск bash тестов
│
└── reports/                         # Отчеты в JSON + log
```

### 13.2 Команды запуска

| Команда | Описание |
|---------|----------|
| `npm test` | Все Jest тесты |
| `npm run test:unit` | Unit тесты |
| `npm run test:integration` | Integration тесты |
| `npm run test:security` | Security тесты |
| `npm run test:coverage` | С отчетом покрытия |
| `npm run test:watch` | Watch режим |
| `./tests/orchestrator/unified-test-runner.sh all` | Все тесты (Jest + smoke + load) |
| `./tests/orchestrator/unified-test-runner.sh quick` | Быстрая проверка |
| `./tests/orchestrator/unified-test-runner.sh health` | Health check |

### 13.3 Тестовые данные

| Сущность | Данные |
|----------|--------|
| Admin пользователь | admin / admin123 |
| Тестовый пользователь | testuser / TestPass123 |
| Здания | 17 зданий в Ташкенте с координатами |
| Контроллеры | 28 контроллеров (CRTL_OL_01...30) |
| Метрики | 34 записи (последние 3 часа) |
| Alert types | 7 предустановленных типов |

### 13.4 Что покрывают тесты

| Область | Тестируется |
|---------|------------|
| SQL Injection | Whitelist sort/order, parameterized queries, sanitization |
| XSS Protection | Наличие domSecurity.js, функции защиты, аудит innerHTML |
| API Endpoints | Статус коды, формат ответов, пагинация |
| Services | BuildingService, ControllerService, MetricService (с моками БД) |
| Rate Limiting | Лимиты запросов, заголовки X-RateLimit-* |
| Authentication | JWT валидация, token lifecycle |

### 13.5 Конфигурация тестов

```json
{
  "testEnvironment": "node",
  "testMatch": ["**/tests/jest/**/*.test.js"],
  "collectCoverageFrom": ["src/**/*.js", "!src/index.js"],
  "coverageDirectory": "tests/reports/coverage",
  "setupFilesAfterSetup": ["<rootDir>/tests/jest/setup.js"]
}
```

---

## 14. Генератор данных

### 14.1 Назначение

Автономный сервис для генерации симулированных метрик от IoT контроллеров. Работает по расписанию cron, отправляя данные через POST /api/metrics/telemetry.

### 14.2 Архитектура генератора

```
generator/
├── src/
│   ├── server.js       # Express сервер на порту 8081
│   ├── scheduler.js    # Cron + генерация метрик
│   ├── apiClient.js    # HTTP клиент с JWT кэшированием
│   └── store.js        # Persistent JSON storage
├── public/             # Web-интерфейс конфигурации
├── Dockerfile          # Multi-stage build (node:20-alpine)
└── package.json        # ES modules, express + axios + node-cron
```

### 14.3 API генератора

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| GET | /health | Healthcheck |
| GET | /api/ranges | Получить все конфигурации диапазонов |
| POST | /api/ranges/import | Импорт конфигураций |
| POST | /api/ranges/:buildingId | Установить диапазон для здания |
| DELETE | /api/ranges/:buildingId | Удалить конфигурацию здания |

### 14.4 Конфигурация диапазонов

Для каждого здания задаются диапазоны генерации:

```javascript
{
  electricity: { ph1: [min, max], ph2: [min, max], ph3: [min, max] },
  amperage: { ph1: [min, max], ph2: [min, max], ph3: [min, max] },
  waterPressure: { cold: [min, max], hotIn: [min, max], hotOut: [min, max] },
  waterTemp: { cold: [min, max], hotIn: [min, max], hotOut: [min, max] },
  environment: { airTemp: [min, max], humidity: [min, max] },
  leakProbability: 0.0 - 1.0
}
```

### 14.5 Процесс генерации

1. Cron запускает scheduler по расписанию (по умолчанию: каждые 2 минуты)
2. apiClient получает список зданий с контроллерами через GET /api/buildings-metrics
3. Для каждого контроллера генерируется payload с рандомными значениями в заданных диапазонах
4. Метрика отправляется через POST /api/metrics/telemetry
5. JWT токен кэшируется в памяти с буфером 5 минут до истечения

### 14.6 Запуск генератора

```bash
docker compose -f docker-compose.generator.yml up --build
```

Переменные окружения:
- `API_BASE_URL` -- URL основного API (default: http://host.docker.internal:3000/api)
- `API_USERNAME` / `API_PASSWORD` -- креденциалы для JWT
- `GENERATOR_CRON` -- cron выражение (default: */5 * * * *)

---

## 15. Диаграммы потоков данных

### 15.1 Поток телеметрии

```
Контроллер (IPC с датчиками)
    |
    | POST /api/metrics/telemetry
    | {controller_id, electricity_ph1..3, amperage_ph1..3,
    |  cold_water_pressure, cold_water_temp, hot_water_*,
    |  air_temp, humidity, leak_sensor}
    |
    v
Express (публичный endpoint, без JWT)
    |
    v
metricController.receiveTelemetry()
    |
    v
metricService.processTelemetry()
    |
    +---> Валидация данных (validateMetricData)
    |
    +---> Metric.create() -> INSERT INTO metrics (...)
    |       |
    |       +---> Триггер: trig_update_heartbeat
    |              -> UPDATE controllers SET last_heartbeat = NOW()
    |
    +---> detectAnomalies() -> Проверка пороговых значений
    |       |
    |       +---> При аномалии: alertService.createAlert()
    |              |
    |              +---> Проверка cooldown (15 мин)
    |              +---> INSERT INTO infrastructure_alerts (...)
    |
    +---> Инвалидация кэша (setImmediate, фоновая)
```

### 15.2 Поток отображения карты

```
Браузер (index.html)
    |
    | Инициализация Leaflet карты
    | MapLayersControl.init()
    |
    v
+--------------------------------------+
|  Параллельная загрузка слоев:        |
|                                      |
|  GET /api/buildings-metrics -------->|---> Маркеры зданий
|  GET /api/transformers ------------->|---> Маркеры трансформаторов
|                                      |      + прогресс-кольца загрузки
|  GET /api/cold-water-sources ------->|---> Маркеры источников воды
|  GET /api/heat-sources ------------->|---> Маркеры источников тепла
|  GET /api/lines -------------------->|---> Polylines электролиний
|  GET /api/water-lines -------------->|---> Polylines водных линий
|  GET /api/controllers -------------->|---> Маркеры контроллеров
|  GET /api/alerts ------------------->|---> Маркеры алертов
|                                      |
+--------------------------------------+
    |
    | setInterval(30000)
    v
Автоматическое обновление данных
    |
    v
DOMPurify.sanitize() -> Безопасные popups
```

### 15.3 Поток Circuit Breaker

```
Запрос аналитики
    |
    v
analyticsService.getTransformerLoad(id)
    |
    v
CircuitBreaker.execute(operation, fallback)
    |
    +-- Состояние: CLOSED
    |   |
    |   +---> Выполнить operation()
    |   |   +-- Успех -> сброс failureCount -> вернуть результат
    |   |   +-- Ошибка -> failureCount++
    |   |       +-- failureCount >= 5 -> Перейти в OPEN
    |   |           +-- вызвать fallback() -> вернуть кэшированные данные
    |   |
    |
    +-- Состояние: OPEN
    |   |
    |   +-- Время не истекло (< 60s)
    |   |   +-- Немедленно вызвать fallback()
    |   |
    |   +-- Время истекло (>= 60s)
    |       +-- Перейти в HALF_OPEN
    |
    +-- Состояние: HALF_OPEN
        |
        +---> Выполнить operation()
        |   +-- Успех -> successCount++
        |   |   +-- successCount >= 3 -> Перейти в CLOSED
        |   +-- Ошибка -> Вернуться в OPEN
        |       +-- вызвать fallback()
```

---

## 16. Известные ограничения и технический долг

### 16.1 Архитектурные проблемы

| # | Проблема | Описание | Приоритет |
|---|---------|----------|-----------|
| 1 | Монолитные JS файлы | admin.js (~2300 строк), script.js (~1400 строк) -- сложно поддерживать | Средний |
| 2 | Дублирование таблиц | transformers vs power_transformers -- две системы трансформаторов | Средний |
| 3 | Отсутствие ORM | Models выполняют SQL напрямую, что затрудняет unit-тестирование | Низкий |
| 4 | Дублирование кода | Водные маршруты (waterSourceRoutes, waterLineRoutes, waterSupplierRoutes) имеют похожую структуру | Низкий |
| 5 | Console.error | Некоторые маршруты используют console.error вместо Winston logger | Низкий |
| 6 | innerHTML usage | Остаточные unsafe innerHTML в admin.js (до 16), script.js (до 15), map-layers-control.js (до 5) | Средний |
| 7 | Отсутствие CI/CD | Нет .github/workflows для автоматического тестирования и деплоя | Средний |

### 16.2 Производительность

| # | Проблема | Описание |
|---|---------|----------|
| 1 | In-memory rate limiter | Не работает при горизонтальном масштабировании (нужен Redis) |
| 2 | In-memory cache | Max 1000 items, при перезапуске теряется |
| 3 | Materialized view | Обновляется вручную (нет автоматического расписания) |

### 16.3 Рекомендации по улучшению

| # | Улучшение | Описание |
|---|----------|----------|
| 1 | Модуляризация frontend | Разбить admin.js и script.js на модули (ES modules или bundler) |
| 2 | Унификация трансформаторов | Мигрировать power_transformers -> transformers, убрать дублирование |
| 3 | CI/CD pipeline | Добавить GitHub Actions: lint, test, build, deploy |
| 4 | Redis для production | Подключить Redis для кэширования и rate limiting |
| 5 | WebSocket | Заменить polling (30s) на WebSocket для real-time обновлений |
| 6 | Партиционирование metrics | Партиционировать таблицу metrics по времени для больших объемов |
| 7 | Repository pattern | Добавить слой Repository между Service и Model для тестируемости |
| 8 | TypeScript | Миграция на TypeScript для type safety |
| 9 | Мониторинг | Подключить Prometheus + Grafana (конфиг уже подготовлен в .env.prod) |
| 10 | Автоматическое обновление MV | Добавить cron-задачу для REFRESH MATERIALIZED VIEW |

---

*Документ сгенерирован на основе автоматического анализа кодовой базы InfraSafe v1.0.1.*
