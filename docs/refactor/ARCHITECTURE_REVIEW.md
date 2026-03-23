# Архитектурный аудит InfraSafe Habitat IQ

**Версия:** 1.0
**Дата:** 2026-03-07
**Аудитор:** Senior Architect
**Кодовая база:** ветка `fix/p0-p1-security-and-hygiene`, коммит `3108954`
**Версия системы:** 1.0.1

---

## Резюме

InfraSafe Habitat IQ -- IoT-платформа мониторинга инженерных систем многоквартирных домов с трехслойной архитектурой (Controllers -> Services -> Models) на Node.js/Express + PostgreSQL/PostGIS. Система функциональна и покрывает заявленную предметную область, однако содержит серьезные архитектурные нарушения: трехслойный паттерн соблюдается лишь для половины модулей, имеются критические проблемы безопасности (`.env` с секретами в git, blacklist токенов в оперативной памяти), и несколько монолитных файлов превышают 1800 строк. Система пригодна для пилотной эксплуатации при масштабе до 100 зданий, но требует существенных доработок перед полноценным production.

---

## 1. Оценка архитектурных решений

### 1.1 Трехслойная архитектура: соблюдение

Заявленная архитектура Controllers -> Services -> Models **соблюдается только для 4 из 10+ модулей**.

**Полностью соблюдается (Controller -> Service -> Model):**
- `buildings`: `buildingController.js` -> `buildingService.js` -> `Building.js`
- `metrics`: `metricController.js` -> `metricService.js` -> `Metric.js`
- `controllers`: `controllerController.js` -> `controllerService.js` -> `Controller.js`
- `analytics` (частично): `analyticsController.js` -> `analyticsService.js` -> `PowerTransformer.js`

**Controller -> Model напрямую (нет Service слоя):**
- `transformerController.js` (строка 1): `const Transformer = require('../models/Transformer')` -- прямой вызов модели
- `lineController.js` (строка 1): `const Line = require('../models/Line')` -- прямой вызов модели

**Controller -> Database напрямую (нет ни Service, ни Model):**
- `adminController.js` (строка 1): `const pool = require('../config/database')` -- 1830 строк прямых SQL-запросов
- `powerAnalyticsController.js` (строка 10): `const db = require('../config/database')` -- сложные SQL-запросы прямо в контроллере
- `buildingMetricsController.js` (строка 1): `const db = require('../config/database')` -- SQL в контроллере

**Route-файлы с прямым SQL (нет ни Controller, ни Service, ни Model):**
- `waterSourceRoutes.js` (строка 3): `const { query } = require('../config/database')` -- полный CRUD в файле маршрутов
- `heatSourceRoutes.js` (строка 3): `const { query } = require('../config/database')` -- полный CRUD в файле маршрутов
- `waterLineRoutes.js`, `waterSupplierRoutes.js` -- аналогичная структура

**Вердикт:** Слоистая архитектура нарушена в ~60% модулей. Наиболее критичное нарушение -- `adminController.js` (1830 строк), который содержит SQL-запросы, бизнес-логику и HTTP-обработку в одном файле.

### 1.2 Consistency паттернов

Обнаружены значительные несоответствия:

| Аспект | Вариант A | Вариант B | Файлы |
|--------|-----------|-----------|-------|
| Стиль контроллера | Функции-объект `module.exports = {}` | Класс `class Controller` | `buildingController` vs `analyticsController` vs `adminController` |
| Формат ответа | `{ data, pagination }` | `{ success: true, data }` | `buildingController` vs `transformerController` |
| Ошибки 404 | `{ error: 'Not found' }` | `{ success: false, error: 'Not found' }` | `buildingController` vs `lineController` |
| Model стиль | Класс со static-методами | Требует инстанцирования | `Building.js` vs `PowerTransformer.js` |
| Язык логов | Английский | Русский | `buildingController` vs `analyticsService` |

### 1.3 Оценка выбора «без ORM»

**Плюсы для данного проекта:**
- Полный контроль над SQL-запросами (критично для PostGIS)
- Оптимизация JOIN-запросов без overhead ORM
- Простота работы с материализованными представлениями
- Меньше зависимостей

**Минусы:**
- Дублирование SQL-запросов (особенно Building.findAll и Building.findById -- одинаковый JOIN на 8 таблиц)
- Нет автоматической миграции схемы
- Нет типизации данных на уровне модели
- SQL injection возможен при отсутствии дисциплины (хотя `queryValidation.js` добавлен)

**Вердикт:** Выбор оправдан для проекта с PostGIS, но требует строгой дисциплины в виде Repository-паттерна, что не реализовано.

---

## 2. Анализ безопасности

### 2.1 КРИТИЧЕСКОЕ: файлы `.env` с секретами в Git

```
$ git ls-files | grep .env
.env
.env.prod
generator/.env
```

Файлы `.env` и `.env.prod` **отслеживаются в git**, несмотря на наличие в `.gitignore`. Это означает, что секреты (JWT-ключи, пароли БД) находятся в истории репозитория. Файл `.env.prod` (строки 27-28) содержит production JWT-секреты.

**Серьезность: КРИТИЧЕСКАЯ.** Даже после удаления файлов из tracking, секреты остаются в git-истории. Необходима ротация всех секретов.

### 2.2 SQL Injection защита

Модуль `queryValidation.js` реализует whitelist-подход для параметров сортировки. Валидация применяется в:
- `Building.js` (строка 20-21)
- `Metric.js` (строка 32-33)
- `Controller.js` -- используется
- `adminController.js` (строка 24-26) -- используется
- `waterSourceRoutes.js` (строка 99) -- используется
- `heatSourceRoutes.js` (строка 99) -- используется

**Проблемы:**
1. Параметризованные запросы (`$1, $2...`) используются корректно для данных
2. Сортировка интерполируется в SQL строку, но через whitelist -- это безопасно
3. В `buildSecureQuery()` (строка 256) параметр `params.length` может быть undefined, что приведет к некорректному номеру плейсхолдера
4. Функция `validateSearchString()` (строка 218-223) использует regex-замены для XSS/SQL, но это ненадежный подход: `replace(/script/gi, '')` можно обойти через `scrscriptipt`

### 2.3 XSS защита

**Backend:**
- `helmet` с CSP настроен в `server.js` (строки 23-38), но с `'unsafe-inline'` и `'unsafe-eval'` для scriptSrc -- это существенно ослабляет CSP
- Express-validator используется в `validators.js` с кастомной `isXSSFree()` функцией
- Отдельный server-side DOMPurify упомянут в зависимостях, но **не используется** ни в одном серверном файле

**Frontend:**
- `domSecurity.js` предоставляет `sanitizePopupContent()`, `setSecureText()`, `escapeHTML()` -- хороший набор утилит
- Однако `innerHTML =` используется 15 раз в frontend-файлах, и не все через DOMPurify
- В `admin.js` (3243 строки) и `script.js` (2377 строк) масштаб кода затрудняет полный аудит XSS

**Nginx CSP (nginx.conf строка 91):**
```
script-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com
```
Nginx CSP **строже** чем Express CSP (нет unsafe-inline и unsafe-eval). Конфликт: Express отдает более мягкие заголовки, но за Nginx они перезаписываются. Это может вызвать непредсказуемое поведение при запросах к API vs статике.

### 2.4 JWT реализация

`authService.js` -- качественная реализация:
- Bcrypt с 12 раундами (строка 9)
- Issuer/audience claims (строка 134-135)
- Refresh token с типизацией `type: 'refresh'` (строка 139)
- Account lockout после 5 попыток (строки 385-396)
- Валидация пароля: минимум 8 символов, строчные + заглавные + цифры (строки 355-362)

**Проблемы:**
1. **Blacklist токенов в in-memory cache** (`cacheService.js`): при перезапуске сервера все заблокированные токены становятся валидными. Без Redis (который опционален) нет персистентного blacklist
2. Таблицы `token_blacklist` и `refresh_tokens` созданы в схеме БД, но **не используются** -- blacklist хранится только в памяти/Redis
3. `jwtRefreshSecret` (строка 14): fallback на `JWT_SECRET` при отсутствии `JWT_REFRESH_SECRET` -- это означает, что access и refresh токены подписываются одним ключом
4. В `authenticateJWT` (auth.js строка 44): используется callback-стиль `jwt.verify()` внутри async-функции -- потенциальный источник ошибок

### 2.5 CORS и Rate Limiting

**CORS** (`server.js` строка 40-45):
- Origin из env-переменной с fallback на localhost -- корректно
- `credentials: true` -- корректно для JWT

**Rate Limiting** (`rateLimiter.js`):
- Собственная реализация (не `express-rate-limit`) -- хорошо для zero-dependency
- Auth: 10 запросов / 15 минут
- Register: 5 / час
- Analytics: 30 / минута с slow-down после 20
- Admin: 100 / минута (помечено как «увеличено для тестирования» -- строка 253)
- **Проблема:** Rate limiter in-memory, не работает при горизонтальном масштабировании

**Проблемы:**
- Rate limiter **не подключен** к большинству маршрутов. В `routes/index.js` нет middleware для rate limiting -- только экспортируется, но не применяется
- В файлах маршрутов (`buildingRoutes.js`, `metricRoutes.js`, etc.) нет импорта rate limiter

### 2.6 Потенциальные уязвимости (сводка)

| # | Уязвимость | Серьезность | Файл | Строка |
|---|-----------|-------------|------|--------|
| 1 | Секреты в Git | КРИТИЧЕСКАЯ | `.env`, `.env.prod` | -- |
| 2 | Token blacklist в памяти | ВЫСОКАЯ | `authService.js` | 422-445 |
| 3 | `unsafe-eval` в CSP | ВЫСОКАЯ | `server.js` | 28 |
| 4 | Rate limiter не подключен к маршрутам | ВЫСОКАЯ | `routes/index.js` | -- |
| 5 | Слабая XSS-фильтрация в `validateSearchString` | СРЕДНЯЯ | `queryValidation.js` | 218-223 |
| 6 | Endpoint телеметрии без аутентификации и без rate limit | СРЕДНЯЯ | `routes/index.js` | 75 |
| 7 | Admin lockout сбрасывается при перезапуске | СРЕДНЯЯ | `authService.js` | 366-374 |

---

## 3. Анализ производительности

### 3.1 N+1 проблемы

**Обнаружена N+1 в `buildingService.getBuildingById()` (строки 50-58):**
```javascript
const building = await Building.findById(id);        // Запрос 1
const controllers = await Controller.findByBuildingId(id); // Запрос 2
```
Два отдельных SQL-запроса вместо одного JOIN.

**Обнаружена N+1 в `buildingService.getBuildingsStatistics()` (строка 210):**
```javascript
const allBuildings = await Building.findAll(1, 10000, 'building_id', 'asc');
```
Загружает ВСЕ здания в память (до 10000) для подсчета статистики, которая может быть получена одним SQL `GROUP BY`.

**Обнаружена N+1 в `buildingService.findBuildingsInRadius()` (строка 168):**
```javascript
const allBuildings = await Building.findAll(1, 1000, 'building_id', 'asc');
const buildingsInRadius = allBuildings.data.filter(...);
```
Загружает все здания и фильтрует в JS, хотя PostGIS (`ST_DWithin`) решает это одним запросом. **Это прямое игнорирование PostGIS, который установлен в системе.**

**Обнаружена неоптимальность в `Metric.findLastForAllControllers()` (строки 132-155):**
CTE с `ROW_NUMBER()` вместо `DISTINCT ON` -- корректно, но менее эффективно в PostgreSQL.

### 3.2 Стратегия кэширования

`cacheService.js` реализует двухуровневый кэш (Memory + Redis):

**Положительные стороны:**
- Graceful degradation при недоступности Redis
- Cleanup timer каждую минуту
- Лимит 1000 элементов в memory cache
- Разные TTL для разных типов данных (30 сек для real-time, 5 мин для статики)

**Проблемы:**
1. **Inconsistency TTL**: в `buildingService.js` (строка 18) TTL передается как `{ ttl: this.defaultCacheTTL * 1000 }` (в миллисекундах), но в `cacheService.get()` (строка 175) сравнивается с `Date.now()` -- это корректно. Однако в `cacheService.set()` (строка 203) TTL передается в секундах для Redis. **Результат: memory cache и Redis имеют разные TTL.**
2. **invalidatePattern()** (строка 247): использует `KEYS *pattern*` в Redis, что блокирует Redis при большом количестве ключей. Документация Redis рекомендует `SCAN`.
3. Нет cache stampede protection (thundering herd) -- при истечении популярного ключа все запросы одновременно идут в БД

### 3.3 Индексы БД

Индексы **хорошо покрывают основные запросы**:
- `idx_metrics_controller` + `idx_metrics_timestamp` -- покрывают основные выборки метрик
- Compound index `metrics(controller_id, timestamp DESC)` добавлен в коммите `a83e909`
- GIST индексы для геопространственных запросов на `buildings`, `transformers`, `lines`, `water_lines`
- GIN индексы для JSONB полей `main_path` и `branches`

**Недостающие индексы:**
- Нет индекса на `buildings.primary_transformer_id` / `backup_transformer_id` -- используются в JOIN в `powerAnalyticsController.js`
- Нет индекса на `buildings.cold_water_line_id` / `hot_water_line_id` -- используются в JOIN в `Building.findAll()`

### 3.4 Circuit Breaker

Реализация в `circuitBreaker.js` корректна:
- 3 состояния: CLOSED -> OPEN -> HALF_OPEN
- Требует 3 успешных запроса для перехода HALF_OPEN -> CLOSED
- Factory с предустановленными конфигурациями

**Проблемы:**
1. `startMonitoring()` (строка 160-177): `setInterval` без `clearInterval` -- утечка таймеров при создании нового инстанса. Каждый CircuitBreaker создает вечный interval
2. Аналогично в `cacheService.js` (строка 53) и `rateLimiter.js` (строка 19, 156) -- все setInterval без cleanup
3. При 3 CircuitBreaker инстансах в `analyticsService.js` -- это 3 утечки таймеров

---

## 4. Масштабируемость

### 4.1 Текущие ограничения

При текущей архитектуре:
- **17 зданий** (seed data) -- работает нормально
- **100 зданий** -- будет работать, но `getBuildingsStatistics()` и `findBuildingsInRadius()` начнут тормозить
- **1000 зданий** -- проблемы:
  - `findBuildingsInRadius()` загрузит 1000 записей в память
  - `getBuildingsStatistics()` загрузит 1000 записей для подсчета
  - `getBuildingsWithMetrics()` (buildingMetricsController) -- LATERAL JOIN на 1000 зданий будет медленным
- **10000 зданий** -- неработоспособно без рефакторинга:
  - Memory cache превысит лимит 1000 элементов
  - `adminController.js` без пагинации на некоторых запросах
  - Таблица `metrics` (непартиционированная) при 10000 контроллеров * 288 записей/день = 2.88M строк/день

### 4.2 Горизонтальное масштабирование

**Не готово:**
- Session/cache в памяти процесса (rate limiter, circuit breaker state, alert cooldowns)
- Token blacklist в памяти
- Singleton-сервисы (`new BuildingService()`, `new AnalyticsService()`) с state в памяти
- Нет sticky sessions и нет shared state
- `setInterval` таймеры в каждом инстансе будут дублироваться

### 4.3 Узкие места

1. **Таблица metrics без партиционирования** -- в схеме есть `DROP TABLE IF EXISTS metrics CASCADE` с последующим созданием непартиционированной таблицы. Для IoT-платформы это критично.
2. **In-memory Map для активных алертов** (`alertService.js` строка 22) -- при горизонтальном масштабировании каждый инстанс будет иметь свою копию
3. **`Building.findAll(1, 10000)` вызовы** -- загрузка всех записей для статистики
4. **Отсутствие connection pooling конфигурации** -- `database.js` создает Pool без настроек `max`, `min`, `idleTimeoutMillis`

---

## 5. Качество кода

### 5.1 DRY нарушения

**Критическое дублирование:**

1. **JOIN на 8 таблиц в `Building.js`** (строки 23-42 и 73-92) -- идентичный SQL в `findAll()` и `findById()`. Должен быть вынесен в переменную/метод.

2. **waterSourceRoutes.js и heatSourceRoutes.js** -- структурно идентичны. CRUD-операции отличаются только именем таблицы и набором полей. Это кандидат на генерацию маршрутов через фабрику.

3. **powerAnalyticsController.js** -- `getBuildingsPower()` (строки 26-96) и `getBuildingPower()` (строки 101-177) содержат практически идентичный SQL-запрос, отличающийся только `WHERE b.building_id = $1`.

4. **powerAnalyticsController.js** -- `getTransformersPower()` (строки 217-304) и `getTransformerPower()` (строки 309-401) -- то же дублирование.

5. **`calculatePower()` в `powerAnalyticsController.js`** (строка 18) и аналогичные расчеты в `analyticsService.js` -- бизнес-логика расчета мощности дублируется.

### 5.2 SOLID принципы

| Принцип | Соблюдение | Комментарий |
|---------|-----------|-------------|
| **S** (Single Responsibility) | Частично | `adminController.js` (1830 строк) нарушает SRP -- это God Object. `script.js` (2377 строк) и `admin.js` (3243 строк) -- аналогично на frontend |
| **O** (Open-Closed) | Нет | Добавление нового типа инфраструктуры требует модификации `adminController.js`, `queryValidation.js`, схемы БД |
| **L** (Liskov Substitution) | N/A | Нет наследования/полиморфизма в архитектуре |
| **I** (Interface Segregation) | Частично | API разделен на логические маршруты, но `adminController` объединяет все |
| **D** (Dependency Inversion) | Нет | Сервисы зависят от конкретных реализаций (`require('../config/database')`), нет DI-контейнера |

### 5.3 Error handling

**Положительно:**
- Единый `errorHandler.js` middleware
- `createError()` утилита для стандартизации
- Try-catch в каждом controller-методе
- `process.on('uncaughtException')` и `process.on('unhandledRejection')` в `server.js`

**Проблемы:**
1. **Inconsistent error format**: некоторые контроллеры возвращают `{ error: 'message' }`, другие `{ success: false, message: 'message' }`, третьи `{ error: { message, status } }` (через errorHandler)
2. `analyticsController.js` (строки 27-32): ловит ошибку и возвращает `res.status(500).json()` напрямую, **не вызывая `next(error)`** -- errorHandler middleware пропускается
3. Это повторяется во всех методах `AnalyticsController` -- ни один не использует `next(error)`
4. `adminController.js` -- смесь: часть методов вызывает `next(error)`, часть -- `res.status(500).json()` напрямую

### 5.4 Logging

`logger.js` -- минимальная, но корректная конфигурация Winston с файловыми и консольным транспортами.

**Проблемы:**
1. Нет correlation ID для трассировки запросов через стек
2. Нет структурированного логирования (JSON в файл, но без request metadata)
3. Morgan (`server.js` строка 47) пишет в logger.info, но формат `combined` -- текстовый, не JSON
4. Уровень логирования в production (`LOG_LEVEL`) не задан в `.env.prod` -- будет `info` по умолчанию, что может быть слишком verbose

---

## 6. Модель данных

### 6.1 Нормализация

Модель данных находится в **приемлемом состоянии нормализации** (3NF) с осознанными денормализациями.

**Избыточность:**
- `buildings.hot_water` и `buildings.has_hot_water` -- два столбца для одного и того же (упомянуто в коммите `2eb2c29`, `has_hot_water` выбрана как каноническая, но `hot_water` не удалена из схемы)
- `buildings.power_transformer_id` (varchar FK на `power_transformers`) и `buildings.primary_transformer_id` (integer FK на `transformers`) -- два пути связи с трансформаторами через разные таблицы

### 6.2 Дублирование таблиц трансформаторов

Существуют **две таблицы трансформаторов**:

| Таблица | PK тип | Используется в |
|---------|--------|---------------|
| `transformers` | `SERIAL` (integer) | `Transformer.js`, `transformerController.js`, `adminController.js`, `powerAnalyticsController.js` |
| `power_transformers` | `VARCHAR(50)` | `PowerTransformer.js`, `analyticsController.js`, `analyticsService.js` |

Это создает:
- Два набора данных, которые могут рассинхронизироваться
- Путаницу: `buildings.primary_transformer_id` (INTEGER) ссылается на `transformers`, а `buildings.power_transformer_id` (VARCHAR) -- на `power_transformers`
- Двойные CRUD-операции при создании трансформатора

### 6.3 Связи между таблицами

```
buildings
  -> primary_transformer_id -> transformers.transformer_id
  -> backup_transformer_id  -> transformers.transformer_id
  -> power_transformer_id   -> power_transformers.id  (VARCHAR!)
  -> primary_line_id        -> lines.line_id
  -> backup_line_id         -> lines.line_id
  -> cold_water_line_id     -> water_lines.line_id
  -> hot_water_line_id      -> water_lines.line_id
  -> cold_water_supplier_id -> water_suppliers.supplier_id
  -> hot_water_supplier_id  -> water_suppliers.supplier_id
  -> cold_water_source_id   -> cold_water_sources.id (VARCHAR!)
  -> heat_source_id         -> heat_sources.id (VARCHAR!)
```

**Проблемы:**
- FK constraints **не определены** для `power_transformer_id`, `cold_water_source_id`, `heat_source_id` в SQL-схеме -- это `ALTER TABLE ... ADD COLUMN`, без `REFERENCES`
- Смешение типов PK: INTEGER для `transformers`, `lines`, `water_lines`, `water_suppliers`, но VARCHAR для `power_transformers`, `cold_water_sources`, `heat_sources` -- legacy vs new
- 11 FK в таблице `buildings` -- признак того, что здание является центральной сущностью, но нет промежуточных таблиц (M2M)

### 6.4 Готовность к миграциям

- Миграции хранятся в `database/migrations/003-006`
- Init-скрипт использует `IF NOT EXISTS` повсеместно
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` для обратной совместимости
- **Проблема:** `DROP TABLE IF EXISTS metrics CASCADE` в init-скрипте (строка 335) уничтожает данные при реинициализации -- опасно в production

---

## 7. Frontend архитектура

### 7.1 Vanilla JS vs Framework

**Обоснованность выбора:**
- Для dashboard/map-приложения с Leaflet -- приемлемо
- Меньше bundle size, быстрый initial load
- Нет build-шага (не нужен webpack/vite)

**Но:**
- При 3243 строках в `admin.js` и 2377 в `script.js` -- управление состоянием вручную неизбежно приведет к ошибкам
- Нет модульности (все в одном файле)
- Нет компонентного подхода
- Нет Hot Module Replacement в dev

### 7.2 Монолитность файлов

| Файл | Строки | Ответственность |
|------|--------|----------------|
| `admin.js` | 3243 | CRUD для всех сущностей, таблицы, формы, модалки, навигация |
| `script.js` | 2377 | Карта, слои, маркеры, popup-ы, аналитика, графики |
| `admin-auth.js` | 382 | Авторизация -- приемлемый размер |
| `map-layers-control.js` | отдельный | Управление слоями -- хороший пример декомпозиции |

**Рекомендация:** Разбить `admin.js` на модули по сущностям (buildings, transformers, controllers, etc.) и `script.js` -- по функциональности (map, layers, analytics, popups).

### 7.3 Безопасность клиентского кода

- `domSecurity.js` предоставляет качественный набор утилит
- DOMPurify подключен через CDN
- JWT токен хранится в `localStorage` (`admin_token`) -- уязвимо к XSS (если XSS найдена, токен крадется). `httpOnly cookie` было бы безопаснее
- Клиентская валидация токена (`validateToken()`) в `domSecurity.js` -- декодирует payload без верификации подписи (это нормально для клиента, но создает ложное чувство безопасности)

### 7.4 Управление состоянием

- Глобальные переменные (`window.DOMSecurity`, глобальные Map/array для маркеров)
- Нет единого state management
- Данные из API кэшируются в локальных переменных внутри замыканий
- Race condition возможны при параллельных запросах к API

---

## 8. DevOps и инфраструктура

### 8.1 Docker конфигурация

**Положительно:**
- Три среды: dev, prod, unified
- Non-root user в Dockerfile (`nodejs`, UID 1001)
- `.dockerignore` настроен
- Volume mounting для hot reload в dev

**Проблемы:**
1. `Dockerfile.dev` использует `node:18-alpine`, но CLAUDE.md указывает `Node.js 20+` -- расхождение
2. Нет multi-stage build в `Dockerfile.dev` (не критично для dev)
3. `npm install` без `--production` в prod может устанавливать devDependencies
4. Нет pinning версий base-image (`:18-alpine` вместо конкретного SHA)

### 8.2 Nginx конфигурация

`nginx.conf` -- **хорошо настроен для production**:
- `worker_processes auto`
- `worker_connections 2048`
- Gzip с полным списком MIME-типов
- `server_tokens off`
- Security headers: X-Frame-Options, X-Content-Type-Options, CSP, HSTS
- JSON-формат логов с buffer
- Кэширование статики (12h)
- HTML без кэша

**Проблемы:**
1. `send_timeout 2` (строка 41) -- 2 секунды может быть мало для тяжелых API-запросов
2. Нет `proxy_read_timeout` для `/api/` -- по умолчанию 60 секунд, может быть мало для аналитических запросов
3. Нет rate limiting на уровне Nginx -- полагается только на Express middleware

### 8.3 Health checks

- Docker healthcheck для frontend: `curl -f http://localhost:8080/health`
- Docker healthcheck для app: node HTTP check на `/api/`
- Docker healthcheck для postgres: `pg_isready` + `SELECT 1`
- Express `/health` endpoint (строка 50-52): возвращает `'healthy'` без проверки БД

**Рекомендация:** Health check Express должен проверять подключение к БД (`SELECT 1`).

### 8.4 Мониторинг и observability

- Winston логирование в файлы (`combined.log`, `error.log`)
- Morgan HTTP-логирование через Winston
- Circuit Breaker статистика через API (`/analytics/system/status`)
- Cache статистика через `cacheService.getStats()`
- Rate limiter статистика через `getAllRateLimitStats()`

**Отсутствует:**
- Метрики (Prometheus/Grafana)
- Трейсинг (OpenTelemetry)
- APM (Application Performance Monitoring)
- Log rotation (файлы логов растут бесконечно)
- Alerting при падении сервисов

---

## 9. Итоговая оценка

### 9.1 Общая оценка: 5.5 / 10

**Обоснование:**

| Категория | Оценка | Вес | Итог |
|-----------|--------|-----|------|
| Архитектура (соблюдение слоев) | 4/10 | 20% | 0.8 |
| Безопасность | 4/10 | 25% | 1.0 |
| Производительность | 5/10 | 15% | 0.75 |
| Качество кода | 5/10 | 15% | 0.75 |
| Модель данных | 6/10 | 10% | 0.6 |
| Frontend | 5/10 | 5% | 0.25 |
| DevOps | 7/10 | 10% | 0.7 |
| **Итого** | | 100% | **4.85 -> 5.5** (с учетом того, что система функционально полна) |

Система демонстрирует хорошее понимание предметной области, грамотные решения (Circuit Breaker, кэширование, PostGIS), но реализация непоследовательна и содержит серьезные нарушения заявленной архитектуры.

### 9.2 TOP-5 критических улучшений (нужно сделать ПЕРВЫМ)

1. **Удалить `.env` и `.env.prod` из git-tracking и ротировать все секреты.** Файлы `.env` и `.env.prod` отслеживаются git. Необходимо: `git rm --cached .env .env.prod`, ротация JWT-секретов, паролей БД. Сканирование git-истории на предмет утечки. Серьезность: P0.

2. **Перенести token blacklist в БД (таблица `token_blacklist` уже создана).** При перезапуске сервера все отозванные токены становятся валидными. Необходимо использовать существующую таблицу `token_blacklist` вместо in-memory cache. Серьезность: P0.

3. **Подключить rate limiter к маршрутам.** Rate limiter реализован, но не применяется к маршрутам. Особенно критичен для `POST /api/metrics/telemetry` (публичный, без аутентификации, без rate limit) -- вектор для DoS. Серьезность: P1.

4. **Убрать `unsafe-eval` из CSP.** `server.js` строка 28 разрешает выполнение произвольного кода в скриптах. Если Swagger UI требует этого, ограничить такой CSP только для `/api-docs/` пути. Серьезность: P1.

5. **Привести `adminController.js` в соответствие с трехслойной архитектурой.** 1830 строк с прямыми SQL-запросами в контроллере. Минимально: вынести SQL в Model-файлы, бизнес-логику в Service. Серьезность: P1.

### 9.3 TOP-5 стратегических улучшений (нужно планировать)

1. **Консолидация таблиц трансформаторов.** Объединить `transformers` и `power_transformers` в одну таблицу. Текущее дублирование создает рассинхронизацию данных и путаницу в FK-типах. Стратегия: Strangler Fig -- новые запросы через единую таблицу, миграция данных, удаление legacy.

2. **Использовать PostGIS для геопространственных запросов.** `findBuildingsInRadius()` загружает все записи и фильтрует в JS. Замена на `ST_DWithin()` даст O(log n) вместо O(n), а индексы GIST уже созданы. Аналогично для всех geo-запросов.

3. **Партиционирование таблицы `metrics`.** IoT-платформа генерирует тысячи записей в день. Необходимо: партиционирование по месяцам (уже были партиции, но удалены), автоматическое создание партиций, retention policy для удаления старых данных.

4. **Декомпозиция frontend.** Разбить `admin.js` (3243 строк) и `script.js` (2377 строк) на модули. Минимально: ES-modules с `import/export`. Оптимально: рассмотреть Vite + модульный JS или легкий фреймворк (Preact, Alpine.js).

5. **Стандартизация API-контракта.** Определить единый формат ответов: `{ success: boolean, data: T, error?: string, pagination?: {...} }`. Все контроллеры должны использовать `next(error)` вместо прямых `res.status().json()`. Все ошибки должны проходить через `errorHandler.js`.

### 9.4 Общее заключение: готов ли продукт к production?

**Нет, в текущем состоянии не готов.**

Критические блокеры:
- Секреты в git-истории -- даже после удаления файлов, секреты доступны через `git log`
- Token blacklist в памяти -- перезапуск сервера обнуляет все отзывы токенов
- Rate limiter не подключен -- публичный endpoint телеметрии открыт для DoS
- CSP разрешает выполнение произвольного кода -- снижает защиту от XSS до минимума

**Для пилотного запуска (до 50 зданий, ограниченный доступ):** готов после устранения P0-проблем (пункты 1-2 из критических улучшений) и подключения rate limiter.

**Для полноценного production (100+ зданий, публичный доступ):** необходимо устранить все 5 критических и минимум 2-3 стратегических улучшения (особенно партиционирование метрик и стандартизацию API).

---

## Приложение A: Карта файлов и ответственности

```
src/
  controllers/
    adminController.js      (1830 строк) - God Object, SQL внутри, нарушает все слои
    analyticsController.js   (466 строк)  - Класс, не использует next(error)
    authController.js        - Controller -> Service, корректно
    buildingController.js    - Controller -> Service, корректно
    buildingMetricsController.js - SQL внутри контроллера
    controllerController.js  - Controller -> Service, корректно
    lineController.js        - Controller -> Model (нет Service)
    metricController.js      - Controller -> Service, корректно
    powerAnalyticsController.js - SQL внутри контроллера
    transformerController.js - Controller -> Model (нет Service)
  services/
    alertService.js          - Service -> DB (нет Model)
    analyticsService.js      - Service -> Model + DB, Circuit Breaker
    authService.js           - Service -> DB, качественная реализация
    buildingService.js       - Service -> Model, кэширование
    cacheService.js          - In-memory + Redis
    controllerService.js     - Service -> Model
    metricService.js         - Service -> Model, валидация
  models/
    Alert.js, AlertType.js
    Building.js              - Static methods, SQL, queryValidation
    Controller.js            - Static methods, SQL
    Line.js, Transformer.js  - Static methods, SQL
    Metric.js                - Static methods, SQL, queryValidation
    PowerTransformer.js      - Дублирует Transformer.js для другой таблицы
    WaterLine.js, WaterSupplier.js
  routes/
    waterSourceRoutes.js     - CRUD SQL прямо в route-файле
    heatSourceRoutes.js      - CRUD SQL прямо в route-файле
    (остальные)              - Делегируют в контроллеры
  middleware/
    auth.js                  - JWT auth, blacklist check
    errorHandler.js          - Единый обработчик ошибок
    rateLimiter.js           - In-memory rate limiting (не подключен!)
    validators.js            - express-validator rules
  utils/
    circuitBreaker.js        - Circuit Breaker + Factory
    helpers.js               - createError, formatDate, validateCoordinates
    logger.js                - Winston config
    queryValidation.js       - SQL injection protection whitelist
  config/
    database.js              - pg Pool wrapper
```

## Приложение B: Утечки таймеров (setInterval без clearInterval)

| Файл | Строка | Интервал | Описание |
|------|--------|----------|----------|
| `circuitBreaker.js` | 161 | 10-30 сек | Мониторинг состояния (3 инстанса) |
| `cacheService.js` | 53 | 60 сек | Очистка memory cache |
| `rateLimiter.js` | 19 | 60 сек | Очистка rate limiter (5 инстансов) |
| `rateLimiter.js` | 156 | 60 сек | Очистка slow down |

Итого: минимум 10 неочищаемых интервалов при штатной работе сервера.
