# InfraSafe Security Debugger — Memory

## Project Overview
Node.js/Express/PostgreSQL IoT building monitoring platform.
Stack: Express 4.18.2, pg 8.11.3, bcrypt 5.1.1, jsonwebtoken 9.0.2, helmet 7.1.0, winston 3.11.0.

## Key Security Patterns (Confirmed Good — as of 2026-04-02)

- **Password hashing**: bcrypt with saltRounds=12 in `src/services/authService.js:10`
- **SQL parameterization**: All models use `$1`/`$2` pg params — no raw concat in models
- **Sort/order whitelist**: `src/utils/queryValidation.js` — allowedSortColumns per entity, used in Building, Controller, Metric, adminController
- **JWT blacklist**: Two-level (in-memory L1 + PostgreSQL token_blacklist table L2) — survives restarts. Checked per-request in `src/middleware/auth.js:27`
- **Account locking**: 5 attempts, 15 min lockout — IN-MEMORY ONLY (resets on restart)
- **User re-validation per request**: auth middleware fetches user from DB on every JWT check (with 5min cache)
- **Error handler**: no stack trace in production (`src/middleware/errorHandler.js:26`)
- **Frontend XSS infra**: `public/utils/domSecurity.js` — DOMPurify + textContent helpers; `sanitizePopupContent` used for Leaflet popups
- **CORS**: configured via CORS_ORIGINS env var whitelist, not wildcard (`src/server.js:46`)
- **Swagger**: disabled in production via `NODE_ENV !== 'production'` check (`src/server.js:71`)
- **scriptSrc CSP**: no unsafe-inline/unsafe-eval in production (`src/server.js:31-33`)
- **Auth rate limiting**: authLimiter (10/15min) and registerLimiter (5/hr) applied in `src/routes/authRoutes.js:62,120`
- **Refresh token type**: authService.refreshToken checks `decoded.type !== 'refresh'`
- **Register role hardcoded**: `src/controllers/authController.js:55` and `src/services/authService.js:41` both hardcode role='user'
- **isAdmin on adminRoutes**: `router.use(isAdmin)` at top of adminRoutes.js:9
- **isAdmin on sensitive analytics**: /refresh, /cache/invalidate, /circuit-breakers/reset, PUT /thresholds — confirmed in analyticsRoutes.js
- **JWT_REFRESH_SECRET**: throws if missing (no fallback) in authService.js constructor
- **Refresh token rotation**: consumed refresh token immediately blacklisted (authService.js:234)
- **Webhook HMAC**: timing-safe comparison via crypto.timingSafeEqual + 300s replay window in ukIntegrationService.js
- **Docker prod**: non-root user (nodejs:1001) in Dockerfile.prod:23, resource limits set
- **.gitignore**: `.env` and `.env.*` excluded; only `.env.example` tracked
- **isAdmin on PATCH /alerts/:id/acknowledge and /alerts/:id/resolve**: alertRoutes.js:343,375 — CONFIRMED FIXED (isAdmin present)
- **alertController error.message**: catch blocks use hardcoded Russian messages (не найден) — NOT leaking raw error
- **severity/infrastructure_type filters**: alertController.js:16-23 has whitelist validation — CONFIRMED FIXED

## CRITICAL — .env with real secret on disk (2026-04-02)
- `.env` file exists at project root with real `UK_WEBHOOK_SECRET=ca3b1db0ee1359f7e40100...`
- `.gitignore` excludes it but file is present — secret must be rotated if this was ever committed

## Open Vulnerabilities (Production Readiness Audit 2026-04-02)

### HIGH
- **H-1: createError leaks error.message — 30+ locations**: `src/controllers/admin/adminBuildingController.js:83`, `adminTransformerController.js` (5), `adminLineController.js` (5), `adminWaterLineController.js` (6), `adminColdWaterSourceController.js` (5), `adminHeatSourceController.js` (5), `adminMetricController.js`, `adminControllerController.js`, `buildingMetricsController.js:11`. All pass `error.message` to `createError()` → `errorHandler` sends to client.
- **H-2: authController leaks service error.message** — Lines 37,40,43 (login), 79 (register), 157,186,190 (refresh/changePassword). Intentional UX messages but INVALID_REFRESH_TOKEN/USER_NOT_FOUND disclose internal state.
- **H-3: JWT tokens in localStorage** — `public/admin-auth.js:4,54`, `public/utils/domSecurity.js:224,239,249`. XSS-stealable. Fix: HttpOnly cookie.
- **H-4: No server-side CSRF protection** — no csurf installed; no XSRF-TOKEN header in requests.
- **H-5: bcrypt@5.1.1 has HIGH CVEs** (node-tar, GHSA-34x7 etc.) — build-time only. Fix: bcrypt@6.0.0.
- **H-6: controllerController.js:110,135 — sendError(res, 400, error.message)** leaks service messages on 400 errors.
- **H-7: buildingController.js:87 — sendError(res, 400, error.message)** same pattern.

### MEDIUM
- **M-1: styleSrc: 'unsafe-inline' in production** — `src/server.js:30` — not gated by NODE_ENV.
- **M-2: GET /api/analytics/status has no rate limiting** — `src/routes/analyticsRoutes.js:311`.
- **M-3: Account lockout in-memory only** — resets on process restart; parallel instances bypass.
- **M-4: No SSL/TLS on DB connection** — `src/config/database.js` has no ssl config.
- **M-5: validateSearchString uses blocklist** — `src/utils/queryValidation.js:218` — bypassable via Unicode.
- **M-6: refreshToken skips issuer/audience check** — `src/services/authService.js:218` no options object.
- **M-7: 5min user cache allows delayed role revocation**.
- **M-8: No ID type validation in buildingController/metricController** — params.id as string without parseInt.
- **M-9: CORS default is localhost:8080** — `src/server.js:46` — wrong default for production.
- **M-10: DB port 5432 exposed in docker-compose.prod.yml:79** — PostgreSQL exposed to host.

### LOW
- **L-1: req.user contains email** — minor over-sharing.
- **L-2: crudLimiter not applied to GET /buildings, GET /controllers**.
- **L-3: No audit log for admin actions**.
- **L-4: Full SQL queries logged at debug level** — `src/config/database.js:44`.

## Architecture Notes (updated 2026-04-02)

- `src/routes/index.js`: Default-deny at lines 100-105; telemetry POST at line 78 BEFORE global middleware
- PUBLIC_ROUTES: POST /auth/login, /auth/register, /auth/refresh, POST /metrics/telemetry, GET /buildings-metrics, GET /, POST /webhooks/uk/building, POST /webhooks/uk/request
- Admin controllers split: `src/controllers/admin/` directory
- errorHandler sends `err.message` to client — any `next(createError(msg))` with error.message leaks
- createError in helpers.js:7 — just wraps message into Error with statusCode — no sanitization
- Dockerfile.prod uses non-root nodejs user (UID 1001) — good
- docker-compose.prod.yml uses env_file: .env.prod — correct pattern for production

## frontend-design Security Findings (2026-03-28)
- See previous audit notes — SSE token in URL (H-1), no CSRF (H-2), auth-guard JS-only (H-3)

## Dependency Notes
- No Redis — in-memory caching with DB fallback for token blacklist
- No csurf or any CSRF library installed
- express-validator used in buildingRoutes, controllerRoutes; NOT on auth routes
- bcrypt@5.1.1 has HIGH CVEs (node-tar) — build-time only; bcrypt@6.0.0 required to fix
