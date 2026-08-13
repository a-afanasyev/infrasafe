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
docker compose -f docker-compose.dev.yml up --build   # рекомендуемый режим
```
Остальные команды — это `scripts` в `package.json` (`npm run dev`, `npm start`,
`npm run lint`, `npm test`, `npm run test:unit` и прочие).

### Testing
Из манифеста не выводится:
```bash
npm run test:db     # [R2-24] против ЖИВОГО Postgres, без мока БД (tests/jest/db/)
npm run test:e2e    # настоящие docker-контейнеры (tests/jest/e2e/)

# единая обвязка, требует запущенного API
./tests/orchestrator/unified-test-runner.sh all|quick|health
```
Подробности, включая авторизацию E2E с обязательной 2FA — `tests/CLAUDE.md`.

### Database
```bash
psql postgresql://postgres:postgres@localhost:5435/infrasafe   # docker пробрасывает 5435
```
Схема — `database/init/01_init_database.sql`, сиды — `02_seed_data.sql`;
init-скрипты запускает entrypoint docker.

Миграции, раннер (`scripts/migrate.sh`, AUD-002) и решения по отдельным
миграциям — `database/migrations/CLAUDE.md` и `README.md` рядом с ним.

## Architecture

### Authentication
- **Default-deny JWT** middleware in `src/routes/index.js` — all routes require auth by default
- Public routes allowlist (source of truth: `PUBLIC_ROUTES` in `src/routes/index.js:94-129`): POST `/auth/login`, `/auth/refresh`, `/auth/verify-2fa`, `/auth/setup-2fa`, `/auth/confirm-2fa`, POST `/metrics/telemetry`, GET `/buildings-metrics`, GET `/uk-requests-metrics`, GET `/uk-buildings-metrics`, GET `/map-layer-counts`, GET `/`, POST `/webhooks/uk/building`, POST `/webhooks/uk/request`. **`/auth/register` is NOT public** — R2-01 removed it (no self-registration UI; registration is an admin operation, guarded by `isAdmin` in `authRoutes.js`). `/csp-report` is reachable without auth too, but by mount order (`routes/index.js:92`, before the default-deny middleware), not via the allowlist — the browser cannot attach an `Authorization` header to `report-uri` POSTs. The three UK/map inventory routes are public to JWT but NOT unauthenticated: `/uk-*-metrics` require `x-service-token` (H-4), `/map-layer-counts` returns integers only.
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
- **Alert business rules + Verification + Reopen** (Sprint 10, **LIVE на проде с 2026-05-24 06:43 UTC** — `ALERT_VERIFICATION_ENABLED=true`. Pre-flip ran cleanly through runbook §0; first tick processed leftover verification id=1 from the day's e2e smoke as `markSkipped`. UK side INT-120 (reopen-marker + urgency_override + `uk_category_override` + `alert.engineer_required` routing in their dispatcher) — **backend #1+#2 verified end-to-end 2026-05-24 18:43 UTC** via two prod synthetics: `260524-003` (reopen, integration_log id=133) подтвердил description prefix `"Повторное обращение №N. "` + `uk_urgency_override="Критическая"`; `260524-004` (engineer_required, integration_log id=144) подтвердил `uk_category_override="Инженерный разбор"` precedence > TYPE_TO_CATEGORY > hardcode (UK commit `340e2ea`) + dispatcher routing by category. UK sub-tasks #3 (`GET /api/v2/requests/{number}` surfaces 4 reopen-meta fields) + #4 (dispatcher modal amber "🔁 Повторное обращение №N · связана с XXX" badge + "⚠ Эскалация на инженера" плашка + TWA resident reopen-badge) **closed 2026-05-25**; demo доступно через 260524-004 в UK dashboard. Sprint 11 backlog: admin-UI "открыть в УК" link с reopen-meta passthrough — поля уже есть с PR-3, нужен UI-проброс + использование UK `onOpenRelated` prop. Header note for any future synthetic: webhook signature header for UK inbound is `x-webhook-signature: t=<ts>,v1=<hex>` (NOT `X-Signature` — that gets stripped/lowercased somewhere in the path and yields `401 signature no_header`). Per-rule policy (persistence_seconds, min_affected_buildings, verification_grace/window, max_reopens_per_24h, reopen_urgency_bump) in `alert_rules` (migration 024). `alertService.createAlert` gates: **season** (B-009) + persistence (SQL aggregation against `metrics` for LEAK+controller path; other types fail-open in v1) + affected-buildings count. **Season gate runs FIRST** — it is synchronous and hits no DB, so out-of-season alerts never pay for the persistence aggregation. `alertGates.checkSeasonGate(alertData, rule, now)` reads `alert_rules.season_from`/`season_to` (`CHAR(5)` `'MM-DD'`, migration 041): both NULL = year-round (every pre-B-009 rule, so behaviour is unchanged); wrap-around across New Year is the MAIN case (`from > to` → `today >= from OR today <= to`, e.g. heating season `10-15..04-15`); bounds inclusive; a half-filled pair is fail-open + warn (the DB CHECK forbids it, but silencing escalation over a half-edited row would be worse). `now` is injectable for tests. The window is set by the operator in the admin "Правила эскалации" panel (`season_from`/`season_to` are in `AlertRule.EDITABLE_FIELDS`, nullable, patched as a PAIR by one PATCH from `_mkSeasonCell` — the UI cannot send half a pair). `alertService.resolveAlert` system path → status `resolved_verifying` + enqueue `AlertVerification`. `src/services/alertVerificationService.js` singleton (mirrors `ukOutboxService` pattern, advisory_lock `849608648`, 15s tick): pickDue + suppression check + reopen-quota check → markPassed / markReopened (new alert with `reopen_sequence=N+1`, `reopen_chain_id`, `related_request_number`, urgency bump) / markEngineerRequired / markSuppressed. **B-020 (2026-05-29)**: каждый terminal-исход теперь делает write-back в `infrastructure_alerts.status` через `alertVerificationService._finalizeAlertStatus(originalAlertId, status)` — passed/reopened/suppressed/skipped → `resolved`, engineer_required → `engineer_required`. До этого фикса `resolved_verifying` был тупиком: алерт навсегда застревал там (прод alerts 25/26 висели днями). Finalize вызывается ПЕРЕД `mark*` (finalize-first → self-healing при крэше между двумя UPDATE, идемпотентность через `WHERE status='resolved_verifying'` guard). Backfill осиротевших — migration 031. `src/models/AlertSuppression.js` keyed on `(infra_type, infra_id, alert_type)` so suppression survives reopen. Schema: migrations 024–027. **AUD-001 (2026-06-11, фазировано 3 PR — закрыло «авто-reopen Sprint 10 мёртв»: на `VERIFY_*` НИКОГДА не было подписчиков, проверено по всей истории git):** **PR-A** (`be2fc32`) AUD-003 cooldown per-type suffix map + AUD-025 validStatuses; **PR-B** (`194a466`, migration 033 `last_checked_at`) — реальный реконнект: 4 `VERIFY_*`-листенера в `alertService` гоняют чекеры в **verify-режиме** (`opts.reopenContext`): freshness-probe (последний профильный сэмпл должен быть аварийным) + `observationSince`-clamp (только пост-resolve телеметрия) + continuous-fault persistence gate (отсчёт от последнего healthy) + transformer **direct-load** calc `_getTransformerLoadSince` (мимо MV/кэша, FILTER против silent-controller dilution) + `{checked}`-контракт; `_findSupersedingAlert` chain-match→fallback→adoption (целостность цепи/квоты); checked-ack (`markChecked`: window-expired `passed` требует `last_checked_at`, иначе `skipped`); engineer-эскалация мимо AlertRequestMap (детерминированный UUIDv5 event_id, enqueue вне `UK_USE_WEBHOOK_SENDER`). **PR-C** (migration 034) — durable-доставка + crash-recovery: re-emit `VERIFY_*` (снят `attempts>0→return null`; `markDispatched` ставит `next_dispatch_at`=NOW+60s + `dispatch_lease_until`=NOW+240s, re-вызываемый); `pickDue` fair-queue (`ORDER BY COALESCE(next_dispatch_at, run_at)` + due-gate — без fresh/retry-starvation); **lease-gate** блокирует ВСЕ terminal-ветки retry (window-expired/suppression/quota) пока `dispatch_lease_until>NOW()` — поздний reopen от медленного чекера всегда привязывается к `pending`-строке; `_deferToLease` сдвигает `next_dispatch_at`=lease (не глушит очередь); reconcile-first и на in-window `attempts>0`; **engineer-sweep** `_sweepEngineerNotifications` (в `_tick` после drain, под тем же advisory-lock; `uk_notified_at`/`markUkNotified` at-least-once ack; fair-rotation `uk_notify_next_attempt_at`, defer-до-emit, emit после release); `UkOutbox.reviveDead` (рестартит `created_at` против revive↔stale-петли с drain-TTL); drain-TTL guard `ukOutboxService._isStale` (mark-dead строк старше `UK_OUTBOX_MAX_AGE_HOURS`=24ч → не бёрстить устаревшие тикеты в УК при флипе sender-флага). `DISPATCH_LEASE_SECONDS=240` — operational bound (НЕ доказанный максимум; превышение ⇒ недосчёт квоты на 1, но reopen-алерт всё равно создаётся и доходит до УК), калибровать по реальной latency чекера.
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

### UK Integration Module
Двусторонняя интеграция с ботом УК: топология сети, файлы бэкенда, outbox и
drain-воркер, HMAC-подписи, эндпоинты — вынесено в скилл **`uk-integration`**
(`.claude/skills/uk-integration/SKILL.md`).

## Environment Variables
Полный справочник переменных, флаги интеграции с УК, шлюзы верификации алертов и
ручной чек-лист PR-6 перед выкаткой — скилл **`env-reference`**
(`.claude/skills/env-reference/SKILL.md`). Актуальный список обязательных на
проде — `src/config/env.js`.

## Docker Services
nginx (8088), app (3000), postgres (5435), redis. Состав compose, роли БД
(`infrasafe_app` против `infrasafe_runtime`), неизменяемый образ приложения
(SEC-14/15) и доставка `public/dist` — скилл **`infrasafe-runtime`**
(`.claude/skills/infrasafe-runtime/SKILL.md`).

**Помните при выкатке:** изменения бэкенда требуют пересборки образа —
одного `git pull` недостаточно.

## Test Data
- **Admin**: admin / admin123
- **Test user**: testuser / TestPass123
- **17 buildings** in Tashkent with coordinates, **34 metric records**

## Test Suite
Раскладка наборов, тесты на живом Postgres (`tests/jest/db/`, R2-24) и
авторизация E2E с обязательной 2FA — `tests/CLAUDE.md`.

## Known Architecture Issues

- `public/admin.js` (3,983 lines) and `public/script.js` (2,229 lines) are still monolithic. Phase 12B.4 включила **минификацию**, а не бандлинг (`bundle: false`), поэтому дробить их раньше, чем появится модульный граф, бессмысленно — это лишь размножит глобалы в `window.*` (см. B-004).
- Models execute SQL directly (no repository layer). Phase 6 introduced `createCrudModel` factory for two water-source models; the rest still hand-write queries.
- Duplication across water-related route files remains (Phase 6 factory covers models only).
- Rate-limiter and cache are **Redis-backed hybrids** (`src/middleware/rateLimiter.js:2,4`, `src/services/cacheService.js:2` — Redis when `REDIS_URL` is set, in-memory Map fallback otherwise), so multi-replica is already coordinated. Sprint 9 outbox (`uk_outbox`) and Sprint 10 verification queue (`alert_verifications`) are DB-backed with `pg_try_advisory_lock` for cross-replica coordination.
- Frontend redesign (`feature/frontend-redesign`) not yet merged to main.
- ~~Prod nginx bind-mounts individual HTML files~~ — **resolved**: HTML moved to a directory mount in B-002 (`frontend-html/`), and the nginx **config** moved to a directory mount in B-012 (`nginx-config/`, run via `nginx -c /etc/nginx/custom/nginx.production.conf`). Both inode-traps are closed; `git pull` + `nginx -s reload` now picks up changes without `--force-recreate`.
- `alertService` persistence gate only fully implemented for LEAK_DETECTED+controller path (SQL aggregation on `metrics`). Other types fail-open in v1, pending rolling-window metric aggregations.
- **LEAK auto-trigger now live (B-005-LEAK, 2026-05-26)**: `metricService.createMetric` эмитит `alertEvents.LEAK_CHECK` после `leak_sensor=true` insert; `alertService.checkLeak(controllerId)` listener → persistence-gated `createAlert` → UK pipeline. End-to-end ~5 сек в проде verified. **VOLTAGE + HEATING auto-trigger ТОЖЕ live** (B-005 Sprint 11): `metricService` эмитит `VOLTAGE_CHECK` при любом non-null фазном напряжении (`metricService.js:242`) и `HEATING_CHECK` при `hot_water_in_temp` → listeners `checkVoltage`/`checkHeating`. Voltage-пороги: warn 198-242, crit 180-260; persistence WARNING=60s / CRITICAL=10s. **VOLTAGE escalate-in-place LIVE (AUD-006, 2026-06-12, migration 035):** WARNING→CRITICAL обновляет тот же `alert_id` in-place (UPDATE severity + реактивация + immediate notification) вместо drop'а; UK-нотификация эскалации (`alert.escalated`) gated `UK_ESCALATION_NOTIFY` (default off, dormant до подтверждения УК). Прод-synthetic verified (controller 2: alert_id сохранён WARNING→CRITICAL). Cooldown gotcha (commit `e15436f`): для checkLeak/checkVoltage/checkHeating bump `lastChecks` ТОЛЬКО на success — gate denial должен оставлять cooldown unset, иначе persistence-gate маскируется до конца cooldown window'а.

## Enforced rules (OPS-003, 2026-08-12)

Эти правила существовали давно и держались на внимании. 12.08.2026 стало видно,
что этого мало: коммит уехал прямо в `main` мимо PR, а деплой на .105 без
`DEPLOY_ENV` откатился, потому что сверял выдачу с чужим доменом. Теперь они
**исполняются**, а не декларируются.

**Коммиты и ветки**
- `main` защищён на стороне GitHub: прямой push отклоняется, merge только через
  PR, обязательны проверки `Lint`, `Tests & Coverage`, `E2E (Docker stack)`,
  `Secret scan (gitleaks)`, `npm audit`, `Docker image`, `Analyze JavaScript/TypeScript`.
  `enforce_admins` включён — правило действует и на владельца, иначе оно не
  правило. Снять на время аварии:
  `gh api -X DELETE repos/a-afanasyev/infrasafe/branches/main/protection`.
- Локальные хуки в `.githooks/` (подключаются автоматически через `postinstall`
  → `npm run hooks:install`): `pre-push` отклоняет пуш в `main`, `commit-msg`
  требует формат `<тип>[(область)]: описание`. Хуки — не рубеж, а быстрый ответ:
  настоящий рубеж на сервере. Осознанный обход — `--no-verify`.

**Выкатка**
- `update-production.sh` больше НЕ имеет умолчания по площадке. Профиль берётся
  из `DEPLOY_ENV`, иначе из файла `.deploy-env` в корне репозитория на хосте
  (gitignored — он описывает машину, а не проект), иначе деплой отказывается
  стартовать до первого изменения. Молчаливое `prod` на .105 давало не ошибку,
  а худшее: деплой доходил до конца и откатывался на byte-verify, оставляя
  расползшееся состояние (git смержен, образ откачен).
- На хостах: `/opt/infrasafe/.deploy-env` = `prod`,
  `/home/infrasafe/infrasafe/.deploy-env` = `infrasafe`.

NEVER delete the project directory or run rm -rf in the project root.
