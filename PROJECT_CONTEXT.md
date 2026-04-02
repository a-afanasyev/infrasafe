# InfraSafe — Project Context

> Автоматически сгенерировано: 2026-04-02
> Источник: аудит кодовой базы агентом (Senior Fullstack Architect)
> Метод: чтение реального кода, grep, glob — без домыслов

---

## 1. Общее описание

**InfraSafe** — цифровая IoT-платформа мониторинга инженерных систем многоквартирных домов (ЖКХ). Собирает данные с интеллектуальных контроллеров (промышленные ПК с датчиками), обрабатывает метрики (электричество, вода, отопление, климат), визуализирует на интерактивной карте Leaflet.js и предоставляет аналитические дашборды. Автоматическое оповещение при выходе параметров за пределы порогов. Включает модуль интеграции с внешней системой управляющей компании (UK Bot).

**Целевая аудитория:** управляющие компании, инженерные службы зданий, администрации районов.
**Масштаб:** 17 зданий в Ташкенте (Узбекистан), ~34 метрики в seed data. Целевой масштаб: 10–500 IoT-устройств.
**Лицензия:** Apache 2.0
**Репозиторий:** https://github.com/a-afanasyev/infrasafe.git

---

## 2. Дерево проекта

```
infrasafe/                            # Root — v1.0.1
├── src/                              # Backend (Node.js/Express, трёхслойная архитектура)
│   ├── config/
│   │   └── database.js               # PostgreSQL pool (pg), debug query logging
│   ├── controllers/                   # HTTP-обработка, валидация, ответы (14 файлов)
│   │   ├── admin/                     # Admin CRUD (9 контроллеров + index.js barrel)
│   │   ├── authController.js          # Login, register, refresh, logout
│   │   ├── buildingController.js      # CRUD зданий
│   │   ├── controllerController.js    # CRUD IoT-контроллеров
│   │   ├── metricController.js        # CRUD метрик + receiveTelemetry
│   │   ├── alertController.js         # Alert lifecycle
│   │   ├── analyticsController.js     # 25+ аналитических endpoints
│   │   ├── buildingMetricsController.js # Map data aggregation
│   │   ├── powerAnalyticsController.js  # Power grid analysis
│   │   ├── transformerController.js   # Трансформаторы
│   │   ├── lineController.js          # Линии электропередач
│   │   ├── coldWaterSourceController.js # Источники холодной воды
│   │   └── heatSourceController.js    # Источники тепла
│   ├── services/                      # Бизнес-логика (11 файлов)
│   │   ├── alertService.js            # Alert lifecycle + 15-мин cooldown + UK pipeline
│   │   ├── analyticsService.js        # Circuit Breaker для fault tolerance
│   │   ├── authService.js             # JWT, refresh, blacklist, account locking
│   │   ├── buildingService.js         # Business logic зданий
│   │   ├── buildingMetricsService.js  # Aggregation для карты
│   │   ├── cacheService.js            # In-memory кэш (Redis-ready)
│   │   ├── controllerService.js       # IoT-контроллеры
│   │   ├── metricService.js           # Anomaly detection, thresholds
│   │   ├── powerAnalyticsService.js   # Анализ электросетей
│   │   ├── ukIntegrationService.js    # UK Bot: webhooks, alert→request, building sync
│   │   └── adminService.js            # Batch admin operations
│   ├── models/                        # Direct SQL через pg Pool, без ORM (16 файлов)
│   │   ├── Building.js                # +external_id, +uk_deleted_at, syncFromUK()
│   │   ├── Controller.js, Metric.js
│   │   ├── Alert.js, AlertType.js, AlertRule.js, AlertRequestMap.js
│   │   ├── Transformer.js, PowerTransformer.js, Line.js
│   │   ├── ColdWaterSource.js, HeatSource.js, WaterLine.js, WaterSupplier.js
│   │   ├── IntegrationConfig.js, IntegrationLog.js
│   ├── middleware/
│   │   ├── auth.js                    # Default-deny JWT + PUBLIC_ROUTES allowlist
│   │   ├── correlationId.js           # x-correlation-id header
│   │   ├── errorHandler.js            # Centralized error handling
│   │   ├── rateLimiter.js             # Custom in-memory rate limiter (7 types)
│   │   └── validators.js              # Input validation
│   ├── routes/                        # API routes (17 файлов)
│   │   ├── index.js                   # Main router, default-deny JWT
│   │   ├── authRoutes.js              # /api/auth/*
│   │   ├── buildingRoutes.js          # /api/buildings/*
│   │   ├── controllerRoutes.js        # /api/controllers/*
│   │   ├── metricRoutes.js            # /api/metrics/*
│   │   ├── alertRoutes.js             # /api/alerts/*
│   │   ├── analyticsRoutes.js         # /api/analytics/*
│   │   ├── adminRoutes.js             # /api/admin/*
│   │   ├── buildingMetricsRoutes.js   # /api/buildings-metrics
│   │   ├── powerAnalyticsRoutes.js    # /api/power-analytics/*
│   │   ├── transformerRoutes.js       # /api/transformers/*
│   │   ├── lineRoutes.js              # /api/lines/*
│   │   ├── waterLineRoutes.js         # /api/water-lines/*
│   │   ├── waterSourceRoutes.js       # /api/cold-water-sources/*
│   │   ├── heatSourceRoutes.js        # /api/heat-sources/*
│   │   ├── waterSupplierRoutes.js     # /api/water-suppliers/*
│   │   ├── webhookRoutes.js           # /api/webhooks/uk/* (HMAC-verified)
│   │   └── integrationRoutes.js       # /api/integration/* (admin + auth)
│   ├── clients/
│   │   └── ukApiClient.js             # UK Bot API client: JWT auth, retry, backoff
│   ├── utils/
│   │   ├── apiResponse.js             # sendError, sendNotFound, sendCreated, sendSuccess
│   │   ├── circuitBreaker.js          # Circuit Breaker pattern
│   │   ├── queryValidation.js         # Whitelist SQL injection prevention
│   │   ├── webhookValidation.js       # UUID, enum whitelist for webhooks
│   │   ├── helpers.js                 # createError, misc utils
│   │   └── logger.js                  # Winston + daily-rotate-file
│   ├── server.js                      # Express app, Helmet, CORS, graceful shutdown, /health
│   └── index.js                       # Entry point (requires server.js)
├── public/                            # Frontend static assets (vanilla JS)
│   ├── admin.js                       # Admin panel (~2600 lines, monolithic)
│   ├── script.js                      # Map interface (~1400 lines, monolithic)
│   ├── admin-auth.js                  # Auth for admin panel
│   ├── admin-coordinate-editor.js     # Coordinate editor
│   ├── map-layers-control.js          # Map layer toggles
│   ├── infrastructure-line-editor.js  # Infrastructure line editor
│   ├── login.html                     # Login page
│   ├── analytics/
│   │   ├── index.html                 # Analytics page
│   │   └── js/analytics.js            # Analytics charts (Chart.js)
│   ├── utils/
│   │   ├── domSecurity.js             # DOMPurify wrapper (XSS protection)
│   │   ├── rateLimiter.js             # Client-side rate limiter
│   │   ├── safeJsonParser.js          # Safe JSON parser
│   │   ├── csrf.js                    # CSRF protection
│   │   └── powerUtils.js              # Power calculation utilities
│   └── libs/                          # Vendored libraries
│       ├── leaflet/                   # Leaflet.js
│       └── leaflet-markercluster/     # MarkerCluster plugin
├── database/
│   ├── init/
│   │   ├── 01_init_database.sql       # Full schema (PostGIS, ~400 lines)
│   │   └── 02_seed_data.sql           # 17 buildings + 34 metrics (Tashkent)
│   ├── migrations/                    # 003-011 (no migration runner!)
│   │   ├── 003_power_calculation_system.sql       # DUPLICATE (3 versions of 003!)
│   │   ├── 003_power_calculation_system_fixed.sql # DUPLICATE
│   │   ├── 003_power_calculation_v2.sql           # Canonical version
│   │   ├── 004_add_coordinates_and_extended_fields.sql
│   │   ├── 005_add_paths_to_lines.sql
│   │   ├── 006_cleanup_infrastructure_lines.sql
│   │   ├── 007_add_metrics_compound_index.sql
│   │   ├── 008_remove_duplicate_hot_water.sql
│   │   ├── 009_token_blacklist_hash_index.sql
│   │   ├── 010_add_missing_indexes.sql
│   │   └── 011_uk_integration.sql
│   ├── export/                        # DB structure export (2025-11-23)
│   └── backups/                       # Manual backup (1 file)
├── generator/                         # Separate service — test data generator
│   ├── package.json                   # ESM, axios, node-cron, express
│   ├── Dockerfile
│   ├── .env.example
│   ├── src/
│   │   ├── server.js                  # Express UI + scheduler
│   │   ├── scheduler.js               # Cron (every 2 min) → HTTP POST metrics
│   │   ├── apiClient.js               # POST to /api/metrics/telemetry
│   │   └── store.js                   # In-memory ranges config
│   └── public/index.html              # Generator config UI
├── tests/
│   ├── jest/
│   │   ├── unit/                      # 56 test files
│   │   ├── integration/               # 2 files (API, default-deny auth)
│   │   ├── security/                  # 3 files (SQL injection, XSS, security)
│   │   ├── e2e/                       # 10 files (real Docker, no mocks)
│   │   ├── helpers/                   # testHelper.js, dbMock.js
│   │   └── setup.js                   # Jest setup
│   ├── reports/coverage/              # HTML coverage reports
│   └── README.md
├── docs/                              # Documentation (100+ .md files)
│   ├── archive/                       # 80+ session reports, old audits
│   ├── production/                    # Production readiness, security audits
│   ├── refactor/                      # Architecture analysis, refactoring plans
│   ├── superpowers/                   # Plans, specs (brainstorming, UK integration)
│   ├── architecture/                  # Architecture debates
│   └── *.md                           # API docs, guides, nginx setup
├── css/
│   ├── style.css                      # Main styles
│   └── map-components.css             # Map component styles
├── screenshots/                       # UI screenshots
├── logs/                              # Winston log files (rotated)
├── *.html                             # Root HTML pages (index, admin, about, contacts, docs)
├── docker-compose.dev.yml             # Dev: frontend + app + postgres
├── docker-compose.prod.yml            # Prod: frontend + app + postgres (no nginx!)
├── docker-compose.unified.yml         # Unified: + nginx + commented-out services
├── docker-compose.generator.yml       # Generator service
├── Dockerfile.dev                     # node:18-alpine, npm install (all deps)
├── Dockerfile.prod                    # node:18-alpine, multi-stage, non-root, healthcheck
├── Dockerfile.unified                 # Multi-target: frontend + backend
├── Dockerfile.frontend-only           # Nginx + static files
├── Dockerfile.frontend.dev            # Dev frontend nginx
├── nginx.conf                         # Dev nginx config
├── nginx.dev.conf                     # Dev nginx config (detailed)
├── nginx.production.conf              # Full TLS config (Let's Encrypt, HSTS, OCSP)
├── .env.example                       # 77 lines, documented
├── .gitignore                         # Standard
├── CLAUDE.md                          # AI assistant context (comprehensive)
├── README.md                          # Project readme (partially outdated)
├── package.json                       # v1.0.1, Apache-2.0
└── package-lock.json                  # Lock file present
```

---

## 3. Технологический стек

### Backend
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Node.js | 20+ (README) / 18 (Dockerfiles!) | Runtime |
| Express.js | ^4.18.2 | HTTP framework |
| PostgreSQL | 15+ | Primary database |
| PostGIS | 3.3 | Geospatial extension |
| pg | ^8.11.3 | PostgreSQL driver (no ORM) |
| jsonwebtoken | ^9.0.2 | JWT auth |
| bcrypt | ^5.1.1 | Password hashing |
| helmet | ^7.1.0 | Security headers (CSP) |
| cors | ^2.8.5 | CORS middleware |
| winston | ^3.11.0 | Structured logging |
| winston-daily-rotate-file | ^5.0.0 | Log rotation |
| express-validator | ^7.2.1 | Input validation |
| swagger-jsdoc | ^6.2.8 | API docs generation |
| swagger-ui-express | ^5.0.0 | Swagger UI |
| morgan | ^1.10.0 | HTTP request logging |
| dompurify | ^3.2.7 | XSS sanitization (server-side) |
| dotenv | ^16.3.1 | Environment variables |

### DevDependencies
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| jest | ^29.7.0 | Test framework |
| eslint | ^8.56.0 | Linter (no config file!) |
| nodemon | ^3.0.2 | Hot reload |
| supertest | ^6.3.3 | HTTP testing |
| axios | ^1.11.0 | HTTP client (for tests) |

### Frontend
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Vanilla JS | ES6+ | No framework |
| Leaflet.js | vendored | Interactive maps |
| Leaflet.markercluster | vendored | Marker clustering |
| Chart.js | CDN | Analytics charts |
| DOMPurify | CDN + utils | XSS protection |

### Infrastructure
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Docker | 20.10+ | Containerization |
| Docker Compose | v2+ | Orchestration |
| Nginx | alpine | Reverse proxy + TLS |
| PostGIS | 15-3.3 | Docker image |

### Generator (separate service)
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Node.js | ESM | Runtime |
| axios | ^1.6.0 | HTTP client |
| node-cron | ^3.0.3 | Scheduled metrics |
| express | ^4.18.2 | Config UI |

---

## 4. Сервисы и их роли

| Сервис | Описание | Язык | Порт | Зависимости |
|--------|----------|------|------|-------------|
| **app** | Express.js REST API — единственный backend | Node.js | 3000 | postgres |
| **frontend** | Nginx + static HTML/JS/CSS | Nginx | 8080/8088 | app |
| **postgres** | PostgreSQL 15 + PostGIS 3.3 | — | 5432 (prod) / 5435 (dev) | — |
| **nginx** (unified only) | TLS reverse proxy | Nginx | 80, 443 | app, frontend |
| **generator** (optional) | Simulated IoT data | Node.js | 3001 | app (HTTP POST) |

### Закомментированные сервисы (docker-compose.unified.yml:67-157)
| Сервис | Статус | Комментарий |
|--------|--------|-------------|
| Mosquitto (MQTT) | Закомментирован | Планируется для IoT pipeline |
| InfluxDB | Закомментирован | Планируется для raw time-series |
| Grafana | Закомментирован | Планируется для ops-дашбордов |
| Node-RED | Закомментирован | Планируется для аналитики/ETL |
| WireGuard | Закомментирован | Планируется для VPN (reverse connection) |

---

## 5. Архитектура взаимодействия

### Request Flow
```
Client Browser
    │
    ▼
Nginx (80/443) ──── TLS termination, static files, CORS
    │
    │ /api/* proxy_pass
    ▼
Express.js (3000) ── src/routes/index.js (default-deny JWT)
    │
    ├── PUBLIC_ROUTES (no auth):
    │   ├── POST /auth/login
    │   ├── POST /auth/register
    │   ├── POST /auth/refresh
    │   ├── POST /metrics/telemetry (rate limited)
    │   ├── GET  /buildings-metrics (optionalAuth)
    │   ├── POST /webhooks/uk/building (HMAC-verified)
    │   └── POST /webhooks/uk/request (HMAC-verified)
    │
    ├── AUTH_REQUIRED (JWT bearer):
    │   ├── /buildings, /controllers, /metrics, /alerts
    │   ├── /transformers, /lines, /cold-water-sources
    │   ├── /heat-sources, /water-lines, /water-suppliers
    │   ├── /analytics (25+ endpoints, Circuit Breaker)
    │   ├── /power-analytics
    │   ├── /integration/request-counts, /integration/building-requests/:id
    │   └── /admin (+ isAdmin guard)
    │
    └── ADMIN_ONLY:
        ├── /admin/* (bulk operations)
        └── /integration/config, /integration/logs, /integration/rules
```

### Data Flow (текущий)
```
Generator (cron каждые 2 мин)
    │
    │ HTTP POST /api/metrics/telemetry
    │ (payload: controller_id, 17 metric fields, timestamp)
    ▼
Express.js → metricController.receiveTelemetry()
    │
    ├── Controller lookup by serial_number
    ├── Anomaly detection (threshold checks)
    ├── Controller status → "online"
    ├── Cache invalidation
    └── INSERT INTO metrics
         │
         ▼
    PostgreSQL (metrics table)
         │
    ┌────┴────┐
    │         │
    ▼         ▼
Frontend   alertService (threshold → alert → UK pipeline)
(polling)
```

### UK Integration (bidirectional)
```
InfraSafe → UK Bot:
    alertService.createAlert() → ukIntegrationService.sendAlertToUK()
    → match alert_rules → resolve building_ids → ukApiClient.createRequest()
    → POST to UK API with JWT auth + retry + exponential backoff

UK Bot → InfraSafe:
    POST /webhooks/uk/building → HMAC verify → building sync (create/update/soft-delete)
    POST /webhooks/uk/request  → HMAC verify → request status update → auto-resolve alerts
```

### API Endpoints Summary

| Prefix | Methods | Auth | Description |
|--------|---------|------|-------------|
| `/auth` | POST login/register/refresh/logout | Public (login/register/refresh) | Authentication |
| `/buildings` | CRUD | JWT | Buildings management |
| `/controllers` | CRUD + status | JWT | IoT controllers |
| `/metrics` | CRUD + telemetry + aggregated + cleanup | Mixed | Sensor data |
| `/alerts` | CRUD + acknowledge + close | JWT | Alert lifecycle |
| `/analytics` | 25+ GET endpoints | JWT | Analytics (Circuit Breaker) |
| `/admin` | Bulk CRUD | JWT + isAdmin | Admin operations |
| `/buildings-metrics` | GET | optionalAuth | Map data aggregation |
| `/power-analytics` | GET + refresh | JWT (refresh: admin) | Power grid analysis |
| `/transformers` | CRUD | JWT | Transformers |
| `/lines` | CRUD | JWT | Power lines |
| `/cold-water-sources` | CRUD | JWT | Cold water sources |
| `/heat-sources` | CRUD | JWT | Heat sources |
| `/water-lines` | CRUD | JWT | Water lines |
| `/water-suppliers` | CRUD | JWT | Water suppliers |
| `/webhooks/uk/*` | POST | HMAC-SHA256 | UK Bot webhooks |
| `/integration` | GET/PUT | JWT/admin | UK integration config |

---

## 6. Модели данных

### PostgreSQL Tables

**Core:**
| Таблица | PK | Описание |
|---------|-----|----------|
| `users` | user_id (serial) | Пользователи, роли (admin/operator/user), account locking |
| `refresh_tokens` | token_id (bigserial) | JWT refresh tokens, FK → users |
| `token_blacklist` | id (bigserial) | Blacklisted JWT tokens |
| `buildings` | building_id (serial) | Здания + PostGIS geom + external_id (UK) + uk_deleted_at |
| `controllers` | controller_id (serial) | IoT-контроллеры, FK → buildings, status, last_heartbeat |
| `metrics` | metric_id (serial) | Телеметрия: 3×voltage, 3×amperage, water pressure/temp, air temp, humidity, leak |
| `alerts` | alert_id (serial) | Алерты: type, severity, status (active/acknowledged/closed) |
| `alert_types` | alert_type_id (serial) | Справочник типов алертов |

**Infrastructure:**
| Таблица | PK | Описание |
|---------|-----|----------|
| `transformers` | transformer_id (serial) | Трансформаторы + PostGIS geom |
| `power_transformers` | id (varchar) | **LEGACY DUPLICATE** of transformers |
| `lines` | line_id (serial) | Линии электропередач + JSONB paths, FK → transformers |
| `water_lines` | line_id (serial) | Линии водоснабжения + JSONB paths |
| `cold_water_sources` | id (varchar) | Источники холодной воды + PostGIS |
| `heat_sources` | id (varchar) | Источники тепла + PostGIS |
| `water_suppliers` | supplier_id (serial) | Поставщики воды |
| `water_measurement_points` | point_id (serial) | Точки измерения воды, FK → buildings |

**UK Integration:**
| Таблица | PK | Описание |
|---------|-----|----------|
| `integration_config` | key (varchar) | Key-value config store (uk_api_url, etc.) |
| `integration_log` | id (serial) | Sync event log with retry tracking |
| `alert_rules` | id (serial) | Alert type → UK request mapping rules |
| `alert_request_map` | id (serial) | Alert → UK request tracking (idempotent) |

**Analytics:**
| Таблица | PK | Описание |
|---------|-----|----------|
| `analytics_history` | id (serial) | Partitioned history (current_month, prev_month) |
| `mv_transformer_load_realtime` | — | Materialized view: transformer load analytics |

**Known schema issues:**
- `transformers` и `power_transformers` — дубликат таблиц
- `buildings.hot_water` и `buildings.has_hot_water` — дубликат колонок
- `metrics` — в production DB партиционирована (monthly), в init SQL — нет
- 3 варианта миграции 003 (только `003_power_calculation_v2.sql` актуален)

### Metric Fields (17 per record)
```
electricity_ph1, electricity_ph2, electricity_ph3    — Voltage (V)
amperage_ph1, amperage_ph2, amperage_ph3             — Amperage (A)
cold_water_pressure, cold_water_temp                 — Cold water
hot_water_in_pressure, hot_water_out_pressure        — Hot water pressure
hot_water_in_temp, hot_water_out_temp                — Hot water temperature
air_temp, humidity                                   — Environment
leak_sensor                                          — Boolean leak detection
timestamp                                            — ISO 8601
```

---

## 7. Конфигурация и переменные окружения

### Обязательные (backend)
| Переменная | Описание |
|-----------|----------|
| `DB_HOST` | PostgreSQL host |
| `DB_PORT` | PostgreSQL port (default: 5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `JWT_SECRET` | JWT signing secret |
| `JWT_REFRESH_SECRET` | JWT refresh token secret |

### Опциональные (backend)
| Переменная | Описание | Default |
|-----------|----------|---------|
| `NODE_ENV` | Environment | development |
| `PORT` | Server port | 3000 |
| `CORS_ORIGINS` | Allowed origins (comma-separated) | — |
| `LOG_LEVEL` | Winston log level | info |
| `LOG_FILE` | Log file path | logs/app.log |
| `SWAGGER_ENABLED` | Enable Swagger UI | — |

### UK Integration (ENV-only, never in DB)
| Переменная | Описание |
|-----------|----------|
| `UK_WEBHOOK_SECRET` | HMAC-SHA256 shared secret |
| `UK_SERVICE_USER` | Service account for UK API |
| `UK_SERVICE_PASSWORD` | Service account password |

### Отсутствуют в .env.example (нужно добавить)
- `UK_WEBHOOK_SECRET`, `UK_SERVICE_USER`, `UK_SERVICE_PASSWORD`
- `SENTRY_DSN`

---

## 8. Docker и деплой

### Docker Compose Variants
| Файл | Назначение | Сервисы | Порты |
|------|-----------|---------|-------|
| `docker-compose.dev.yml` | Разработка | frontend(8088), app(3000), postgres(5435) | Hot reload, volume mounts |
| `docker-compose.prod.yml` | Production | frontend(8080), app(3000), postgres(5432) | .env.prod, resource limits, logging |
| `docker-compose.unified.yml` | Единое развёртывание | frontend(8080), app(3000), postgres, nginx(80,443) | TLS, commented-out services |
| `docker-compose.generator.yml` | Генератор метрик | generator(3001) | Cron-based metric simulation |

### Dockerfiles
| Файл | Base | Особенности |
|------|------|-------------|
| `Dockerfile.prod` | node:18-alpine | Multi-stage, non-root, healthcheck, 512MB heap |
| `Dockerfile.dev` | node:18-alpine | All deps, nodemon |
| `Dockerfile.unified` | Multi-target | frontend + backend targets |
| `Dockerfile.frontend-only` | nginx | Static files only |
| `generator/Dockerfile` | node:18-alpine | Generator service |

### Known Docker Issues
- **node:18-alpine** в Dockerfile.prod и Dockerfile.dev — Node 18 EOL (апрель 2025), README заявляет Node 20+
- **`npm install --only=production`** в Dockerfile.prod — deprecated, нужен `npm ci --omit=dev`
- **PostgreSQL port 5432** экспонирован в docker-compose.prod.yml — security risk
- **Hardcoded `DB_PASSWORD=@ppl1c@ti0n`** в docker-compose.unified.yml:36,52

### Deploy Target
- VPS: `95.46.96.105` (leaked in docker-compose.unified.yml WireGuard comment)
- Domain: `infrasafe.aisolutions.uz` (in nginx.production.conf)
- TLS: Let's Encrypt (configured in nginx.production.conf)

---

## 9. CI/CD

**Текущее состояние: CI/CD отсутствует.**

- Нет `.github/workflows/` директории
- Нет `gitlab-ci.yml`
- Нет `Jenkinsfile`
- Тесты запускаются только вручную через `npm test`
- Есть `.gitpod.yml` (GitPod workspace config)

**Рекомендация:** GitHub Actions pipeline с lint + test + audit (план в `docs/superpowers/plans/2026-04-02-production-readiness.md`, Task 5).

---

## 10. Существующая документация — аудит

### Актуальные документы
| Файл | Оценка | Комментарий |
|------|--------|-------------|
| `CLAUDE.md` | ✅ Актуален | Comprehensive AI context, включая UK integration |
| `README.md` | ⚠️ Частично устарел | Тесты: "175" → реально 677. Структура проекта неполная |
| `.env.example` | ⚠️ Неполный | Отсутствуют UK Integration переменные |
| `docs/PRODUCTION_SETUP.md` | ✅ Полезен | Production setup guide |
| `docs/DEVELOPMENT_DOCKER_GUIDE.md` | ✅ Актуален | Docker dev guide |
| `docs/GENERATOR.md` | ✅ Актуален | Generator documentation |
| `docs/API_AUTH_MATRIX.md` | ✅ Актуален | Auth matrix for all endpoints |
| `docs/POWER-ANALYTICS-API.md` | ✅ Актуален | Power analytics API docs |
| `tests/README.md` | ✅ Актуален | Test instructions |

### Архивные документы (docs/archive/)
80+ файлов — session reports, test reports, fix summaries. **Не актуальны для текущей разработки**, но представляют историческую ценность.

### Аналитические документы (docs/refactor/, docs/production/)
| Файл | Описание |
|------|----------|
| `docs/refactor/ARCHITECTURE_REVIEW.md` | Previous architecture audit |
| `docs/refactor/REFACTORING_PLAN.md` | 8-sprint refactoring plan |
| `docs/refactor/2026-03-07-infrasafe-v2-unified-platform-design.md` | v2 design (Vue 3, UK merge) |
| `docs/production/PRODUCTION-UPGRADE-PLAN.md` | Production upgrade plan (2026-04-02) |
| `docs/architecture/2026-04-02-service-stack-debate.md` | IoT service stack debate |
| `project-audit.md` | Full project audit (2026-04-02) |

---

## 11. Тесты

### Summary
| Тип | Файлов | ~Тестов | Фреймворк |
|-----|--------|--------|-----------|
| Unit | 56 | ~520 | Jest |
| Integration | 2 | ~50 | Jest + supertest |
| Security | 3 | ~50 | Jest |
| E2E | 10 | ~57 | Jest (real Docker, no mocks) |
| **Total** | **71** | **~677** | — |

### Coverage
- **~90.2%** overall (по данным предыдущего аудита)
- Все директории ≥80%
- E2E тесты исключены из default `npm test` (run via `npm run test:e2e`)
- E2E globalSetup.js кэширует auth tokens для обхода rate limiter

### Test Commands
```bash
npm test                    # All tests except E2E (~620 tests)
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm run test:security       # Security tests (SQL injection, XSS)
npm run test:coverage       # With coverage report
npm run test:e2e            # E2E (requires running Docker containers)
npm run test:watch          # Watch mode
```

### What's NOT tested
- Frontend JavaScript (public/*.js) — нет unit тестов
- Nginx configuration — нет automated verification
- Docker build — нет CI pipeline

---

## 12. Технический долг и TODO

### TODO/FIXME в коде
| Файл | Строка | Текст |
|------|--------|-------|
| `src/services/alertService.js` | 296 | `TODO: Реализовать WebSocket broadcast` |

Это единственный TODO в production-коде.

### Критичный технический долг
| # | Проблема | Файл/Строка | Severity |
|---|----------|-------------|----------|
| 1 | Hardcoded DB password `@ppl1c@ti0n` | `docker-compose.unified.yml:36,52` | **CRITICAL** |
| 2 | Leaked server IP `95.46.96.105` | `docker-compose.unified.yml:143` | HIGH |
| 3 | Node.js 18 (EOL) в Dockerfiles | `Dockerfile.prod:2,14`, `Dockerfile.dev:1` | **CRITICAL** |
| 4 | No ESLint config | Нет `eslint.config.*` в корне | HIGH |
| 5 | No CI/CD pipeline | Нет `.github/workflows/` | **CRITICAL** |
| 6 | No TLS nginx in prod compose | `docker-compose.prod.yml` | **CRITICAL** |
| 7 | PostgreSQL port exposed in prod | `docker-compose.prod.yml:80` | HIGH |
| 8 | Duplicate tables: transformers/power_transformers | `01_init_database.sql` | MEDIUM |
| 9 | Duplicate columns: buildings.hot_water/has_hot_water | `01_init_database.sql` | LOW |
| 10 | 3 versions of migration 003 | `database/migrations/` | MEDIUM |
| 11 | No migration runner/tracking | `database/migrations/` | HIGH |
| 12 | admin.js monolith (~2600 lines) | `public/admin.js` | MEDIUM |
| 13 | script.js monolith (~1400 lines) | `public/script.js` | MEDIUM |
| 14 | No database backups | No cron script | HIGH |
| 15 | 90 lines of commented-out services | `docker-compose.unified.yml:67-157` | LOW |
| 16 | `trust proxy` not set | `src/server.js` | HIGH |
| 17 | SQL debug logging in production | `src/config/database.js:45` | MEDIUM |
| 18 | README: "175 тестов" (outdated) | `README.md:182` | LOW |

### Рекомендации по приоритетам
1. **CRITICAL (блокирует production):** #1, #3, #4, #5, #6
2. **HIGH (нужно до production):** #2, #7, #11, #14, #16
3. **MEDIUM (tech debt):** #8, #10, #12, #13, #17
4. **LOW (nice-to-have):** #9, #15, #18

**Plan:** `docs/superpowers/plans/2026-04-02-production-readiness.md` (10 tasks, ~48 steps)

---

## 13. Открытые вопросы

| # | Вопрос | Контекст |
|---|--------|----------|
| 1 | **Какие реальные контроллеры будут использоваться?** | ARM (Raspberry Pi) vs x86 (industrial PC). Определяет firmware и протоколы |
| 2 | **Какая частота данных с реальных контроллеров?** | 1/sec? 1/min? 1/5min? Влияет на нагрузку PostgreSQL и необходимость InfluxDB |
| 3 | **Нужны ли команды к контроллерам (bidirectional)?** | Firmware update, reboot, config push. Определяет MQTT topic structure |
| 4 | **Какое edge-железо сервера?** | RAM, CPU, disk. Бюджет для Docker services |
| 5 | **Один сервер или мульти-сайт?** | Edge gateways на объектах или всё к одному серверу |
| 6 | **Что с Git-историей секретов?** | `@ppl1c@ti0n` в git history. BFG cleanup нужен? |
| 7 | **Когда появятся реальные контроллеры?** | Определяет timing для WireGuard + Mosquitto |
| 8 | **Нужна ли offline resilience?** | Что делает контроллер без VPN? Буферизация? |
| 9 | **Regulatory/compliance требования?** | Хранение данных, retention, audit trail |
| 10 | **Когда merge feature/uk-integration-phase3-5?** | 5 phases complete, but not merged to main |
| 11 | **Когда merge feature/frontend-redesign?** | New design system, but not merged |
| 12 | **Partition strategy для metrics в init SQL?** | Production DB partitioned, init SQL — нет. Рассинхрон |
