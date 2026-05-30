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
# Migrations: database/migrations/003-029 (see database/migrations/README.md)
# Latest migrations: 011 UK integration, 012 TOTP 2FA, 013 account lockout, 014 perf indexes,
#                    015 alert dedup, 016 password_changed_at, 017 runtime role,
#                    018 alert_request_map FK (Sprint 5), 019 buildings FK indexes (Sprint 5),
#                    020 mv refresh SECURITY DEFINER wrapper (Sprint 6),
#                    021 alerts.metric_id FK (Sprint 7),
#                    022 uk_outbox table (Sprint 9 FIX-007),
#                    023 alert_request_map counter partial index (Sprint 9),
#                    024 alert_rules extensions (Sprint 10 PR-1: persistence + reopen policy cols),
#                    025 alert_verifications queue (Sprint 10 PR-2),
#                    026 alert_suppressions table (Sprint 10 PR-4),
#                    027 alerts lifecycle v2 (Sprint 10 PR-2: status enum + reopen_chain_id),
#                    028 drop alert_types catalog (Sprint 10 PR-1.5),
#                    029 alert_rule_changes audit log (Sprint 10 PR-5),
#                    030 uk_request_url_template config seed (Sprint 11 B-001),
#                    031 B-020 backfill orphaned resolved_verifying alerts (Sprint 11)
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
- **Map-page login modal — 2FA condition order** (2026-05-24 fix): the inline modal in `public/script.js` had `if (response.ok && data.success)` BEFORE `data.requires2FA`. Backend returns `{success:true, requires2FA:true, tempToken}` for admin login, so the modal closed immediately without ever issuing a cookie — `apiClient.isAuthenticated` flipped true on a non-existent session, every subsequent `/api/*` call returned 401. Mirror `public/login.js`: check `requires2FA` / `requires2FASetup` FIRST, then the terminal `success` branch. `completeMapLogin` also reordered to close the modal + flip the auth button BEFORE awaiting `loadData()`, wrapped in try/catch so a network blip cannot leave the modal half-closed.

### Key Patterns
- **Circuit Breaker**: `src/utils/circuitBreaker.js`, used in `analyticsService.js` for fault tolerance
- **Multi-layer Caching**: `src/services/cacheService.js` (in-memory, Redis-ready)
- **Alert Cooldown**: 15-minute cooldown between identical alerts in `src/services/alertService.js`
- **Alert Event Bus** (Phase 7 + Sprint 10): `src/events/alertEvents.js` — `EventEmitter` decouples `controllerService` → `alertService` → `ukIntegrationService`; breaks prior circular requires. Events: `TRANSFORMER_CHECK`, `ALERT_CREATED`, `UK_REQUEST_RESOLVED`, plus Sprint 10: `VERIFY_TRANSFORMER` / `VERIFY_LEAK` / `VERIFY_VOLTAGE` / `VERIFY_HEATING`, `ALERT_REOPENED`, `ALERT_ENGINEER_REQUIRED`, `ALERT_SUPPRESSED`.
- **UK Outbox + Drain Worker** (Sprint 9 / FIX-007): `src/models/UkOutbox.js` + `src/services/uk/ukOutboxService.js` + `src/clients/ukWebhookClient.js`. Persistent outbox (migration 022) drained by singleton worker (mirrors `mvRefreshService` pattern) at ≤30/мин with `pg_try_advisory_lock` for multi-replica safety. Sign-at-send-time HMAC-SHA256 (UK 300s window); body stored as `TEXT` not `JSONB` for byte stability; `ON CONFLICT (event_id) DO NOTHING` for idempotent enqueue; dead-letter writes to `infrastructure_alerts.data.notification_failures`.
- **Alert business rules + Verification + Reopen** (Sprint 10, **LIVE на проде с 2026-05-24 06:43 UTC** — `ALERT_VERIFICATION_ENABLED=true`. Pre-flip ran cleanly through runbook §0; first tick processed leftover verification id=1 from the day's e2e smoke as `markSkipped`. UK side INT-120 (reopen-marker + urgency_override + `uk_category_override` + `alert.engineer_required` routing in their dispatcher) — **backend #1+#2 verified end-to-end 2026-05-24 18:43 UTC** via two prod synthetics: `260524-003` (reopen, integration_log id=133) подтвердил description prefix `"Повторное обращение №N. "` + `uk_urgency_override="Критическая"`; `260524-004` (engineer_required, integration_log id=144) подтвердил `uk_category_override="Инженерный разбор"` precedence > TYPE_TO_CATEGORY > hardcode (UK commit `340e2ea`) + dispatcher routing by category. UK sub-tasks #3 (`GET /api/v2/requests/{number}` surfaces 4 reopen-meta fields) + #4 (dispatcher modal amber "🔁 Повторное обращение №N · связана с XXX" badge + "⚠ Эскалация на инженера" плашка + TWA resident reopen-badge) **closed 2026-05-25**; demo доступно через 260524-004 в UK dashboard. Sprint 11 backlog: admin-UI "открыть в УК" link с reopen-meta passthrough — поля уже есть с PR-3, нужен UI-проброс + использование UK `onOpenRelated` prop. Header note for any future synthetic: webhook signature header for UK inbound is `x-webhook-signature: t=<ts>,v1=<hex>` (NOT `X-Signature` — that gets stripped/lowercased somewhere in the path and yields `401 signature no_header`). Per-rule policy (persistence_seconds, min_affected_buildings, verification_grace/window, max_reopens_per_24h, reopen_urgency_bump) in `alert_rules` (migration 024). `alertService.createAlert` gates: persistence (SQL aggregation against `metrics` for LEAK+controller path; other types fail-open in v1) + affected-buildings count. `alertService.resolveAlert` system path → status `resolved_verifying` + enqueue `AlertVerification`. `src/services/alertVerificationService.js` singleton (mirrors `ukOutboxService` pattern, advisory_lock `849608648`, 15s tick): pickDue + suppression check + reopen-quota check → markPassed / markReopened (new alert with `reopen_sequence=N+1`, `reopen_chain_id`, `related_request_number`, urgency bump) / markEngineerRequired / markSuppressed. **B-020 (2026-05-29)**: каждый terminal-исход теперь делает write-back в `infrastructure_alerts.status` через `alertVerificationService._finalizeAlertStatus(originalAlertId, status)` — passed/reopened/suppressed/skipped → `resolved`, engineer_required → `engineer_required`. До этого фикса `resolved_verifying` был тупиком: алерт навсегда застревал там (прод alerts 25/26 висели днями). Finalize вызывается ПЕРЕД `mark*` (finalize-first → self-healing при крэше между двумя UPDATE, идемпотентность через `WHERE status='resolved_verifying'` guard). Backfill осиротевших — migration 031. `src/models/AlertSuppression.js` keyed on `(infra_type, infra_id, alert_type)` so suppression survives reopen. Schema: migrations 024–027.
- **Admin Rules Editor + Audit Log** (Sprint 10 PR-5): `src/models/AlertRule.js` `EDITABLE_FIELDS` whitelist + `update(id, fields, userId, reason)` diff-then-PATCH-then-audit + `listWithStats(days)` LATERAL join for per-rule alert/escalation/reopen counts. `src/models/AlertRuleChange.js` writes one audit row per changed field (migration 029). Admin UI panel "Правила эскалации" in `admin.html` + `public/admin.js` `renderIntegrationRules`; client-side bounds mirror in `public/utils/ukRulesValidation.js`. Endpoints: `GET /api/integration/rules/stats`, `PATCH /api/integration/rules/:id`, `POST /api/integration/rules/:id/toggle`, `GET /api/integration/rules/:id/history`. CRITICAL-rule disable shows confirmation modal.
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
- `/uk-requests-metrics` - ARCH-114 reconciliation inventory for UK side (no auth, mirror of `/buildings-metrics`)

### UK Integration Module
Bidirectional integration with UK Management Bot (Управляющая Компания). All 5 phases complete + Sprint 9 sender (FIX-007) + Sprint 10 ARCH-114 reconcile (2026-05-24).

**Network topology** (2026-05-24, post-Sprint-9.x): **both directions** of the UK channel flow through the **public HTTPS edge**, NOT the internal docker `uk-network`. The Sprint 9.x compose changes (and subsequent compose-fix PR #51) removed `infrasafe-app-1` from `uk-network`; the public edge became the canonical target for inbound, and after the e2e smoke on 2026-05-24 (alert 24 → ticket 260524-001) we confirmed the same for outbound:
- **UK→InfraSafe** (inbound): `https://infrasafe.uz/webhooks/uk/*` and `/api/uk-requests-metrics` → nginx → `infrasafe-app-1:3000` over the `leaflet-network` bridge.
- **InfraSafe→UK** (outbound): `UK_API_URL=https://infrasafe.uz/uk` → nginx `location ^~ /uk/api/` (nginx-config/nginx.production.conf:192) → rewrite `/uk/api/*` → `http://uk-management-api:8080/api/*` over the `uk-network` bridge (only `infrasafe-nginx-1` is in that network, not the app).

Defense-in-depth: nginx TLS + HMAC-SHA256 webhook signatures (both directions, same `UK_WEBHOOK_SECRET`) + 60/мин rate limit. **Do NOT re-attach `infrasafe-app-1` to `uk-network`** — это вернёт B-011 alias collision: `uk-postgres` имеет alias `postgres` в `uk-network`, и app может зарезолвить DB hostname в чужой контейнер с другим паролем (auth-fail loop, debugged 2026-05-28; fix B-010 закрепил `docker-compose.unified.yml` так чтобы app сидел только в `infrasafe-network + leaflet-network`, без uk-network). Если когда-то понадобится альтернативный internal-docker путь для UK↔InfraSafe — сначала переименуйте generic alias'ы (`postgres`/`redis`/`frontend`/`app`) в обоих compose-проектах на уникальные (`uk-postgres`/`infrasafe-postgres`), задокументируйте в B-011 closure, и только потом обсуждайте network sharing.

**Backend files:**
- `src/services/ukIntegrationService.js` — Facade re-exporting the 5 modules below (Sprint 8 split for P1-14). Bound-method API surface + property proxies for backward compat.
- `src/services/uk/configProxy.js` — `isEnabled` / `getConfig` / `updateConfig` + counter cache (`getRequestCounts`, `getBuildingRequests`, 60s TTL, `invalidateRequestCache`). **Sprint 9**: counters now built from `alert_request_map` SQL aggregation (UK won't implement `/requests/counts-by-building` per O4).
- `src/services/uk/webhookVerifier.js` — HMAC-SHA256 verification + nonce replay protection (Redis-backed when configured, Map fallback). Also `logEvent` / `isDuplicateEvent` helpers. **Sprint 9**: reads `INFRASAFE_WEBHOOK_SECRET ?? UK_WEBHOOK_SECRET` for the rename migration window.
- `src/services/uk/buildingSync.js` — `handleBuildingWebhook` (created/updated/deleted) + deterministic `_generateExternalId`.
- `src/services/uk/alertForwarder.js` — `sendAlertToUK` + `resolveBuildingIds`. Owns the `alertEvents.ALERT_CREATED` listener. **Sprint 9**: enqueues to `uk_outbox` (gated by `UK_USE_WEBHOOK_SENDER`) instead of synchronous JWT call.
- `src/services/uk/requestProcessor.js` — `handleRequestWebhook` (request status feedback from UK). Emits `alertEvents.UK_REQUEST_RESOLVED` for the auto-resolve flow.
- `src/services/uk/ukOutboxService.js` — **Sprint 9 (NEW)** drain worker singleton; per-tick single-row drain with `pg_try_advisory_lock` for multi-replica safety; backoff 2/4/8/16/32s capped at 5 attempts → dead.
- `src/clients/ukWebhookClient.js` — **Sprint 9 (NEW)** HMAC-SHA256 sender; mirrors webhookVerifier algorithm; signs at send-time (not enqueue) for 300s timestamp window; supports dual-secret rotation (`UK_USE_NEXT_SECRET`).
- `src/routes/webhookRoutes.js` — POST `/webhooks/uk/building` and `/webhooks/uk/request` (full validation, TOCTOU-safe)
- `src/routes/integrationRoutes.js` — Admin API + public-auth endpoints: config, logs, rules, request-counts, building-requests
- `src/utils/webhookValidation.js` — Input validation helpers
- `src/models/IntegrationConfig.js` — Key-value config store (DB-backed)
- `src/models/IntegrationLog.js` — Sync event log with pagination and filtering
- `src/models/AlertRule.js` — Alert-to-UK-request mapping rules + `findByTypeAndSeverity()`
- `src/models/AlertRequestMap.js` — Tracks alert→request mappings: create, findByAlertAndBuilding, markSent, findByRequestNumber, findByIdempotencyKey, updateStatus, areAllTerminal
- `src/models/UkOutbox.js` — **Sprint 9 (NEW)** persistent outbox: `enqueue` (ON CONFLICT DO NOTHING), `pickNext` (FOR UPDATE SKIP LOCKED), `markSent` / `markFailed` / `markDead` / `resetForSkip`.

**Key methods:**
- `alertForwarder.sendAlertToUK(alertData)` — matches alert rules, resolves buildings, **Sprint 9**: builds canonical event body and `UkOutbox.enqueue` per building (drain worker handles UK POST)
- `requestProcessor.handleRequestWebhook(payload)` — terminal status detection (Принято/Отменена), auto-resolves alert when all mappings terminal
- `alertForwarder.resolveBuildingIds(id, type)` — resolves via primary/backup_transformer_id, controller_id, cold_water_source_id, heat_source_id
- `configProxy.getRequestCounts()` / `configProxy.getBuildingRequests()` — **Sprint 9**: local SQL aggregation against `alert_request_map`, 60s cache, graceful degradation. ⚠️ Under-count caveat: bot-originated requests not included until UK ARCH-113.
- `webhookVerifier.verifyWebhookSignature(rawBody, sigHeader)` — HMAC + replay protection
- `buildingSync.handleBuildingWebhook(payload)` — building.created / .updated / .deleted
- `ukWebhookClient.send(payloadBody)` — **Sprint 9** HMAC-signs at send-time, POSTs to UK `/api/v2/webhooks/infrasafe/alert`, returns `{outcome: success|dead|retry|skip, code, error}`.
- `ukOutboxService.start()` / `.stop()` — **Sprint 9** drain worker lifecycle; per-tick `_drainOne` translates send outcome to outbox + AlertRequestMap transitions.

**Building model extensions** (`src/models/Building.js`):
- `external_id` (UUID) — reference to UK system building
- `uk_deleted_at` — soft delete from UK
- Methods: `findByExternalId()`, `createFromUK()`, `syncFromUK()`, `softDeleteFromUK()`

**Security:** HMAC-SHA256 webhook signatures both directions, replay protection, insert-first UNIQUE guard (TOCTOU-safe), idempotent alert→request mapping via outbox `ON CONFLICT`, rate limiting (60 req/min inbound + 30/мин outbound drain), timing-safe comparison. Secrets stored in ENV only:
- `INFRASAFE_WEBHOOK_SECRET` — UK signs, InfraSafe verifies (inbound). Fallback `UK_WEBHOOK_SECRET` during migration.
- `UK_WEBHOOK_SECRET` — InfraSafe signs, UK verifies (outbound). **Sprint 9**.
- `UK_WEBHOOK_SECRET_NEXT` + `UK_USE_NEXT_SECRET` — dual-secret rotation support.

**API endpoints (Phase 5):**
- `GET /integration/request-counts` — any authenticated user (not admin), 60s cached, Sprint 9: SQL from `alert_request_map`
- `GET /integration/building-requests/:externalId` — any authenticated user, UUID validated, Sprint 9: SQL from `alert_request_map`
- Both mounted BEFORE `router.use(isAdmin)` in integrationRoutes.js

**Phased plan:**
1. Foundation (DB, models, routes, admin UI, logging) — **DONE**
2. Building Sync (UK → InfraSafe) — **DONE**
3. Alert → Request Pipeline (InfraSafe → UK) — **DONE** (Sprint 9 reimplementation: HMAC webhook via outbox replaces dead JWT path)
4. Request → Alert Feedback (UK → InfraSafe) — **DONE**
5. Map Layer backend (request counts, caching, external_id) — **DONE** (Sprint 9: local SQL counters)
6. **Sprint 9 / FIX-007**: HMAC-webhook sender + persistent outbox + secret split — **DONE** behind `UK_USE_WEBHOOK_SENDER` flag (default off until UK Phase 2 + secret rotation).

**Specs & runbooks:**
- `docs/superpowers/specs/2026-03-24-infrasafe-uk-integration-v2-design.md` — original Phase 1-5 design
- `docs/audit/2026-05-22-FIX-007-uk-integration-questions.md` — Sprint 9 contract negotiation (rounds A-Q)
- `docs/audit/2026-05-22-secret-split-runbook.md` — operator runbook for secret rename + age key exchange

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
- **UK Integration tables**: `integration_config`, `integration_log`, `alert_rules` (+Sprint 10 cols), `alert_request_map`, `uk_outbox`
- **Sprint 10 tables**: `alert_verifications` (verification queue), `alert_suppressions` (operator escape hatch), `alert_rule_changes` (per-field audit log)
- **Status enum** (`infrastructure_alerts.status`): `active`, `acknowledged`, `resolved`, `resolved_verifying`, `engineer_required` (Sprint 10 expansion via migration 027). Partial dedup index restricted to `('active', 'acknowledged')` so a reopen with a fresh `alert_id` is not blocked. `alert_types` catalog dropped in PR-1.5 — type names live as a CHECK constraint on `alert_rules.alert_type`.
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

# Materialized view scheduler (Sprint 6 / P0-6)
MV_REFRESH_ENABLED=true                  # set to false in tests; otherwise leave on
MV_REFRESH_INTERVAL_SECONDS=60           # default 60, clamped to [10, 3600]

# UK Integration — ENV-only secrets (Sprint 9 / FIX-007 split per O5):
INFRASAFE_WEBHOOK_SECRET   # UK→InfraSafe verifier (UK signs, we verify).
                           # Falls back to UK_WEBHOOK_SECRET during rename window.
UK_WEBHOOK_SECRET          # InfraSafe→UK sender (we sign, UK verifies). Sprint 9.
UK_WEBHOOK_SECRET_NEXT     # Optional: NEW value during rotation window. Sprint 9.
UK_USE_NEXT_SECRET=false   # Set to 'true' to switch sender to UK_WEBHOOK_SECRET_NEXT.
UK_API_URL                 # Bare host — client appends /api/v2/webhooks/infrasafe/alert.
                           # Canonical for prod (2026-05-24): https://infrasafe.uz/uk
                           # The nginx `location ^~ /uk/api/` (nginx-config/nginx.production.conf:192)
                           # rewrites /uk/api/* → http://uk-management-api:8080/api/* over
                           # the existing uk-network bridge. Symmetric with UK's inbound:
                           # both directions go through our public HTTPS edge (TLS + HMAC),
                           # no internal docker http://uk-management-api on the InfraSafe
                           # side (infrasafe-app-1 is NOT in uk-network — see compose-fix
                           # PR #51 rationale + the network-topology note under "UK
                           # Integration Module" above).
UK_USE_WEBHOOK_SENDER=false # Master gate for the new HMAC-webhook outbound channel.
                           # Default false until UK Phase 2 + secret rotation completes.
UK_OUTBOX_DRAIN_INTERVAL_MS=2000  # Drain tick (clamped [500, 60000]). Default ≈30/мин rate.

# Sprint 10 — Alert verification + reopen subsystem (deployed dormant 2026-05-23)
ALERT_VERIFICATION_ENABLED=false       # Master gate. false = worker is created but never ticks.
                                       # Flip to true via the CR-window runbook only after
                                       # docs/audit/2026-05-24-sprint-10-rollout-runbook.md §0 pre-flight.
ALERT_VERIFICATION_TICK_MS=15000       # Drain interval (clamped [5000, 60000])

# UK Integration — DB-stored via integration_config, toggleable in admin UI
# uk_integration_enabled, uk_api_url, uk_frontend_url
```

## Docker Services
- **frontend**: Nginx on port 8088 (static files + API proxy)
- **app**: Node.js Express on port 3000
- **postgres**: PostGIS on port 5435 (mapped from container 5432)

### Prod-only compose (`docker-compose.prod.yml`) — 2026-05-24 fixes
- **External nginx network**: the prod `infrasafe-nginx-1` container lives in `infrasafe_leaflet-network` (created by an older deploy). The compose declares it as `external: true` and joins both `app` and `frontend` to it with explicit `app` / `frontend` aliases — without this, every `docker compose up -d --no-deps app frontend` made nginx 502 on `/api/*` until someone manually `docker network connect`'d the services.
- **Portable postgres healthcheck**: uses `pg_isready -h 127.0.0.1 -p 5432` (no `-U`). The earlier check ran `psql -U $POSTGRES_USER -c 'SELECT 1;'` which broke because `$POSTGRES_USER` resolved to `postgres` — a role that does not exist on prod (the bootstrap role is `infrasafe_app`), so the probe failed and postgres went unhealthy on every recreate, blocking app/frontend startup.
- **DB roles** (verified prod 2026-05-30): `infrasafe_app` = SUPERUSER bootstrap/migration role (created from `POSTGRES_USER` at container init); `infrasafe_runtime` = non-super LOGIN role created by migration `017_runtime_role.sql` — **this is the role the app connects as** (`DB_USER=infrasafe_runtime`, least-privilege). Migration 017 *creates* `infrasafe_runtime`; it does NOT rename `infrasafe_app`. Do NOT switch `DB_USER` to `infrasafe_app` (that's the superuser). `POSTGRES_USER` in `.env.prod` is dead config — `docker-compose.unified.yml`'s postgres service hardcodes `POSTGRES_USER=infrasafe_app`, overriding the `.env` value.
- **Frontend bundle on prod**: nginx serves `public/` as a directory bind mount, so `git pull` refreshes `public/dist/*.js` automatically. HTML files (`admin.html`, `index.html`, `login.html`, etc.) are mounted as **individual files** — `git pull` creates new inodes, so nginx keeps reading the old inode until the container is restarted. After a Sprint deploy that touches any `.html`, run `docker restart infrasafe-nginx-1` (or migrate this to a directory mount in a future PR).

## Test Data
- **Admin**: admin / admin123
- **Test user**: testuser / TestPass123
- **17 buildings** in Tashkent with coordinates, **34 metric records**

## Test Suite
- **~2128 tests** in `npm test` (107+ suites) plus `npm run test:e2e` (~57 in `tests/jest/e2e/`). Sprint 10 added ~300 units across persistence gate, verification worker, suppression, AlertRule.update, AlertRuleChange.
- Unit tests: `tests/jest/unit/` — services, controllers, models, middleware, UK integration, totpService, AccountLockout, EventBus, factories, plus Sprint 10: `AlertVerification.test.js`, `AlertSuppression.test.js`, `alertVerificationService.test.js`, `alertService.persistenceGate.test.js`, `alertService.resolveAlert.test.js`, `alertService.reopen.test.js`, `AlertRule.update.test.js`.
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
- Rate-limiter and cache are still in-memory — multi-replica deployments will need Redis (tracked in audit plan Phase 11.1/11.2). Sprint 9 outbox is already DB-backed (`uk_outbox`) and Sprint 10 verification queue is DB-backed (`alert_verifications`), both with `pg_try_advisory_lock` for cross-replica coordination.
- Frontend redesign (`feature/frontend-redesign`) not yet merged to main.
- ~~Prod nginx bind-mounts individual HTML files~~ — **resolved**: HTML moved to a directory mount in B-002 (`frontend-html/`), and the nginx **config** moved to a directory mount in B-012 (`nginx-config/`, run via `nginx -c /etc/nginx/custom/nginx.production.conf`). Both inode-traps are closed; `git pull` + `nginx -s reload` now picks up changes without `--force-recreate`.
- `alertService` persistence gate only fully implemented for LEAK_DETECTED+controller path (SQL aggregation on `metrics`). Other types fail-open in v1, pending rolling-window metric aggregations.
- **LEAK auto-trigger now live (B-005-LEAK, 2026-05-26)**: `metricService.createMetric` эмитит `alertEvents.LEAK_CHECK` после `leak_sensor=true` insert; `alertService.checkLeak(controllerId)` listener → persistence-gated `createAlert` → UK pipeline. End-to-end ~5 сек в проде verified. **VOLTAGE/HEATING всё ещё manual-only** — следующий тикет B-005 (VOLTAGE+HEATING) в `docs/audit/sprint-11-backlog.md`. Cooldown gotcha (commit `e15436f`): для checkLeak/checkVoltage/checkHeating bump `lastChecks` ТОЛЬКО на success — gate denial должен оставлять cooldown unset, иначе persistence-gate маскируется до конца cooldown window'а.

NEVER delete the project directory or run rm -rf in the project root.
