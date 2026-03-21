# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfraSafe is a digital IoT monitoring platform for multi-apartment buildings (Russian-language UI). It collects data from intelligent controllers (industrial PCs with sensors), processes metrics, and provides real-time visualization through interactive Leaflet maps and analytics dashboards. The system monitors electrical supply, water systems, heating, and environmental conditions with automated alerting.

**Tech stack**: Node.js 20+ / Express.js backend, PostgreSQL 15+ with PostGIS, vanilla JavaScript frontend (Leaflet.js + Chart.js), Docker Compose orchestration, Nginx reverse proxy.

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
# Migrations: database/migrations/003-010
```

## Architecture

### Three-Layer Backend (src/)
1. **Controllers** (`src/controllers/`) - HTTP handling, validation, response formatting
2. **Services** (`src/services/`) - Business logic, caching, circuit breaker
3. **Models** (`src/models/`) - Direct SQL queries via `pg` Pool (no ORM)

### Request Flow
`Nginx (8080)` -> `/api/*` proxied to -> `Express (3000)` -> `src/routes/index.js` (main router) -> per-entity route files -> controllers -> services -> models -> PostgreSQL

### Authentication
- **Default-deny JWT** middleware in `src/routes/index.js` — all routes require auth by default
- Public routes allowlist: POST `/auth/login`, POST `/auth/register`, POST `/auth/refresh`, POST `/metrics/telemetry`, GET `/buildings-metrics`, GET `/`
- `optionalAuth` on `/buildings-metrics` — anonymous gets truncated data, authenticated gets full metrics
- `isAdmin` guards on: admin routes, analytics transformer CRUD, power-analytics refresh, controller status updates
- JWT with refresh tokens, blacklist, and account locking (`src/middleware/auth.js`)

### Key Patterns
- **Circuit Breaker**: `src/utils/circuitBreaker.js`, used in `analyticsService.js` for fault tolerance
- **Multi-layer Caching**: `src/services/cacheService.js` (in-memory, Redis-ready)
- **Alert Cooldown**: 15-minute cooldown between identical alerts in `src/services/alertService.js`
- **SQL Injection Prevention**: Whitelist validation via `src/utils/queryValidation.js` for sort/order params
- **Standardized Responses**: `src/utils/apiResponse.js` — `sendError`, `sendNotFound`, `sendCreated`, `sendSuccess`
- **Correlation ID**: `src/middleware/correlationId.js` — request tracing via `x-correlation-id` header
- **Rate Limiting**: `src/middleware/rateLimiter.js` — brute-force and DDoS protection
- **Graceful Shutdown**: SIGTERM/SIGINT handling in `src/server.js` — close HTTP server + DB pool
- **Health Check**: `GET /health` — DB ping, returns `{ status: 'healthy' }` or 503

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

### Frontend
- **Vanilla JS** (no framework), HTML files at project root (`index.html`, `admin.html`, `about.html`, `contacts.html`)
- **Public assets** in `public/` - `script.js` (map interface), `admin.js` (admin panel), `admin-auth.js`, `map-layers-control.js`
- **Leaflet.js** with marker clustering, multiple layers (buildings, transformers, water/heat sources), custom icons
- **Chart.js** for analytics visualization
- **DOMPurify** for XSS protection (`public/utils/domSecurity.js`)

### Database
- **PostgreSQL 15+ with PostGIS** extension (SRID 4326 for coordinates)
- **Core tables**: `users`, `buildings`, `controllers`, `metrics`, `alerts`, `alert_types`
- **Infrastructure tables**: `power_transformers`, `cold_water_sources`, `heat_sources`, `water_lines`, `water_suppliers`
- **Materialized views** for transformer load analytics
- Schema defined in `database/init/01_init_database.sql`

### Generator
`generator/` contains a standalone service (separate `package.json`) for generating simulated metric data, run via `docker-compose.generator.yml`.

## Environment Variables
```bash
# Required
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
JWT_SECRET, JWT_REFRESH_SECRET

# Optional
NODE_ENV=development|production
PORT=3000
CORS_ORIGINS=http://localhost:8080
LOG_LEVEL=info|debug|warn|error
LOG_FILE=logs/app.log
```

## Docker Services
- **frontend**: Nginx on port 8080 (static files + API proxy)
- **app**: Node.js Express on port 3000
- **postgres**: PostGIS on port 5435 (mapped from container 5432)

## Test Data
- **Admin**: admin / admin123
- **Test user**: testuser / TestPass123
- **17 buildings** in Tashkent with coordinates, **34 metric records**

## Test Suite
- **175 tests** across **16 test suites**, all passing
- Unit tests: `tests/jest/unit/` (10 files — services, controllers, models, middleware)
- Integration tests: `tests/jest/integration/` (API, default-deny auth)
- Security tests: `tests/jest/security/` (SQL injection, XSS, general security)

## Known Architecture Issues
- `public/admin.js` (~2,300 lines) and `public/script.js` (~1,400 lines) are monolithic
- Models execute SQL directly (no repository pattern), making unit testing harder
- Some backend code uses `console.error` instead of Winston logger
- Code duplication across water-related route files
