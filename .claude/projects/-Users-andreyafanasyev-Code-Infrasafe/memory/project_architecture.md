---
name: InfraSafe architecture overview
description: Three-layer backend architecture, frontend stack, database, Docker setup, key patterns
type: project
---

## Backend (Node.js 20+ / Express)
Three-layer: Controllers → Services → Models (direct SQL via `pg`, no ORM).

**How to apply:** Always follow this pattern when adding new features. Don't put business logic in controllers or SQL in services.

### Admin controllers (post-refactor)
Split into `src/controllers/admin/` with 9 files:
- adminBuildingController, adminControllerController, adminMetricController
- adminTransformerController, adminLineController
- adminColdWaterSourceController, adminHeatSourceController, adminWaterLineController
- adminGeneralController (bulk operations)
- index.js (re-exports all)

### Key patterns
- Circuit Breaker in analyticsService
- Multi-layer caching (cacheService.js)
- Alert cooldown (15min)
- SQL injection prevention via queryValidation.js whitelist
- Standardized responses via apiResponse.js
- Correlation ID middleware
- Rate limiting on all routes
- Graceful shutdown in server.js

## Frontend (vanilla JS)
- Leaflet.js maps with marker clustering, custom icons, multiple layers
- Chart.js for analytics
- DOMPurify for XSS protection
- Monolithic files: admin.js (~2300 lines), script.js (~1400 lines) — known tech debt

## Database (PostgreSQL 15+ with PostGIS)
- Schema: `database/init/01_init_database.sql`
- Seed: `database/init/02_seed_data.sql`
- Migrations: 003-010
- Core tables: users, buildings, controllers, metrics, alerts, alert_types
- Infrastructure: power_transformers, cold_water_sources, heat_sources, water_lines, water_suppliers

## Docker
- frontend (Nginx:8080/8088), app (Express:3000), postgres (PostGIS:5435)
- Dev: `docker-compose.dev.yml`, Prod: `docker-compose.prod.yml`
