# Техническое задание: InfraSafe Habitat IQ

**Версия документа:** 1.0
**Дата формирования:** 2026-03-09
**Источник:** реверс-инжиниринг кодовой базы проекта InfraSafe (ветка `fix/p0-p1-security-and-hygiene`, коммит `bbaca4b`)
**Метод:** анализ исходного кода, конфигурационных файлов, схемы БД, тестов и Docker-конфигурации

---

## Содержание

1. [Общие сведения](#1-общие-сведения)
2. [Описание предметной области](#2-описание-предметной-области)
3. [Технологический стек](#3-технологический-стек)
4. [Архитектура системы](#4-архитектура-системы)
5. [Функциональные требования](#5-функциональные-требования)
6. [Модель данных](#6-модель-данных)
7. [API и интерфейсы](#7-api-и-интерфейсы)
8. [Система аутентификации и авторизации](#8-система-аутентификации-и-авторизации)
9. [Нефункциональные требования](#9-нефункциональные-требования)
10. [Конфигурация и развёртывание](#10-конфигурация-и-развёртывание)
11. [Тестирование](#11-тестирование)
12. [Известные ограничения и технический долг](#12-известные-ограничения-и-технический-долг)

---

## 1. Общие сведения

### 1.1. Название проекта

**InfraSafe Habitat IQ** (далее -- InfraSafe)

### 1.2. Назначение и цели

InfraSafe -- цифровая IoT-платформа мониторинга инженерной инфраструктуры многоквартирных жилых домов. Система собирает данные от интеллектуальных контроллеров (промышленных ПК с датчиками), установленных в зданиях, обрабатывает метрики и предоставляет визуализацию в реальном времени через интерактивные карты и аналитические панели.

Платформа мониторит:

- **Электроснабжение**: напряжение и силу тока по трём фазам, загрузку трансформаторов и линий электропередач
- **Водоснабжение**: давление и температуру холодной и горячей воды, состояние водопроводных линий
- **Теплоснабжение**: температуру входящей и исходящей горячей воды, работу тепловых источников
- **Микроклимат**: температуру воздуха, влажность, срабатывание датчиков протечек

### 1.3. Краткое описание

InfraSafe решает задачу централизованного мониторинга инженерных систем жилого фонда. Управляющие компании и городские службы получают единый интерфейс для наблюдения за состоянием сотен зданий одновременно. На интерактивной карте (на базе Leaflet.js) отображаются здания, трансформаторные подстанции, источники воды и тепла, линии электропередач и водоснабжения с маршрутами прокладки.

Система автоматически анализирует поступающие метрики и генерирует алерты при выходе параметров за пределы пороговых значений -- например, при перегрузке трансформатора выше 85% или падении давления воды ниже 2 бар. Для аналитиков доступны прогнозы пиковых нагрузок, статистика по зонам и исторические данные.

Географический контекст проекта -- город Ташкент (Узбекистан). Интерфейс системы -- на русском языке.

### 1.4. Репозиторий и лицензия

- **Репозиторий:** `https://github.com/a-afanasyev/infrasafe.git`
- **Лицензия:** Apache-2.0
- **Текущая версия:** 1.0.1

---

## 2. Описание предметной области

### 2.1. Контекст использования

Система предназначена для эксплуатации управляющими компаниями многоквартирных домов и городскими инженерными службами. Каждое здание оснащается IoT-контроллером, который через телеметрический API передаёт показания датчиков на центральный сервер. Оператор наблюдает за состоянием инфраструктуры через веб-интерфейс.

### 2.2. Целевая аудитория

| Роль | Описание | Уровень доступа |
|------|----------|-----------------|
| **Анонимный посетитель** | Просмотр карты с расположением зданий (без метрик) | Только `GET /buildings-metrics` (урезанные данные) |
| **Авторизованный пользователь** (`user`) | Просмотр карты с полными метриками, аналитика, алерты | Чтение всех данных, создание метрик |
| **Администратор** (`admin`) | Полное управление системой: CRUD всех сущностей, batch-операции, проверка трансформаторов, управление порогами алертов | Полный доступ ко всем эндпоинтам |
| **IoT-контроллер** (device) | Отправка телеметрии без аутентификации | Только `POST /metrics/telemetry` |

### 2.3. Основные бизнес-процессы

1. **Сбор телеметрии**: контроллеры в зданиях периодически (по умолчанию каждые 2 минуты) отправляют пакеты метрик через публичный эндпоинт `/api/metrics/telemetry`
2. **Мониторинг на карте**: оператор наблюдает за состоянием зданий и инфраструктурных объектов через интерактивную карту с несколькими слоями
3. **Автоматический алертинг**: система анализирует метрики, сравнивает с пороговыми значениями и создаёт алерты (INFO / WARNING / CRITICAL)
4. **Аналитика нагрузок**: расчёт загрузки трансформаторов, анализ дисбаланса фаз, прогнозирование пиковых нагрузок
5. **Администрирование**: управление зданиями, контроллерами, инфраструктурными объектами, batch-операции
6. **Жизненный цикл алертов**: создание -> подтверждение (acknowledge) -> закрытие (resolve)

---

## 3. Технологический стек

### 3.1. Backend

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| Runtime | Node.js | 20+ |
| Web-фреймворк | Express.js | ^4.18.2 |
| База данных | PostgreSQL с PostGIS | 15+ (postgis/postgis:15-3.3) |
| Драйвер БД | pg (node-postgres) | ^8.11.3 |
| Аутентификация | jsonwebtoken | ^9.0.2 |
| Хэширование паролей | bcrypt | ^5.1.1 (12 раундов) |
| Валидация запросов | express-validator | ^7.2.1 |
| HTTP-безопасность | helmet | ^7.1.0 |
| CORS | cors | ^2.8.5 |
| Логирование | winston | ^3.11.0 |
| HTTP-логи | morgan | ^1.10.0 |
| API-документация | swagger-jsdoc + swagger-ui-express | ^6.2.8 / ^5.0.0 |
| Санитизация | dompurify | ^3.2.7 |
| Конфигурация | dotenv | ^16.3.1 |

### 3.2. Frontend

| Компонент | Технология | Примечание |
|-----------|-----------|------------|
| JavaScript | Vanilla JS (ES6+) | Без фреймворков |
| Карта | Leaflet.js | Локальная копия в `public/libs/leaflet/` |
| Кластеризация | leaflet.markercluster | Группировка маркеров при масштабировании |
| Графики | Chart.js | Визуализация аналитики |
| XSS-защита | DOMPurify | `public/utils/domSecurity.js` -- обёртка |
| Темы | CSS переменные | Светлая/тёмная тема, localStorage |

### 3.3. Инфраструктура

| Компонент | Технология |
|-----------|-----------|
| Контейнеризация | Docker Compose |
| Reverse proxy | Nginx (порт 8080) |
| CI/CD | Не обнаружено в кодовой базе |
| Мониторинг | Winston логи (файлы + консоль) |
| Кэширование | In-memory Map + опциональный Redis |

### 3.4. Тестирование

| Компонент | Технология |
|-----------|-----------|
| Тестовый фреймворк | Jest | ^29.7.0 |
| HTTP-тесты | supertest | ^6.3.3 |
| HTTP-клиент (интеграция) | axios | ^1.11.0 |
| Линтер | ESLint | ^8.56.0 |
| Hot reload | nodemon | ^3.0.2 |

---

## 4. Архитектура системы

### 4.1. Тип архитектуры

**Монолитное веб-приложение** с трёхслойной серверной архитектурой, контейнеризированное через Docker Compose. Фронтенд обслуживается отдельным Nginx-контейнером, который также проксирует API-запросы к Node.js-серверу.

### 4.2. Схема взаимодействия компонентов

```
                    +-----------+
                    |  Браузер  |
                    +-----+-----+
                          |
                    порт 8080
                          |
              +-----------v-----------+
              |     Nginx (frontend)  |
              |  - Статика: HTML/JS   |
              |  - /api/* -> app:3000 |
              +-----------+-----------+
                          |
                    порт 3000
                          |
              +-----------v-----------+
              |   Express.js (app)    |
              |  +-----------------+  |
              |  | Middleware:     |  |
              |  |  helmet, cors, |  |
              |  |  morgan, JWT,  |  |
              |  |  rate limiter  |  |
              |  +-----------------+  |
              |  | Routes (index) |  |
              |  +--------+--------+ |
              |           |          |
              |  +--------v--------+ |
              |  | Controllers     | |
              |  +--------+--------+ |
              |           |          |
              |  +--------v--------+ |
              |  | Services        | |
              |  | (бизнес-логика) | |
              |  +--------+--------+ |
              |           |          |
              |  +--------v--------+ |
              |  | Models          | |
              |  | (SQL-запросы)   | |
              |  +--------+--------+ |
              +-----------+-----------+
                          |
                    порт 5432
                          |
              +-----------v-----------+
              |  PostgreSQL + PostGIS |
              |  (postgis:15-3.3)    |
              +-----------------------+

              +-----------------------+
              |  Generator (отдельно) |
              |  Cron: */2 * * * *   |
              |  -> POST /telemetry  |
              +-----------------------+
```

### 4.3. Основные модули и их взаимосвязи

#### Серверный слой (`src/`)

| Слой | Директория | Назначение |
|------|-----------|------------|
| **Точка входа** | `src/index.js` -> `src/server.js` | Инициализация Express, middleware, маршрутов, подключение к БД |
| **Маршрутизация** | `src/routes/` | 15 файлов маршрутов, объединённых в `index.js` |
| **Контроллеры** | `src/controllers/` | 8 контроллеров: обработка HTTP, валидация, форматирование ответов |
| **Сервисы** | `src/services/` | 6 сервисов: бизнес-логика, кэширование, Circuit Breaker |
| **Модели** | `src/models/` | 9 моделей: прямые SQL-запросы через `pg` Pool |
| **Middleware** | `src/middleware/` | `auth.js`, `rateLimiter.js`, `validators.js`, `errorHandler.js` |
| **Утилиты** | `src/utils/` | `logger.js`, `circuitBreaker.js`, `queryValidation.js`, `helpers.js` |
| **Конфигурация** | `src/config/` | `database.js` -- инициализация пула соединений PostgreSQL |

#### Фронтенд (`public/`)

| Файл/Модуль | Назначение |
|-------------|------------|
| `script.js` (~1400 строк) | Главный интерфейс карты: инициализация Leaflet, маркеры, popup, темы |
| `map-layers-control.js` | Класс `MapLayersControl`: управление слоями карты (здания, трансформаторы, водоснабжение, теплоснабжение), обновление метрик |
| `admin.js` (~2300 строк) | Админ-панель: CRUD-таблицы, batch-операции, экспорт |
| `admin-auth.js` | Класс `AdminAuth`: авторизация админки, перехват fetch-запросов |
| `admin-coordinate-editor.js` | Редактор координат на карте для зданий |
| `infrastructure-line-editor.js` | Визуальный редактор маршрутов линий инфраструктуры |
| `utils/domSecurity.js` | Безопасная работа с DOM: экранирование, DOMPurify-обёртки, валидация JWT на клиенте |
| `utils/csrf.js` | CSRF-защита (клиентская) |
| `utils/powerUtils.js` | Утилиты расчёта мощности |
| `utils/rateLimiter.js` | Клиентский rate limiter |
| `utils/safeJsonParser.js` | Безопасный JSON-парсер |
| `analytics/` | Страница аналитики (Chart.js графики) |

### 4.4. Структура директорий проекта

```
infrasafe/
  src/                      # Серверный код
    config/                  #   Конфигурация БД
    controllers/             #   HTTP-контроллеры (8 файлов)
    middleware/              #   Middleware (auth, validators, rateLimiter, errorHandler)
    models/                  #   Модели данных (SQL-запросы, 9 файлов)
    routes/                  #   Маршруты API (15 файлов + index.js)
    services/                #   Бизнес-логика (6 файлов)
    utils/                   #   Утилиты (logger, circuitBreaker, queryValidation, helpers)
  public/                   # Фронтенд-ресурсы
    analytics/              #   Страница аналитики
    css/                    #   Стили слоёв карты
    images/                 #   Логотипы и иконки
    libs/                   #   Локальные библиотеки (Leaflet, MarkerCluster)
    utils/                  #   Клиентские утилиты безопасности
  database/
    init/                   #   01_init_database.sql, 02_seed_data.sql
    migrations/             #   Миграции 003-009
    backups/                #   Резервные копии
    export/                 #   Экспорт схемы
  generator/                # Standalone-сервис генерации тестовых данных
    src/                    #   server.js, scheduler.js, apiClient.js, store.js
  tests/
    jest/                   #   Unit, integration, security тесты
    orchestrator/           #   Unified test runner (shell-скрипт)
    logs/                   #   Логи тестовых прогонов
  docs/                     # Документация
  logs/                     # Логи приложения (combined.log, error.log)
```

---

## 5. Функциональные требования

### 5.1. Модуль аутентификации и авторизации

**Файлы:** `src/services/authService.js`, `src/controllers/authController.js`, `src/middleware/auth.js`, `src/routes/authRoutes.js`

#### Функциональность

| Функция | Описание |
|---------|----------|
| Регистрация | Создание нового пользователя с ролью `user`. Валидация: username >= 3 символа, email формат, пароль >= 8 символов (обязательно строчные + заглавные буквы + цифры) |
| Аутентификация | Вход по username/email + пароль. Генерация пары access token (24h) + refresh token (7d) |
| Обновление токенов | Ротация токенов через refresh token; использованный refresh token помещается в blacklist |
| Выход | Добавление текущего access token в blacklist (двухуровневый: in-memory + таблица `token_blacklist` в БД) |
| Смена пароля | Проверка текущего пароля, валидация нового, обновление `password_hash` |
| Профиль | Получение данных текущего аутентифицированного пользователя |
| Блокировка аккаунта | После 5 неудачных попыток входа -- блокировка на 15 минут (через in-memory cache) |
| Очистка blacklist | Периодическая (раз в час) очистка просроченных токенов из таблицы `token_blacklist` |

#### Бизнес-правила

- Новые пользователи всегда получают роль `user` (роль `admin` назначается только вручную в БД)
- Роли: `admin`, `operator`, `user`
- JWT содержит: `user_id`, `username`, `email`, `role`; issuer: `infrasafe-api`, audience: `infrasafe-client`
- Хэширование пароля: bcrypt с 12 раундами
- Blacklist токенов -- двухуровневый: L1 (in-memory cacheService) + L2 (PostgreSQL таблица `token_blacklist` с SHA-256 хэшами)

### 5.2. Модуль управления зданиями

**Файлы:** `src/controllers/buildingController.js`, `src/services/buildingService.js`, `src/models/Building.js`, `src/routes/buildingRoutes.js`

#### Функциональность

| Функция | Описание |
|---------|----------|
| Список зданий | Пагинация, сортировка (whitelist-валидация), фильтрация |
| Поиск в радиусе | Геопространственный поиск зданий через PostGIS `ST_DWithin` по координатам и радиусу (км) |
| Статистика | Агрегация по городам и управляющим компаниям |
| CRUD | Создание / чтение / обновление / удаление зданий |

#### Входные данные при создании

| Поле | Тип | Обязательное | Описание |
|------|-----|-------------|----------|
| name | varchar(100) | Да | Название здания |
| address | text | Да | Адрес |
| town | varchar(100) | Да | Город |
| latitude | numeric(9,6) | Да | Широта |
| longitude | numeric(9,6) | Да | Долгота |
| management_company | varchar(100) | Нет | Управляющая компания |
| region | varchar(50) | Нет | Район |
| has_hot_water | boolean | Нет | Наличие горячего водоснабжения |

#### Бизнес-правила

- При вставке/обновлении координат триггер `trig_buildings_geom` автоматически создаёт PostGIS-геометрию (`POINT`, SRID 4326)
- Удаление здания невозможно при наличии привязанных контроллеров
- Здание может быть связано с инфраструктурой: основной/резервный трансформатор, основная/резервная линия электропередач, линии ХВС/ГВС, поставщики воды, источник тепла, трансформаторная подстанция (legacy), источник холодной воды (legacy)

### 5.3. Модуль управления контроллерами

**Файлы:** `src/controllers/controllerController.js`, `src/services/controllerService.js`, `src/models/Controller.js`, `src/routes/controllerRoutes.js`

#### Функциональность

| Функция | Описание |
|---------|----------|
| Список | Пагинация, сортировка, фильтрация по статусу |
| По зданию | Получение контроллеров, привязанных к конкретному зданию |
| Метрики контроллера | Получение метрик с фильтрацией по дате |
| Статистика | Агрегация по статусам и зданиям |
| Обновление статуса по активности | Массовое обновление статусов на основе `last_heartbeat` (timeout 10 минут). **Только admin.** |
| CRUD | Создание / обновление / удаление / изменение статуса |

#### Модель контроллера

| Поле | Тип | Описание |
|------|-----|----------|
| controller_id | serial PK | Идентификатор |
| serial_number | varchar(50) UNIQUE | Серийный номер (валидация XSS) |
| vendor | varchar(50) | Производитель |
| model | varchar(50) | Модель устройства |
| building_id | int FK | Привязка к зданию |
| status | varchar(20) | `online` / `offline` / `maintenance` |
| installed_at | timestamptz | Дата установки |
| last_heartbeat | timestamptz | Последнее обновление (обновляется триггером при вставке метрики) |

### 5.4. Модуль метрик и телеметрии

**Файлы:** `src/controllers/metricController.js`, `src/services/metricService.js`, `src/models/Metric.js`, `src/routes/metricRoutes.js`

#### Функциональность

| Функция | Описание |
|---------|----------|
| Приём телеметрии | `POST /api/metrics/telemetry` -- **публичный** эндпоинт, без аутентификации. Rate limit: 120 запросов/мин |
| Список метрик | Пагинация, сортировка по `timestamp DESC` |
| По контроллеру | Фильтрация по controller_id и диапазону дат |
| Последние метрики | Последняя метрика каждого контроллера |
| Агрегированные данные | MIN/MAX/AVG по временным интервалам (hour/day/week/month) |
| Очистка старых | Удаление метрик старше N дней (по умолчанию 30, макс 365) |
| CRUD | Создание / чтение / удаление отдельных метрик |

#### Структура метрики

| Группа | Поля | Тип |
|--------|------|-----|
| Электричество (напряжение) | `electricity_ph1`, `electricity_ph2`, `electricity_ph3` | numeric(6,2) |
| Электричество (ток) | `amperage_ph1`, `amperage_ph2`, `amperage_ph3` | numeric(6,2) |
| Холодная вода | `cold_water_pressure`, `cold_water_temp` | numeric(5,2) |
| Горячая вода | `hot_water_in_pressure`, `hot_water_out_pressure`, `hot_water_in_temp`, `hot_water_out_temp` | numeric(5,2) |
| Окружение | `air_temp`, `humidity` | numeric(5,2) |
| Датчики | `leak_sensor` | boolean |

#### Бизнес-правила

- При вставке метрики триггер `trig_update_heartbeat` автоматически обновляет `last_heartbeat` контроллера
- Составной индекс `idx_metrics_ctrl_ts` (controller_id, timestamp DESC) оптимизирует типичные запросы
- Телеметрийный эндпоинт имеет отдельный rate limiter (120 req/min) и не требует аутентификации

### 5.5. Модуль карты и визуализации (buildings-metrics)

**Файлы:** `src/controllers/buildingMetricsController.js`, `src/routes/buildingMetricsRoutes.js`

#### Функциональность

Единственный эндпоинт `GET /api/buildings-metrics` -- публичный маршрут с **двухуровневым доступом** (optionalAuth):

| Режим | Возвращаемые данные |
|-------|---------------------|
| **Анонимный** (без токена) | `building_id`, `building_name`, `address`, `town`, `latitude`, `longitude`, `has_controller` |
| **Авторизованный** (с токеном) | Все данные анонимного режима + `region`, `management_company`, `has_hot_water`, `controller_id`, `controller_serial`, `controller_status`, все метрики (напряжение, ток, давление, температура, влажность, протечки) |

#### Бизнес-правила

- Используется `LEFT JOIN LATERAL` для эффективного получения последней метрики каждого контроллера
- Анонимные пользователи видят только расположение зданий на карте без чувствительных данных
- Маршрут обёрнут в `optionalAuth` middleware: при наличии валидного токена устанавливается `req.user`, при отсутствии -- `req.user = null`

### 5.6. Модуль аналитики и трансформаторов

**Файлы:** `src/services/analyticsService.js`, `src/controllers/analyticsController.js`, `src/routes/analyticsRoutes.js`, `src/models/PowerTransformer.js`

#### Функциональность

| Функция | Эндпоинт | Описание |
|---------|----------|----------|
| Все трансформаторы с аналитикой | `GET /analytics/transformers` | Список с загрузкой, фильтрация по статусу/загрузке |
| Загрузка конкретного | `GET /analytics/transformers/:id/load` | Детальная аналитика загрузки |
| Перегруженные | `GET /analytics/transformers/overloaded` | Трансформаторы выше порога (по умолчанию 80%) |
| Геопоиск | `GET /analytics/transformers/search` | Поиск трансформаторов в радиусе от координат |
| Ближайшие здания | `GET /analytics/transformers/:id/buildings` | PostGIS-поиск зданий вблизи трансформатора |
| Прогноз нагрузки | `GET /analytics/transformers/:id/forecast` | Прогнозирование по часовым паттернам (1-168 часов) |
| Загрузка по зонам | `GET /analytics/zones/load` | Агрегация по городам/районам |
| Статистика | `GET /analytics/transformers/statistics` | Общая статистика трансформаторов |
| Статус системы | `GET /analytics/status` | Состояние Circuit Breaker, кэша |
| CRUD трансформаторов | POST/PUT/DELETE | **Только admin** |
| Обновление MV | `POST /analytics/refresh` | Обновление материализованного представления. **Только admin** |
| Сброс кэша | `POST /analytics/cache/invalidate` | **Только admin** |
| Сброс Circuit Breaker | `POST /analytics/circuit-breakers/reset` | **Только admin** |

#### Архитектурные паттерны

- **Circuit Breaker** с тремя состояниями (CLOSED -> OPEN -> HALF_OPEN -> CLOSED):
  - `TransformerAnalytics`: порог 3 ошибки, таймаут 30 сек
  - `AnalyticsDB`: порог 5 ошибок, таймаут 60 сек
  - `MaterializedView`: порог 3 ошибки, таймаут 30 сек
- **Fallback-стратегия**: при открытом Circuit Breaker данные получаются из базовых таблиц вместо материализованных представлений
- **Многоуровневое кэширование**: in-memory (Map, TTL 1 мин) -> Redis (TTL 5 мин, опциональный) -> PostgreSQL
- **Прогнозирование**: простой алгоритм на основе часовых паттернов за последние 7 дней

### 5.7. Модуль алертов

**Файлы:** `src/services/alertService.js`, `src/controllers/alertController.js`, `src/routes/alertRoutes.js`

#### Функциональность

| Функция | Описание |
|---------|----------|
| Получение активных алертов | Фильтрация по severity и типу инфраструктуры |
| Создание алерта | Вручную или автоматически при проверке трансформатора |
| Подтверждение (acknowledge) | Смена статуса `active` -> `acknowledged`, фиксация пользователя и времени |
| Закрытие (resolve) | Смена статуса на `resolved` |
| Проверка трансформатора | Запуск проверки конкретного трансформатора. **Только admin** |
| Массовая проверка | Проверка всех трансформаторов. **Только admin** |
| Статистика | Агрегация по severity, типу инфраструктуры, статусу, дате за N дней |
| Пороги | Получение и обновление пороговых значений. Обновление -- **только admin** |

#### Пороговые значения (по умолчанию)

| Параметр | Значение | Уровень |
|----------|----------|---------|
| Загрузка трансформатора | >= 85% | WARNING (TRANSFORMER_OVERLOAD) |
| Загрузка трансформатора | >= 95% | CRITICAL (TRANSFORMER_CRITICAL_OVERLOAD) |
| Давление воды (низкое) | < 2.0 бар | WARNING |
| Давление воды (критическое) | < 1.5 бар | CRITICAL |
| Разность температур отопления | < 15 C | WARNING |
| Разность температур отопления | < 10 C | CRITICAL |

#### Бизнес-правила

- **Cooldown 15 минут**: между одинаковыми алертами (по ключу `infrastructure_type:infrastructure_id:alert_type`)
- Активные алерты хранятся в Map в памяти для быстрого доступа
- При создании CRITICAL алерта выполняется немедленное уведомление (логирование, в будущем -- email/SMS/Telegram)
- Circuit Breaker защищает операции с БД при создании алертов

### 5.8. Модуль аналитики мощности

**Файлы:** `src/controllers/powerAnalyticsController.js`, `src/routes/powerAnalyticsRoutes.js`

#### Функциональность

| Эндпоинт | Описание |
|----------|----------|
| `GET /power-analytics/buildings` | Потребляемая мощность всех зданий по фазам |
| `GET /power-analytics/buildings/:id` | Мощность конкретного здания |
| `GET /power-analytics/transformers` | Загрузка всех трансформаторов |
| `GET /power-analytics/transformers/:id` | Загрузка конкретного трансформатора |
| `GET /power-analytics/phase-imbalance` | Анализ дисбаланса фаз (TODO) |
| `GET /power-analytics/lines` | Мощность линий (TODO) |
| `POST /power-analytics/refresh` | Обновление данных. **Только admin** |

### 5.9. Модуль управления инфраструктурой

#### Трансформаторы (`/api/transformers`)

Таблица `transformers` -- CRUD через `src/routes/transformerRoutes.js`. Поля: name, power_kva, voltage_kv, location, latitude, longitude, installation_date, manufacturer, model, status. Триггер автоматически обновляет PostGIS-геометрию.

#### Линии электропередач (`/api/lines`)

Таблица `lines` -- CRUD через `src/routes/lineRoutes.js`. Поля: name, voltage_kv, length_km, transformer_id, координаты начала/конца, main_path (JSONB), branches (JSONB), cable_type, commissioning_year. Триггеры автоматически конвертируют координаты начала/конца в main_path и строят PostGIS LINESTRING.

#### Источники холодной воды (`/api/cold-water-sources`)

Таблица `cold_water_sources` -- CRUD. Поля: name, address, coordinates, source_type (`pumping_station`/`well`/`reservoir`), capacity_m3_per_hour, operating_pressure_bar, status.

#### Источники тепла (`/api/heat-sources`)

Таблица `heat_sources` -- CRUD. Поля: name, address, coordinates, source_type (`boiler_house`/`heat_plant`/`chp`), capacity_mw, fuel_type, status.

#### Линии водоснабжения (`/api/water-lines`)

Таблица `water_lines` -- CRUD. Поля: name, diameter_mm, material, pressure_bar, status, координаты, main_path (JSONB), branches (JSONB).

#### Поставщики воды (`/api/water-suppliers`)

Таблица `water_suppliers` -- CRUD. Поля: name, supplier_type (`cold_water`/`hot_water`/`both`), contact_person, phone, email, tariff_per_m3, contract_number, status.

### 5.10. Административный модуль

**Файлы:** `src/controllers/adminController.js`, `src/routes/adminRoutes.js`

**Все маршруты защищены** middleware `isAdmin` на уровне роутера (`router.use(isAdmin)`).

#### Функциональность

| Функция | Описание |
|---------|----------|
| Оптимизированные списки | Для зданий, контроллеров, метрик, трансформаторов, линий, водных линий, источников воды, источников тепла -- с расширенной фильтрацией, поиском, выбором полей |
| CRUD для всех сущностей | Создание, чтение, обновление, удаление |
| Batch-операции | Массовые delete, update_status, export для зданий, контроллеров, метрик, трансформаторов, линий, водных линий |
| Глобальный поиск | `GET /admin/search` -- поиск по всем сущностям (buildings, controllers) |
| Статистика дашборда | `GET /admin/stats` -- общая статистика системы |
| Экспорт данных | `POST /admin/export` -- экспорт в форматах CSV/XLSX/JSON |

### 5.11. Генератор тестовых данных

**Файлы:** `generator/` (отдельный Node.js-сервис со своим `package.json`)

#### Функциональность

- Отдельный Express-сервер с веб-интерфейсом для настройки диапазонов генерации
- Cron-расписание: по умолчанию `*/2 * * * *` (каждые 2 минуты)
- Для каждого контроллера генерирует метрику со случайными значениями в настраиваемых диапазонах
- Отправляет метрики через `POST /api/metrics/telemetry` (публичный эндпоинт)
- Параметры генерации: диапазоны напряжения, тока, давления воды, температуры, влажности, вероятность протечки
- Запускается через отдельный `docker-compose.generator.yml`

---

## 6. Модель данных

### 6.1. Диаграмма сущностей

```
users ----< refresh_tokens
  |
  +----< token_blacklist (через SHA-256 хэш)
  |
  +---- infrastructure_alerts (acknowledged_by, resolved_by)

buildings ----< controllers ----< metrics
  |                                  |
  |                                  +----> alerts (через metric_id)
  |
  +---- power_transformers (FK: power_transformer_id)
  +---- cold_water_sources (FK: cold_water_source_id)
  +---- heat_sources (FK: heat_source_id)
  +---- transformers (FK: primary_transformer_id, backup_transformer_id)
  +---- lines (FK: primary_line_id, backup_line_id)
  +---- water_lines (FK: cold_water_line_id, hot_water_line_id)
  +---- water_suppliers (FK: cold_water_supplier_id, hot_water_supplier_id)

transformers ----< lines (FK: transformer_id)

buildings ----< water_measurement_points
```

### 6.2. Основные таблицы

#### `users` -- Пользователи системы

| Колонка | Тип | Описание |
|---------|-----|----------|
| user_id | serial PK | Идентификатор |
| username | varchar(50) UNIQUE NOT NULL | Имя пользователя |
| email | varchar(100) UNIQUE NOT NULL | Email |
| password_hash | varchar(255) NOT NULL | bcrypt-хэш пароля |
| full_name | varchar(100) | Полное имя |
| role | varchar(20) DEFAULT 'user' | Роль: `admin`, `operator`, `user` |
| is_active | boolean DEFAULT true | Активность аккаунта |
| failed_login_attempts | integer DEFAULT 0 | Счётчик неудачных попыток |
| last_failed_login | timestamptz | Время последней неудачной попытки |
| account_locked_until | timestamptz | Время разблокировки |
| created_at | timestamptz | Дата регистрации |
| updated_at | timestamptz | Дата обновления |
| last_login | timestamptz | Последний вход |

#### `buildings` -- Здания

| Колонка | Тип | Описание |
|---------|-----|----------|
| building_id | serial PK | Идентификатор |
| name | varchar(100) NOT NULL | Название |
| address | text NOT NULL | Адрес |
| town | varchar(100) NOT NULL | Город |
| latitude | numeric(9,6) NOT NULL | Широта |
| longitude | numeric(9,6) NOT NULL | Долгота |
| region | varchar(50) | Район |
| management_company | varchar(100) | Управляющая компания |
| has_hot_water | boolean DEFAULT false | Наличие ГВС |
| geom | geometry(POINT, 4326) | PostGIS-геометрия (авто) |
| power_transformer_id | varchar(50) FK | Legacy-трансформатор |
| cold_water_source_id | varchar(50) FK | Источник ХВС |
| heat_source_id | varchar(50) FK | Источник тепла |
| primary_transformer_id | int FK | Основной трансформатор |
| backup_transformer_id | int FK | Резервный трансформатор |
| primary_line_id | int FK | Основная линия |
| backup_line_id | int FK | Резервная линия |
| cold_water_line_id | int FK | Линия ХВС |
| hot_water_line_id | int FK | Линия ГВС |
| cold_water_supplier_id | int FK | Поставщик ХВС |
| hot_water_supplier_id | int FK | Поставщик ГВС |

#### `metrics` -- Метрики телеметрии

| Колонка | Тип | Описание |
|---------|-----|----------|
| metric_id | bigserial PK | Идентификатор |
| controller_id | int FK | Контроллер |
| timestamp | timestamptz NOT NULL | Время измерения |
| electricity_ph1..ph3 | numeric(6,2) | Напряжение по фазам (В) |
| amperage_ph1..ph3 | numeric(6,2) | Ток по фазам (А) |
| cold_water_pressure | numeric(5,2) | Давление ХВС (бар) |
| cold_water_temp | numeric(5,2) | Температура ХВС (C) |
| hot_water_in/out_pressure | numeric(5,2) | Давление ГВС вход/выход |
| hot_water_in/out_temp | numeric(5,2) | Температура ГВС вход/выход |
| air_temp | numeric(5,2) | Температура воздуха |
| humidity | numeric(5,2) | Влажность |
| leak_sensor | boolean | Датчик протечки |

#### `infrastructure_alerts` -- Алерты

| Колонка | Тип | Описание |
|---------|-----|----------|
| alert_id | bigserial PK | Идентификатор |
| type | varchar(50) NOT NULL | Тип алерта |
| infrastructure_id | varchar(50) NOT NULL | ID инфраструктурного объекта |
| infrastructure_type | varchar(50) NOT NULL | `transformer`, `water_source`, `heat_source` |
| severity | varchar(20) NOT NULL | `INFO`, `WARNING`, `CRITICAL` |
| status | varchar(20) DEFAULT 'active' | `active`, `acknowledged`, `resolved` |
| message | text NOT NULL | Текст алерта |
| affected_buildings | int DEFAULT 0 | Количество затронутых зданий |
| data | jsonb | Дополнительные данные |
| acknowledged_by | int FK -> users | Кто подтвердил |
| resolved_by | int FK -> users | Кто закрыл |

#### `token_blacklist` -- Чёрный список токенов

| Колонка | Тип | Описание |
|---------|-----|----------|
| id | bigserial PK | Идентификатор |
| token_hash | varchar(255) UNIQUE NOT NULL | SHA-256 хэш токена |
| expires_at | timestamptz NOT NULL | Время истечения |
| blacklisted_at | timestamptz DEFAULT NOW() | Время добавления |

### 6.3. Материализованные представления

#### `mv_transformer_load_realtime`

Агрегирует данные загрузки трансформаторов в реальном времени:
- Количество зданий и контроллеров
- Средние значения напряжения и тока
- Процент загрузки (формула: `avg_amperage * 0.4 / capacity_kva * 100`)
- Количество метрик за последний час

Обновляется через SQL-функцию `refresh_transformer_analytics()` (CONCURRENTLY).

### 6.4. Партиционирование

Таблица `analytics_history` партиционирована по `analysis_date` (RANGE):
- `analytics_history_current` -- текущий месяц
- `analytics_history_prev` -- предыдущий месяц

### 6.5. Триггеры

| Триггер | Таблица | Событие | Действие |
|---------|---------|---------|----------|
| trig_buildings_geom | buildings | INSERT/UPDATE lat/lng | Создание PostGIS POINT |
| trig_transformers_geom | transformers | INSERT/UPDATE lat/lng | Создание PostGIS POINT |
| trig_power_transformers_geom | power_transformers | INSERT/UPDATE lat/lng | Создание PostGIS POINT |
| trig_cold_water_sources_geom | cold_water_sources | INSERT/UPDATE lat/lng | Создание PostGIS POINT |
| trig_heat_sources_geom | heat_sources | INSERT/UPDATE lat/lng | Создание PostGIS POINT |
| trig_update_heartbeat | metrics | INSERT | Обновление `last_heartbeat` контроллера |
| trig_lines_convert_endpoints | lines | INSERT/UPDATE | Конвертация координат в JSONB main_path |
| trig_lines_update_geom | lines | INSERT/UPDATE | Создание PostGIS LINESTRING из main_path |
| trig_water_lines_geom_from_coordinates | water_lines | INSERT/UPDATE | Создание PostGIS LINESTRING |
| trigger_*_updated_at | transformers, lines, water_lines | UPDATE | Обновление `updated_at` |

### 6.6. Миграции

| Миграция | Описание |
|----------|----------|
| 003 | Система расчёта мощности |
| 004 | Добавление координат и расширенных полей трансформаторов |
| 005 | Добавление путей (main_path, branches) к линиям |
| 006 | Очистка infrastructure_lines, разделение на lines + water_lines |
| 007 | Составной индекс `idx_metrics_ctrl_ts` на metrics(controller_id, timestamp DESC) |
| 008 | Удаление дублирующих записей ГВС |
| 009 | Индексы на `token_blacklist` (token_hash, expires_at) |

---

## 7. API и интерфейсы

### 7.1. Общие соглашения

- Базовый путь: `/api`
- Формат: JSON
- Аутентификация: Bearer JWT в заголовке `Authorization`
- Пагинация: query-параметры `page`, `limit`, `sort`, `order`
- Ответ успеха: `{ success: true, data: ..., pagination: ... }`
- Ответ ошибки: `{ error: { message: ..., status: ... } }` или `{ success: false, message: ... }`
- Swagger UI доступен по адресу `/api-docs` (только в development)

### 7.2. Матрица авторизации API

#### Публичные маршруты (PUBLIC_ROUTES allowlist)

| Метод | Путь | Middleware | Описание |
|-------|------|-----------|----------|
| POST | `/api/auth/login` | authLimiter (10 req / 15 min) | Вход в систему |
| POST | `/api/auth/register` | registerLimiter (5 req / 1 hour) | Регистрация |
| POST | `/api/auth/refresh` | authenticateRefresh | Обновление токенов |
| POST | `/api/metrics/telemetry` | telemetryLimiter (120 req / 1 min) | Приём телеметрии от устройств |
| GET | `/api/buildings-metrics` | optionalAuth | Данные для карты (урезанные без токена) |
| GET | `/api/` | -- | Информация об API |

#### Авторизованные маршруты (JWT required)

Все маршруты, не входящие в PUBLIC_ROUTES, проходят через middleware `authenticateJWT` (default-deny). Ниже выделены маршруты, дополнительно защищённые `isAdmin`:

| Модуль | Маршрут | Admin-only операции |
|--------|---------|---------------------|
| Controllers | `POST /controllers/update-status-by-activity` | Да |
| Analytics | `POST /analytics/transformers` | Да |
| Analytics | `PUT/DELETE /analytics/transformers/:id` | Да |
| Analytics | `POST /analytics/refresh` | Да |
| Analytics | `POST /analytics/cache/invalidate` | Да |
| Analytics | `POST /analytics/circuit-breakers/reset` | Да |
| Analytics | `PUT /analytics/thresholds` | Да |
| Alerts | `POST /alerts/check/transformer/:id` | Да |
| Alerts | `POST /alerts/check/all-transformers` | Да |
| Alerts | `PUT /alerts/thresholds` | Да |
| Power Analytics | `POST /power-analytics/refresh` | Да |
| Admin | Все маршруты `/admin/*` | Да (router.use(isAdmin)) |

### 7.3. Полный перечень API-маршрутов

#### Auth (`/api/auth`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| POST | `/login` | Вход | Нет |
| POST | `/register` | Регистрация | Нет |
| POST | `/refresh` | Обновление токенов | Refresh token |
| GET | `/profile` | Профиль | JWT |
| POST | `/logout` | Выход | JWT |
| POST | `/change-password` | Смена пароля | JWT |

#### Buildings (`/api/buildings`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/` | Список зданий | JWT |
| GET | `/search` | Геопоиск | JWT |
| GET | `/statistics` | Статистика | JWT |
| GET | `/:id` | Здание по ID | JWT |
| POST | `/` | Создать | JWT + rate limit + валидация |
| PUT | `/:id` | Обновить | JWT + rate limit + валидация |
| DELETE | `/:id` | Удалить | JWT + rate limit |

#### Controllers (`/api/controllers`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/` | Список | JWT |
| GET | `/statistics` | Статистика | JWT |
| GET | `/:id` | По ID | JWT |
| GET | `/building/:buildingId` | По зданию | JWT |
| GET | `/:id/metrics` | Метрики контроллера | JWT |
| POST | `/` | Создать | JWT + rate limit + валидация |
| POST | `/update-status-by-activity` | Обновить статусы | JWT + admin |
| PUT | `/:id` | Обновить | JWT + rate limit + валидация |
| PATCH | `/:id/status` | Изменить статус | JWT + rate limit |
| DELETE | `/:id` | Удалить | JWT + rate limit |

#### Metrics (`/api/metrics`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| POST | `/telemetry` | Приём телеметрии | Нет (публичный) |
| GET | `/` | Список | JWT |
| GET | `/latest` | Последние | JWT |
| GET | `/:id` | По ID | JWT |
| GET | `/controller/:controllerId` | По контроллеру | JWT |
| GET | `/controller/:controllerId/aggregated` | Агрегированные | JWT |
| POST | `/` | Создать | JWT + rate limit |
| DELETE | `/cleanup` | Очистка старых | JWT + rate limit |
| DELETE | `/:id` | Удалить | JWT + rate limit |

#### Buildings-Metrics (`/api/buildings-metrics`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/` | Здания + метрики для карты | optionalAuth (публичный с расширением) |

#### Analytics (`/api/analytics`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/transformers` | Все с аналитикой | JWT |
| GET | `/transformers/overloaded` | Перегруженные | JWT |
| GET | `/transformers/search` | Геопоиск | JWT |
| GET | `/transformers/statistics` | Статистика | JWT |
| GET | `/transformers/:id/load` | Загрузка | JWT |
| GET | `/transformers/:id/buildings` | Ближайшие здания | JWT |
| GET | `/transformers/:id/forecast` | Прогноз | JWT |
| GET | `/zones/load` | По зонам | JWT |
| GET | `/status` | Статус системы | JWT |
| POST | `/transformers` | Создать | JWT + admin |
| PUT | `/transformers/:id` | Обновить | JWT + admin |
| DELETE | `/transformers/:id` | Удалить | JWT + admin |
| POST | `/refresh` | Обновить MV | JWT + admin |
| POST | `/cache/invalidate` | Сброс кэша | JWT + admin |
| POST | `/circuit-breakers/reset` | Сброс CB | JWT + admin |
| PUT | `/thresholds` | Обновить пороги | JWT + admin |

#### Alerts (`/api/alerts`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/` | Активные алерты | JWT |
| GET | `/statistics` | Статистика | JWT |
| GET | `/status` | Статус системы | JWT |
| GET | `/thresholds` | Пороги | JWT |
| POST | `/` | Создать вручную | JWT |
| POST | `/check/transformer/:id` | Проверить трансформатор | JWT + admin |
| POST | `/check/all-transformers` | Проверить все | JWT + admin |
| PATCH | `/:alertId/acknowledge` | Подтвердить | JWT |
| PATCH | `/:alertId/resolve` | Закрыть | JWT |
| PUT | `/thresholds` | Обновить пороги | JWT + admin |

#### Power Analytics (`/api/power-analytics`)

| Метод | Путь | Описание | Авторизация |
|-------|------|----------|-------------|
| GET | `/buildings` | Мощность зданий | JWT |
| GET | `/buildings/:id` | Мощность здания | JWT |
| GET | `/lines` | Мощность линий | JWT |
| GET | `/lines/:id` | Мощность линии | JWT |
| GET | `/transformers` | Загрузка трансформаторов | JWT |
| GET | `/transformers/:id` | Загрузка трансформатора | JWT |
| GET | `/phase-imbalance` | Дисбаланс фаз | JWT |
| POST | `/refresh` | Обновление | JWT + admin |

#### Инфраструктура (по аналогии для каждого типа)

- `/api/transformers` -- CRUD трансформаторов (таблица `transformers`)
- `/api/lines` -- CRUD линий электропередач
- `/api/cold-water-sources` -- CRUD источников ХВС
- `/api/heat-sources` -- CRUD источников тепла
- `/api/water-lines` -- CRUD линий водоснабжения
- `/api/water-suppliers` -- CRUD поставщиков воды

#### Admin (`/api/admin`) -- все маршруты требуют admin-роль

- Оптимизированные списки: buildings, controllers, metrics, transformers, lines, water-lines, cold-water-sources, heat-sources
- CRUD для каждой сущности
- Batch-операции: `/buildings/batch`, `/controllers/batch`, `/metrics/batch`, `/transformers/batch`, `/lines/batch`, `/water-lines/batch`
- Глобальный поиск: `/search`
- Статистика: `/stats`
- Экспорт: `/export`

### 7.4. Внешние интеграции

На момент анализа система не имеет активных внешних интеграций. Код содержит заготовки для:

- WebSocket broadcast алертов (заглушка `broadcastAlert()` в alertService.js)
- Webhook-уведомления (закомментированный `sendWebhookNotification()`)
- Email/SMS/Telegram-уведомления (перечислены как TODO в `getCriticalAlertRecipients()`)
- Redis-кэш (опциональный, подключается через `REDIS_URL`)

---

## 8. Система аутентификации и авторизации

### 8.1. Архитектура аутентификации

```
Запрос → src/routes/index.js
         ↓
    isPublicRoute(method, path)?
         ├── Да → next() (без проверки)
         └── Нет → authenticateJWT(req, res, next)
                    ↓
              Есть Authorization header?
                    ├── Нет → 401 "Access token is missing"
                    └── Да → Извлечь Bearer token
                              ↓
                        isTokenBlacklisted(token)?
                              ├── Да → 401 "Token has been revoked"
                              └── Нет → jwt.verify(token, JWT_SECRET)
                                         ├── Ошибка → 401 "Invalid or expired token"
                                         └── Успех → findUserById(decoded.user_id)
                                                      ├── Не найден → 401
                                                      ├── is_locked → 401
                                                      └── OK → req.user = {...}, next()
```

### 8.2. Default-deny middleware

Реализован в `src/routes/index.js`. **Все маршруты по умолчанию требуют JWT-токен**, кроме явного allowlist (`PUBLIC_ROUTES`). Это центральный middleware, применяемый через `router.use()` перед монтированием sub-роутеров.

Allowlist:
- `POST /auth/login`
- `POST /auth/register`
- `POST /auth/refresh`
- `POST /metrics/telemetry`
- `GET /buildings-metrics`
- `GET /` (корневой маршрут API)

### 8.3. Optional auth (двухуровневый доступ)

Middleware `optionalAuth` (`src/middleware/auth.js`) используется для маршрута `/buildings-metrics`:
- Если токен отсутствует или невалиден -- `req.user = null`, запрос продолжается
- Если токен валиден -- `req.user` заполняется данными пользователя
- Контроллер возвращает разный набор данных в зависимости от `req.user`

### 8.4. Admin guards

Middleware `isAdmin` (`src/middleware/auth.js`):
- Проверяет `req.user.role === 'admin'`
- При несоответствии -- 403 "Requires admin privileges"
- Применяется:
  - На уровне отдельных маршрутов (analytics, alerts, power-analytics, controllers)
  - На уровне всего роутера (`router.use(isAdmin)` для `/admin/*`)

### 8.5. Token lifecycle

1. **Создание**: при логине генерируются access token (24h) + refresh token (7d)
2. **Использование**: access token передаётся в `Authorization: Bearer <token>`
3. **Обновление**: refresh token отправляется в body `POST /auth/refresh`, старый refresh token помещается в blacklist, выдаётся новая пара
4. **Отзыв**: при logout access token помещается в blacklist (L1: in-memory + L2: PostgreSQL)
5. **Очистка**: ежечасно из таблицы `token_blacklist` удаляются записи с `expires_at < NOW()`

---

## 9. Нефункциональные требования

### 9.1. Производительность

| Механизм | Реализация | Файл |
|----------|-----------|------|
| **Многоуровневый кэш** | L1: In-memory Map (TTL 1 мин, макс 1000 записей) + L2: Redis (TTL 5 мин, опциональный) | `src/services/cacheService.js` |
| **Пагинация** | Все списковые эндпоинты поддерживают `page`/`limit` с макс. значением 200 | `src/utils/queryValidation.js` |
| **Материализованные представления** | `mv_transformer_load_realtime` -- предрассчитанные данные загрузки трансформаторов | `database/init/01_init_database.sql` |
| **Составные индексы** | `idx_metrics_ctrl_ts` (controller_id, timestamp DESC) для частых запросов | Миграция 007 |
| **GiST-индексы** | На геометрических полях всех таблиц с координатами | Схема БД |
| **GIN-индексы** | На JSONB-полях `main_path` и `branches` для линий | Схема БД |
| **Partial-индексы** | `idx_users_active WHERE is_active = true`, `idx_metrics_leak WHERE leak_sensor = true` | Схема БД |
| **Circuit Breaker** | 3 инстанса с разными порогами: Analytics (3/30s), Database (5/60s), ExternalService (2/120s) | `src/utils/circuitBreaker.js` |
| **Slow down** | Замедление запросов после 20 req/min (задержка 500ms за каждый, макс 5 сек) | `src/middleware/rateLimiter.js` |
| **Connection pool** | `pg` Pool: max 20, min 2, idle timeout 30 сек | `src/config/database.js` |

### 9.2. Безопасность

| Механизм | Реализация | Файл |
|----------|-----------|------|
| **Default-deny JWT** | Все маршруты требуют JWT кроме явного allowlist (6 маршрутов) | `src/routes/index.js` |
| **Helmet** | CSP (условный: строгий в production, мягкий в dev), X-Frame-Options, X-Content-Type-Options и др. | `src/server.js` |
| **CORS** | Настраивается через `CORS_ORIGINS`, по умолчанию `http://localhost:8080` | `src/server.js` |
| **Rate limiting** | 6 лимитеров: analytics (30/min), admin (20/min), CRUD (60/min), telemetry (120/min), auth login (10/15min), register (5/hour) | `src/middleware/rateLimiter.js` |
| **SQL Injection** | Whitelist-валидация `sort`/`order` параметров, параметризованные запросы через `$1`, `$2` | `src/utils/queryValidation.js` |
| **XSS на сервере** | Проверка XSS-паттернов при валидации контроллеров (express-validator), DOMPurify на бэкенде | `src/middleware/validators.js` |
| **XSS на клиенте** | DOMPurify, `textContent` вместо `innerHTML`, `escapeHTML()`, `sanitizePopupContent()` | `public/utils/domSecurity.js` |
| **Хэширование паролей** | bcrypt, 12 раундов | `src/services/authService.js` |
| **Блокировка аккаунта** | 5 неудачных попыток -> блокировка на 15 минут | `src/services/authService.js` |
| **Token blacklist** | Двухуровневый (memory + DB), SHA-256 хэши, автоочистка | `src/services/authService.js` |
| **JSON body limit** | 1 MB максимум | `src/server.js` |
| **Клиентская валидация JWT** | Проверка формата и срока действия перед отправкой | `public/utils/domSecurity.js` |

### 9.3. Надёжность

| Механизм | Реализация |
|----------|-----------|
| **Circuit Breaker с fallback** | При отказе материализованных представлений данные берутся из базовых таблиц |
| **Graceful error handling** | Глобальный errorHandler middleware, try-catch во всех контроллерах |
| **Process crash protection** | `uncaughtException` и `unhandledRejection` handlers |
| **Database reconnection** | AlertService ожидает готовность БД (до 30 попыток с интервалом 1 сек) |
| **Timer cleanup** | `.unref()` на всех setInterval для корректного завершения процесса |
| **Structured logging** | Winston: console + файлы (combined.log, error.log), уровни info/debug/warn/error |
| **Health check** | `GET /health` для Docker readiness probe |
| **Docker healthcheck** | Для всех трёх сервисов (frontend, app, postgres) с intervals и retries |

### 9.4. Масштабируемость

- Архитектура **готова к горизонтальному масштабированию** при условии вынесения кэша в Redis (уже поддерживается, требуется `REDIS_URL`)
- PostgreSQL pool с настраиваемыми параметрами
- Stateless-аутентификация (JWT), кроме blacklist (требует общего хранилища при >1 инстанса)
- Генератор данных -- отдельный сервис с собственным Dockerfile

---

## 10. Конфигурация и развёртывание

### 10.1. Переменные окружения

| Переменная | Обязательная | Значение по умолчанию | Описание |
|-----------|-------------|---------------------|----------|
| `DB_HOST` | Да | -- | Хост PostgreSQL |
| `DB_PORT` | Нет | `5432` | Порт PostgreSQL |
| `DB_NAME` | Да | -- | Имя базы данных |
| `DB_USER` | Да | -- | Пользователь БД |
| `DB_PASSWORD` | Да | -- | Пароль БД |
| `JWT_SECRET` | Да | -- | Секрет для подписи access token |
| `JWT_REFRESH_SECRET` | Да | -- | Секрет для подписи refresh token |
| `JWT_EXPIRES_IN` | Нет | `24h` | Время жизни access token |
| `NODE_ENV` | Нет | `development` | Окружение (development/production) |
| `PORT` | Нет | `3000` | Порт Express-сервера |
| `CORS_ORIGINS` | Нет | `http://localhost:8080` | Разрешённые CORS-источники (через запятую) |
| `LOG_LEVEL` | Нет | `info` | Уровень логирования (info/debug/warn/error) |
| `REDIS_URL` | Нет | -- | URL Redis для кэширования (опционально) |
| `GENERATOR_CRON` | Нет | `*/2 * * * *` | Cron-расписание генератора (для generator-сервиса) |

### 10.2. Docker Compose конфигурации

| Файл | Назначение |
|------|------------|
| `docker-compose.dev.yml` | Разработка: Nginx (8080), Node.js (3000), PostgreSQL (5435), volume-mounting исходников, hot reload |
| `docker-compose.prod.yml` | Production-сборка |
| `docker-compose.generator.yml` | Генератор тестовых данных (отдельный сервис) |
| `docker-compose.unified.yml` | Унифицированная конфигурация |

### 10.3. Сервисы Docker (development)

| Сервис | Образ | Порт | Описание |
|--------|-------|------|----------|
| `frontend` | `Dockerfile.frontend.dev` | 8080 | Nginx: статика + proxy `/api/*` -> `app:3000` |
| `app` | `Dockerfile.dev` | 3000 | Node.js Express с hot reload (nodemon) |
| `postgres` | `postgis/postgis:15-3.3` | 5435 -> 5432 | PostgreSQL с PostGIS, pg_stat_statements |

### 10.4. Инициализация БД

1. При первом запуске Docker автоматически выполняет скрипты из `database/init/`:
   - `01_init_database.sql` -- создание схемы, таблиц, индексов, функций, триггеров, MV
   - `02_seed_data.sql` -- загрузка тестовых данных (17 зданий в Ташкенте, 34 метрики, 7 типов алертов, 3 источника воды, 3 источника тепла, трансформаторы, пользователи)
2. Миграции (003-009) применяются вручную или при необходимости

### 10.5. Тестовые данные

| Сущность | Количество |
|----------|-----------|
| Пользователи | admin (admin / admin123), testuser (testuser / TestPass123) |
| Здания | 17 (Ташкент, различные районы) |
| Контроллеры | 17 (по одному на здание) |
| Метрики | 34 записи (снимок 3 часов) |
| Типы алертов | 7 (POWER_FAILURE, WATER_LEAK, OVERHEATING, LOW_PRESSURE, COMMUNICATION_LOST, VOLTAGE_ANOMALY, TEMPERATURE_ANOMALY) |
| Трансформаторы (legacy) | 4 |
| Источники ХВС | 3 (насосная, скважина, резервуар) |
| Источники тепла | 3 (котельная, ТЭЦ, центральная котельная) |

---

## 11. Тестирование

### 11.1. Структура тестов

```
tests/
  jest/
    setup.js                    # Setup файл Jest
    simple.test.js              # Базовые smoke-тесты
    unit/
      alertService.test.js      # Unit-тесты сервиса алертов
      services.test.js          # Unit-тесты сервисов
    integration/
      api.test.js               # Интеграционные API-тесты
      default-deny.test.js      # Тесты default-deny JWT middleware
    security/
      security.test.js          # Тесты безопасности
      xss-protection.test.js    # Тесты XSS-защиты
      sql-injection.test.js     # Тесты SQL-инъекций
  orchestrator/
    unified-test-runner.sh      # Shell-скрипт для запуска полного набора тестов
  logs/                         # Логи тестовых прогонов
```

### 11.2. Команды запуска

| Команда | Описание |
|---------|----------|
| `npm test` | Все Jest-тесты |
| `npm run test:unit` | Unit-тесты |
| `npm run test:integration` | Интеграционные тесты |
| `npm run test:security` | Тесты безопасности |
| `npm run test:coverage` | С отчётом покрытия |
| `npm run test:watch` | Watch-режим |
| `./tests/orchestrator/unified-test-runner.sh all` | Полный набор (требует запущенного API) |

### 11.3. Тесты default-deny

Файл `tests/jest/integration/default-deny.test.js` проверяет:

1. **Защищённые маршруты без токена -> 401**: GET /buildings, GET /controllers, GET /alerts, POST /auth/logout
2. **Публичные маршруты без токена -> НЕ 401**: GET /, GET /buildings-metrics, POST /auth/login, POST /auth/register
3. **Авторизованные запросы -> 200**: GET /buildings, GET /controllers, GET /alerts с mock-токеном
4. **Boundary-тесты**: публичные маршруты не блокируются даже на deny-приложении

Тесты используют изолированное Express-приложение с mock-ами для auth, database, services, и rate limiters.

---

## 12. Известные ограничения и технический долг

### 12.1. TODO/FIXME в коде

| Файл | Описание |
|------|----------|
| `src/services/alertService.js:286` | `TODO: Реализовать WebSocket broadcast` -- уведомления в реальном времени через WebSocket |
| `src/controllers/powerAnalyticsController.js:185` | `TODO: Реализовать расчет для линий электропередач` |
| `src/controllers/powerAnalyticsController.js:203` | `TODO: Реализовать расчет для конкретной линии` |
| `src/controllers/powerAnalyticsController.js:290` | `TODO: подсчитать линии` -- счётчик линий в статистике |
| `src/controllers/powerAnalyticsController.js:409` | `TODO: Реализовать анализ дисбаланса фаз` |

### 12.2. Архитектурные проблемы

| Проблема | Описание | Приоритет |
|----------|----------|-----------|
| **Монолитные фронтенд-файлы** | `public/admin.js` (~2300 строк), `public/script.js` (~1400 строк) -- сложно поддерживать и тестировать | Средний |
| **Отсутствие Repository pattern** | Модели выполняют SQL напрямую (`pg` Pool), что затрудняет unit-тестирование и создаёт связность между бизнес-логикой и БД | Средний |
| **Дублирование кода** | Маршруты водной инфраструктуры (water-sources, heat-sources, water-lines, water-suppliers) имеют схожую структуру без общего абстрактного контроллера | Низкий |
| **Двойная система трансформаторов** | `power_transformers` (legacy, varchar PK) и `transformers` (новая, serial PK) сосуществуют; здания имеют FK к обеим | Средний |
| **Нет WebSocket** | Алерты и обновления метрик доступны только через polling; WebSocket broadcast -- заглушка | Средний |
| **Нет CI/CD** | Отсутствует конфигурация GitHub Actions / GitLab CI | Средний |
| **console.error** | Некоторые маршруты используют `console.error` вместо Winston logger | Низкий |
| **Нет миграций с версионированием** | Миграции -- SQL-файлы без системы управления (нет knex/flyway/liquibase) | Низкий |
| **Отсутствие HTTPS** | Nginx настроен на HTTP (порт 8080), TLS-терминация предполагается на уровне балансировщика | Средний |

### 12.3. Нереализованные функции (заглушки в коде)

- **WebSocket-уведомления**: `broadcastAlert()` в alertService -- логирует вместо отправки
- **Email/SMS/Telegram**: `getCriticalAlertRecipients()` возвращает `[{ type: 'log' }]`
- **Webhook-уведомления**: закомментированный `sendWebhookNotification()`
- **Анализ дисбаланса фаз**: эндпоинт `/phase-imbalance` возвращает заглушку
- **Расчёт мощности линий**: эндпоинты `/power-analytics/lines` возвращают заглушки
- **Экспорт в XLSX**: эндпоинт `/admin/export` указывает поддержку XLSX, но реализация требует проверки

### 12.4. Безопасность (потенциальные улучшения)

- JWT secrets в docker-compose.dev.yml хранятся в открытом виде (для dev-окружения)
- Отсутствует ротация JWT secrets
- Нет CSRF-токенов на серверной стороне (только клиентская заглушка `public/utils/csrf.js`)
- Rate limiter хранит данные in-memory (потеряются при перезапуске, не работает с несколькими инстансами)
- Блокировка аккаунта хранится в in-memory кэше (потеряется при перезапуске)

---

*Документ сформирован автоматически на основе анализа исходного кода проекта InfraSafe. Для уточнения требований, не отражённых в коде (бизнес-контекст, SLA, требования к доступности), необходима консультация с владельцем продукта.*
