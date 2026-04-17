# InfraSafe - Системные паттерны

## Архитектурные паттерны

### Сервисный слой (Service Layer)
- Отделение бизнес-логики от контроллеров
- Единая точка доступа к данным
- Кэширование и оптимизация запросов
- Валидация на уровне сервисов

### Repository Pattern
- Абстракция работы с базой данных
- Модели данных (Building, Controller, Metric)
- Централизованные CRUD операции

### Middleware Pattern
- auth.js - JWT авторизация
- errorHandler.js - централизованная обработка ошибок
- validators.js - валидация входящих данных
- rateLimiter.js - защита от перегрузки

### Circuit Breaker
- Защита от каскадных сбоев
- Автоматическое восстановление
- Мониторинг состояния сервисов

## Паттерны данных

### Кэширование
- TTL кэши для часто запрашиваемых данных
- Инвалидация при изменениях
- Оптимизация производительности

### Пагинация
- Стандартизированная пагинация API
- Контроль размера ответов
- Эффективность загрузки данных

### Валидация
- Валидация координат (широта/долгота)
- Проверка обязательных полей
- Санитизация входных данных

## Паттерны безопасности

### JWT авторизация
- Stateless аутентификация
- Роли и права доступа
- Защищённые маршруты

### Input validation
- Защита от SQL инъекций
- Валидация типов данных
- Санитизация пользовательского ввода

## Паттерны мониторинга

### Логирование
- Структурированные логи
- Различные уровни логирования
- Отслеживание операций

### Метрики и аналитика
- Сбор статистики использования
- Мониторинг производительности
- Анализ трендов

## Паттерны, добавленные в Phase 5-12B (2026-04)

### CRUD Factory (Phase 6)
- `src/models/factories/createCrudModel.js` генерирует класс с `findAll/findById/create/update/delete` из описания таблицы (имя таблицы, PK, поля, алиасы сортировки)
- `src/controllers/factories/createCrudController.js` генерирует `{ getAll, getById, create, update, remove }`
- Применено к `ColdWaterSource`, `HeatSource` — остальные модели пока hand-written (легаси + специфичная бизнес-логика)

### Alert Event Bus (Phase 7)
- `src/events/alertEvents.js` — `EventEmitter` с событиями `TRANSFORMER_CHECK`, `ALERT_CREATED`, `UK_REQUEST_RESOLVED`
- Разрывает циклическую зависимость между `controllerService` → `alertService` → `ukIntegrationService`: теперь они подписываются на события, а не требуют друг друга напрямую
- `require`-цикл удалён; upfront init в `src/server.js`

### Admin Query Helpers (Phase 5)
- `src/utils/adminQueryBuilder.js::buildPaginatedList(pool, config, req)` — пагинация + фильтры (kinds: exact/like/gte/lte) + сортировка с `sortAliasMap` + опциональный group-by
- `src/utils/dynamicUpdateBuilder.js::buildUpdateQuery(table, pk, id, fields, allowed)` — динамический UPDATE с whitelist-валидацией через `ALLOWED_UPDATE_TABLES`
- `IDENT_RE` регэксп проверяет каждый идентификатор перед подстановкой в SQL. Консолидировали 8 admin-контроллеров (–582 LoC дублирования)

### Persistent Account Lockout (Phase 12B.3)
- `src/models/AccountLockout.js` + миграция `database/migrations/013_account_lockout.sql`
- Заменил in-memory `Map` — теперь блокировка переживает рестарт приложения и консистентна между репликами
- Таблица `account_lockout` с `user_id`, `failed_attempts`, `locked_until`

### Idempotent 2FA Setup (2026-04-17)
- `src/services/totpService.js generateSetup()` — если у пользователя уже есть `totp_secret` и `totp_enabled=false`, переиспользует существующий секрет вместо генерации нового
- До фикса повторный вызов `/api/auth/setup-2fa` (обновление страницы) перезаписывал секрет — первый QR ломался → пользователь видел «разные OTP»
- Recovery codes по-прежнему ротируются на каждом вызове (one-shot контракт)

### Admin Panel Auth — redirect-only (2026-04-17)
- `public/admin-auth.js` больше не держит собственную логин-форму (−250 LoC)
- При отсутствии `admin_token` → `window.location.replace('/login.html')` (там уже есть полный 2FA-flow)
- Guards против строкового `"undefined"`/`"null"` в localStorage (regression от прежнего бага)
- Сохранён интерсептор `window.fetch` для добавления `Authorization: Bearer` к `/api/*` и автоматического logout при 401

### Frontend Bundle Pipeline (Phase 12B.4)
- `build/esbuild.config.mjs` — 11 entry points, минификация + сорсмапы, `outbase: 'public'` (зеркалит структуру в `public/dist/`)
- `package.json` postinstall hook — `npm ci` автоматически пересобирает `public/dist/`
- HTML-страницы ссылаются на `public/dist/*.js`, nginx раздаёт с `Content-Encoding: gzip`
- production `nginx.production.conf` — `location ~ \.map$ { return 404; }` запрещает сорсмапы в проде
- `public/dist/` в `.gitignore` — не коммитится
