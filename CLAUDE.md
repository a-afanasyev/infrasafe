# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfraSafe is a digital IoT monitoring platform for multi-apartment buildings (Russian-language UI). It collects data from intelligent controllers (industrial PCs with sensors), processes metrics, and provides real-time visualization through interactive Leaflet maps and analytics dashboards. The system monitors electrical supply, water systems, heating, and environmental conditions with automated alerting. Includes integration module with external UK (Управляющая Компания) management bot for bidirectional building and request synchronization.

**Tech stack**: Node.js 20+ / Express.js backend, PostgreSQL 15+ with PostGIS, vanilla JavaScript frontend (Leaflet.js + Chart.js), Docker Compose orchestration, Nginx reverse proxy.

**Active branches**:
- `main` — production backend + legacy frontend + full UK integration (Phases 1-5 merged) + Phase 5-12B refactors + esbuild bundler
- `feature/frontend-redesign` — new frontend-design/ (Inter font, design tokens, dark/light themes, responsive dashboard), not yet merged

## Key Commands

### Development
```bash
# Docker development environment (recommended)
docker compose -f docker-compose.dev.yml up --build

# Backend only (requires local PostgreSQL)
npm run dev        # nodemon hot-reload on port 3000
npm start          # production mode

# Lint
npm run lint
```

### Testing
```bash
npm test                    # All Jest tests
npm run test:unit           # Unit tests (tests/jest/unit/)
npm run test:integration    # Integration tests (tests/jest/integration/)
npm run test:security       # Security tests (tests/jest/security/)
npm run test:coverage       # With coverage report
npm run test:watch          # Watch mode

# Unified test framework (requires running API)
./tests/orchestrator/unified-test-runner.sh all
./tests/orchestrator/unified-test-runner.sh quick
./tests/orchestrator/unified-test-runner.sh health
```

### Database
```bash
# Docker exposes PostgreSQL on port 5435
psql postgresql://postgres:postgres@localhost:5435/infrasafe

# Init scripts run automatically via Docker entrypoint from database/init/
# Schema: database/init/01_init_database.sql
# Seed data: database/init/02_seed_data.sql
# Migrations: database/migrations/003-015 (see database/migrations/README.md)
# Latest migrations: 011 UK integration, 012 TOTP 2FA, 013 account lockout, 014 perf indexes, 015 alert dedup
```

## Architecture

### Three-Layer Backend (src/)
1. **Controllers** (`src/controllers/`) - HTTP handling, validation, response formatting
2. **Services** (`src/services/`) - Business logic, caching, circuit breaker, UK integration
3. **Models** (`src/models/`) - Direct SQL queries via `pg` Pool (no ORM)

### Request Flow
`Nginx (8088)` -> `/api/*` proxied to -> `Express (3000)` -> `src/routes/index.js` (main router) -> per-entity route files -> controllers -> services -> models -> PostgreSQL

### Authentication
- **Default-deny JWT** middleware in `src/routes/index.js` — all routes require auth by default
- Public routes allowlist: POST `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/verify-2fa`, `/auth/setup-2fa`, `/auth/confirm-2fa`, POST `/metrics/telemetry`, GET `/buildings-metrics`, GET `/`, POST `/webhooks/uk/building`, POST `/webhooks/uk/request`
- `optionalAuth` on `/buildings-metrics` — anonymous gets truncated data, authenticated gets full metrics
- `isAdmin` guards on: admin routes, analytics transformer CRUD, power-analytics refresh, controller status updates, integration config/logs/rules
- JWT with refresh tokens, blacklist, and persistent account lockout (`src/middleware/auth.js` + `src/models/AccountLockout.js`, migration 013)
- **2FA (TOTP)**: mandatory for admin accounts. Login returns `{ requires2FA | requires2FASetup, tempToken }` (no `accessToken`); flow completes via `/auth/verify-2fa` or `/auth/setup-2fa` → `/auth/confirm-2fa`. `generateSetup()` is idempotent — same secret returned until `confirmSetup()` succeeds, so refreshing the QR page doesn't invalidate prior scans (`src/services/totpService.js`).
- **Admin login flow** (2026-04-17): `admin.html` delegates login entirely to `/login.html`. `public/admin-auth.js` only validates the token in localStorage and intercepts `window.fetch` to add `Authorization: Bearer`; when unauthenticated it redirects to `/login.html`, which writes `admin_token` back and redirects to `/admin.html`.

### Key Patterns
- **Circuit Breaker**: `src/utils/circuitBreaker.js`, used in `analyticsService.js` for fault tolerance
- **Multi-layer Caching**: `src/services/cacheService.js` (in-memory, Redis-ready)
- **Alert Cooldown**: 15-minute cooldown between identical alerts in `src/services/alertService.js`
- **Alert Event Bus** (Phase 7): `src/events/alertEvents.js` — `EventEmitter` decouples `controllerService` → `alertService` → `ukIntegrationService`; breaks prior circular requires. Events: `TRANSFORMER_CHECK`, `ALERT_CREATED`, `UK_REQUEST_RESOLVED`.
- **CRUD Factory** (Phase 6): `src/models/factories/createCrudModel.js` and `src/controllers/factories/createCrudController.js` — used by `ColdWaterSource`, `HeatSource`; generate a `{ findAll, findById, create, update, delete }` model class and matching controller from a table descriptor.
- **Admin Query Helpers** (Phase 5): `src/utils/adminQueryBuilder.js` (`buildPaginatedList()` with filter kinds exact/like/gte/lte, sort alias map, group-by) and `src/utils/dynamicUpdateBuilder.js` (`buildUpdateQuery()` with `ALLOWED_UPDATE_TABLES` whitelist). Shared by 8 admin controllers; `IDENT_RE` regex validates every identifier before it reaches SQL.
- **Persistent Account Lockout** (Phase 12B.3): `src/models/AccountLockout.js` + migration 013 — replaces in-memory `Map` so lockout state survives restart and is consistent across replicas.
- **SQL Injection Prevention**: Whitelist validation via `src/utils/queryValidation.js` for sort/order params
- **Standardized Responses**: `src/utils/apiResponse.js` — `sendError`, `sendNotFound`, `sendCreated`, `sendSuccess`
- **Correlation ID**: `src/middleware/correlationId.js` — request tracing via `x-correlation-id` header
- **Rate Limiting**: `src/middleware/rateLimiter.js` — brute-force and DDoS protection
- **Graceful Shutdown**: SIGTERM/SIGINT handling in `src/server.js` — close HTTP server + DB pool
- **Health Check**: `GET /health` — DB ping, returns `{ status: 'healthy' }` or 503
- **Webhook HMAC Verification**: `src/services/ukIntegrationService.js` — HMAC-SHA256 signature with replay protection (300s tolerance), format `t=<timestamp>,v1=<hex>`
- **Webhook Validation**: `src/utils/webhookValidation.js` — UUID, enum whitelist validation for webhook payloads
- **Integration Event Logging**: `integration_log` table — audit trail for all UK sync operations with retry tracking
- **Raw Body Preservation**: `src/server.js` — `req.rawBody` captured for webhook signature verification
- **Frontend Bundle Pipeline** (Phase 12B.4): `build/esbuild.config.mjs` emits minified JS + sourcemaps to `public/dist/`; `postinstall` in `package.json` rebuilds on every `npm ci`. HTML pages reference `public/dist/*.js`; production nginx denies `.map` files.

### API Routes (src/routes/index.js)
All mounted under `/api`:
- `/auth` - Login, register, refresh, logout
- `/buildings`, `/controllers`, `/metrics` - Core CRUD
- `/transformers`, `/lines` - Power infrastructure
- `/cold-water-sources`, `/heat-sources`, `/water-lines`, `/water-suppliers` - Water infrastructure
- `/analytics` - 25+ analytical endpoints with Circuit Breaker
- `/alerts` - Alert lifecycle (create -> acknowledge -> close)
- `/admin` - Bulk admin operations
- `/buildings-metrics` - Map data aggregation
- `/power-analytics` - Power grid analysis
- `/webhooks/uk` - Incoming webhooks from UK bot (HMAC-verified, rate-limited 60/min, no JWT)
- `/integration` - UK integration: config/logs/rules (admin-only), request-counts/building-requests (any auth user)

### UK Integration Module
Bidirectional integration with UK Management Bot (Управляющая Компания). All 5 phases complete.

**Backend files:**
- `src/services/ukIntegrationService.js` — Core logic: webhook verification, building sync, alert→request pipeline, request→alert feedback, request counts with caching
- `src/clients/ukApiClient.js` — UK API client: JWT auth with 25min token cache, createRequest() with retry + exponential backoff, get() with 401 retry
- `src/routes/webhookRoutes.js` — POST `/webhooks/uk/building` and `/webhooks/uk/request` (full validation, TOCTOU-safe)
- `src/routes/integrationRoutes.js` — Admin API + public-auth endpoints: config, logs, rules, request-counts, building-requests
- `src/utils/webhookValidation.js` — Input validation helpers
- `src/models/IntegrationConfig.js` — Key-value config store (DB-backed)
- `src/models/IntegrationLog.js` — Sync event log with pagination and filtering
- `src/models/AlertRule.js` — Alert-to-UK-request mapping rules + `findByTypeAndSeverity()`
- `src/models/AlertRequestMap.js` — Tracks alert→request mappings: create, findByAlertAndBuilding, markSent, findByRequestNumber, updateStatus, areAllTerminal

**Key methods in ukIntegrationService:**
- `sendAlertToUK(alertData)` — matches alert rules, resolves buildings by infrastructure FK, creates UK requests with idempotent mappings
- `handleRequestWebhook(payload)` — terminal status detection (Принято/Отменена), auto-resolves alert when all requests terminal
- `resolveBuildingIds(id, type)` — resolves via primary/backup_transformer_id, controller_id, cold_water_source_id, heat_source_id
- `getRequestCounts()` / `getBuildingRequests()` — UK API proxy with 60s cache, graceful degradation

**Building model extensions** (`src/models/Building.js`):
- `external_id` (UUID) — reference to UK system building
- `uk_deleted_at` — soft delete from UK
- Methods: `findByExternalId()`, `createFromUK()`, `syncFromUK()`, `softDeleteFromUK()`

**Security:** HMAC-SHA256 webhook signatures, replay protection, insert-first UNIQUE guard (TOCTOU-safe), idempotent alert→request mapping, rate limiting (60 req/min), timing-safe comparison. Secrets (UK_WEBHOOK_SECRET, UK_SERVICE_USER, UK_SERVICE_PASSWORD) stored in ENV only, never in DB.

**API endpoints (Phase 5):**
- `GET /integration/request-counts` — any authenticated user (not admin), 60s cached
- `GET /integration/building-requests/:externalId` — any authenticated user, UUID validated
- Both mounted BEFORE `router.use(isAdmin)` in integrationRoutes.js

**Phased plan (5 phases, all merged to `main`):**
1. Foundation (DB, models, routes, admin UI, logging) — **DONE**
2. Building Sync (UK → InfraSafe) — **DONE**
3. Alert → Request Pipeline (InfraSafe → UK) — **DONE**
4. Request → Alert Feedback (UK → InfraSafe) — **DONE**
5. Map Layer backend (request counts, caching, external_id) — **DONE**

**Spec:** `docs/superpowers/specs/2026-03-24-infrasafe-uk-integration-v2-design.md`

### Frontend (Legacy — main branch)
- **Vanilla JS** (no framework), HTML files at project root (`index.html`, `admin.html`, `about.html`, `contacts.html`, `documentation.html`)
- **Public assets** in `public/` — sources: `script.js` (map interface, ~2,335 LoC), `admin.js` (admin panel, ~3,429 LoC), `admin-auth.js`, `map-layers-control.js`, `infrastructure-line-editor.js`, `admin-coordinate-editor.js`, `login.html`, utility modules under `public/utils/`.
- **Bundling** (Phase 12B.4): HTML pages reference minified bundles at `public/dist/*.js` served with `Content-Encoding: gzip` (e.g. `script.js` ≈ 49.8 KB minified, ≈ 12.6 KB gzipped). Dev: `npm run build:frontend:watch`; fresh clone runs the build via `npm ci` postinstall.
- **Leaflet.js** with marker clustering, multiple layers (buildings, transformers, water/heat sources), custom icons
- **Chart.js** for analytics visualization
- **DOMPurify** for XSS protection (`public/utils/domSecurity.js`)
- **Admin panel** includes "Интеграция UK" tab for managing integration settings, logs, and alert mapping rules

### Frontend Redesign (feature/frontend-redesign branch)
- **Directory**: `frontend-design/` — complete new frontend with design system
- **Design tokens**: CSS custom properties in `css/design-tokens.css` (colors, spacing, typography, shadows)
- **Themes**: Light/dark with `data-theme` attribute, persisted to localStorage
- **Auth**: `js/auth.js` (JWT login/refresh), `js/auth-guard.js` (redirect to login), `js/api.js` (fetch wrapper with token)
- **Shared components**: `js/sidebar.js`, `js/page-shell.js`, `js/theme.js`, `js/components/` (command-palette, notification-center, connection-banner, kiosk-mode)
- **Pages**: dashboard.html, map.html, buildings.html, controllers.html, power.html, water.html, heating.html, energy-analytics.html, alerts.html, users.html, settings.html, shift-handover.html, login.html, index.html (landing)
- **Map**: Leaflet with circleMarkers (color-coded status), collapsible sidebar, collapsible layers panel, table-based popups with blinking status indicators, dynamic power data loading
- **Docker**: `docker-compose.dev.yml` mounts `frontend-design/` as nginx root on port 8088

### Database
- **PostgreSQL 15+ with PostGIS** extension (SRID 4326 for coordinates)
- **Core tables**: `users`, `buildings`, `controllers`, `metrics`, `alerts`, `alert_types`
- **Infrastructure tables**: `power_transformers`, `cold_water_sources`, `heat_sources`, `water_lines`, `water_suppliers`
- **UK Integration tables**: `integration_config`, `integration_log`, `alert_rules`, `alert_request_map`
- **Building extensions**: `external_id` (UUID, UNIQUE), `uk_deleted_at` (TIMESTAMPTZ), nullable `latitude`/`longitude`
- **Materialized views** for transformer load analytics
- Schema defined in `database/init/01_init_database.sql`
- UK migration: `database/migrations/011_uk_integration.sql`

### Generator
`generator/` contains a standalone service (separate `package.json`) for generating simulated metric data, run via `docker-compose.generator.yml`.

## Environment Variables
```bash
# Required
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET, JWT_REFRESH_SECRET

# 2FA (TOTP) Encryption — required (generate: openssl rand -base64 32)
TOTP_ENCRYPTION_KEY

# Optional
NODE_ENV=development|production
PORT=3000
CORS_ORIGINS=http://localhost:8088,http://localhost:3000
LOG_LEVEL=info|debug|warn|error
LOG_FILE=logs/app.log

# UK Integration (ENV-only secrets, never stored in DB)
UK_WEBHOOK_SECRET          # HMAC-SHA256 shared secret for webhook verification
UK_SERVICE_USER            # Service account for UK API calls
UK_SERVICE_PASSWORD        # Service account password
# UK Integration (DB-stored via integration_config, toggleable in admin UI)
# uk_integration_enabled, uk_api_url, uk_frontend_url
```

## Docker Services
- **frontend**: Nginx on port 8088 (static files + API proxy)
- **app**: Node.js Express on port 3000
- **postgres**: PostGIS on port 5435 (mapped from container 5432)

## Test Data
- **Admin**: admin / admin123
- **Test user**: testuser / TestPass123
- **17 buildings** in Tashkent with coordinates, **34 metric records**

## Test Suite
- **1804+ tests** in `npm test` (89 suites) plus `npm run test:e2e` (~57 in `tests/jest/e2e/`)
- Unit tests: `tests/jest/unit/` (~29 files — services, controllers, models, middleware, UK integration, totpService, AccountLockout, EventBus, factories)
- Integration tests: `tests/jest/integration/` (API, default-deny auth)
- Security tests: `tests/jest/security/` (SQL injection, XSS, general security)
- E2E tests: `tests/jest/e2e/` — real Docker containers, no mocks — run via `npm run test:e2e`
- E2E requires running Docker containers; excluded from default `npm test` via testPathIgnorePatterns
- E2E globalSetup.js caches auth tokens to avoid rate limiter; restart app before running

## Known Architecture Issues

- `public/admin.js` (~3,429 lines) and `public/script.js` (~2,335 lines) are still monolithic — Phase 12B.4 activated bundling but did not split entry points.
- Models execute SQL directly (no repository layer). Phase 6 introduced `createCrudModel` factory for two water-source models; the rest still hand-write queries.
- Some backend code uses `console.error` instead of Winston logger.
- Duplication across water-related route files remains (Phase 6 factory covers models only).
- Rate-limiter, cache, and outbox are still in-memory — multi-replica deployments will need Redis (tracked in audit plan Phase 11.1/11.2/11.10).
- Frontend redesign (`feature/frontend-redesign`) not yet merged to main.

NEVER delete the project directory or run rm -rf in the project root.
