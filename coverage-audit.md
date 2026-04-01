# Coverage Audit — InfraSafe

**Date:** 2026-04-01
**Language:** Node.js 18 / Express.js
**Test framework:** Jest 29.7
**Test command:** `npm test` (620 tests, unit+integration+security)
**Coverage command:** `npm run test:coverage`
**E2E (separate):** `npm run test:e2e` (57 tests, live Docker, NOT in coverage)
**Coverage config:** `collectCoverageFrom: ["src/**/*.js", "!src/index.js"]`, reporters: text + html + lcov

**Total: 82 source files, 36 test files, 32.9% statement coverage**

---

## Coverage by Directory (worst → best)

| Directory | Source Files | Tests | Stmts % | Branch % | Func % | Gap to 80% |
|-----------|-------------|-------|---------|----------|--------|------------|
| `src/clients` | 1 | 0 | 0% | 0% | 0% | +1 test file |
| `src/controllers/admin` | 10 | 0 | 16% | 8% | 10% | +8 test files |
| `src/models` | 16 | 4 (via mock) | 20% | 16% | 26% | +10 test files |
| `src/config` | 1 | 0 | 25% | 0% | 0% | +1 test file |
| `src/controllers` | 12 | 3 | 29% | 26% | 23% | +8 test files |
| `src/services` | 11 | 7 | 32% | 30% | 36% | +5 test files |
| `src/middleware` | 5 | 1 | 45% | 36% | 51% | +3 test files |
| `src/utils` | 6 | 3 | 47% | 35% | 51% | +2 test files |
| `src/routes` | 18 | 2 | 77% | 61% | 48% | +2 test files |
| `src` (root) | 2 | 0 | 65% | — | — | indirect |
| **TOTAL** | **82** | **20 direct** | **32.9%** | **26%** | **31.7%** | **~38 test files** |

---

## Files at 0% — No Test Execution At All

| File | Lines | Impact |
|------|-------|--------|
| `src/clients/ukApiClient.js` | 122 | UK API auth, retry, backoff — untested |
| `src/models/Alert.js` | ~80 | Core alert CRUD — untested |
| `src/models/AlertRequestMap.js` | 120 | UK mapping — only mocked, never executed |
| `src/models/AlertType.js` | ~40 | Alert type lookup — untested |

---

## Files Below 80% (51 of 82) — Sorted Worst → Best

| File | Stmts % | Directory |
|------|---------|-----------|
| `Alert.js` | 0% | models |
| `AlertRequestMap.js` | 0% | models |
| `AlertType.js` | 0% | models |
| `ukApiClient.js` | 0% | clients |
| `WaterLine.js` | 2% | models |
| `PowerTransformer.js` | 2% | models |
| `Line.js` | 2% | models |
| `analyticsController.js` | 3% | controllers |
| `Transformer.js` | 3% | models |
| `adminWaterLineController.js` | 3% | controllers/admin |
| `WaterSupplier.js` | 4% | models |
| `adminColdWaterSourceController.js` | 5% | controllers/admin |
| `adminHeatSourceController.js` | 5% | controllers/admin |
| `adminLineController.js` | 5% | controllers/admin |
| `adminTransformerController.js` | 5% | controllers/admin |
| `analyticsService.js` | 7% | services |
| `HeatSource.js` | 8% | models |
| `cacheService.js` | 11% | services |
| `controllerService.js` | 13% | services |
| `AlertRule.js` | 13% | models |
| `adminGeneralController.js` | 14% | controllers/admin |
| `transformerController.js` | 15% | controllers |
| `lineController.js` | 16% | controllers |
| `circuitBreaker.js` | 18% | utils |
| `powerAnalyticsController.js` | 21% | controllers |
| `alertService.js` | 21% | services |
| `controllerController.js` | 22% | controllers |
| `alertController.js` | 24% | controllers |
| `database.js` | 25% | config |
| `waterLineRoutes.js` | 25% | routes |
| `waterSupplierRoutes.js` | 26% | routes |
| `Metric.js` | 27% | models |
| `auth.js` | 28% | middleware |
| `metricController.js` | 29% | controllers |
| `Controller.js` | 32% | models |
| `authController.js` | 32% | controllers |
| `metricService.js` | 36% | services |
| `ukIntegrationService.js` | 39% | services |
| `helpers.js` | 40% | utils |
| `rateLimiter.js` | 44% | middleware |
| `buildingService.js` | 44% | services |
| `authService.js` | 47% | services |
| `adminControllerController.js` | 54% | controllers/admin |
| `adminMetricController.js` | 55% | controllers/admin |
| `buildingController.js` | 55% | controllers |
| `webhookRoutes.js` | 64% | routes |
| `server.js` | 65% | root |
| `queryValidation.js` | 68% | utils |
| `adminBuildingController.js` | 78% | controllers/admin |
| `integrationRoutes.js` | 79% | routes |
| `Building.js` | 80% | models |

---

## Files at 100% (no additional tests needed)

`adminService.js`, `buildingMetricsService.js`, `powerAnalyticsService.js`, `apiResponse.js`, `logger.js`, `correlationId.js`, `webhookValidation.js` (93%), `ColdWaterSource.js` (93%), 12 route files (100%)

---

## Files Without Any Matching Test (32 files)

### `src/clients/` (1 file, 0 tests)
- `ukApiClient.js`

### `src/controllers/admin/` (9 files, 0 direct tests)
- `adminColdWaterSourceController.js`
- `adminControllerController.js`
- `adminGeneralController.js`
- `adminHeatSourceController.js`
- `adminLineController.js`
- `adminMetricController.js`
- `adminTransformerController.js`
- `adminWaterLineController.js`
- `index.js`

### `src/controllers/` (5 files, no test match)
- `analyticsController.js`
- `buildingMetricsController.js`
- `lineController.js`
- `powerAnalyticsController.js`
- `transformerController.js`

### `src/middleware/` (2 files, no test match)
- `errorHandler.js`
- `validators.js`

### `src/models/` (3 files, no test match)
- `AlertRequestMap.js` (mocked in unit tests, never executed directly)
- `AlertType.js`
- `PowerTransformer.js`

### `src/routes/` (11 files, no dedicated test)
- `alertRoutes.js`, `analyticsRoutes.js`, `buildingMetricsRoutes.js`, `buildingRoutes.js`, `controllerRoutes.js`, `heatSourceRoutes.js`, `lineRoutes.js`, `powerAnalyticsRoutes.js`, `transformerRoutes.js`, `waterLineRoutes.js`, `waterSourceRoutes.js`, `waterSupplierRoutes.js`

### `src/utils/` (1 file)
- `queryValidation.js`

---

## Tests Needed to Reach 80%

| Priority | Target | Files | Current Avg | Tests to Add | Effort |
|----------|--------|-------|-------------|-------------|--------|
| **P1** | Services (business logic) | 9 | 24% | ~9 test files | 14h |
| **P2** | Models (SQL queries) | 10 | 16% | ~10 test files | 8h |
| **P3** | Controllers (HTTP handlers) | 16 | 20% | ~10 test files | 10h |
| **P4** | Infrastructure (middleware, utils) | 6 | 35% | ~5 test files | 3h |
| **P5** | Clients | 1 | 0% | 1 test file | 1h |
| | **TOTAL** | **42** | | **~35 test files** | **~36h** |

### P1 Services (highest impact)

| File | Current | What to Test |
|------|---------|-------------|
| `analyticsService.js` | 7% | CircuitBreaker, materialized view queries, cache, 25+ methods |
| `cacheService.js` | 11% | get/set/invalidate, TTL, pattern invalidation |
| `controllerService.js` | 13% | CRUD, status updates, search, metrics join |
| `alertService.js` | 21% | checkTransformerLoad, checkAll, cooldown, lifecycle |
| `metricService.js` | 36% | processTelemetry, aggregation, cleanup |
| `ukIntegrationService.js` | 39% | sendAlertToUK, handleRequestWebhook, cache |
| `buildingService.js` | 44% | cascadeDelete, search, geo queries |
| `authService.js` | 47% | token refresh, password change, lockout |

### P2 Models (direct SQL untested)

| File | Current | What to Test |
|------|---------|-------------|
| `Alert.js` | 0% | create, findActive, acknowledge, resolve |
| `AlertRequestMap.js` | 0% | create, findByAlertAndBuilding, markSent, areAllTerminal |
| `AlertType.js` | 0% | findAll, findById |
| `PowerTransformer.js` | 2% | CRUD, load analytics |
| `WaterLine.js` | 2% | CRUD |
| `Line.js` | 2% | CRUD |
| `Transformer.js` | 3% | CRUD, building relationships |
| `WaterSupplier.js` | 4% | CRUD |
| `HeatSource.js` | 8% | CRUD |
| `Metric.js` | 27% | CRUD, aggregation |
