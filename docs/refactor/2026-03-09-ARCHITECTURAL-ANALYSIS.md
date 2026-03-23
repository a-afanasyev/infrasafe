# Архитектурный анализ InfraSafe Habitat IQ

**Дата:** 2026-03-09
**Версия:** 1.0
**Автор:** Senior Fullstack Architect
**Кодовая база:** ветка `fix/p0-p1-security-and-hygiene`, коммит `70f8d35`
**Версия системы:** 1.0.1

---

## 1. Резюме (Executive Summary)

InfraSafe Habitat IQ -- функционально зрелая IoT-платформа мониторинга инженерных систем многоквартирных домов с чётко выраженной предметной областью и работающим MVP. Система покрывает сбор телеметрии, визуализацию на карте Leaflet с несколькими слоями инфраструктуры, автоматический алертинг по порогам, аналитику загрузки трансформаторов с Circuit Breaker и многоуровневым кэшированием. Бэкенд на Node.js/Express с PostgreSQL/PostGIS -- адекватный стек для данного масштаба (17 зданий, десятки контроллеров). Ключевые архитектурные решения -- отказ от ORM ради контроля над PostGIS-запросами, default-deny JWT, геопространственный поиск через материализованные представления -- оправданы и технически грамотны.

Главная архитектурная проблема -- **неконсистентность**: трёхслойный паттерн (Controller -> Service -> Model) соблюдается лишь в 4 из 10+ модулей; остальные содержат SQL прямо в route-файлах или контроллерах. Три стиля контроллеров (функции, классы, inline-обработчики), два формата ответов (`{data, pagination}` vs `{success, data, count}`), дублирование таблиц трансформаторов (`transformers` и `power_transformers`) и алертов (`alerts` и `infrastructure_alerts`). Фронтенд -- монолитные файлы (`admin.js` -- 2825 строк, `script.js` -- 2328 строк) без модульной системы, 4 несогласованных подхода к HTTP-запросам, 217 вызовов `console.log/warn/error` в продакшн-коде.

По сравнению с индустриальными платформами (ThingsBoard, OpenRemote, Wattsense), InfraSafe отстаёт в трёх критических направлениях: отсутствие протокола MQTT для IoT-устройств (используется HTTP POST), отсутствие WebSocket/SSE для push-обновлений в браузер (все данные получаются поллингом), и отсутствие edge-computing поддержки. При этом InfraSafe имеет конкурентное преимущество -- глубокую доменную модель для ЖКХ (трансформаторы, водоснабжение, теплоснабжение с PostGIS-аналитикой), что отсутствует у универсальных IoT-платформ.

Рекомендуемая стратегия -- **инкрементальная доработка модульного монолита**, а не полная переписка. Предложенный ранее план v2 (объединение с UK Management Bot, Vue 3 SPA, grammY Telegram, PostgreSQL schemas) архитектурно грамотен, но преждевременен: текущий технический долг не позволит чисто построить v2 поверх существующей базы. Сначала необходимо устранить P0/P1 проблемы (12-16 дней по плану рефакторинга), затем -- модульная реорганизация бэкенда с вертикальными слайсами, и только после этого -- расширение функциональности.

Общая оценка зрелости: **5.5 из 10** для production-готовности. Для пилотной эксплуатации на малом масштабе (до 50 зданий) -- пригодна после устранения P0-уязвимостей. Для масштабирования и коммерческой эксплуатации -- требуется 3-4 месяца планомерной работы.

---

## 2. Анализ текущей архитектуры

### 2.1. Сильные стороны

**1. Грамотный выбор стека для предметной области**

PostgreSQL с PostGIS -- идеальный выбор для платформы с геопространственными запросами. Материализованное представление `mv_transformer_load_realtime` (файл `database/init/01_init_database.sql`, строки 829-858) эффективно агрегирует данные о загрузке трансформаторов через JOIN из 4 таблиц с оконными функциями. Триггеры автоматически обновляют `geom` при изменении координат (строки 671-696). Функция `find_nearest_buildings_to_transformer()` (строки 890-917) использует `ST_DWithin` с проекцией в метрическую СК (EPSG:3857). Отказ от ORM оправдан -- ни Sequelize, ни Prisma не дают полноценного контроля над PostGIS-функциями и материализованными представлениями.

**2. Circuit Breaker с fallback-стратегией**

`src/utils/circuitBreaker.js` -- хорошо реализованный паттерн с тремя состояниями (CLOSED/OPEN/HALF_OPEN), fallback-функциями, статистикой и мониторингом. `AnalyticsService` (`src/services/analyticsService.js`, строки 25-80) демонстрирует правильное применение: при сбое материализованного представления fallback возвращает базовые данные из основной таблицы с флагом `is_fallback: true`.

**3. Многоуровневое кэширование**

`src/services/cacheService.js` реализует двухуровневый кэш (in-memory Map + опциональный Redis) с автоматической очисткой, инвалидацией по паттерну и ограничением максимального количества записей (1000). Готовность к Redis-интеграции через `process.env.REDIS_URL` -- правильный подход "start simple, scale when needed".

**4. Default-deny JWT-архитектура**

`src/routes/index.js`, строки 79-101 -- глобальный middleware с явным allowlist публичных маршрутов. Это надёжнее, чем защита отдельных маршрутов на уровне route-файлов, так как новые маршруты автоматически требуют аутентификацию. Дополнительно реализован `optionalAuth` для двухуровневого доступа к `/buildings-metrics`.

**5. Комплексная безопасность**

- Rate limiting: собственная реализация без внешних зависимостей (`rateLimiter.js`, 387 строк), 7 предустановленных профилей с SlowDown-стратегией
- SQL injection: whitelist-валидация параметров сортировки (`queryValidation.js`), параметризованные запросы
- XSS: `domSecurity.js` с DOMPurify, `escapeHTML`, `sanitizePopupContent`
- CSP через helmet с условным режимом для dev/production
- Token blacklist с cooldown, account locking после 5 неудачных попыток

**6. Продуманная доменная модель**

Схема БД (991 строка SQL) покрывает полный спектр инженерной инфраструктуры: здания, контроллеры, метрики, трансформаторы, линии электропередач с JSONB-маршрутами, линии водоснабжения, источники воды и тепла, поставщики. Партиционированная таблица `analytics_history` для долгосрочного хранения. Функция `archive_daily_analytics()` для архивации.

---

### 2.2. Архитектурные проблемы

**Проблема 1: Неконсистентность трёхслойной архитектуры (критическая)**

Заявленный паттерн Controller -> Service -> Model соблюдается только в 4 модулях:
- `buildings`: `buildingController.js` -> `buildingService.js` -> `Building.js`
- `metrics`: `metricController.js` -> `metricService.js` -> `Metric.js`
- `controllers`: `controllerController.js` -> `controllerService.js` -> `Controller.js`
- `analytics`: `analyticsController.js` -> `analyticsService.js` -> `PowerTransformer.js`

Нарушения в 60% модулей:

| Модуль | Паттерн | Файл | Строки |
|--------|---------|------|--------|
| waterSourceRoutes | Route -> DB.query() напрямую | `src/routes/waterSourceRoutes.js` | строка 3 |
| heatSourceRoutes | Route -> DB.query() напрямую | `src/routes/heatSourceRoutes.js` | строка 3 |
| adminController | Controller -> DB.query() | `src/controllers/adminController.js` | ~1830 строк |
| powerAnalytics | Controller -> DB.query() | `src/controllers/powerAnalyticsController.js` | строка 10 |
| buildingMetrics | Controller -> DB.query() | `src/controllers/buildingMetricsController.js` | строка 1 |
| transformers | Controller -> Model (нет Service) | `src/controllers/transformerController.js` | строка 1 |
| lines | Controller -> Model (нет Service) | `src/controllers/lineController.js` | строка 1 |

Это приводит к:
- Невозможности юнит-тестирования бизнес-логики без БД
- Дублированию SQL-запросов между модулями
- Нарушению принципа единой ответственности (SRP)

**Проблема 2: Дублирование сущностей в БД**

Две таблицы трансформаторов:
- `transformers` (serial ID, связана с `lines` через FK) -- используется `Transformer.js`
- `power_transformers` (varchar ID, legacy) -- используется `PowerTransformer.js`, материализованное представление `mv_transformer_load_realtime`

Две системы алертов:
- `alerts` (legacy, FK на `alert_types` и `metrics`) -- используется `Alert.js`
- `infrastructure_alerts` (новая, с `severity`, `data jsonb`, `acknowledged_by`) -- используется `alertService.js`

Тройное хранение координат линий:
- `latitude_start/end, longitude_start/end` (скалярные поля)
- `main_path JSONB` (массив точек с порядком)
- `geom GEOMETRY(LINESTRING, 4326)` (PostGIS)

**Проблема 3: Монолитный фронтенд без модульной системы**

| Файл | Строк | Содержимое |
|------|-------|-----------|
| `public/admin.js` | 2825 | CRUD 8 сущностей, пагинация, фильтры, модальные окна |
| `public/script.js` | 2328 | Карта, маркеры, APIClient, тема, баннеры, login |
| `public/map-layers-control.js` | ~1200 | Слои карты, fetch, popups |

4 несогласованных подхода к HTTP-запросам:
1. `APIClient` класс в `script.js` -- с rate limiter, JWT
2. Monkey-patch `window.fetch` в `admin-auth.js`
3. Прямой `fetch()` + ручной header в `admin.js`
4. Прямой `fetch()` + localStorage в `map-layers-control.js`

217 вызовов `console.log/warn/error` в продакшн-коде фронтенда. 47 использований `innerHTML` (частично через DOMPurify, но не все).

**Проблема 4: Отсутствие real-time push-механизма**

Все обновления данных на карте и в админке получаются поллингом (периодические HTTP-запросы). Для IoT-платформы мониторинга это фундаментальное ограничение:
- Задержка обнаружения инцидентов = интервал поллинга
- Избыточная нагрузка на API при пустых ответах
- WebSocket/SSE не реализованы (в `alertService.js`, строка 284: `broadcastAlert()` -- заглушка с TODO)

**Проблема 5: HTTP-only для телеметрии IoT-устройств**

Контроллеры отправляют данные через `POST /api/metrics/telemetry` (HTTP REST). Это работает для десятков устройств, но не масштабируется:
- HTTP overhead на каждый пакет (headers, TLS handshake)
- Нет подтверждения доставки на уровне протокола (QoS)
- Нет буферизации при потере связи
- Индустриальный стандарт -- MQTT с QoS 1/2

---

### 2.3. Технический долг

**Количественная оценка:**

| Категория | Элементов | Влияние |
|-----------|----------|---------|
| Дублирующие таблицы БД | 2 пары (transformers, alerts) | Рассинхронизация данных |
| Модули без Service-слоя | 7 из 11 | Невозможность юнит-тестирования |
| `console.log` в продакшн-коде | 217 вызовов | Шум в консоли, утечка информации |
| `innerHTML` без DOMPurify | ~10 из 47 | Потенциальный XSS |
| `setInterval` без `clearInterval` | 15 в src/ | Утечки таймеров |
| Тесты: покрытие контроллеров | 0 из 8 | Регрессии при рефакторинге |
| Тесты: покрытие моделей | 0 из 10 | Регрессии при изменении SQL |
| Несогласованных API-форматов | 3+ варианта | Сложность клиентской интеграции |

**Устаревший код:**
- `src/config/app.js` -- альтернативный Express app, нигде не импортируется
- Дублирующее поле `hot_water` и `has_hot_water` в таблице `buildings`
- Mock-данные в `public/analytics/js/analytics.js` (строки 162-194) -- при ошибке API генерируются фиктивные графики без предупреждения пользователя

**Тестовое покрытие (8 тестовых файлов):**

| Файл теста | Тип | Что покрывает |
|------------|-----|--------------|
| `simple.test.js` | Unit | 3 тривиальных теста |
| `services.test.js` | Unit | ~10 методов сервисов |
| `alertService.test.js` | Unit | alertService |
| `default-deny.test.js` | Integration | 13 тестов default-deny middleware |
| `api.test.js` | Integration | ~8 эндпоинтов (требует БД) |
| `security.test.js` | Security | Базовые проверки безопасности |
| `xss-protection.test.js` | Security | Статический анализ XSS |
| `sql-injection.test.js` | Security | SQL injection |

Итого: ~50 тестов, из них работоспособных без БД -- ~30. Покрытие контроллеров и моделей -- 0%.

---

### 2.4. Безопасность

**Устранённые уязвимости (в текущей ветке `fix/p0-p1-security-and-hygiene`):**
- Default-deny JWT middleware (P0)
- Двухуровневый доступ к `/buildings-metrics` (P0)
- SQL injection в `alertService.js` -- `INTERVAL '1 day' * $1` вместо интерполяции (P0)
- XSS: замена `innerHTML` на `textContent` для API-данных в admin.js
- Удалён meta CSP из HTML (единый источник -- helmet)
- Swagger global security по умолчанию `bearerAuth`
- Нормализация `line_type` для water-lines

**Оставшиеся уязвимости:**

| ID | Серьёзность | Описание | Файл |
|----|-------------|----------|------|
| SEC-1 | КРИТИЧЕСКАЯ | `.env` файлы в git-истории (секреты JWT, пароли БД) | `.env`, `.env.prod` |
| SEC-2 | ВЫСОКАЯ | Token blacklist только в памяти -- сбрасывается при рестарте | `authService.js` |
| SEC-3 | ВЫСОКАЯ | `JWT_REFRESH_SECRET` fallback на `JWT_SECRET` -- один ключ для access и refresh | `authService.js:14` |
| SEC-4 | СРЕДНЯЯ | CSP с `unsafe-inline` + `unsafe-eval` в development (может утечь в production при неверном NODE_ENV) | `server.js:30-32` |
| SEC-5 | СРЕДНЯЯ | Rate limiter не подключён к 11 из 16 route-файлов | Все route-файлы кроме telemetry, analytics, admin |
| SEC-6 | СРЕДНЯЯ | `validateSearchString()` использует regex-замены вместо параметризации (`replace(/script/gi, '')` обходится через `scrscriptipt`) | `queryValidation.js:218-223` |
| SEC-7 | НИЗКАЯ | Нет HTTPS redirect на уровне Express (зависимость от Nginx конфигурации) | `server.js` |
| SEC-8 | НИЗКАЯ | Health endpoint `/health` не проверяет состояние БД и Redis | `server.js:52-54` |

---

## 3. Анализ рынка и конкурентов

### 3.1. Обзор рынка умных зданий и IoT-платформ

Глобальный рынок Building Management System (BMS) оценивается в $22.95 млрд в 2025 году с прогнозом роста до $60.76 млрд к 2030 году (CAGR 20.7%). Рынок IoT-платформ для коммерческих зданий -- $64.1 млрд в 2024 с прогнозом $101 млрд к 2030 (CAGR 7.87%). Общий рынок smart buildings достиг $141.79 млрд в 2025 году (CAGR 18.9% до 2033).

Ключевые драйверы роста:
- Требования к энергоэффективности (ESG-повестка, зелёные сертификации)
- Рост стоимости коммунальных ресурсов, стимулирующий мониторинг и оптимизацию
- Развитие edge computing (снижение задержек на 40-60% по сравнению с cloud-only)
- AI/ML для предиктивного обслуживания и обнаружения аномалий
- Стандартизация протоколов (BACnet, Modbus, MQTT, OPC UA)

Региональная динамика: Европа -- крупнейший рынок BMS; Азиатско-Тихоокеанский регион -- самый быстрорастущий. Для InfraSafe (Узбекистан/СНГ) -- это растущий рынок с низкой конкуренцией и высоким потенциалом.

### 3.2. Ключевые конкуренты и их технологические решения

**Открытые IoT-платформы:**

| Платформа | Стек | Протоколы | Особенности | Ограничения |
|-----------|------|-----------|-------------|-------------|
| **ThingsBoard** | Java (Spring), PostgreSQL/Cassandra, Angular | MQTT, CoAP, HTTP, LwM2M | Rule engine, dashboards, multi-tenancy, device management | Коммерциализация продвинутых функций, тяжёлый стек |
| **OpenRemote** | Java (JBoss/Wildfly), PostgreSQL, Keycloak | MQTT, HTTP, Z-Wave, KNX | 100% open source, smart city фокус, правила автоматизации | Сложность развёртывания, крутая кривая обучения |
| **Node-RED** | Node.js, flow-based | MQTT, HTTP, WebSocket | Визуальное программирование, 5000+ узлов в NPM | Не полноценная платформа, нет управления устройствами |
| **Kaa IoT** | Java, MongoDB/Cassandra | MQTT, CoAP, HTTP | Data collection, device management, analytics | Специфичная документация, Enterprise-ориентация |

**Коммерческие SaaS-платформы:**

| Платформа | Фокус | Ценовая модель |
|-----------|-------|---------------|
| **Wattsense** | BMS для существующих зданий (retrofit) | SaaS, подписка по зданиям |
| **KODE Labs** | Единая платформа управления зданием | Enterprise SaaS |
| **Cohesion** | Умные здания (occupancy, HVAC, lighting) | Enterprise SaaS |
| **Siemens Navigator** | Полный цикл BMS | Enterprise, custom pricing |

**Облачные решения:**

| Платформа | Стоимость | Преимущество |
|-----------|-----------|-------------|
| **AWS IoT Core** | Pay-per-message | MQTT broker, Rules Engine, Device Shadow |
| **Azure IoT Hub** | По тирам | Digital Twins, Edge Runtime, Stream Analytics |
| **Google Cloud IoT** | Закрыт в 2023 | Мигрировал на партнёрские решения |

### 3.3. Тренды технологического стека 2025-2026

**1. Протоколы связи с устройствами:**
- MQTT v5 -- де-факто стандарт для IoT (pub/sub, QoS 0/1/2, retained messages). 99.5% надёжность доставки в нестабильных сетях.
- MQTT over WebSocket -- для браузерных клиентов реального времени (dashboard updates).
- LoRaWAN -- для зданий без проводной инфраструктуры (низкое энергопотребление, покрытие целого здания).
- Sparkplug 3.0 -- стандартизация payload-форматов поверх MQTT для промышленного IoT.

**2. Архитектурные паттерны:**
- **Edge-Cloud Hybrid**: обработка time-critical данных на edge-устройствах, агрегация и ML в облаке.
- **Unified Namespace (UNS)**: единое пространство имён для OT и IT данных через MQTT-брокер.
- **Digital Twins**: виртуальные модели зданий, синхронизированные с реальными показаниями.
- **Event-Driven Architecture**: для IoT-данных -- оправдан (в отличие от CRUD).

**3. Frontend:**
- React/Next.js или Vue 3/Nuxt -- для SPA-дашбордов.
- MapLibre GL / Deck.gl -- для 3D-визуализации и больших объёмов геоданных.
- WebSocket/SSE -- обязательно для real-time обновлений.

**4. Backend:**
- Node.js 20+ (с нативными worker threads) -- отличный выбор для I/O-bound IoT.
- Go -- альтернатива для высоконагруженной обработки телеметрии.
- TimescaleDB (PostgreSQL extension) -- для хранения и запросов time-series данных.
- InfluxDB/QuestDB -- специализированные TSDB для метрик.

**5. Observability:**
- OpenTelemetry -- единый стандарт для traces, metrics, logs.
- Structured logging (JSON) с correlation ID.
- Grafana + Prometheus для мониторинга инфраструктуры.

### 3.4. Актуальность выбранного стека InfraSafe

| Компонент InfraSafe | Индустриальный стандарт | Оценка |
|---------------------|----------------------|--------|
| Node.js/Express | Node.js/Fastify, Go, Java | Адекватно. Express устарел (Fastify 2x производительнее), но для текущего масштаба -- достаточно |
| PostgreSQL + PostGIS | PostgreSQL + PostGIS + TimescaleDB | Хорошо. PostGIS -- правильный выбор. Не хватает TimescaleDB для time-series метрик |
| HTTP POST для телеметрии | MQTT + HTTP (fallback) | Слабо. HTTP overhead критичен при масштабировании. MQTT -- обязательный следующий шаг |
| In-memory cache | Redis | Допустимо на малом масштабе. Redis нужен для кластерного развёртывания и persistent cache |
| Vanilla JS фронтенд | Vue 3 / React SPA | Слабо. Отсутствие модульности, 2800-строчные файлы, нет state management |
| Polling для обновлений | WebSocket / SSE / MQTT over WS | Критическая нехватка. IoT-платформа без push -- не production-ready |
| Winston logging | Structured JSON logging (Pino/Bunyan) | Допустимо. Winston работает, но Pino производительнее для Node.js |
| Jest тесты | Jest + Supertest + TestContainers | Фреймворк хороший, покрытие -- критически низкое |
| Docker Compose | Docker Compose / K8s | Адекватно для текущего масштаба |
| Нет CI/CD | GitHub Actions / GitLab CI | Критическая нехватка для quality gate |

**Общая оценка стека: адекватен для MVP, требует эволюции для production.**

---

## 4. Рекомендации по улучшению

### 4.1. Критические (P0) -- делать немедленно

**P0-1. Ротация секретов и удаление .env из git** `Complexity: Appropriate`

Проблема: `.env` и `.env.prod` в git-истории содержат JWT-секреты и пароли БД.

Действия:
1. `git rm --cached .env .env.prod generator/.env`
2. Создать `.env.example` с placeholder-значениями
3. Ротировать ВСЕ секреты (JWT_SECRET, JWT_REFRESH_SECRET, DB_PASSWORD)
4. Если репозиторий публичный -- рассмотреть `git filter-branch` или BFG Repo-Cleaner

Оценка: 2-3 часа.

**P0-2. Персистентный token blacklist** `Complexity: Appropriate`

Проблема: При перезапуске сервера все отозванные токены снова валидны.

Действия:
1. `authService.js`: `blacklistToken()` -- вставка в таблицу `token_blacklist` (уже существует в схеме, строки 53-58)
2. `isTokenBlacklisted()` -- проверка сначала memory cache, при miss -- `SELECT FROM token_blacklist`
3. Добавить cleanup job: `DELETE FROM token_blacklist WHERE expires_at < NOW()`

Оценка: 4-6 часов.

**P0-3. Разделить JWT_SECRET и JWT_REFRESH_SECRET** `Complexity: Appropriate`

Проблема: `authService.js` строка 14 -- fallback `JWT_REFRESH_SECRET || JWT_SECRET` означает, что access token может быть предъявлен как refresh.

Действие: Убрать fallback, требовать отдельный `JWT_REFRESH_SECRET` в production (throw при отсутствии).

Оценка: 1 час.

---

### 4.2. Высокий приоритет (P1) -- в ближайшем спринте

**P1-1. Подключить rate limiter ко всем маршрутам** `Complexity: Appropriate`

Проблема: `rateLimiter.js` экспортирует 7 профилей, но подключены только 5 из 16 route-файлов.

Действие: Добавить `applyCrudRateLimit` на POST/PUT/DELETE во все оставшиеся route-файлы (buildingRoutes, controllerRoutes, transformerRoutes, lineRoutes, waterLineRoutes, waterSourceRoutes, heatSourceRoutes, waterSupplierRoutes, metricRoutes, powerAnalyticsRoutes, buildingMetricsRoutes).

Оценка: 2-3 часа.

**P1-2. Условный CSP для production** `Complexity: Appropriate`

Проблема: `server.js` строки 30-32 содержат `unsafe-inline` + `unsafe-eval` для Swagger UI, но Swagger уже отключён в production (строка 60). CSP должен быть строгим в production.

Действие: уже частично реализовано (строки 30-32 условный `scriptSrc`), но нужно убедиться, что `NODE_ENV=production` устанавливается при деплое.

Оценка: 1 час.

**P1-3. Удалить console.log из продакшн-кода** `Complexity: Appropriate`

Проблема: 217 вызовов `console.log/warn/error` в frontend-файлах. Засоряют консоль, могут утечь sensitive данные.

Действие: `grep -r 'console\.' public/ --include='*.js' -l` и удалить все debug-логи. Оставить только `console.error` для реальных ошибок в production.

Оценка: 2-3 часа.

**P1-4. Унифицировать формат API-ответов** `Complexity: Appropriate`

Проблема: 3+ формата ответов:
- Buildings: `{ data: [...], pagination: { total, page, limit, totalPages } }`
- Analytics: `{ success: true, data: [...], count: N }`
- Water sources: `{ data: [...], pagination: { pages } }` (без `success`)
- Ошибки: `{ error: "..." }` vs `{ success: false, message: "..." }`

Действие: Создать middleware-обёртку для стандартного формата:
```javascript
// Единый формат:
{
  success: boolean,
  data: any,
  pagination?: { page, limit, total, totalPages },
  error?: string
}
```

Оценка: 1-2 дня.

---

### 4.3. Средний приоритет (P2) -- в бэклоге

**P2-1. Реорганизация бэкенда в вертикальные слайсы** `Complexity: Appropriate`

Текущая горизонтальная структура:
```
src/controllers/  -- все контроллеры
src/services/     -- все сервисы
src/models/       -- все модели
src/routes/       -- все маршруты
```

Предлагаемая вертикальная структура (из v2 design):
```
src/modules/
  buildings/
    buildings.controller.js
    buildings.service.js
    buildings.model.js
    buildings.routes.js
  metrics/
    ...
  monitoring/
    alerts/
    transformers/
    power-lines/
    water/
    heat/
```

Это позволит:
- Каждый модуль -- самодостаточная единица с полным стеком
- Легче навигация (файлы одного домена рядом)
- Проще выделение в микросервис при необходимости (Strangler Fig)
- Устранение нарушений трёхслойности (каждый модуль обязан иметь controller + service + model)

Оценка: 3-5 дней.

**P2-2. Консолидация дублирующих таблиц** `Complexity: Appropriate`

1. `transformers` + `power_transformers` -> единая таблица. Миграция данных, обновление MV и моделей
2. `alerts` + `infrastructure_alerts` -> единая `infrastructure_alerts`. Удалить legacy `Alert.js`
3. Координаты линий: оставить `main_path JSONB` + `geom GEOMETRY`, удалить `latitude_start/end`

Оценка: 2-3 дня.

**P2-3. WebSocket/SSE для push-обновлений** `Complexity: Appropriate`

Минимальная реализация:
- SSE (Server-Sent Events) через `res.writeHead(200, {'Content-Type': 'text/event-stream'})` на эндпоинте `/api/events`
- При создании alert -- `broadcastAlert()` отправляет SSE-событие всем подключённым клиентам
- Frontend: `new EventSource('/api/events')` вместо поллинга

SSE предпочтительнее WebSocket для данного случая:
- Однонаправленный поток (сервер -> клиент) достаточен
- Нативная поддержка в браузерах, автоматический reconnect
- Проще деплой через Nginx (не нужна WebSocket-конфигурация)
- Не требует дополнительных библиотек

Оценка: 1-2 дня.

**P2-4. Фронтенд-декомпозиция** `Complexity: Appropriate`

Вариант A (минимальный, без фреймворка):
1. Установить Vite как бандлер
2. Разбить `script.js` -> `map.js`, `api-client.js`, `layers.js`, `theme.js`, `auth.js`
3. Разбить `admin.js` -> по сущностям: `buildings-crud.js`, `controllers-crud.js`, `pagination.js`, `modals.js`
4. Единый `HttpClient` модуль, заменяющий 4 подхода к fetch

Вариант B (из v2 design -- Vue 3 SPA):
- Полная замена vanilla JS на Vue 3 + Vite + Pinia
- vue-leaflet для карты
- Значительно больший объём работы, но долгосрочно правильнее

Рекомендация: Вариант A для ближайших 2-3 месяцев, Вариант B -- стратегическая цель.

Оценка: Вариант A -- 3-5 дней. Вариант B -- 4-6 недель.

**P2-5. Добавить CI/CD pipeline** `Complexity: Appropriate`

GitHub Actions:
```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:15-3.3
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: infrasafe_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

Оценка: 0.5 дня.

---

### 4.4. Стратегические (P3) -- долгосрочная перспектива

**P3-1. MQTT-шлюз для IoT-устройств** `Complexity: Appropriate для данного этапа развития`

Текущий HTTP POST для телеметрии работает, но не масштабируется. Рекомендация:

1. Развернуть MQTT-брокер (Mosquitto или EMQX) рядом с Express-сервером
2. Создать MQTT-bridge сервис в Node.js:
   - Подписка на `infrasafe/+/telemetry` (wildcard по controller_id)
   - Преобразование MQTT-сообщений в вызовы `metricService.processTelemetry()`
3. Оставить HTTP POST как fallback для устройств без MQTT-поддержки

Преимущества:
- QoS 1 гарантирует доставку при нестабильной сети
- Retained messages -- последнее значение для новых подписчиков
- Last Will -- автоматическое обнаружение отключения контроллера
- В 5-10x меньше overhead на каждый пакет по сравнению с HTTP

Оценка: 1-2 недели.

**P3-2. TimescaleDB для time-series метрик** `Complexity: Questionable -- только при доказанной необходимости`

Текущая таблица `metrics` -- обычная PostgreSQL-таблица. При росте до миллионов записей потребуется:
- TimescaleDB hypertable с автоматическим партиционированием по времени
- Continuous aggregates для предрассчитанных агрегатов (часовые, дневные)
- Retention policy для автоматического удаления данных старше N дней

Однако TimescaleDB -- PostgreSQL extension, поэтому интеграция безболезненна и не требует смены стека. Добавлять, когда таблица `metrics` превысит 10М записей.

Оценка: 1-2 дня для базовой настройки.

**P3-3. Observability stack** `Complexity: Appropriate`

1. Заменить Winston на Pino (3-5x производительнее, нативный JSON-формат)
2. Добавить correlation ID middleware (передавать `X-Request-Id` через все слои)
3. Healthcheck endpoint расширить: проверка БД, Redis, MQTT-брокера
4. Prometheus-совместимые метрики: `prom-client` для Express
5. Grafana dashboard для визуализации

Оценка: 3-5 дней.

**P3-4. Объединение с UK Management Bot (InfraSafe v2)** `Complexity: Appropriate, но требует завершения P0-P2`

План v2 (из `docs/refactor/2026-03-07-infrasafe-v2-unified-platform-design.md`) архитектурно обоснован:
- Единая БД с PostgreSQL schemas (`public`, `infrasafe`, `uk`)
- Vue 3 SPA вместо vanilla JS
- grammY для Telegram-бота на Node.js (один стек)
- Redis для кэширования и pub/sub

Однако выполнять v2 **после** устранения техдолга, иначе дублирующие таблицы, неконсистентные паттерны и монолитный фронтенд перенесутся в новую архитектуру.

Рекомендуемая последовательность:
1. P0-P1 (2-3 недели) -- исправления текущей ветки
2. P2 (3-5 недель) -- модульная реорганизация бэкенда, консолидация БД
3. P3 (параллельно) -- MQTT, SSE, CI/CD
4. v2 (8-12 недель) -- Vue 3 SPA, UK-модули, Telegram

---

## 5. Рекомендуемый технологический стек для v2

| Слой | Текущий | Рекомендуемый v2 | Обоснование |
|------|---------|-----------------|-------------|
| **Runtime** | Node.js 20 | Node.js 22 LTS | LTS-поддержка, нативные worker threads |
| **Web-фреймворк** | Express 4 | Fastify 5 | 2x производительнее Express, нативная JSON-schema валидация, TypeScript-first |
| **ORM / Query** | pg (raw SQL) | pg + pgtyped или Kysely | Типизированные SQL-запросы без ORM overhead. Критично для PostGIS |
| **База данных** | PostgreSQL 15 + PostGIS | PostgreSQL 16 + PostGIS + TimescaleDB | Нативные time-series hypertables для метрик |
| **Кэш** | In-memory Map | Redis 7 | Persistent cache, pub/sub для SSE, rate limiting |
| **IoT протокол** | HTTP POST | MQTT (Mosquitto/EMQX) + HTTP fallback | QoS, retained messages, last will, 5-10x меньше overhead |
| **Real-time** | Polling | SSE (Server-Sent Events) | Push-обновления для алертов и метрик |
| **Frontend** | Vanilla JS | Vue 3 + Vite + Pinia | Модульность, state management, vue-leaflet |
| **Карта** | Leaflet.js | Leaflet.js (или MapLibre GL для 3D) | Leaflet достаточен для 2D, MapLibre -- для перспективы |
| **Тесты** | Jest + Supertest | Vitest + Supertest + TestContainers | Vitest -- быстрее для Vue-проектов, TestContainers -- для интеграционных тестов с БД |
| **CI/CD** | Нет | GitHub Actions | Quality gate: lint, test, security scan |
| **Logging** | Winston | Pino | 5x производительнее, нативный JSON |
| **Observability** | Нет | OpenTelemetry + Grafana | Traces, metrics, dashboards |
| **Контейнеризация** | Docker Compose | Docker Compose (dev) / K8s (prod, при масштабировании) | Не переусложнять -- K8s только когда >3 сервисов |
| **Telegram** | Нет | grammY (Node.js) | Один стек, webhook через Express |
| **Типизация** | Нет | TypeScript (постепенная миграция) | JSDoc -> .ts по модулям при рефакторинге |

**Важно: НЕ менять всё сразу.** Каждая замена -- отдельный PR с тестами. Приоритет изменений:

1. Redis (нужен для persistent cache, rate limiting, SSE pub/sub)
2. SSE для push-обновлений (максимальный impact на UX)
3. MQTT для телеметрии (масштабируемость)
4. Vue 3 SPA (замена фронтенда)
5. Fastify (замена Express -- делать вместе с модульной реорганизацией)
6. TypeScript (постепенно, начиная с новых модулей)

---

## 6. Заключение

InfraSafe Habitat IQ -- проект с сильным доменным ядром и адекватным технологическим фундаментом, который нуждается в инженерной дисциплине, а не в полной переписке. Основная ценность платформы -- глубокая доменная модель инженерной инфраструктуры ЖКХ с PostGIS-аналитикой, что отсутствует у универсальных IoT-платформ (ThingsBoard, OpenRemote).

Ключевые выводы:

1. **Стек адекватен**, но требует эволюции: Node.js/PostgreSQL/PostGIS -- правильный выбор. Добавить MQTT, Redis, SSE. Заменить Express на Fastify при модульной реорганизации.

2. **Архитектура нуждается в унификации**, не в смене парадигмы. Модульный монолит с вертикальными слайсами -- правильная архитектура для текущего масштаба (1-3 разработчика, десятки зданий). Микросервисы -- преждевременны и нецелесообразны.

3. **Безопасность требует немедленного внимания**: ротация секретов из git, персистентный blacklist токенов, разделение JWT_SECRET/JWT_REFRESH_SECRET.

4. **Фронтенд -- главный кандидат на рефакторинг**: 2800-строчные файлы без модульности непригодны для командной работы. Минимальная декомпозиция через Vite бандлинг -- первый шаг; Vue 3 SPA -- стратегическая цель.

5. **План v2 (объединение с UK Bot)** -- амбициозный, но архитектурно обоснован. Выполнять после устранения P0-P2, ориентировочно через 2-3 месяца.

6. **IoT-протокол**: переход на MQTT -- обязательный шаг для масштабирования. HTTP POST работает для MVP, но не для production с сотнями устройств.

**Дорожная карта:**

| Этап | Срок | Результат |
|------|------|----------|
| P0: Безопасность | 1-2 дня | Production-safe секреты и токены |
| P1: Гигиена | 3-5 дней | Rate limiting, CSP, unified API format |
| P2: Архитектура | 3-5 недель | Модульный бэкенд, консолидация БД, SSE, CI/CD |
| P3: Инфраструктура | 2-3 недели | MQTT, Redis, observability |
| v2: Объединение | 8-12 недель | Vue 3 SPA, UK-модули, Telegram |

Общий timeline до production-ready v2: **5-6 месяцев** при одном full-time разработчике.

---

*Источники рыночного анализа:*
- [IoT Platforms in Smart Commercial Buildings 2025-2030](https://memoori.com/portfolio/iot-platforms-smart-commercial-building-2025/)
- [Building Management System Market Report 2026](https://www.globenewswire.com/news-release/2026/01/27/3226158/28124/en/Building-Management-System-Market-Report-2026-60-75-Bn-Opportunities-Trends-Competitive-Landscape-Strategies-and-Forecasts-2020-2025-2025-2030F-2035F.html)
- [IoT Trends Shaping Smart Building Tech by 2025](https://building-technologies.messefrankfurt.com/frankfurt/en/media-library/specialized-articles/iot-platforms-2025.html)
- [Guide to Smart Building Technology in 2026](https://www.coram.ai/post/smart-building-technology)
- [MQTT Trends for 2025 and Beyond](https://www.emqx.com/en/blog/mqtt-trends-for-2025-and-beyond)
- [MQTT vs WebSocket](https://www.emqx.com/en/blog/mqtt-vs-websocket)
- [MQTT over WebSockets with HiveMQ: A 2025 Guide](https://www.hivemq.com/blog/mqtt-essentials-special-mqtt-over-websockets/)
- [Using Node.js for IoT Development](https://relevant.software/blog/node-js-for-iot-development/)
- [Open-Source IoT Platform Comparison](https://zediot.com/blog/choosing-the-best-open-source-iot-platform-for-development/)
- [OpenRemote: Making sense of open source IoT platforms](https://www.openremote.io/making-sense-of-open-source-iot-platforms-to-avoid-pitfalls/)
- [Top 30 IoT development platforms 2025](https://www.intuz.com/blog/top-iot-development-platforms-and-tools)
- [Building Management Systems Market Size 2025](https://www.gminsights.com/industry-analysis/building-management-systems-market)
