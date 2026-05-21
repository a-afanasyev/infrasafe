# InfraSafe Audit Backlog — 2026-05-20

> Сгенерирован из полного аудита (round 1): Jest (89 suites, 1835/1835 passed), security-reviewer, architect, typescript-reviewer, database-reviewer, Playwright live-smoke (`https://infrasafe.uz`).
>
> Дополнен из верификационного прохода (round 2): security re-audit, db/code re-audit, ops/e2e/frontend gap hunt. **+23 новых находки** добавлены под секциями `Verification round 2`.
>
> **Round 3 (2026-05-21)**: статическая сверка backlog'а с workspace (см. `audit-backlog-2026-05-20-code-verification.md`). Применены 6 поправок: `[P1-6]` → false-positive, `[P2-6]` → fixed, `[P0-V1]` → P2 (DOMPurify используется через wrapper), `[P0-5]` → reworded (infrasafe_app — bootstrap superuser), `[P2-1]` count updated (241 vs 24), `[P2-V6]` refined.
>
> **Sprint 0 hotfix session — 2026-05-21**: 10 items закрыты. 8 code-fixes + P0-7 backup deployed на demo сервер. Только P0-4 secret rotation отложен (по решению оператора).
> Полный отчёт: [`sprint0-progress-2026-05-21.md`](./sprint0-progress-2026-05-21.md). Все 10 PR merged в `main` через squash (PR #4-#13).
>
> **Sprint 0.1 follow-ups — 2026-05-21**: 6 post-merge review findings закрыты (3 HIGH + 1 MEDIUM + 2 LOW). PR #14 `fe691c6` merged, deployed на demo. Tests: 1857/1857 ✓.
>
> **Sprint 1 — Track A "Security through isolation" — 2026-05-21**: 3 items закрыты локально в `sprint1-security/all-2026-05-21` (P0-5 runtime role + P1-3 CSP/SRI + P1-2 HttpOnly cookies). 94 suites / 1907 tests ✓. Post-merge review: 0 BLOCKER/HIGH, 5 MEDIUM, 6 LOW → Track A follow-ups записаны как `[1A-FU-*]` в конце backlog'а.
>
> | Item | Status | PR | Prod verification |
> |---|---|---|---|
> | [P0-1] login.html 404 | `fixed (deployed)` | #4 `8b4e9c1` | `curl /login.html` → 200 ✓ |
> | [P0-2] webhook nonce dedup | `fixed (deployed)` | #5 `32fed42` | `_seenSignatures` Map в container ✓ |
> | [P0-3] axios CVE (main) | `fixed (deployed)` | #6 `9569f7a` | container axios=1.16.1 ✓ |
> | [P0-3a] axios CVE (generator) | `fixed (image ready)` | #7 `d292d1d` | image rebuilt; generator не запущен |
> | [P0-4] deploy scripts + rotation memo | `partial — operator deferred` | #8 `39f0a9e` | audit ✓; rotation отложена |
> | [P0-7] backup cron + setup runbook | `fixed (deployed)` | #9 `1b49abd` | smoke dump 20K ✓; cron `15 3 * * *` installed ✓ |
> | [P1-V1] logout blacklists refresh token | `fixed (deployed)` | #11 `193bc12` | code в container ✓ |
> | [P1-V3] jwt algorithms whitelist | `fixed (deployed)` | #12 `90a7c62` | 6 HS256 callsites ✓ |
> | [P1-V4] triple-003 migrations | `fixed (deployed)` | #13 `a2b3e5a` | `_superseded/` в container ✓ |
> | [P1-5] silent .catch → logger.warn | `fixed (deployed)` | #10 `826ec8e` | 0 silent catches ✓ |
> | [P1-V5] backup-database.sh hardcoded creds | `superseded by P0-7` | — | — |
>
> Формат: `[ID] | severity | title | files | fix summary | status`.
> Статусы: `open` / `in-progress` / `fixed` / `fixed (local)` / `fixed (deployed)` / `fixed (image ready)` / `partial — operator deferred` / `partial — operator pending` / `superseded by <id>` / `wontfix` / `verified` / `false-positive`.

## Legend

| Severity | SLA |
|---|---|
| **P0** — CRITICAL | fix today / blocker |
| **P1** — HIGH | within sprint |
| **P2** — MEDIUM | within month |
| **P3** — LOW | next maintenance cycle |

---

## P0 — CRITICAL (6)

### `[P0-1]` `/login.html` → 404 на проде (admin-flow сломан)
- **Files**: `public/admin-auth.js:62` (redirect target), nginx config, `docker-compose.unified.yml` bind-mounts
- **Severity**: P0 — admin не может залогиниться через `/admin.html`
- **Evidence**: Playwright live smoke `https://infrasafe.uz/admin.html` → 302 `/login.html` → 404. `infrasafe-nginx-1` имеет bind-mount для всех HTML кроме `login.html` (он только в `/usr/share/nginx/html/public/login.html`).
- **Fix**: добавить в `docker-compose.unified.yml` для service `nginx`:
  ```yaml
  - ./public/login.html:/usr/share/nginx/html/login.html:ro
  ```
  Либо в `nginx.production.conf` добавить:
  ```nginx
  location = /login.html { try_files /public/login.html =404; }
  ```
- **Status**: `fixed (deployed)` — PR #4, squash `8b4e9c1` (branch `fix/p0-1-login-html-mount`, base `56d5289`). Prod nginx restarted; `curl https://infrasafe.uz/login.html` → 200 ✓. Sprint 0 (2026-05-21).

### `[P0-2]` Webhook replay protection — только timestamp, нет nonce dedup
- **Files**: `src/services/ukIntegrationService.js:106`
- **Severity**: P0 — в 300s окне атакующий может реплеить любой захваченный webhook
- **Evidence**: HMAC проверяется + `Math.abs(now - timestamp) > 300` reject, но повторные подписи в пределах окна не отслеживаются.
- **Fix**: in-memory `Map<signature, expireAt>` с TTL 310s; либо UNIQUE-индекс на `(signature_hash)` в `integration_log` с insert-first dedup.
- **Status**: `fixed (deployed)` — PR #5, squash `32fed42` (branch `fix/p0-2-webhook-nonce`, base `ce9d2dd`). In-memory Map with 310s TTL + soft cap 10k entries + 6 new regression tests. Prod app restarted; `_seenSignatures` Map активен в контейнере ✓. Sprint 0 (2026-05-21).

### `[P0-3]` `axios ^1.15.0` — 13 HIGH CVEs
- **Files**: `package.json` (`"axios": "^1.15.0"`), `src/clients/ukApiClient.js`
- **Severity**: P0 — SSRF, prototype pollution, CRLF, auth bypass, request hijacking
- **Fix**: `npm audit fix` (без code changes), verify ≥ 1.15.2
- **Status**: `fixed (deployed)` — PR #6, squash `9569f7a` (branch `fix/p0-3-axios-main`, base `dfaf990`). Bumped to `^1.16.1`; `npm audit --omit=dev` → 0 vulnerabilities; 89 UK tests still green. App container пересобран на проде; `docker exec app cat node_modules/axios/package.json | jq .version` → `"1.16.1"` ✓. Sprint 0 (2026-05-21).

### `[P0-4]` Production secrets в `.env`/`.env.prod` на диске
- **Files**: `.env`, `.env.prod`, 10+ untracked `deploy*.sh` в working tree
- **Severity**: P0 — риск случайного `git add -A` в deploy скриптах; rotate если файл шарился
- **Evidence**: `.env.prod` содержит `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `TOTP_ENCRYPTION_KEY`, `UK_WEBHOOK_SECRET` plaintext
- **Fix**: 1) аудит всех deploy скриптов на `git add`/`git stash`; 2) rotate `UK_WEBHOOK_SECRET` + `TOTP_ENCRYPTION_KEY`; 3) move в vault (HashiCorp Vault / AWS SM)
- **Status**: `partial — operator deferred` — PR #8, squash `39f0a9e` (branch `fix/p0-4-deploy-scripts`, base `81379aa`). Sanitization audit ✓: **no unsafe `git add` patterns found** in any of 22 .sh files (см. `docs/deploy-scripts-audit-2026-05-21.md`). Rotation половина — отложена по решению оператора; runbook готов в `docs/secret-rotation-2026-05-21.md`. Vault migration deferred to Sprint 1+. Sprint 0 (2026-05-21).

### `[P0-5]` БД-привилегии: `infrasafe_app` создан как bootstrap superuser (нет least-privilege role) ⤓ **reworded after verification**
- **Files**: `docker-compose.unified.yml:57` (`POSTGRES_USER=infrasafe_app`), `database/init/01_init_database.sql` (нет GRANT/REVOKE separation), `src/config/database.js`
- **Original claim**: "app connects as postgres" — было неточно. App уже использует `DB_USER=infrasafe_app`, но **тот же** пользователь объявлен через `POSTGRES_USER` → role создаётся с superuser-привилегиями. Effectively same risk.
- **Severity**: P0 — app role имеет DDL права (DROP TABLE, CREATE ROLE, install extensions)
- **Fix**:
  ```sql
  -- Создать второго пользователя для приложения с минимальными правами
  CREATE ROLE infrasafe_runtime LOGIN PASSWORD '...';
  GRANT CONNECT ON DATABASE infrasafe TO infrasafe_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO infrasafe_runtime;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO infrasafe_runtime;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  -- Установить app `DB_USER=infrasafe_runtime`; `infrasafe_app` оставить bootstrap-only
  ```
- **Status**: `fixed (local)` — branch `fix/p0-5-runtime-role`, integration `sprint1-security/all-2026-05-21` commit `22eb865`. Migration `017_runtime_role.sql` + init `09_runtime_role.sql` + runbook `docs/p0-5-runtime-role-2026-05-21.md`. SECURITY DEFINER on MV refresh function (owner `infrasafe_app`, EXECUTE granted to `infrasafe_runtime`). REVOKE CREATE FROM PUBLIC. Operator action pending: env-var swap `DB_USER=infrasafe_runtime` после `ALTER ROLE … PASSWORD`. Follow-ups: `[1A-FU-C-M2]` hardcoded DB name, `[1A-FU-S-M1]` runbook про trust auth, `[1A-FU-S-L2]` search_path tightening, `[1A-FU-C-L3]` NOLOGIN initial. Sprint 1 Track A (2026-05-21).

### `[P0-6]` Materialized view `mv_transformer_load_realtime` — manual refresh only ⤓ **downgraded to P1 in round 2**
- **Files**: `database/init/01_init_database.sql` (mv definition), `src/controllers/analyticsController.js:225`
- **Original severity**: P0 — данные на dashboard stale часами без manual trigger
- **Re-calibration (round 2)**: stale analytics — availability/freshness issue, not security/outage; downgrade to **P1**
- **Evidence**: refresh только через `POST /api/power-analytics/refresh` (admin). Нет `pg_cron`, нет `setInterval` в `server.js`.
- **Fix**: добавить `pg_cron` schedule (`*/15 min`) или `setInterval` в `server.js` вызывающий `analyticsService.refreshTransformerAnalytics()`
- **Status**: `open` (P1)

### `[P0-7]` (NEW round 2) **No automated DB backup**
- **Files**: `backup-database.sh` (manual script), `deploy.sh:85`, `deploy-nosudo.sh:62`
- **Severity**: P0 — single-host postgres на demo без cron/systemd timer, без off-host upload, без PITR (no `archive_mode`). RPO = "whenever a deploy ran". Disaster recovery невозможен.
- **Fix**: 1) cron-schedule `pg_dump | gzip | aws s3 cp` 1×/день; 2) `archive_mode=on` + WAL archiving для PITR; 3) retention policy `find … -mtime +30 -delete`
- **Status**: `fixed (deployed)` — PR #9, squash `1b49abd` (branch `fix/p0-7-backup-cron`, base `f5a33fa`). Delivered: `database/backup-cron.sh` (pg_dump→gzip→S3/scp→retention) + `docs/backup-setup-2026-05-21.md` (cron + systemd-timer + S3 lifecycle + acceptance checklist). Установлен на проде: smoke dump прошёл (20K сжатый) ✓; `crontab -l` показывает `15 3 * * *` ✓. WAL archiving (PITR) deferred to Sprint 1+. Sprint 0 (2026-05-21).

### `[P0-3a]` (NEW round 2 — broaden of P0-3) **`generator/package.json` тоже имеет axios ^1.6.0** (same CVE family)
- **Files**: `generator/package.json:15`
- **Severity**: P0 — generator service запущен на том же хосте; те же CVEs
- **Fix**: `cd generator && npm audit fix`
- **Status**: `fixed (image ready)` — PR #7, squash `d292d1d` (branch `fix/p0-3a-axios-generator`, base `b280909`). Bumped to `^1.16.1`; committed `generator/package-lock.json` (was missing) so docker `npm ci` path becomes reproducible. `npm audit` → 0 vulnerabilities. Image пересобран; контейнер `generator` на проде не запущен (по конфигурации) — патч активируется при следующем запуске. Sprint 0 (2026-05-21).

---

## P1 — HIGH (15 round 1 + 14 round 2 = 29)

### `[P1-1]` Rate limiter in-memory — multi-replica ломается
- **Files**: `src/middleware/rateLimiter.js:16` (`new Map()`), :159 (ProgressiveRateLimiter)
- **Severity**: P1 — atacker rotates через N replicas → N×budget; restart обнуляет счётчики
- **Fix**: `rate-limiter-flexible` + `RateLimiterRedis`, gated на `REDIS_URL`; SimpleRateLimiter fallback для dev/tests
- **Status**: `open`

### `[P1-2]` JWT в `localStorage` → XSS-вынос
- **Files**: `public/admin-auth.js:16`, `public/admin.js:84, 1336, ...`
- **Severity**: P1 — любой XSS на admin крадёт token
- **Fix**: `HttpOnly; Secure; SameSite=Strict` cookie, backend читает из header; временно — eliminate `unsafe-inline`/`unsafe-eval` из prod CSP
- **Status**: `partial — local (Phase 1)` — branch `fix/p1-2-cookie-auth`, integration `sprint1-security/all-2026-05-21` commit `b83496a`. Phase 1 transitional: сервер ставит HttpOnly+Secure+SameSite=Strict cookies (`src/utils/authCookies.js`); auth middleware читает cookie как fallback; logout очищает обе cookies. Клиент по-прежнему дублирует токены в localStorage (transitional). **Phase 2 нужен** — убрать localStorage из admin-auth.js/script.js/login.js, инвертировать порядок extractAccessToken на cookie-first. До Phase 2 защита от XSS НЕ работает в полную силу (см. `[1A-FU-C-M1]`). Follow-ups: `[1A-FU-C-M1]` localStorage cleanup, `[1A-FU-S-L3]` cookie path /api, `[1A-FU-S-L4]` flip extract order, `[1A-FU-S-L5]` __Host- prefix. Sprint 1 Track A (2026-05-21).

### `[P1-3]` Production CSP: `unsafe-inline`/`unsafe-eval` в dev; no SRI для CDN
- **Files**: `src/server.js:36-41` (helmet config)
- **Severity**: P1 — на staging с `NODE_ENV=development` CSP полностью обходится; CDN-скрипты (cdn.jsdelivr.net, unpkg.com) без `integrity`
- **Fix**: 1) SRI hash для всех CDN `<script>` тегов; 2) nonce-based CSP для prod
- **Status**: `fixed (local)` — branch `fix/p1-3-csp-sri`, integration `sprint1-security/all-2026-05-21` commit `5e6c697`. SRI `sha384-...` + `crossorigin="anonymous"` + `referrerpolicy="no-referrer"` на всех CDN-скриптах (DOMPurify в index/admin/login). 4 inline `<script>` блока вынесены в `public/api-config.js`, `public/login.js`, `public/theme-toggle.js`. Nginx prod CSP `script-src` теперь без `'unsafe-inline'`/`'unsafe-eval'`. 0 inline event handlers (onclick=, onerror=) подтверждено. `style-src 'unsafe-inline'` сохранён (документировано). Follow-ups: `[1A-FU-S-M2]` нет `report-uri`, `[1A-FU-S-L1]` `fonts.googleapis.com` в script-src dead weight, `[1A-FU-C-M4]` тесты file-content vs live header. Sprint 1 Track A (2026-05-21).

### `[P1-4]` `AlertService.ensureInitialized()` — race без `_initPromise`
- **Files**: `src/services/alertService.js:43-54`
- **Severity**: P1 — 2 concurrent requests → double-init, double-load active alerts в Map
- **Fix**:
  ```js
  if (!this._initPromise) this._initPromise = this.initialize();
  await this._initPromise;
  ```
- **Status**: `open`

### `[P1-5]` Silent `.catch(() => {})` на audit-log writes
- **Files**: `src/services/ukIntegrationService.js:310, 484, 495`
- **Severity**: P1 — невидимые сбои integration log = потеря audit trail
- **Fix**: `.catch(err => logger.warn('integration log update failed', err.message))` минимум
- **Status**: `fixed (deployed)` — PR #10, squash `826ec8e` (branch `fix/p1-5-silent-catch`, base `b73a91c`). Все 3 callsites обёрнуты в `.catch(logErr => logger.warn(...))` с id integration_log в сообщении. + 3 регрессионных теста (включая source-scan guard от ре-интродукции). Прод-проверка: `docker exec app grep -c "catch(() => {})" src/services/ukIntegrationService.js` → `0` ✓. Sprint 0 (2026-05-21).

### `[P1-6]` Сервисы вызывают `res.json()` — layer violation ❌ **FALSE POSITIVE (verified 2026-05-21)**
- **Files**: 9 файлов в `src/services/` (по утверждению architect agent)
- **Re-verification**: `grep -rn "res\.json\|res\.status\|res\.send" src/services/` → **0 совпадений**. Architect agent ошибся, или это был артефакт устаревшей версии.
- **Status**: `false-positive` — закрыто

### `[P1-7]` `updateConfig` — raw `req.body` в DB без validation
- **Files**: `src/routes/integrationRoutes.js:63`, `src/services/ukIntegrationService.js:55-68`
- **Severity**: P1 — `uk_integration_enabled` может быть object/string; `uk_frontend_url` не валидируется (vs `uk_api_url`)
- **Fix**: Joi/zod schema на route entry; coerce boolean; validate URL
- **Status**: `open`

### `[P1-8]` `alert_request_map.infrasafe_alert_id` без FK constraint
- **Files**: `database/migrations/011_uk_integration.sql:50-60`
- **Severity**: P1 — orphan rows при удалении alerts
- **Fix**: `ALTER TABLE alert_request_map ADD CONSTRAINT fk_arm_alert FOREIGN KEY (infrasafe_alert_id) REFERENCES infrastructure_alerts(alert_id) ON DELETE CASCADE;`
- **Status**: `open`

### `[P1-9]` `users.id` `serial` (int4), FK columns `integer` — type mismatch ⤓ **scope ×8 in round 2**
- **Files**: `database/init/01_init_database.sql:28`, `refresh_tokens.user_id`
- **Round 2 finding**: `serial` (int4) PK на **8 таблицах**: `buildings`, `controllers`, `transformers`, `lines` × 2, `water_suppliers`, `alert_types`, legacy `alerts`, плюс `users`. Все FK — `integer`.
- **Severity**: P1 — overflow риск долгосрочный (int4 max ~2.1B); миграция в 8× сложнее заявленного
- **Fix**: ALTER на `bigserial` пока таблицы малые; coordinate with all FK columns
- **Status**: `open`

### `[P1-10]` `update_controller_heartbeat()` trigger — write amplification
- **Files**: `database/init/01_init_database.sql:540-705`
- **Severity**: P1 — каждый INSERT metrics → отдельный UPDATE controllers; lock на hottest path
- **Fix**: убрать trigger, вычислять `last_heartbeat = MAX(m.timestamp)` в queries либо debounce в app
- **Status**: `open`

### `[P1-11]` `analyticsService.js:284` — deprecated FK `buildings.power_transformer_id`
- **Files**: `src/services/analyticsService.js:280-289`
- **Severity**: P1 — query возвращает пустые результаты для актуальных трансформеров (live data в `transformers`, не `power_transformers`)
- **Fix**: rewrite `WHERE b.primary_transformer_id = $1::int OR b.backup_transformer_id = $1::int`
- **Status**: `open`

### `[P1-12]` UK frontend: CSP блокирует Google Fonts
- **Files**: UK frontend CSP (на `/uk/resident-board`, `/uk/login`)
- **Severity**: P1 — `style-src 'self' 'unsafe-inline'` не включает `fonts.googleapis.com`/`fonts.gstatic.com`; UI грузится без шрифтов
- **Evidence**: Playwright live smoke зафиксировал 2 CSP errors в console
- **Fix**: добавить `fonts.googleapis.com` (style-src), `fonts.gstatic.com` (font-src) в UK CSP **(этот fix в UK-репо, не InfraSafe)**
- **Status**: `open`

### `[P1-13]` Controllers напрямую импортируют models — repository layer missing
- **Files**: `src/controllers/transformerController.js:1`, `analyticsController.js:2`, `heatSourceController.js:5`, `lineController.js:1`, `coldWaterSourceController.js:7`
- **Severity**: P1 — short-circuit service layer; tight coupling SQL ↔ models
- **Fix**: расширить `createCrudModel` factory (Phase 6) на остальные 5 entities; ~3-4 дня
- **Status**: `open`

### `[P1-14]` `ukIntegrationService.js` — god-class (591 LoC, 4 responsibilities)
- **Files**: `src/services/ukIntegrationService.js`
- **Severity**: P1 — config CRUD + HMAC + outbound pipeline + inbound + caching в одном классе; raw SQL в event listener (line 559-589)
- **Fix**: разбить на `UKConfigService`, `UKWebhookVerifier`, `UKOutboundPipeline`, `UKInboundProcessor`, `UKRequestCountCache`; ~2 дня
- **Status**: `open`

### `[P1-15]` Singleton in-memory caches × 4 не идут через `cacheService`
- **Files**: `src/services/ukIntegrationService.js:18-20` (request counts), `src/models/IntegrationConfig.js:9` (config), `src/clients/ukApiClient.js:8` (UK JWT)
- **Severity**: P1 — на N>1 replicas independent state, stale config после admin toggle
- **Fix**: route через `cacheService.get/set`; Redis pub/sub для invalidation
- **Status**: `open`

---

## P2 — MEDIUM (14)

### `[P2-1]` Mixed response envelope — много прямого `res.json`/`res.status` vs `apiResponse` helpers
- **Files**: src/controllers/ + src/routes/
- **Counts (2026-05-21, exact greps)**:
  ```bash
  grep -rn "res\.json("   src/controllers/ src/routes/  # → 85
  grep -rn "res\.status(" src/controllers/ src/routes/  # → 156 (часто chain'ом к .json/.send)
  grep -rn "sendError\|sendSuccess\|sendCreated\|sendNotFound" src/controllers/ src/routes/  # → 24
  ```
- **Note**: 85 + 156 НЕ независимы (часто на одной строке `res.status(...).json(...)`); прежнее "241" суммирование некорректно.
- **Fix**: ESLint rule запрещающий прямой `res.json/res.status` в controllers + миграция на `apiResponse` helpers; стабилизирует API envelope для frontend/SDK
- **Status**: `open`

### `[P2-2]` Lazy `require()` в hot async paths
- **Files**: `src/services/ukIntegrationService.js:193, 211, 212, 213, 230, 512, 534, 566`
- **Fix**: top-level requires; реальный fix — break circular dep через events
- **Status**: `open`

### `[P2-3]` `alertService` Map write race window
- **Files**: `src/services/alertService.js:102-125, 261-266`
- **Severity**: race между cooldown check и `lastChecks.set`; DB UNIQUE ловит, но in-memory state inconsistent
- **Fix**: атомарный check-and-set в одной критической секции (single-threaded JS снижает риск)
- **Status**: `open`

### `[P2-4]` `errorHandler` gate через case-sensitive `NODE_ENV === 'development'`
- **Files**: `src/middleware/errorHandler.js:31`
- **Fix**: pre-compute boolean на module load с `.toLowerCase()`
- **Status**: `open`

### `[P2-5]` `parseInt` без `isNaN` guard — inconsistency
- **Files**: `src/routes/integrationRoutes.js:30` vs :82-83
- **Fix**: единый паттерн с `isNaN` checks
- **Status**: `open`

### `[P2-6]` `handleBuildingWebhook` — мутация incoming payload ✅ **FIXED (verified 2026-05-21)**
- **Files**: `src/services/ukIntegrationService.js`
- **Verification**: метод собирает новый `ukFields` объект и не мутирует входящий payload
- **Status**: `fixed` — закрыто

### `[P2-7]` Monolithic frontend bundles
- **Files**: `public/script.js` 2335 LoC, `public/admin.js` 3430 LoC, `build/esbuild.config.mjs:42` (`bundle: false`)
- **Fix**: split `admin.js` по табам (~6 модулей × 500 LoC), lazy-load; ~3-5 дней
- **Status**: `open`

### `[P2-8]` `SELECT *` в 20+ моделях
- **Files**: `src/models/IntegrationLog.js:47, 65, 176`, `AlertRequestMap.js:8, 42, 69, 82`, `Line.js:60, 88, 281`, `Metric.js:98`, `Controller.js:80, 204`
- **Fix**: enumerate columns; covering indexes
- **Status**: `open`

### `[P2-9]` `Building.findAll` — sequential data + COUNT
- **Files**: `src/models/Building.js:48-49`
- **Fix**: `COUNT(*) OVER()` в одном запросе либо TTL cache count
- **Status**: `open`

### `[P2-10]` `integration_log` — OFFSET pagination на append-only audit
- **Files**: `src/models/IntegrationLog.js:176`
- **Fix**: keyed pagination `WHERE id < $last_id ORDER BY id DESC LIMIT $n`
- **Status**: `open`

### `[P2-11]` Migration 012 — двойной номер (`012_fix_materialized_view` + `012_totp_2fa`)
- **Files**: `database/migrations/012_*.sql`
- **Fix**: renumber один из них в `012b` либо сдвинуть TOTP на 013 и shift later
- **Status**: `open`

### `[P2-12]` Migration 012 (mv) — DROP+CREATE без CONCURRENTLY
- **Files**: `database/migrations/012_fix_materialized_view.sql`
- **Fix**: `CREATE MATERIALIZED VIEW IF NOT EXISTS` + `REFRESH … CONCURRENTLY`
- **Status**: `open`

### `[P2-13]` `notification_failures` audit-write дублируется
- **Files**: `src/services/alertService.js:285-332`, `src/services/ukIntegrationService.js:559-589`
- **Fix**: `Alert.recordNotificationFailure(alertId, channel, error)` метод на модели; оба сервиса вызывают
- **Status**: `open`

### `[P2-14]` `alertService → analyticsService` require остался после Phase 7
- **Files**: `src/services/alertService.js:10`
- **Severity**: риск re-introduce circular cycle
- **Fix**: extract used thresholds/utils в `src/config/thresholds.js` или `src/utils/`; verify через `madge --circular src/`
- **Status**: `open`

---

## P3 — LOW (5)

### `[P3-1]` `trust proxy 1` unconditional
- **Files**: `src/server.js:23`
- **Fix**: ok пока nginx ВСЕГДА терминирует public connections + strips X-Forwarded-For
- **Status**: `open`

### `[P3-2]` `bcrypt` rounds 12 — verify on container hardware
- **Files**: `src/services/authService.js:15`
- **Fix**: измерить hash time на target IoT железе, держать <1s
- **Status**: `open`

### `[P3-3]` `analytics_history` partitions hardcoded на init time
- **Files**: `database/init/01_init_database.sql:429-437`
- **Fix**: `pg_partman` или non-partitioned + archive job
- **Status**: `open`

### `[P3-4]` 8 индексов на `buildings` FK есть в schema_export, нет в init/migrations
- **Files**: `database/init/01_init_database.sql`, `database/migrations/`
- **Severity**: на fresh install будут seq scans
- **Fix**: новая миграция `016_buildings_fk_indexes.sql`
- **Status**: `open`

### `[P3-5]` Test data: testuser credentials не работают на prod
- **Files**: `tests/jest/e2e/globalSetup.js` (caches token), DB user table
- **Evidence**: Playwright live smoke: testuser/TestPass123 → 401
- **Fix**: либо seed-скрипт восстанавливает test users, либо doc update
- **Status**: `open`

---

## Tech debt map — dependency graph

```
[P1-1 rate limiter in-memory] ──blocks──> [N>1 replica horizontal scaling]
                                           └─ also blocked by ──> [P1-15 singleton caches × 4]

[P1-6 services call res.*] ──blocks──> [Service reuse from CLI/cron/event handlers]
                                        └─ also blocked by ──> [P1-13 controllers→models direct]

[P2-1 mixed apiResponse] ──blocks──> [Stable OpenAPI / client SDK]

[P1-14 UK god-class] ──blocks──> [Second integration partner (2GIS, ЖКХ)]

[P1-13 CRUD factory partial] ──blocks──> [Repository pattern rollout] ──> [pg Pool → read-replica routing]

[P2-7 monolithic admin.js] ──blocks──> [Code splitting] ──> [frontend-design/ incremental migration]

[P2-14 alertService→analyticsService require] ──risk──> [Circular cycle reintroduction]
```

---

## Sprint plan (рекомендация)

### Sprint 0 — Hotfix (1-2 дня)
- `[P0-1]` login.html 404
- `[P0-3]` npm audit fix
- `[P0-4]` audit deploy scripts + rotate если надо
- `[P0-6]` pg_cron для MV refresh
- `[P0-2]` nonce dedup для webhook
- `[P1-5]` `.catch(() => {})` → logger.warn
- `[P1-3]` axios CVE (если ещё не закрыт через audit fix)

### Sprint 1 — Scale-out (1 неделя)
- `[P1-1]` Redis rate limiter
- `[P1-15]` Cache unification через cacheService
- `[P1-2]` Cookie-based JWT auth
- `[P1-3]` CSP hardening + SRI
- `[P1-4]` AlertService _initPromise guard
- `[P0-5]` DB role separation
- `[P1-12]` UK frontend CSP (UK-репо)

### Sprint 2 — Layer hygiene (1 неделя)
- `[P2-1]` apiResponse migration (controllers/routes на единый envelope)
- `[P1-7]` updateConfig validation
- `[P2-14]` alertService→analyticsService require audit
- `[P1-8]` alert_request_map FK
- `[P1-11]` analyticsService deprecated FK query fix

### Sprint 3 — DB performance (1 неделя)
- `[P1-10]` heartbeat trigger removal
- `[P2-9]` Building.findAll COUNT() OVER
- `[P2-8]` SELECT * cleanup
- `[P2-10]` integration_log keyset pagination
- `[P3-4]` buildings FK indexes migration

### Sprint 4 — Decomposition (1-2 недели)
- `[P1-14]` Split ukIntegrationService
- `[P2-7]` Code-split admin.js
- `[P2-13]` Centralize notification_failures
- `[P1-9]` users.id → bigserial
- `[P2-12]` MV migration concurrent-safe

---

## Verification matrix

| Issue | Confirmed by | Method |
|---|---|---|
| P0-1 | Playwright smoke + ssh inspect | live HTTP 404 + nginx mounts |
| P0-2 | security-reviewer + code grep | `src/services/ukIntegrationService.js:106` |
| P0-3 | code-reviewer | `npm audit` |
| P0-4 | security-reviewer | filesystem inspect |
| P0-5 | database-reviewer | `database/init/01_init_database.sql` no GRANT |
| P0-6 | database-reviewer | no pg_cron, no setInterval |
| P1-x | parallel agents | cross-referenced |
| P2-x | individual agents | unique findings |

---

## Notes

- 1835 Jest tests **PASSED** — defensive net solid
- Live demo **функционально работает** (главная, map, /uk/*, /docs); admin-route сломан через login.html
- 2FA flow **корректен** — admin/admin123 → returns 2FA challenge tempToken
- UK integration (Phases 1-5) — все 9 PRs смержены, координаты bакфилл-нуты
- 5 ранее зафиксированных tech debt items из webhook hardening spec тоже остаются актуальными (см. `docs/superpowers/specs/2026-05-19-uk-infrasafe-webhook-hardening.md`)

---

# ⊕ Verification Round 2 — NEW findings (2026-05-20, second pass)

> 3 параллельных верификационных агентов прошлись по этому backlog'у и нашли пропущенное. **+23 новых пункта**.

## P0 — round 2 additions (1 added; см. также `[P0-7]`, `[P0-3a]` выше)

### `[P0-V1]` ⤓ **downgraded to P2 after code-verification** — DOMPurify используется через wrapper
- **Files**: `public/utils/domSecurity.js:47,177` (`DOMPurify.sanitize()` вызывается), `public/script.js:178+` (зовёт `window.DOMSecurity.*`)
- **Original claim (отменён)**: 0 вызовов DOMPurify — была ошибка grep'а (искали в admin.js/script.js, а не в `utils/domSecurity.js`)
- **Reformulated issue (P2)**:
  1. CDN-загрузка DOMPurify без `integrity=` (SRI) attribute — folds into [P1-3] hardening
  2. Аудит конкретных HTML sinks в `admin.js` и `script.js` на consistent применение `window.DOMSecurity.sanitize*()` — нет полной матрицы какие places идут через wrapper vs raw textContent
- **Fix**: 1) добавить SRI hash на `<script src="...purify.min.js">`; 2) перечислить все HTML sinks (popup-content, table-rendering, modal-bodies) и убедиться что каждый идёт через DOMSecurity wrapper
- **Status**: `reformulated, P2`

## P1 — round 2 additions (14)

### `[P1-V1]` Logout НЕ blacklist'ит refresh token
- **Files**: `src/controllers/authController.js:143-149`
- **Evidence**: `logout()` extract'ит только `Authorization: Bearer` access token; refresh token (живёт 7 дней) остаётся валидным; клиент в `admin-auth.js` хранит оба в `localStorage`
- **Fix**: клиент шлёт `refreshToken` в body запроса logout; server вызывает `authService.blacklistToken(refreshToken)` дополнительно
- **Status**: `fixed (deployed)` — PR #11, squash `193bc12` (branch `fix/p1-v1-logout-refresh`, base `8f3fe65`). Server best-effort blacklist'ит обе токены, defensive type-check на refreshToken. Клиенты (script.js + admin-auth.js) отправляют refreshToken в body. admin-auth.js теперь вообще вызывает /auth/logout (раньше только localStorage clear). + 5 регрессионных тестов. App контейнер перезапущен; frontend bundles пересобраны через postinstall ✓. Sprint 0 (2026-05-21).

### `[P1-V2]` Blacklist circuit breaker fail-OPEN при DB outage
- **Files**: `src/services/authService.js:591-613`
- **Evidence**: комментарий явный — "Circuit breaker open or DB error — fail-open: assume not blacklisted". ARCH-102 decision, но в backlog отсутствует
- **Security impact**: atacker может flood DB connections → blacklisted tokens принимаются заново
- **Fix**: документировать threat model в spec; альтернатива — fail-closed для critical paths
- **Status**: `open`

### `[P1-V3]` `jwt.verify()` без `algorithms` whitelist — alg confusion possible
- **Files**: `src/middleware/auth.js:59, 148, 224`; `src/services/authService.js:179, 230, 270` (6 callsites)
- **Evidence**: все 6 вызовов передают только `issuer`/`audience`, без `algorithms: ['HS256']`. RS→HS confusion возможен.
- **Fix**: одна строка на каждый вызов — `{ algorithms: ['HS256'], issuer: ..., audience: ... }`
- **Status**: `fixed (deployed)` — PR #12, squash `90a7c62` (branch `fix/p1-v3-jwt-algorithms`, base `7e28856`). Все 6/6 callsites имеют `algorithms: ['HS256']`. + 5 регрессионных тестов на real `jsonwebtoken` (не mocked): HS256 accept, RS256 reject, alg=none reject, verifyTempToken whitelist applies. Прод-проверка: `docker exec app grep -c "algorithms: \['HS256'\]" src/middleware/auth.js src/services/authService.js` → `6` ✓. Sprint 0 (2026-05-21).

### `[P1-V4]` Triple-003 migrations — non-deterministic schema на fresh install
- **Files**: `database/migrations/003_power_calculation_system.sql`, `003_power_calculation_system_fixed.sql`, `003_power_calculation_v2.sql`
- **Evidence**: 3 файла с одинаковым префиксом 003 → автоматический runner либо выполнит все три либо в filesystem-сорт-order → conflicts (duplicate object, DROP undoing prior run)
- **Fix**: renumber в `003a/003b/003c` или удалить устаревшие; add comments which supersedes which
- **Status**: `fixed (deployed)` — PR #13, squash `a2b3e5a` (branch `fix/p1-v4-migration-renumber`, base `99e63e5`). Два superseded файла перенесены в `database/migrations/_superseded/` с README. Каноническая `003_power_calculation_v2.sql` остаётся на верхнем уровне. Fresh install не затронут (использует `database/init/01_init_database.sql`). Migrations README обновлён. Прод-проверка: `docker exec app ls database/migrations/_superseded/` показывает оба файла ✓. Sprint 0 (2026-05-21).

### `[P1-V5]` `backup-database.sh` hardcoded `postgres`/`postgres` credentials
- **Files**: `backup-database.sh:15-16`, `:17-18`
- **Evidence**: `DB_USER="postgres"`, `DB_PASSWORD="postgres"` встроены в committed shell script
- **Fix**: читать из `$DB_USER`/`$DB_PASSWORD` env; добавить cron schedule; retention `find … -mtime +7 -delete`; off-host upload
- **Status**: `superseded by P0-7` — PR #9 (`fixed (deployed)`). Новый `database/backup-cron.sh` в проде с env-only credentials (`: "${DB_USER:?...}"` отказывается падать на hardcoded fallback); cron `15 3 * * *` активен, smoke dump зелёный. Старый `backup-database.sh` остаётся untracked в working tree; формально закрыть P1-V5 можно либо (a) удалив старый скрипт после полной миграции, либо (b) пропатчив его до env-based креденшалов. Решение оставить за оператором. Sprint 0 (2026-05-21).

### `[P1-V6]` Deploy scripts proliferation — **11 untracked** `.sh` скриптов в working tree
- **Files (verified 2026-05-21 via `git status -s`)**: `connect.sh`, `deploy.sh`, `deploy-nosudo.sh`, `deploy-resume.sh`, `deploy-resume2.sh`, `deploy-resume3.sh`, `fix-git-and-redeploy.sh`, `hardening.sh`, `hardening-recover.sh`, `hardening-recover2.sh`, `setup-generator.sh`
- **Evidence**: untracked в git, не в CI, ad-hoc bandages от прошлых сбоев; tribal knowledge; risk случайного `git add -A` (см. [P0-4])
- **Fix**: consolidate в один canonical `deploy.sh` (idempotent) или Ansible playbook; commit в репо; delete старые snapshots после извлечения логики
- **Status**: `open`

### `[P1-V7]` CI не запускает E2E / smoke / load тесты
- **Files**: `.github/workflows/ci.yml`
- **Evidence (2026-05-21, refined)**: workflow выполняет `lint` + `npm run test:coverage` и uploads coverage artifact через `actions/upload-artifact@v4:59`. Отсутствуют: `test:e2e`, `test:smoke`, `test:load`; нет docker compose up; нет artifact upload именно для e2e/smoke/load результатов (screenshots, traces, видео).
- **Fix**: добавить E2E матрицу в CI с docker compose up для services; security/smoke тесты для PR; artifact upload для e2e traces
- **Status**: `open`

### `[P1-V8]` E2E coverage gaps — критичные flows не покрыты
- **Files**: `tests/jest/e2e/*.e2e.test.js`
- **Missing**:
  - 2FA enrollment + verify flow (mandatory для admin per CLAUDE.md, не тестируется)
  - Account lockout trigger + persistence across restart (`AccountLockout` модель)
  - Token blacklist behaviour after logout (только один test, поверхностный)
  - **Webhook full happy path** — `webhooks.e2e.test.js` тестит только 401/503; signed `t=…,v1=…` happy path gated by `E2E_ENABLE_UK_INTEGRATION=true` (нигде не выставлен)
  - Webhook idempotency на duplicate `event_id` (см. P0-2)
  - Concurrent alert creation race (см. P1-4, P2-3)
  - UK request → alert resolution full cycle (`areAllTerminal()`)
- **Status**: `open`

### `[P1-V9]` Нет pre-commit hooks (`.husky/` отсутствует)
- **Files**: `.husky/` (does not exist), `package.json` без `husky` deps
- **Severity**: P1 — нет gitleaks/trufflehog secret scan; signed-commit not enforced
- **Linkage**: усиливает [P0-4] risk
- **Fix**: добавить husky + lint-staged + gitleaks pre-commit
- **Status**: `open`

### `[P1-V10]` Нет Dependabot/Renovate
- **Files**: `.github/dependabot.yml` (does not exist)
- **Severity**: P1 — без auto-PR на CVE backlog P0-3 (axios) не появился бы
- **Fix**: добавить `dependabot.yml` с weekly schedule на npm
- **Status**: `open`

### `[P1-V11]` Coverage threshold 80% возможно НЕ на E2E
- **Files**: `package.json:99-106`, `.github/workflows/ci.yml`
- **Evidence**: jest coverage runs всё кроме E2E (testPathIgnorePatterns). 80% threshold действует только на non-E2E часть.
- **Fix**: добавить отдельный E2E coverage threshold gate; либо включить E2E в общий coverage run
- **Status**: `open`

### `[P1-V12]` `update_controller_heartbeat()` уже зафиксирован в `[P1-10]` — duplicate; ИГНОР

### `[P1-V13]` Deploy resources/healthcheck/logging — `prod.yml` лучше `unified.yml`, но в проде используется `unified.yml`
- **Files**: `docker-compose.prod.yml` vs `docker-compose.unified.yml`
- **Evidence**: `prod.yml` имеет `healthcheck`, `deploy.resources.limits`, JSON-file log rotation, `condition: service_healthy` depends_on. `unified.yml` (актуальный deploy per deploy.sh:17) — none of this.
- **Fix**: перенести defining bits из `prod.yml` в `unified.yml`; deprecate `prod.yml`
- **Status**: `open`

### `[P1-V14]` `legacy alerts.metric_id` без FK — dangling bigint
- **Files**: `database/init/01_init_database.sql:403`
- **Evidence**: `metric_id bigint` есть, индекс `idx_alerts_metric` есть, FK `REFERENCES metrics(metric_id)` нет
- **Fix**: `ALTER TABLE alerts ADD CONSTRAINT fk_alerts_metric FOREIGN KEY (metric_id) REFERENCES metrics(metric_id) ON DELETE SET NULL;`
- **Status**: `open`

### `[P1-V15]` Нет migration runner — миграции вручную через psql
- **Files**: `package.json` (no `node-pg-migrate`, `flyway`, `liquibase`)
- **Severity**: P1 — combined with triple-003 (V4) и double-012 (P2-11), fresh deploy не имеет deterministic sequencing
- **Fix**: добавить `node-pg-migrate` или `db-migrate`; renumber collisions; `npm run migrate` в `docker-compose` entrypoint
- **Status**: `open`

### `[P1-V16]` Migration 012 (MV) — duplicate с уже зафиксированным `[P2-12]`; **escalate P2-12 → P1** в свете triple-003 (V4)

## P2 — round 2 additions (8)

### `[P2-V1]` Password change audit insufficient
- **Files**: `src/services/authService.js:386`
- **Evidence**: `logger.info('Пароль изменен для пользователя ID: ${userId}')` — нет IP, нет actor identity (self vs admin-change), нет audit table write
- **Fix**: добавить запись в `audit_log` table с {actor_id, target_id, ip, ua, ts}
- **Status**: `open`

### `[P2-V2]` Recovery codes не имеют отдельного rate limit
- **Files**: `src/routes/authRoutes.js:279`
- **Evidence**: `/auth/verify-2fa` обрабатывает и TOTP и recovery codes под общим `authLimiter` (IP-based). Recovery codes one-time, более ценные → attacker с IP rotator получает O(maxAttempts × IPs) попыток на 8-hex code.
- **Fix**: tighter limiter для recovery codes или per-user lockout после N failed attempts
- **Status**: `open`

### `[P2-V3]` `CORS_ORIGINS.split(',')` без trim
- **Files**: `src/server.js:56`
- **Evidence**: если ENV содержит "a, b" → второй origin становится " b" с leading space → silent CORS break → operator расширяет до `*`
- **Fix**: `.split(',').map(s => s.trim()).filter(Boolean)`
- **Status**: `open`

### `[P2-V4]` AccountLockout key case-sensitive — bypass via case variation
- **Files**: `src/models/AccountLockout.js:18-24`
- **Evidence**: lockout key = raw `login` без normalization. Если authService.login() нормализует на lookup, но lockout key insert до normalization (или с разным case) → attacker пробует `Admin`, `ADMIN`, `admin` как отдельные buckets, каждый со своим budget
- **Fix**: `login.toLowerCase()` в `recordFailedAttempt()` и `get()`
- **Status**: `open` (требует verify normalization chain in authService)

### `[P2-V5]` `adminQueryBuilder` ILIKE `%term%` без trigram index
- **Files**: `src/utils/adminQueryBuilder.js:151, 174`
- **Evidence**: leading wildcard → seq scan на text columns (building names, controller labels). `pg_trgm` GIN не установлен.
- **Fix**: `CREATE EXTENSION IF NOT EXISTS pg_trgm`; `CREATE INDEX … USING GIN (col gin_trgm_ops)` на searchable columns; либо restrict to `term%` only
- **Status**: `open`

### `[P2-V6]` Source maps в `public/dist/*.map` — denied только production nginx (refined 2026-05-21)
- **Files**: `nginx.production.conf:243` (denies `.map$` ✓), но `nginx.conf` для **unified frontend service** на порту 8080 не имеет `.map` deny
- **Evidence**: source maps существуют в `public/dist/`; production proxy денaes их, но unified frontend (`infrasafe-frontend-1` на port 8080) — потенциально нет
- **Fix**: добавить `.map$` deny в `nginx.conf` для unified frontend; либо exclude `.map` из build output для prod
- **Status**: `open`

### `[P2-V7]` `setup-generator.sh` password handling
- **Files**: `setup-generator.sh:32-66`
- **Evidence**: 1) shell-quoting `$GEN_PASSWORD` внутри `node -e '...'` fragile (если password содержит метачар, head -c truncate); 2) generator account bypasses 2FA (CLAUDE.md: 2FA mandatory for admins) — verify role не admin; 3) plaintext password в `$BACKUP_DIR/generator-password.txt` forever
- **Fix**: env-var vault; cleanup `generator-password.txt` после распространения; verify generator role не admin
- **Status**: `open`

### `[P2-V8]` `tests/load/`, `tests/smoke/`, `tests/orchestrator/` не wired to CI
- **Files**: `tests/load/run-load-tests.sh`, `tests/smoke/run-smoke-tests.sh`, `tests/orchestrator/unified-test-runner.sh`
- **Evidence**: bash скрипты, есть npm scripts `test:load`, `test:smoke`, `test:all`, но в CI отсутствуют
- **Fix**: добавить smoke в PR pipeline, load на schedule (nightly)
- **Status**: `open`

## P3 — round 2 additions (3)

### `[P3-V1]` `changePassword` 5-second skew window — accepted trade-off
- **Files**: `src/services/authService.js:404-410` (`JWT_CUTOFF_SKEW_MS = 5000`)
- **Note**: документировать в threat model; pre-cutoff токены валидны ещё ≤5s
- **Status**: `documented`

### `[P3-V2]` Stored functions без volatility classification (defaults to VOLATILE)
- **Files**: `database/init/01_init_database.sql:528-950` (9 plpgsql функций)
- **Evidence**: `find_nearest_buildings_to_transformer` (line 893) читает только static geometry — мог бы быть `STABLE` для planner
- **Fix**: add `STABLE` / `IMMUTABLE` где применимо
- **Status**: `open`

### `[P3-V3]` `hardening.sh` 10-min `at`-killswitch без final-state assertion
- **Files**: `hardening.sh:144-159`
- **Evidence**: clever pattern — но если operator забыл `atrm` после disconnect, hardening silently откатывается через 10 минут
- **Fix**: final-state self-test после X секунд + warning если killswitch не отменён
- **Status**: `open`

## ❌ False Positives / Verified

### `[V-FP-1]` Migration 016 `password_changed_at` cutoff check — **VERIFIED WIRED UP**
- **Evidence**: `grep` показывает `_isIssuedBeforeCutoff(decoded, user)` вызывается в `src/middleware/auth.js:73` и `:162`; функция в `authService.js:405-410` правильно читает `user.password_changed_at`
- **Verdict**: false alarm от N8 verification suggestion — не P0
- **Status**: `false-positive`

### `[V-FP-2]` HMAC constant-time compare — already using `timingSafeEqual`
- **Files**: `src/services/ukIntegrationService.js:123` uses `crypto.timingSafeEqual`
- **Verdict**: sub-concern about timing attack уже mitigated; P0-2 остаётся только в части replay nonce dedup
- **Status**: `verified`

## 📊 Round 2 Summary (snapshot до Round 3 corrections)

| Категория | Round 1 | Round 2 added | Round 2 total |
|---|---:|---:|---:|
| P0 | 6 | 1 (+ broaden P0-3a) | 7 |
| P1 | 15 | 14 | 29 |
| P2 | 14 | 8 | 22 |
| P3 | 5 | 3 | 8 |
| False positives | — | 2 | — |
| **Total** | **40** | **23** | **63 (pre R3)** |

**Round 3 corrections** (2026-05-21, см. `audit-backlog-2026-05-20-code-verification.md`):
- −1 P0: `[P0-V1]` DOMPurify → P2 (используется через wrapper)
- −1 P0: `[P0-6]` MV refresh → P1 (availability, not security)
- −1 P1: `[P1-6]` services res.* → false-positive (0 совпадений)
- +1 P2: `[P0-V1]` поглощён в P2 (reformulated: SRI + HTML sinks audit)
- −1 P2: `[P2-6]` payload mutation → fixed
- correction `[P2-1]`: count clarified (85 res.json + 156 res.status — частично overlap; 24 helpers)
- correction `[P1-V6]`: 11 untracked scripts (не 7)
- correction `[P1-V7]`: artifact upload coverage есть, отсутствует только для e2e/smoke/load

**После Round 3 — итоговое распределение:**

| Категория | Final count |
|---|---:|
| P0 | 5 (P0-1, P0-2, P0-3+3a, P0-4, P0-7) |
| P1 | 28 (15 R1 минус P1-6 + 14 R2) |
| P2 | 22 (R1 минус P2-6 + R2 + 1 from P0-V1) |
| P3 | 8 |
| False positives / fixed | 3 (P1-6, P2-6, и аспект P0-5 reworded) |
| **Total open** | **63** |

**Recalibrations applied:**
- `[P0-6]` MV refresh → **P1** (availability, not security)
- `[P1-9]` int4 serial → scope ×8 tables (not just users)
- `[P2-11]` migration 012 dup → escalate to **P1** в связке с V4 triple-003
- `[P0-3]` axios CVE → broadened to include generator/

## 🎯 Sprint 0 (Hotfix) — execution report (2026-05-21)

✅ **Sprint 0 closed.** 10/10 запланированных пунктов закрыты (8 deployed на demo сервер, 1 image ready, 1 partial — P0-4 secret rotation отложен по решению оператора). Подробный отчёт + per-PR ссылки: [`sprint0-progress-2026-05-21.md`](./sprint0-progress-2026-05-21.md).

1. ✅ `[P0-1]` login.html 404 — PR #4 `8b4e9c1` — deployed
2. ✅ `[P0-3]` axios CVE main — PR #6 `9569f7a` — deployed
3. ✅ `[P0-3a]` axios CVE generator — PR #7 `d292d1d` — image ready (контейнер не запущен)
4. ⚠️ `[P0-4]` sanitize deploy scripts + rotation runbook — PR #8 `39f0a9e` — partial (rotation отложена)
5. ✅ `[P0-7]` cron pg_dump + off-host backup — PR #9 `1b49abd` — deployed (smoke dump зелёный, cron активен)
6. ✅ `[P0-2]` webhook nonce dedup — PR #5 `32fed42` — deployed
7. ✅ `[P1-V1]` logout blacklist refresh token — PR #11 `193bc12` — deployed
8. ✅ `[P1-V3]` jwt algorithms whitelist — PR #12 `90a7c62` — deployed
9. ✅ `[P1-5]` silent .catch → logger.warn — PR #10 `826ec8e` — deployed
10. ✅ `[P1-V4]` renumber triple-003 migrations — PR #13 `a2b3e5a` — deployed
11. (DOMPurify SRI — оставлено на Sprint 1 hardening `[P1-3]`, не блокер)

**Acceptance metrics:**
- Test suite: 1853/1853 зелёные (89 → 91 suites, +19 новых регрессионных тестов)
- `npm audit --omit=dev`: 0 vulnerabilities (root + generator)
- Lint: clean (0 ошибок)
- 0 регрессий в существующих тестах
- 0 откатов на prod

**Carry-over в Sprint 1:**
- `[P0-4]` rotation: отложена; runbook готов в `docs/secret-rotation-2026-05-21.md`
- `[P0-5]` `infrasafe_runtime` least-privilege DB role
- `[P0-6]` MV refresh schedule (downgraded to P1)
- `[P1-V6]` consolidate 11 deploy scripts (касается тоже P0-4 vault-миграции)
- `[P1-V7]` CI: E2E + smoke + load матрица
- `[P1-V9]` / `[P1-V10]` pre-commit hooks (gitleaks) + Dependabot


---

# ⊕ Sprint 1 — Track A "Security through isolation" follow-ups (2026-05-21)

> Post-merge review by code-reviewer + security-reviewer agents.
> Verdict: **SHIP-WITH-FOLLOWUP** (0 BLOCKER, 0 HIGH, 5 MEDIUM, 6 LOW).
> P0-5 + P1-3 + P1-2 базовые цели достигнуты; ниже — гигиенические items для Sprint 1.0.1.

## MEDIUM (5) — fix в Sprint 1.0.1

### `[1A-FU-C-M1]` `completeLogin()` дублирует токены в localStorage → негирует P1-2 HttpOnly cookies (HIGH-priority follow-up)
- **Files**: `public/login.js:213`, и аналогично в `public/admin-auth.js` / `public/script.js`
- **Severity**: MEDIUM (но **HIGH-priority** функционально — без этого P1-2 не работает против XSS)
- **Evidence**: server ставит HttpOnly cookie, но клиент **тут же** делает `localStorage.setItem('admin_token', data.accessToken)` → токен снова JS-accessible
- **Fix**: убрать `localStorage.setItem` из `completeLogin()`; auth middleware уже умеет fallback на cookie. После — инвертировать `extractAccessToken` order на cookie-first.
- **Status**: `open`

### `[1A-FU-C-M2]` Hardcoded `infrasafe` DB name в миграции 017
- **Files**: `database/migrations/017_runtime_role.sql:51`, `database/init/09_runtime_role.sql`
- **Evidence**: `GRANT CONNECT ON DATABASE infrasafe TO infrasafe_runtime` — если БД переименована или staging использует другое имя, миграция silent no-op
- **Fix**:
  ```sql
  DO $$ BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO infrasafe_runtime', current_database());
  END $$;
  ```
- **Status**: `open`

### `[1A-FU-C-M3]` Unvalidated `data.qrCodeUrl` → `img.src` (data-URI injection)
- **Files**: `public/login.js:170`
- **Severity**: MEDIUM — server controls URL, но defence-in-depth
- **Fix**: validate prefix `data:image/` или `https://` перед assignment; иначе `showError('Некорректный QR-код')`
- **Status**: `open`

### `[1A-FU-C-M4]` p1-3-csp-sri tests — file-content contract, не live header
- **Files**: `tests/jest/unit/p1-3-csp-sri.test.js`
- **Evidence**: Whitespace/quoting error в nginx.production.conf обойдёт unit-тесты и доедет до prod как silent missing CSP header
- **Fix**: добавить e2e тест в `tests/jest/e2e/` который делает HTTP GET и asserts `res.headers['content-security-policy']` существует + не содержит `'unsafe-inline'` в script-src
- **Status**: `open`

### `[1A-FU-S-M1]` Runbook P0-5 не запрещает `trust` pg_hba для `infrasafe_runtime`
- **Files**: `docs/p0-5-runtime-role-2026-05-21.md`
- **Evidence**: placeholder password нейтрализуется если pg_hba имеет `trust` для local connections — runtime юзер может login без пароля
- **Fix**: добавить параграф в runbook: "MUST verify `pg_hba.conf` does not use `trust` auth for `infrasafe_runtime`; require `scram-sha-256` или `md5`"
- **Status**: `open`

### `[1A-FU-S-M2]` Нет CSP `report-uri`/`report-to` — нарушения silent
- **Files**: `nginx.production.conf` CSP directive
- **Evidence**: тightened CSP без observability — bypass/misconfig идут невидимо
- **Fix**: добавить `report-uri /api/csp-report` + minimal backend endpoint (POST JSON, log via winston, rate-limited)
- **Status**: `open`

## LOW (6)

### `[1A-FU-S-L1]` `fonts.googleapis.com` в `script-src` — dead weight
- **Files**: `nginx.production.conf:147`
- **Evidence**: Google Fonts отдаёт CSS, не JS; entry в `script-src` ненужно расширяет attack surface. Уже есть в `style-src`.
- **Fix**: убрать из `script-src`, оставить только в `style-src`
- **Status**: `open`

### `[1A-FU-S-L2]` SECURITY DEFINER `search_path` weaker form
- **Files**: `database/migrations/017_runtime_role.sql:120`
- **Evidence**: `SET search_path = public, pg_temp` — `pg_catalog` отсутствует. Канонический паттерн: `SET search_path = pg_catalog, public`
- **Risk**: very low (zero-arg function), но deviation from canonical
- **Fix**: `ALTER FUNCTION refresh_transformer_analytics() SET search_path = pg_catalog, public;`
- **Status**: `open`

### `[1A-FU-S-L3]` Cookie `path: '/'` — scope to `/api` после localStorage migration
- **Files**: `src/utils/authCookies.js:36`
- **Evidence**: cookie отправляется на webhook receivers, health checks, static files — privacy hygiene
- **Fix**: после Phase 2 localStorage cleanup сменить на `path: '/api'`
- **Status**: `open` (waits on `[1A-FU-C-M1]`)

### `[1A-FU-S-L4]` Auth middleware fallback order — header first, надо cookie first
- **Files**: `src/middleware/auth.js` `extractAccessToken`
- **Evidence**: header-first OK transitional; после Phase 2 нужно cookie-first иначе XSS-set `Authorization` всегда выиграет
- **Fix**: инвертировать order; header — только для programmatic API clients
- **Status**: `open` (waits on `[1A-FU-C-M1]`)

### `[1A-FU-S-L5]` Cookie names без `__Host-` префикса
- **Files**: `src/utils/authCookies.js:21-22`
- **Evidence**: `__Host-` префикс enforce'ит `Secure; Path=/; no Domain` на уровне браузера, защищает от subdomain cookie injection. Missed depth-in-defense.
- **Fix**: rename `access_token` → `__Host-access_token`, `refresh_token` → `__Host-refresh_token`. Требует `path: '/'` (т.е. конфликтует с `[1A-FU-S-L3]`).
- **Status**: `open`

### `[1A-FU-C-L1]` `secure: NODE_ENV==='production'` — staging gap
- **Files**: `src/utils/authCookies.js:32`
- **Evidence**: staging с `NODE_ENV=development` или `NODE_ENV=staging` отправляет cookies по plain HTTP несмотря на TLS у nginx
- **Fix**: `secure: isProduction || process.env.SECURE_COOKIES === 'true'`
- **Status**: `open`

### `[1A-FU-C-L2]` Raw server error messages в `showError()` leak internal state
- **Files**: `public/login.js:82`
- **Evidence**: `err.message` из API показывается verbatim ("User admin locked until 2026-05-22T10:00:00") — leaks lockout times и internal state
- **Risk**: LOW (textContent prevents XSS execution)
- **Fix**: normalize error messages — mapping API codes к generic user-friendly strings
- **Status**: `open`

### `[1A-FU-C-L3]` Placeholder password в коммите — рекомендация NOLOGIN initially
- **Files**: `database/migrations/017_runtime_role.sql:44`
- **Evidence**: `PASSWORD 'CHANGE_ME_VIA_OPERATOR_RUNBOOK_DO_NOT_USE_IN_PROD'` — dev может забыть runbook и connect с placeholder'ом
- **Fix**: создавать `infrasafe_runtime` сразу как `NOLOGIN`; operator ALTER ROLE LOGIN PASSWORD '...' single atomic step
- **Status**: `open`

## ✅ Что подтверждено корректным (Track A)

- HttpOnly + Secure + SameSite=Strict на всех auth cookies (23 assertions в `authCookies.test.js`)
- SRI `sha384-...` + `crossorigin="anonymous"` + `referrerpolicy="no-referrer"` на CDN scripts
- `'unsafe-inline'`/`'unsafe-eval'` действительно убраны из script-src (prod)
- 0 inline event handlers в HTML entry points
- SECURITY DEFINER направление правильное (`infrasafe_app` owner, EXECUTE → `infrasafe_runtime`)
- `REVOKE CREATE ON SCHEMA public FROM PUBLIC` ✓
- cookieParser middleware order правильный (после json, до auth)
- Logout очищает обе cookies (access + refresh)
- 2FA tempToken НЕ в cookie (правильно)
- `npm audit` clean
- 94 suites / 1907 tests (baseline 92/1872 → +2 suites, +35 tests, 0 regressions)

## Sprint 1 Track A — итоговое распределение

| Item | Status | Verified |
|---|---|---|
| `[P0-5]` runtime role | `fixed (local)` — branch `fix/p0-5-runtime-role`, commit `22eb865` | SECURITY DEFINER + REVOKE PUBLIC ✓ |
| `[P1-3]` CSP/SRI | `fixed (local)` — branch `fix/p1-3-csp-sri`, commit `5e6c697` | unsafe-inline removed ✓ |
| `[P1-2]` HttpOnly cookies | `partial — local (Phase 1)` — branch `fix/p1-2-cookie-auth`, commit `b83496a` | HttpOnly+Secure+SameSite=Strict ✓; localStorage cleanup в Phase 2 |

**Track A integration branch**: `sprint1-security/all-2026-05-21` (commits `22eb865`, `5e6c697`, `b83496a`, `e109345`/`01efb85`/`3152fad` merges, `bbad5aa` progress doc). 1907/1907 tests, lint clean, npm audit clean.

**Deploy order recommendation**:
1. P1-3 nginx restart (lowest risk, instant rollback)
2. P1-2 app restart (additive, доеха backward-compat с localStorage)
3. P0-5 last (требует свежий backup + env swap + app restart)

**Carry-over в Sprint 1.0.1 / Sprint 2**:
- 5 MEDIUM follow-ups (`[1A-FU-C-M1..4]`, `[1A-FU-S-M1..2]`) → Sprint 1.0.1 (~1.5-2 часа)
- 6 LOW (`[1A-FU-C-L1..3]`, `[1A-FU-S-L1..5]`) → Sprint 2 hygiene

---

# ⊕ Sprint 1.0.1 — review findings (2026-05-21)

**Scope**: code-reviewer + security-reviewer + database-reviewer прошлись по
`fix/sprint1.0.1-followups` (5 коммитов, 34 files, +2129/-407). 0 BLOCKER, 0 CRITICAL.
Список из 4 HIGH (закрыто immediately одним hot-fix) + 8 MEDIUM + 7 LOW carry-over.

## ⚡ Closed immediately (Sprint 1.0.2 hot-fix)

| ID | File:line | Issue | Status |
|---|---|---|---|
| `1A-FU2-C-H1` | `public/login.js:77` | `password.trim()` silent auth fail for passwords with leading/trailing spaces | **fixed** (Sprint 1.0.2) — keep `username.trim()`, drop password trim |
| `1A-FU2-C-H2` | `public/login.js:218` | `if (!token) throw` wrong invariant in cookie-first world — cookie уже выставлен сервером | **fixed** (Sprint 1.0.2) — убрать throw, redirect полагается на cookie + profile probe |
| `1A-FU2-DB-H1` | `database/migrations/017_runtime_role.sql:114-115`, `init/09:56-57` | `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS` авто-grant для будущих SECURITY DEFINER | **fixed** (Sprint 1.0.2) — снят дефолт, snapshot grant сохранён; будущие функции granted explicit per-migration |
| `1A-FU2-DB-H2` | `017_runtime_role.sql:92`, `init/09:44`, plus default-priv at 112+55 | `GRANT ... UPDATE ON SEQUENCES` — позволяет `setval()` rewind PK | **fixed** (Sprint 1.0.2) — оставлено `USAGE, SELECT` only (direct + ALTER DEFAULT). +2 regression теста |

## 🟡 MEDIUM — Sprint 2 follow-up (8)

| ID | File | Issue |
|---|---|---|
| `1A-FU2-S-M1` | `src/services/authService.js:511` | Lockout timestamp leak via API JSON (frontend normalize — но curl/script-клиент видит ISO timestamp). Throw generic msg на service layer, log детали server-side |
| `1A-FU2-S-M2` | `src/controllers/authController.js:52,239,316,381` | `accessToken`/`refreshToken` всё ещё spread в response body — XSS читаемо. Cookie уже стоит → body redundant. Удалить `...tokens` (или хотя бы `refreshToken`) |
| `1A-FU2-S-M3` | `public/login.js:166-167,171` | `qrCodeUrl` allowlist слишком широк (`https://` permits attacker CDN); нет length cap. Сузить до `data:image/png;base64,` + ≤8KB. Server-controlled, но defence-in-depth |
| `1A-FU2-S-M4` | `nginx.production.conf:152` (main server) | `object-src` отсутствует в main CSP — fallback на `default-src 'self'` разрешает Flash/plugin objects. `/uk/` block имеет `'none'`. Добавить в main |
| `1A-FU2-S-M5` | `nginx.production.conf:152` | `report-uri` deprecated — Chromium может drop в будущем. Параллельно добавить `Report-To` header + `report-to` CSP directive |
| `1A-FU2-C-M1` | `public/admin-auth.js:133`, `public/script.js:226` | `window.csrfProtection?.isModifyingMethod(...)` silent no-op — load-order зависимость. При невзорванной загрузке admin.js CSRF тихо не шлётся. Сделать explicit failure mode |
| `1A-FU2-DB-M1` | `017_runtime_role.sql` | Нет `CONNECTION LIMIT N` на роли. После grant LOGIN утечка коннектов → exhaust `max_connections`. Добавить `CONNECTION LIMIT 20` (match pool size) в `ALTER ROLE` runbook |
| `1A-FU2-DB-M2` | `017_runtime_role.sql:56`, init/09:19 | Нет explicit `NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION` атрибутов. Defence-in-depth от копипасты неверного `ALTER ROLE` в runbook |

## 🟢 LOW — sweep (7)

| ID | File | Issue |
|---|---|---|
| `1A-FU2-C-L1` | `public/script.js:2202` | `apiClient.setToken(token)` всё ещё передаёт live token — no-op сейчас, но создаёт risk re-introduction localStorage при future refactor. Добавить comment at callsite |
| `1A-FU2-C-L2` | `src/routes/index.js:82,:104` | `/csp-report` mounted twice — router.use + PUBLIC_ROUTES entry. Второй no-op. Удалить redundant entry |
| `1A-FU2-C-L3` | `public/login.js:71` | `initializeForm()` без null-guard на `document.getElementById('login-form')`. Defensive `if (!form) return;` predicate |
| `1A-FU2-C-L4` | `public/admin-auth.js:57,147` | `console.warn`/`console.log` в prod-path (известная архитектурная проблема + 2 новых instance) |
| `1A-FU2-S-L1` | `src/server.js:75` | `cookieParser()` без signing secret. Если future code использует `req.signedCookies` — silent `false`. Pass `process.env.COOKIE_SIGNING_SECRET` (cheap insurance) |
| `1A-FU2-S-L2` | `src/utils/authCookies.js:34-37` | `SECURE_COOKIES` env override precedence non-obvious для staging с `NODE_ENV=production`. Документировать в комменте |
| `1A-FU2-S-L3` | `src/routes/cspReportRoutes.js:62` | `documentUri` slice до 256 но не strip query/fragment. Spec гарантирует браузер сам strip — но защита от non-compliant clients |

**Verification (Sprint 1.0.2 hot-fix)**:
- 96 suites, 1935 tests passing (+2 regression тестов на DB-H1/H2)
- npm run lint: clean
- Commit: TBD on `fix/sprint1.0.1-followups`
