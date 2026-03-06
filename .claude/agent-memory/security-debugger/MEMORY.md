# InfraSafe Security Debugger — Memory

## Project Overview
Node.js/Express/PostgreSQL IoT building monitoring platform.
Stack: Express 4.18.2, pg 8.11.3, bcrypt 5.1.1, jsonwebtoken 9.0.2, helmet 7.1.0, winston 3.11.0.

## Key Security Patterns (Confirmed Good)

- **Password hashing**: bcrypt with saltRounds=12 in `src/services/authService.js:9`
- **SQL parameterization**: All models use `$1`/`$2` pg params — no raw concat in models
- **Sort/order whitelist**: `src/utils/queryValidation.js` — allowedSortColumns per entity, used in Building, Controller, Metric, adminController
- **JWT blacklist**: in-memory cache via `cacheService`, checked on every auth request in `src/middleware/auth.js:27`
- **Account locking**: 5 attempts, 15 min lockout, stored in cacheService — resets on restart (LOW risk)
- **User re-validation per request**: auth middleware fetches user from DB on every JWT check
- **Error handler**: no stack trace in production (`src/middleware/errorHandler.js:25`)
- **Frontend XSS infra**: `public/utils/domSecurity.js` — DOMPurify + textContent helpers

## Known Vulnerabilities (Audit 2026-03-06)

### Critical
- **SQL Injection INTERVAL**: `src/services/alertService.js:437` — `INTERVAL '${days} days'` string interpolation. Fix: `INTERVAL '1 day' * $1`
- **Privilege Escalation**: `src/controllers/authController.js:54` — `role` accepted from req.body on public register endpoint. Any user can self-register as admin.

### High
- **No rate limiting on /auth/login and /auth/register**: `src/routes/authRoutes.js` — brute-force unprotected
- **Refresh token uses same secret as access token**: `src/services/authService.js:136-143` — both signed with `JWT_SECRET`, `JWT_REFRESH_SECRET` env var exists but unused in signing
- **All GET endpoints unauthenticated**: `src/routes/index.js:89-95` — buildings, controllers, metrics, alerts open without auth
- **CORS wildcard**: `src/server.js:40` — `cors()` without config, ignores CORS_ORIGIN env var
- **XSS via innerHTML**: `public/script.js:2317` — `data.total_power_kw` interpolated directly

### Medium
- **Swagger in production**: `src/server.js:83` — SWAGGER_ENABLED env var ignored in code
- **CSP unsafe-inline + unsafe-eval**: `src/server.js:26-27` — global for all routes, needed only for /api-docs
- **JWT in localStorage**: `public/admin-auth.js:4` — admin token vulnerable to XSS theft
- **CSRF protection stub**: `public/utils/csrf.js` — reads meta tag that server never generates; no server-side CSRF middleware
- **validateSearchString blocklist**: `src/utils/queryValidation.js:219` — blocklist approach, but SQLi impossible due to pg params

### Low
- **.env.prod committed with real JWT secrets** — check git history, rotate secrets
- **DB password "postgres" in .env** — dev only, but risky
- **Lockout counter in memory** — resets on server restart
- **morgan logs all query params** — potential token leakage if tokens ever passed as URL params

## Architecture Notes

- `src/routes/index.js`: auth routes excluded from middleware, telemetry endpoint `POST /metrics/telemetry` intentionally unauthenticated
- `src/services/cacheService.js`: in-memory cache (no Redis) — used for JWT blacklist, lockout, user cache
- `src/middleware/auth.js`: 4 exported functions — authenticateJWT, isAdmin, authenticateRefresh, optionalAuth
- Admin routes at `/api/admin/*` — protected only by `rateLimitStrict` (100 req/min), NO authenticateJWT + isAdmin middleware on the routes themselves (applied globally for POST/PUT/DELETE only)
- `src/services/authService.js`: singleton exported via `module.exports = new AuthService()`

## Dependency Notes
- No Redis dependency — all caching is in-memory (Map-based)
- dompurify in package.json but used only client-side via CDN reference
- No csurf or any CSRF library installed
- express-validator used in `src/middleware/validators.js` but not applied to auth routes
