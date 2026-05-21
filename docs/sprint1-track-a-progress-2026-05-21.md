# Sprint 1 — Track A: Безопасность через изоляцию (2026-05-21)

> Follow-up sprint after Sprint 0 hotfixes. Three items from
> `docs/audit-backlog-2026-05-20.md` packaged together because they're
> all about reducing the blast radius of an XSS or app-bug compromise.

## Headline

| Metric | Value |
|---|---|
| Items shipped | 3 |
| Branches created | 3 fix-branches + 1 integration |
| Pre-deploy state | local-only (per operator decision) |
| New tests | 50 (12 + 15 + 23) |
| Existing tests modified | 2 (auth controller + middleware mocks updated) |
| Final suite size | 94 suites, 1907 tests, all green |
| Lint | clean |
| Regressions | 0 |

## Per-item status

| ID | Title | Branch | New tests | Status |
|---|---|---|---|---|
| **P0-5** | DB role separation (`infrasafe_runtime`) | `fix/p0-5-runtime-role` | 12 | local, ready for review |
| **P1-3** | CSP hardening + SRI + inline-script extraction | `fix/p1-3-csp-sri` | 15 | local, ready for review |
| **P1-2** | HttpOnly cookie alongside Authorization header (transitional) | `fix/p1-2-cookie-auth` | 23 | local, ready for review |

Integration branch: `sprint1-security/all-2026-05-21`.

## What each item actually changes

### P0-5 — DB role separation

- **New migration**: `database/migrations/017_runtime_role.sql` creates `infrasafe_runtime` LOGIN role with only `SELECT/INSERT/UPDATE/DELETE` on tables, `USAGE` on sequences, `EXECUTE` on functions. No `SUPERUSER`, no `CREATEROLE`, no `CREATEDB`.
- **`ALTER DEFAULT PRIVILEGES`** so future migrations creating tables auto-grant to `infrasafe_runtime` — prevents migration-time prod outages.
- **`refresh_transformer_analytics()` → `SECURITY DEFINER`** with locked `search_path` so the runtime user can refresh MVs without owning them; the search-path lock closes the classic SECURITY DEFINER escalation footgun.
- **`REVOKE CREATE ON SCHEMA public FROM PUBLIC`** belt-and-braces.
- **Operator runbook**: `docs/p0-5-runtime-role-2026-05-21.md` covers `openssl rand` → `ALTER ROLE` → `.env.prod` swap → restart → verify → rollback path.

### P1-3 — CSP + SRI

- **SRI hashes** (`sha384-qJNk...21rV`) + `crossorigin="anonymous"` + `referrerpolicy="no-referrer"` on every DOMPurify CDN tag (`index.html`, `admin.html`, `public/login.html`).
- **All 4 inline `<script>` blocks extracted** to external `.js`:
  - `index.html` → `public/api-config.js`
  - `about.html` + `documentation.html` → `public/theme-toggle.js` (was duplicated)
  - `public/login.html` → `public/login.js` (191-line LoginHandler)
- **nginx.production.conf**: `script-src` no longer has `'unsafe-inline'` / `'unsafe-eval'`. (`style-src` keeps `'unsafe-inline'` because HTML uses `style="..."` attributes; that's a low-risk CSS-only refactor for a later sprint.)
- **helmet** (Express middleware): dev mode drops `'unsafe-eval'` (Swagger UI 5.x doesn't need it); prod was already clean.

### P1-2 — Cookie auth (transitional)

- **New dependency**: `cookie-parser`.
- **New module**: `src/utils/authCookies.js` — `setAuthCookies`, `clearAuthCookies`, `extractAccessToken`, `extractRefreshToken`.
- **Cookies emitted** by `login`, `verify2FA`, `confirm2FA`, `refreshToken` — alongside the existing JSON body fields. Attributes: `httpOnly`, `secure` in prod, `sameSite=strict`, `path=/`, `maxAge` = 1h (access) / 7d (refresh).
- **Cookies read** by `authenticateJWT`, `authenticateRefresh`, `optionalAuth` middlewares as fallback when the Authorization header / `req.body.refreshToken` is missing.
- **Cookies cleared** by `logout` on every path (including the 400 "Token required" path).
- **Logout now also accepts** the access token from `access_token` cookie when header missing.
- **Clients untouched** — per operator decision, the transitional release keeps localStorage as-is. A follow-up PR (Sprint 1 next chunk) will switch admin-auth.js, script.js, login.js to cookie-only.

## Verification commands you can run

```bash
# Integration branch — full regression
git checkout sprint1-security/all-2026-05-21
npm test -- --silent          # 94 suites, 1907 tests, all green
npm run lint                  # clean

# Per-item targeted runs
npm test -- --testPathPattern="migration017RuntimeRole"  # P0-5: 12 contract tests
npm test -- --testPathPattern="p1-3-csp-sri"              # P1-3: 15 contract tests
npm test -- --testPathPattern="authCookies"               # P1-2: 23 unit + integration

# Audit
npm audit --omit=dev          # 0 vulnerabilities
```

## Operator deploy checklist

| # | Item | Action | Verification |
|---|---|---|---|
| 1 | P1-3 nginx CSP | `git pull && docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate nginx` | DevTools console: no CSP violations on admin login; SRI passes (no `Integrity check failure` errors) |
| 2 | P1-2 cookie auth | `docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate app` | DevTools → Application → Cookies: `access_token`, `refresh_token` present with HttpOnly + Secure + SameSite=Strict |
| 3 | P0-5 runtime role | Follow `docs/p0-5-runtime-role-2026-05-21.md` ENTIRELY — fresh backup → migration → password → env swap → restart → smoke checks | All 6 acceptance checks in §"Acceptance checks" pass; logs show no `permission denied` |

**Order matters**: do P1-3 and P1-2 first (low risk, instant rollback). P0-5 needs the prod backup as safety net — verify the latest off-host dump exists before swapping `.env.prod`.

## What's NOT in this round

- **localStorage removal from clients** (P1-2 Phase 2) — separate Sprint 1 PR. Browser tabs with cached JS continue to work through the deploy; once we've confirmed cookies are functioning everywhere in prod, the next PR removes the localStorage path on admin-auth.js, script.js, login.js, and updates the fetch interceptor accordingly.
- **`style-src 'unsafe-inline'`** still present — CSS-only refactor with low security ROI. Tracked as a follow-up.
- **`database.sql` ↔ `database/init/*.sql` divergence** — discovered during P0-5; fix-init flow uses neither path cleanly. Logged in the P0-5 runbook for a separate cleanup.
- **`infrasafe_app` superuser status** — kept superuser for migrations and pg_dump. A future split could break it into `infrasafe_migrate` (DDL) + `infrasafe_backup` (read).

## Items NOT done in this session that should be next

From the backlog (`docs/audit-backlog-2026-05-20.md`), the natural follow-up:

- **`[P1-1]`** Redis rate-limiter (blocks N>1 replica scale-out)
- **`[P1-15]`** Cache unification through `cacheService` (UK counts, IntegrationConfig, UK JWT — all process-local today)
- **`[P0-4]`** Operator: rotate `UK_WEBHOOK_SECRET` + `TOTP_ENCRYPTION_KEY` per the Sprint 0 runbook — now that the runtime role + cookie auth are in, this is the right window
- **`[P1-V6]`** Consolidate 11 untracked deploy scripts into a single canonical
- **`[P1-V7]` / `[P1-V9]` / `[P1-V10]`** — CI hardening (E2E in CI, husky + gitleaks, Dependabot)
- **P1-2 Phase 2** — remove localStorage from clients now that cookies are in flight
