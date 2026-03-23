# InfraSafe Architecture Details

## Circuit Breaker Configuration
| Profile          | Failure Threshold | Reset Timeout | Use Case                  |
|------------------|-------------------|---------------|---------------------------|
| Analytics        | 3 failures        | 30s           | analyticsService          |
| Database         | 5 failures        | 60s           | DB operations             |
| ExternalService  | 2 failures        | 120s          | External API calls        |

States: CLOSED -> OPEN (after threshold) -> HALF_OPEN (after timeout) -> CLOSED (on success)

## Rate Limiter Presets
| Preset     | Window  | Max Requests | Purpose                  |
|------------|---------|-------------|--------------------------|
| analytics  | 1 min   | 30          | Analytics endpoints      |
| admin      | 1 min   | 20          | Admin operations         |
| CRUD       | 1 min   | 60          | Standard CRUD            |
| telemetry  | 1 min   | 120         | Device data ingestion    |
| auth       | 15 min  | 10          | Login attempts           |
| register   | 1 hour  | 5           | New registrations        |

## JWT Configuration
- Access token: 24h expiry, issuer: 'infrasafe-api', audience: 'infrasafe-client'
- Refresh token: 7d expiry
- Blacklist: L1 in-memory Set + L2 DB table (SHA-256 hashed tokens)
- Account lockout: 5 failed attempts -> 15 min lock

## Alert Thresholds
- Transformer overload: WARNING at 85%, CRITICAL at 95%
- Water pressure: WARNING at 2.0 bar, CRITICAL at 1.5 bar
- Cooldown: 15 minutes between identical alerts (same type + source)

## Cache Strategy
- L1: In-memory Map, TTL 60s, max 1000 entries, periodic cleanup
- L2: Optional Redis (not yet deployed in production Docker config)
- Pattern invalidation: supports wildcard cache key clearing

## Database Connection Pool
- max: 20, min: 2, idleTimeoutMillis: 30000
- PostgreSQL 15+ with PostGIS extension

## Frontend Architecture
- Leaflet.js map with marker clustering (MarkerClusterGroup)
- Multiple map layers: buildings, transformers, cold water sources, heat sources, water lines, power lines
- Layer toggle control with auth-aware data loading (hides admin layers for anonymous)
- Chart.js for analytics dashboards
- DOMPurify for XSS protection (server + client)
- Theme toggle (dark/light) persisted in localStorage

## Test Structure
- Jest test suites: unit, integration, security
- Integration test for default-deny verifies all routes require JWT except PUBLIC_ROUTES
- Unified test runner shell script for end-to-end testing against running API
- Test data: admin/admin123, testuser/TestPass123, 17 buildings in Tashkent

## Generator Service
- Standalone ESM service in `generator/` directory
- Separate package.json with axios, node-cron, express
- Cron-based metric generation to /api/metrics/telemetry
- Run via docker-compose.generator.yml
