# InfraSafe Project Knowledge

## Project Summary
InfraSafe Habitat IQ -- IoT monitoring platform for multi-apartment buildings in Tashkent, Uzbekistan.
Russian-language UI. Monitors electrical supply, water, heating, environmental conditions.

## Architecture
- **Monolith**: Node.js 20+ / Express.js, 3-layer (Controllers -> Services -> Models)
- **Database**: PostgreSQL 15+ with PostGIS (SRID 4326), no ORM -- raw SQL via `pg` Pool
- **Frontend**: Vanilla JS (Leaflet.js + Chart.js), no framework
- **Deployment**: Docker Compose -- Nginx (8080) -> Express (3000) -> PostgreSQL (5432/5435)
- **Entry point**: `src/index.js` -> `src/server.js`

## Key Files & Directories
- `src/routes/index.js` -- Main router, default-deny JWT middleware, PUBLIC_ROUTES allowlist
- `src/middleware/auth.js` -- authenticateJWT, isAdmin, optionalAuth, authenticateRefresh
- `src/services/authService.js` -- JWT tokens, blacklist (L1 memory + L2 DB with SHA-256), account lockout
- `src/services/alertService.js` -- Thresholds (transformer 85%/95%, water 2.0/1.5 bar), 15-min cooldown
- `src/services/analyticsService.js` -- 3 Circuit Breakers, MV fallback, peak load forecasting
- `src/services/cacheService.js` -- In-memory Map (TTL 1min, max 1000) + optional Redis
- `src/utils/circuitBreaker.js` -- Factory pattern: Analytics/Database/ExternalService presets
- `src/middleware/rateLimiter.js` -- 6 presets: analytics, admin, CRUD, telemetry, auth, register
- `database/init/01_init_database.sql` -- Full schema v2.4: 15+ tables, triggers, MV, indexes
- `generator/` -- Standalone ESM service for simulated metric generation (separate package.json)

## Authentication Pattern
- Default-deny: ALL routes require JWT except explicit PUBLIC_ROUTES allowlist (6 routes)
- GET on most resources is public; POST/PUT/DELETE/PATCH require Bearer token
- Exception: `/api/metrics/telemetry` POST is public (device ingestion)
- optionalAuth on `/api/buildings-metrics` for two-level access (anonymous vs authenticated)
- isAdmin guards on admin routes, alert check/thresholds, analytics mutations

## API Structure
15 sub-routers under `/api`: auth, buildings, controllers, metrics, transformers, lines,
cold-water-sources, heat-sources, water-lines, water-suppliers, analytics, alerts, admin,
buildings-metrics, power-analytics

## Database Schema
15+ tables: users, buildings, controllers, metrics, alerts, alert_types, power_transformers,
power_lines, cold_water_sources, heat_sources, water_lines, water_suppliers, token_blacklist
+ Materialized view `transformer_load_analytics` + PostGIS triggers

## Technical Debt (from code analysis)
- `public/admin.js` (~2300 lines) and `public/script.js` (~1400 lines) are monolithic
- Models execute SQL directly -- no repository pattern
- Some routes use console.error instead of Winston logger
- Code duplication across water-related route files
- Some power-analytics endpoints are TODO stubs

## Generated Docs
- `docs/TECHNICAL_SPECIFICATION.md` -- Full 12-section Russian-language ТЗ (created 2026-03-09)

See also: [architecture-details.md](./architecture-details.md) for deeper notes.
