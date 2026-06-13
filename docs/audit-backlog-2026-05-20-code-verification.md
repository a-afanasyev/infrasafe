# InfraSafe Audit Backlog — code verification

Дата сверки: 2026-05-21.

Метод: статическая сверка текущего workspace с `docs/audit-backlog-2026-05-20.md`. Тесты, `npm audit`, live-prod и UK-репозиторий не запускались. Секреты в `.env*` не приводятся.

## Summary

Большая часть backlog подтверждается текущим кодом, но есть заметные устаревшие формулировки:

- `[P1-6]` false-positive/stale: в `src/services/` сейчас нет `res.json()` / `res.*` HTTP-ответов.
- `[P2-6]` stale: `handleBuildingWebhook()` уже собирает `ukFields` и не мутирует входящий payload.
- `[P0-V1]` false-positive as written: DOMPurify реально вызывается через `public/utils/domSecurity.js`; `public/script.js` использует `window.DOMSecurity.sanitizePopupContent()`.
- `[P0-5]` формулировка устарела: app сейчас не коннектится как `postgres`; в `docker-compose.unified.yml` app использует `infrasafe_app`, но этот же пользователь создается через `POSTGRES_USER`, то есть остается bootstrap/superuser-ролью.
- `[P1-V7]` частично stale: CI действительно не запускает E2E/smoke/load, но upload coverage artifact уже есть.

## P0

| ID | Verdict | Code check |
|---|---|---|
| P0-1 | confirmed | `public/admin-auth.js` редиректит на `/login.html`; root `login.html` отсутствует, есть только `public/login.html`; `docker-compose.unified.yml` монтирует `./public` как `/public`, но не монтирует root `/login.html`; `nginx.production.conf` не имеет отдельного location для `/login.html`. |
| P0-2 | partially confirmed | `verifyWebhookSignature()` проверяет только timestamp + HMAC, без signature/nonce dedup. При этом `/api/webhooks/uk/*` требует `event_id`, а `integration_log.event_id` UNIQUE уже дает idempotency для корректных событий. Риск replay уже уже, чем написано, но signature-level replay cache отсутствует. |
| P0-3 | version confirmed | `package.json` и `package-lock.json` фиксируют axios `1.15.0`. CVE count без `npm audit` не проверялся. |
| P0-4 | confirmed | `.env` и `.env.prod` существуют локально и содержат plaintext secrets. `.gitignore` игнорирует `.env*`, поэтому обычный `git add -A` их не добавит, но секреты на диске подтверждены. |
| P0-5 | partially confirmed | App использует `DB_USER=infrasafe_app`, не `postgres`; но `POSTGRES_USER=infrasafe_app` создает bootstrap superuser. В init SQL нет отдельного least-privilege role/grants. |
| P0-6 | confirmed, P1 severity | MV refresh есть через `refresh_transformer_analytics()` и controller endpoint; cron/pg_cron/server `setInterval` не найден. |
| P0-7 | confirmed | Есть manual `backup-database.sh` и deploy-time dumps; cron/systemd timer/off-host upload/WAL archive не найдены. |
| P0-3a | confirmed | `generator/package.json` содержит axios `^1.6.0`; `generator/package-lock.json` отсутствует. |

## P1

| ID | Verdict | Code check |
|---|---|---|
| P1-1 | confirmed | `src/middleware/rateLimiter.js` использует `new Map()` для limiter/slowdown state. |
| P1-2 | confirmed | `public/admin-auth.js` и `public/admin.js` читают JWT из `localStorage`. |
| P1-3 | confirmed | Helmet dev CSP содержит `unsafe-inline`/`unsafe-eval`; prod Helmet и nginx допускают CDN scripts без `integrity`. |
| P1-4 | confirmed | `AlertService.ensureInitialized()` вызывает `initialize()` без `_initPromise` guard. |
| P1-5 | confirmed | Silent `.catch(() => {})` остались в `ukIntegrationService.js` на integration log writes. |
| P1-6 | false-positive/stale | `rg "res\\.json\\(" src/services` не нашел service-level HTTP responses. |
| P1-7 | confirmed | `integrationRoutes.updateConfig()` передает raw `req.body`; `uk_api_url` валидируется, `uk_frontend_url` и boolean coercion нет. |
| P1-8 | confirmed | `alert_request_map.infrasafe_alert_id` в migration 011 без FK. |
| P1-9 | confirmed, understated | `serial`/`SERIAL` есть не только в перечисленных таблицах; также есть serial в integration tables/more legacy tables. |
| P1-10 | confirmed | `trig_update_heartbeat AFTER INSERT ON metrics` делает UPDATE `controllers.last_heartbeat`. |
| P1-11 | confirmed | `analyticsService.getPeakLoadForecast()` все еще фильтрует `b.power_transformer_id = $1`. |
| P1-12 | partially local-confirmed | InfraSafe `/uk/` CSP в `nginx.production.conf` имеет `style-src 'self' 'unsafe-inline'`, без `fonts.googleapis.com`; фактический UK UI надо проверять в UK repo/live. |
| P1-13 | confirmed | 5 controllers напрямую импортируют models. |
| P1-14 | confirmed | `ukIntegrationService.js` = 591 LoC, содержит config/HMAC/outbound/inbound/cache/event listener. |
| P1-15 | confirmed | Внутренние caches есть в `ukIntegrationService`, `IntegrationConfig`, `ukApiClient`; не все идут через `cacheService`. |
| P1-V1 | confirmed | Logout blacklist'ит только bearer access token, refresh token из body не принимает. |
| P1-V2 | confirmed | `authService.isTokenBlacklisted()` fail-open при breaker/DB error. |
| P1-V3 | confirmed | `jwt.verify()`/promisified verify callsites не задают `algorithms: ['HS256']`. |
| P1-V4 | partially confirmed | Triple `003_*` files существуют, но текущий README говорит, что `01_init_database.sql` интегрирует 003-010; риска auto-runner нет, потому что auto-runner отсутствует. |
| P1-V5 | confirmed | `backup-database.sh` hardcodes the Postgres username/password instead of reading them from environment/config. |
| P1-V6 | confirmed | Deploy/hardening/setup scripts are untracked and proliferated in working tree. |
| P1-V7 | partially confirmed | CI запускает lint + coverage, не E2E/smoke/load; coverage artifact upload уже есть. |
| P1-V8 | confirmed | E2E gaps real: 2FA flow not covered in E2E, logout test does not reuse token after logout, webhook happy path is gated by `E2E_ENABLE_UK_INTEGRATION=true`. |
| P1-V9 | confirmed | `.husky/` отсутствует, husky deps нет. |
| P1-V10 | confirmed | `.github/dependabot.yml` отсутствует. |
| P1-V11 | confirmed | Jest coverage ignores `/tests/jest/e2e/`. |
| P1-V12 | duplicate | Same as `[P1-10]`. |
| P1-V13 | confirmed | Deploy scripts use `docker-compose.unified.yml`; `prod.yml` has health/resources/logging pieces not present in unified app/frontend. |
| P1-V14 | confirmed | Legacy `alerts.metric_id bigint` has index but no FK to `metrics`. |
| P1-V15 | confirmed | No migration tool dependency/script; migrations are applied manually by deploy scripts/README via `psql`. |
| P1-V16 | duplicate/escalation note | Same underlying issue as `[P2-12]`, plus numbering collisions. |

## P2

| ID | Verdict | Code check |
|---|---|---|
| P2-1 | confirmed | Current count is higher than doc: 85 raw `res.json()` in controllers/routes vs 24 `apiResponse` helper usages. |
| P2-2 | confirmed | Lazy `require()` still present in `ukIntegrationService.js`. |
| P2-3 | partially confirmed | In-memory check/set window exists; DB dedup exists in migration 015, but not integrated into `01_init_database.sql`. |
| P2-4 | confirmed | `errorHandler` uses case-sensitive `process.env.NODE_ENV === 'development'`. |
| P2-5 | confirmed | `integrationRoutes` has inconsistent `parseInt` guard pattern. |
| P2-6 | stale/fixed | `handleBuildingWebhook()` uses a new `ukFields` object and does not mutate incoming payload. |
| P2-7 | confirmed | `public/script.js` 2335 LoC, `public/admin.js` 3429 LoC, esbuild has `bundle: false`. |
| P2-8 | confirmed | Many `SELECT *` remain in models/services/controllers. |
| P2-9 | confirmed | `Building.findAll()` performs data query + separate `COUNT(*)`. |
| P2-10 | confirmed | `IntegrationLog.findAll()` uses `LIMIT/OFFSET`. |
| P2-11 | confirmed | Both `012_fix_materialized_view.sql` and `012_totp_2fa.sql` exist. |
| P2-12 | confirmed | MV migration does `DROP MATERIALIZED VIEW` + `CREATE`, not concurrent-safe migration pattern. |
| P2-13 | confirmed | Notification failure writes are duplicated in `alertService` and `ukIntegrationService` event listener. |
| P2-14 | partially confirmed | `alertService -> analyticsService` top-level require remains; direct reverse require is gone via `alertEvents`, so current circular cycle was not proven. |
| P2-V1 | confirmed | Password change only logs user id; no IP/UA/actor audit table write found. |
| P2-V2 | confirmed | `/auth/verify-2fa` uses generic `authLimiter`; recovery code path inside `totpService.verifyCode()` has no separate limiter. |
| P2-V3 | confirmed | `CORS_ORIGINS.split(',')` has no trim/filter. |
| P2-V4 | partially confirmed | `AccountLockout` keys raw login. But current auth lookup is also case-sensitive, so same-account case-variation bypass is not proven. |
| P2-V5 | confirmed | `%term%` ILIKE exists; no `pg_trgm` extension/index found. |
| P2-V6 | confirmed with nuance | Source maps exist in `public/dist`. Production reverse proxy denies `.map`, but `nginx.conf` used by the unified frontend target has no `.map` deny while port `8080:8080` is exposed. |
| P2-V7 | partially confirmed | Password shell interpolation + plaintext backup file confirmed. Generator role is `user`, not admin. |
| P2-V8 | confirmed | `test:smoke`, `test:load`, `test:all` exist but CI does not run them. |

## P3

| ID | Verdict | Code check |
|---|---|---|
| P3-1 | confirmed | `app.set('trust proxy', 1)` unconditional. |
| P3-2 | code confirmed, env not verified | bcrypt rounds = 12; target hardware timing not checked. |
| P3-3 | confirmed | `analytics_history_current`/`prev` partitions are hardcoded at init time. |
| P3-4 | confirmed | Schema export has many `buildings` FK indexes absent from init/migrations; migrations only add some transformer indexes. |
| P3-5 | not locally verified | Requires live-prod credential check / seed policy. |
| P3-V1 | code confirmed | 5-second skew exists and is commented in code; separate threat-model doc not found. |
| P3-V2 | confirmed | PL/pgSQL functions omit explicit volatility classification. |
| P3-V3 | confirmed | `hardening.sh` schedules 10-min `at` killswitch; no final-state assertion/cancel verification found. |

## False Positives / Verified

| ID | Verdict | Code check |
|---|---|---|
| V-FP-1 | verified false-positive | `_isIssuedBeforeCutoff()` is wired in auth middleware and refresh flow. |
| V-FP-2 | verified | HMAC compare uses `crypto.timingSafeEqual`. |

## Recommended backlog edits

1. Change `[P1-6]` to `false-positive` or remove.
2. Change `[P2-6]` to `fixed` or remove.
3. Rewrite `[P0-V1]`: DOMPurify is used via `DOMSecurity`; remaining issue is narrower: no SRI on CDN and admin page loads DOMPurify though admin.js currently uses mostly `textContent`/static HTML.
4. Rewrite `[P0-5]`: not `postgres` user, but `infrasafe_app` created as bootstrap superuser in compose.
5. Update `[P2-1]` counts to 85 raw `res.json()` vs 24 helper usages.
6. Update `[P2-V6]`: source maps are denied by production reverse proxy, but still present and potentially exposed through the unified frontend service on 8080.

---

## Update 2026-05-21 — Round 3 reconciliation applied to main backlog

Все 6 рекомендаций выше **применены** в `audit-backlog-2026-05-20.md` (Round 3 corrections). Также применены follow-ups:

7. `[P2-1]` count clarified — formulation теперь "85 res.json + 156 res.status (часто chain'ом), 24 helpers" с явными grep-командами, чтобы не было суммирования.
8. `[P1-V7]` уточнён — artifact upload **есть** (coverage), отсутствует только для e2e/smoke/load.
9. `[P0-V1]` reformulated дополнительно — убрано неточное "массовый innerHTML =" утверждение, фокус на SRI + аудит конкретных HTML sinks.
10. `[P1-V6]` count исправлен — **11** untracked скриптов (verified `git status -s`), не 7.
11. Sprint 0 plan — убран P0-V1 (DOMPurify deprecate task), теперь 9 пунктов + footnote про SRI в Sprint 1.
12. Sprint 2 plan — убран `[P1-6]` task (false-positive).
13. Round 2 totals в main backlog'е помечены как "snapshot до Round 3 corrections" + добавлена финальная сводка.

**Этот verification-файл теперь читать как historical record findings, не как live recommendations** — actionable список consolidated в основном backlog'е.
