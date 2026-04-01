# Coverage Audit — InfraSafe

**Date:** 2026-04-01
**Framework:** Jest 29 / Node.js 18 / Express.js
**Command:** `npm run test:coverage` (620 tests) + `npm run test:e2e` (57 tests, not in coverage)
**Total:** 82 source files, 36 test files, **32.9% statement coverage**

---

## Summary by Directory (worst to best)

| Directory | Source Files | Stmts % | Branch % | Func % | Status |
|-----------|-------------|---------|----------|--------|--------|
| `src/clients` | 1 | 0% | 0% | 0% | NO TESTS |
| `src/controllers/admin` | 10 | 16% | 8% | 10% | CRITICAL |
| `src/models` | 16 | 20% | 16% | 26% | CRITICAL |
| `src/controllers` | 12 | 29% | 26% | 23% | LOW |
| `src/services` | 11 | 32% | 30% | 36% | LOW |
| `src/config` | 1 | 25% | 0% | 0% | LOW |
| `src/middleware` | 5 | 45% | 36% | 51% | MEDIUM |
| `src/utils` | 6 | 47% | 35% | 51% | MEDIUM |
| `src/routes` | 18 | 77% | 61% | 48% | OK |
| **TOTAL** | **82** | **32.9%** | **26%** | **31.7%** | **LOW** |

---

## Files at 0% Coverage (no test execution at all)

| File | Lines | Priority |
|------|-------|----------|
| `src/clients/ukApiClient.js` | 122 | HIGH — UK API client, retry logic, auth |
| `src/models/Alert.js` | ~80 | HIGH — core alert CRUD |
| `src/models/AlertRequestMap.js` | 120 | MEDIUM — tested via mock only |
| `src/models/AlertType.js` | ~40 | LOW |

---

## Files Below 20% Coverage (critical gaps)

| File | Stmts % | Lines | What's Missing |
|------|---------|-------|----------------|
| `src/models/WaterLine.js` | 2% | ~100 | All CRUD operations |
| `src/models/PowerTransformer.js` | 2% | ~90 | All CRUD operations |
| `src/models/Line.js` | 2% | ~90 | All CRUD operations |
| `src/controllers/analyticsController.js` | 3% | ~200 | All handler functions |
| `src/models/Transformer.js` | 3% | ~100 | All CRUD operations |
| `src/controllers/admin/*` (8 files) | 3-15% | ~800 total | Admin CRUD handlers |
| `src/models/WaterSupplier.js` | 4% | ~90 | All CRUD operations |
| `src/models/HeatSource.js` | 8% | ~80 | All CRUD operations |
| `src/services/analyticsService.js` | 7% | 380 | CircuitBreaker, cache, 25+ methods |
| `src/services/cacheService.js` | 11% | 300 | Redis-ready cache, all operations |
| `src/services/controllerService.js` | 13% | 400 | CRUD + status management |
| `src/models/AlertRule.js` | 13% | 58 | findByTypeAndSeverity tested via mock |
| `src/controllers/transformerController.js` | 15% | ~100 | CRUD handlers |
| `src/controllers/lineController.js` | 16% | ~100 | CRUD handlers |
| `src/utils/circuitBreaker.js` | 18% | 200 | State machine, fallback logic |

---

## Files 20-50% Coverage (significant gaps)

| File | Stmts % | What's Missing |
|------|---------|----------------|
| `src/services/alertService.js` | 21% | Alert lifecycle (checkTransformerLoad, checkAll, cooldown) |
| `src/controllers/controllerController.js` | 22% | Most CRUD handlers |
| `src/controllers/alertController.js` | 24% | Create, acknowledge, resolve handlers |
| `src/models/Metric.js` | 27% | Most CRUD operations |
| `src/middleware/auth.js` | 28% | Token validation, blacklist, account locking |
| `src/models/Controller.js` | 32% | Status management, search |
| `src/controllers/authController.js` | 32% | Profile, password change |
| `src/services/metricService.js` | 36% | Telemetry processing, aggregation |
| `src/services/ukIntegrationService.js` | 39% | sendAlertToUK, handleRequestWebhook, getRequestCounts |
| `src/middleware/rateLimiter.js` | 44% | Rate limiter creation, cleanup |
| `src/services/buildingService.js` | 44% | CRUD, cascade delete, search |
| `src/services/authService.js` | 47% | Token refresh, password change, lockout |

---

## Files at 100% Coverage

| File | Note |
|------|------|
| `src/services/adminService.js` | Full CRUD tested |
| `src/services/buildingMetricsService.js` | Map data query |
| `src/services/powerAnalyticsService.js` | Analytics views |
| `src/utils/apiResponse.js` | Response helpers |
| `src/utils/logger.js` | Winston config |
| `src/middleware/correlationId.js` | Request tracing |
| All route files (12/18) | Route definitions |

---

## Tests Needed to Reach 80% Coverage

### Priority 1 — Core Business Logic (~15 test files needed)

| Target File | Current | Tests to Add | Estimated Effort |
|-------------|---------|-------------|-----------------|
| `alertService.js` | 21% | Alert lifecycle, checkTransformerLoad, cooldown | 2h |
| `analyticsService.js` | 7% | CircuitBreaker integration, cache, 10+ methods | 3h |
| `controllerService.js` | 13% | CRUD, status updates, search | 1.5h |
| `buildingService.js` | 44% | Cascade delete, search, geo queries | 1h |
| `metricService.js` | 36% | Telemetry processing, aggregation | 1.5h |
| `cacheService.js` | 11% | Get/set/invalidate, TTL, patterns | 1h |
| `authService.js` | 47% | Token refresh, password, lockout | 1h |
| `ukIntegrationService.js` | 39% | sendAlertToUK, handleRequestWebhook, cache | 2h |
| `ukApiClient.js` | 0% | Auth, retry, get, token refresh | 1h |

### Priority 2 — Models (~10 test files needed)

| Target File | Current | Tests to Add |
|-------------|---------|-------------|
| `Alert.js` | 0% | CRUD, status transitions |
| `Building.js` | 80% | Edge cases only |
| `Controller.js` | 32% | Status, search, metrics join |
| `Metric.js` | 27% | CRUD, aggregation queries |
| `PowerTransformer.js` | 2% | CRUD, load analytics |
| `Transformer.js` | 3% | CRUD, building relationships |
| `Line.js` | 2% | CRUD |
| `WaterLine.js` | 2% | CRUD |
| `WaterSupplier.js` | 4% | CRUD |
| `HeatSource.js` | 8% | CRUD |

### Priority 3 — Controllers (~8 test files needed)

| Target File | Current | Tests to Add |
|-------------|---------|-------------|
| `alertController.js` | 24% | All CRUD + acknowledge/resolve |
| `analyticsController.js` | 3% | All analytics endpoints |
| `controllerController.js` | 22% | CRUD + status |
| `authController.js` | 32% | Profile, password change |
| `metricController.js` | 29% | Telemetry, CRUD |
| `admin/*` (8 files) | 3-15% | Admin CRUD handlers |

### Priority 4 — Infrastructure

| Target File | Current | Tests to Add |
|-------------|---------|-------------|
| `circuitBreaker.js` | 18% | State transitions, fallback, recovery |
| `auth.js` (middleware) | 28% | Token validation, blacklist |
| `rateLimiter.js` | 44% | Limiter factory, window tracking |

---

## Estimated Effort to Reach 80%

| Priority | Files | Current Avg | Effort |
|----------|-------|------------|--------|
| P1 Services | 9 | 24% | ~14h |
| P2 Models | 10 | 16% | ~8h |
| P3 Controllers | 8+8 | 20% | ~10h |
| P4 Infrastructure | 3 | 30% | ~3h |
| **Total** | **38** | — | **~35h** |

Current: 32.9% → Target 80% requires ~35 additional test files / ~2,500 lines of tests.
