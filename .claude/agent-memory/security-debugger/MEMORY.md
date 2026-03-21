# InfraSafe Security Debugger — Memory

## Project Overview
Node.js/Express/PostgreSQL IoT building monitoring platform.
Stack: Express 4.18.2, pg 8.11.3, bcrypt 5.1.1, jsonwebtoken 9.0.2, helmet 7.1.0, winston 3.11.0.

## Key Security Patterns (Confirmed Good — as of 2026-03-21)

- **Password hashing**: bcrypt with saltRounds=12 in `src/services/authService.js:10`
- **SQL parameterization**: All models use `$1`/`$2` pg params — no raw concat in models
- **Sort/order whitelist**: `src/utils/queryValidation.js` — allowedSortColumns per entity, used in Building, Controller, Metric, adminController
- **JWT blacklist**: Two-level (in-memory L1 + PostgreSQL token_blacklist table L2) — survives restarts. Checked per-request in `src/middleware/auth.js:27`
- **Account locking**: 5 attempts, 15 min lockout — IN-MEMORY ONLY (see P2-4)
- **User re-validation per request**: auth middleware fetches user from DB on every JWT check (with 5min cache — see P0-1)
- **Error handler**: no stack trace in production (`src/middleware/errorHandler.js:25`)
- **Frontend XSS infra**: `public/utils/domSecurity.js` — DOMPurify + textContent helpers; `sanitizePopupContent` used for Leaflet popups. No innerHTML with user data found.
- **CORS**: configured via CORS_ORIGINS env var whitelist, not wildcard (`src/server.js:44-47`)
- **Swagger**: disabled in production via `NODE_ENV !== 'production'` check (`src/server.js:60`)
- **scriptSrc CSP**: no unsafe-inline/unsafe-eval in production (`src/server.js:30-32`)
- **Auth rate limiting**: authLimiter (10/15min) and registerLimiter (5/hr) applied in `src/routes/authRoutes.js:62,120`
- **Refresh token type**: authService.refreshToken checks `decoded.type !== 'refresh'`
- **Register role hardcoded**: `src/controllers/authController.js:55` and `src/services/authService.js:38` both hardcode role='user' — privilege escalation via register is NOT possible
- **isAdmin on adminRoutes**: `router.use(isAdmin)` at top of adminRoutes.js — FIXED since 2026-03-08
- **isAdmin on sensitive analytics**: /refresh, /cache/invalidate, /circuit-breakers/reset, PUT /thresholds — FIXED since 2026-03-08
- **JWT_REFRESH_SECRET**: throws if missing (no fallback) — FIXED since 2026-03-08
- **Refresh token rotation**: consumed refresh token immediately blacklisted (authService.js:234)

## Fixed Since Previous Audit (2026-03-08 → 2026-03-21, branch fix/p0-p1-security-and-hygiene)
- No auth on GET /api/admin/* — FIXED: router.use(isAdmin) in adminRoutes.js:9
- No isAdmin on sensitive analytics routes — FIXED
- Rate limiter bypass via User-Agent — FIXED: authLimiter/registerLimiter use IP-only keyGenerator
- JWT_REFRESH_SECRET fallback — FIXED: now throws if missing
- XSS via innerHTML in script.js and map-layers-control.js — FIXED: no innerHTML with API data found
- CSP meta tag unsafe-inline contradiction — resolved
- password_hash in user cache — FIXED (2026-03-21 QA): authService.findUserById now uses explicit SELECT columns + destructures hash out
- analyticsController error.message leak — FIXED (2026-03-21 QA): all catch blocks now return 'Внутренняя ошибка сервера'
- alertController error.message leak — FIXED (2026-03-21 QA): all catch blocks hardened
- JWT secrets hardcoded in docker-compose.dev.yml — FIXED (2026-03-21 QA): now use ${JWT_SECRET:-fallback} syntax
- Morgan logs full query string — FIXED (2026-03-21 QA): custom :safepath token uses req.path
- cacheService TTL double-conversion bug — FIXED (2026-03-21 QA): all callers now pass seconds; get()/set() both convert to ms
- HAVING→WHERE semantic bug in powerAnalyticsService — FIXED (2026-03-21 QA): subquery wrapper used

## Open Vulnerabilities (Post-QA Audit 2026-03-21)

### P1 — High (pre-existing, not addressed in this PR)
- **JWT tokens in localStorage**: `public/admin-auth.js:4,54` — admin_token in localStorage, XSS-stealable. Fix: move to HttpOnly cookie.
- **No server-side CSRF protection**: `public/utils/csrf.js` reads meta tag that doesn't exist in HTML. No csurf middleware installed. Fix: csurf or double-submit cookie.

### P1 — High (NEW, introduced by QA fix)
- **createError leaks error.message in admin/domain controllers**: 32 occurrences across `src/controllers/admin/` and `src/controllers/buildingMetricsController.js`. `createError(`...${error.message}`, 500)` passes the message to `errorHandler`, which sends `err.message` directly to client. Fix: use generic message in createError() calls.
- **authController leaks error.message for coded errors**: Lines 37,40,43,79,158,187,190 — `error.message` from service-layer errors (which contain user-visible Russian strings) returned directly for INVALID_CREDENTIALS, ACCOUNT_DISABLED, ACCOUNT_LOCKED, USER_EXISTS, INVALID_REFRESH_TOKEN, USER_NOT_FOUND, INVALID_CURRENT_PASSWORD. These are intentional UX messages, but INVALID_REFRESH_TOKEN at line 158 could disclose internal state; review needed.
- **bcrypt 5.1.1 has 3 high CVEs via node-tar**: `npm audit` shows GHSA-34x7, GHSA-8qq5, GHSA-83g3, GHSA-qffp, GHSA-9ppj, GHSA-r6q2. npm audit fix --force upgrades to bcrypt@6.0.0 (breaking change). Only exploitable at build/install time (not runtime). Requires explicit decision to upgrade.

### P2 — Medium (pre-existing, not addressed in this PR)
- **styleSrc: 'unsafe-inline' in production**: `src/server.js:30` — not gated by NODE_ENV unlike scriptSrc.
- **GET /api/analytics/status has no rate limiting**: `src/routes/analyticsRoutes.js:311`.
- **Account lockout in-memory only**: `src/services/authService.js:384` — resets on process restart.
- **No ID type validation in buildingController/metricController**: params.id passed as string without parseInt check.
- **validateSearchString uses blocklist**: `src/utils/queryValidation.js:218` — bypassable via Unicode.
- **refreshToken in authService.js skips blacklist and issuer/audience check**: `src/services/authService.js:218`.
- **5min user cache allows delayed role revocation**: still present (by design — accepted risk).
- **server.close() hangs on keep-alive connections**: graceful shutdown awaits server.close() indefinitely if persistent connections exist (Node.js default behavior). Force-exit timeout at 10s mitigates.

### P3 — Low (pre-existing)
- **req.user contains email**: minor over-sharing.
- **crudLimiter defined but not applied to /buildings, /controllers CRUD routes**.
- **No audit log for admin actions**.

## Architecture Notes (updated 2026-03-21)

- `src/routes/index.js`: Default-deny at lines 96-101; telemetry POST at line 76 BEFORE global middleware
- PUBLIC_ROUTES allowlist: POST /auth/login, /auth/register, /auth/refresh, POST /metrics/telemetry, GET /buildings-metrics, GET /
- Admin controllers split: `src/controllers/admin/` directory — adminBuildingController.js, adminMetricController.js, index.js
- batchMetricsOperation and batchBuildingsOperation are STUBS — return success without doing anything (safe, but incomplete)
- errorHandler (`src/middleware/errorHandler.js:20`) always sends `err.message` to client — any `next(createError(msg))` where msg contains error.message leaks to client
- authService.findUserByUsernameOrEmail: NOT cached (correct — contains password_hash, used for login)
- authService.findUserById: FIXED — now explicit SELECT columns, destructures password_hash out before caching
- cacheService.get() converts ttl seconds→ms; cacheService.set() also converts — consistent as of 2026-03-21 QA

## Dependency Notes
- No Redis — caching in-memory (Map) with DB fallback for token blacklist
- dompurify in package.json; used only client-side via CDN
- No csurf or any CSRF library installed
- express-validator used in buildingRoutes, controllerRoutes validators; NOT on auth routes
- bcrypt@5.1.1 has 3 HIGH CVEs (node-tar path traversal) — build-time only, not runtime. Fix requires upgrade to bcrypt@6.0.0 (breaking change)
