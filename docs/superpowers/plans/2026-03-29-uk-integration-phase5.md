# UK Integration Phase 5: Map Layer

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Show UK request badges on the InfraSafe map and display request details in building popups.

**Architecture:** Two new endpoints in `integrationRoutes.js` proxy and cache UK API data (request counts per building and per-building request details). `ukIntegrationService.js` gets `getRequestCounts()` and `getBuildingRequests()` methods with a 60-second in-memory TTL cache, invalidated when request webhooks arrive. On the frontend, `map-layers-control.js` registers a new overlay layer with colored badge markers, and `script.js` injects a "ЗАЯВКИ" section into authenticated building popups.

**Tech Stack:** Node.js, pg, Leaflet.js, vanilla JS, Jest

**Spec:** `docs/superpowers/specs/2026-03-24-infrasafe-uk-integration-v2-design.md` (Section 7 + Section 12 Phase 5)

---

## File Structure

### Files to modify
| File | Change |
| --- | --- |
| `src/services/ukIntegrationService.js` | Add `_requestCountsCache`, `getRequestCounts()`, `getBuildingRequests()`, `invalidateRequestCache()` |
| `src/routes/integrationRoutes.js` | Add `GET /request-counts` and `GET /building-requests/:externalId` (auth, not admin) |
| `src/routes/index.js` | No changes needed (integration routes already mounted, JWT enforced by default-deny) |
| `public/map-layers-control.js` | Add `"📋 Заявки UK"` overlay, `loadUKRequests()`, `getUrgencyColor()` |
| `public/script.js` | Add "ЗАЯВКИ" section to authenticated building popup, fetch on `popupopen` |

### Files to create
| File | Responsibility |
| --- | --- |
| `tests/jest/unit/requestCounts.test.js` | Unit tests for `getRequestCounts`, `getBuildingRequests`, cache invalidation |
| `tests/jest/integration/requestCountsApi.test.js` | Integration tests for the two new endpoints |

---

## Task 1: Service — Request Counts with Cache

**Files:**
- Modify: `src/services/ukIntegrationService.js`
- Test: `tests/jest/unit/requestCounts.test.js`

### Step 1.1: Write failing tests (RED)

- [ ] **Create `tests/jest/unit/requestCounts.test.js`**

```javascript
// tests/jest/unit/requestCounts.test.js
'use strict';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/models/IntegrationConfig', () => ({
    isEnabled: jest.fn(),
    getAll: jest.fn(),
    get: jest.fn(),
    set: jest.fn()
}));
jest.mock('../../../src/models/IntegrationLog', () => ({
    create: jest.fn(), findByEventId: jest.fn(), updateStatus: jest.fn()
}));
jest.mock('../../../src/models/Building', () => ({
    findByExternalId: jest.fn(), createFromUK: jest.fn(),
    updateFromUK: jest.fn(), softDelete: jest.fn()
}));
jest.mock('../../../src/utils/webhookValidation', () => ({
    isValidBuildingEvent: jest.fn()
}));
// Mock ukApiClient (Phase 3) — unified auth model
jest.mock('../../../src/clients/ukApiClient', () => ({
    get: jest.fn(),
    createRequest: jest.fn(),
    authenticate: jest.fn()
}));

const ukApiClient = require('../../../src/clients/ukApiClient');
const IntegrationConfig = require('../../../src/models/IntegrationConfig');
const service = require('../../../src/services/ukIntegrationService');

describe('UKIntegrationService — Request Counts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        service.invalidateRequestCache();
    });

    describe('getRequestCounts()', () => {
        // ukApiClient.get() returns response.data (already unwrapped, see Phase 3)
        const mockCounts = {
            buildings: {
                'a1b2c3d4-e5f6-7890-abcd-ef1234567890': { total: 3, by_urgency: { 'Критическая': 1, 'Средняя': 2 } },
                'b2c3d4e5-f6a7-8901-bcde-f12345678901': { total: 1, by_urgency: { 'Срочная': 1 } }
            }
        };

        it('returns empty when integration is disabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(false);
            const result = await service.getRequestCounts();
            expect(result).toEqual({ buildings: {} });
            expect(ukApiClient.get).not.toHaveBeenCalled();
        });

        it('fetches from UK API and returns data', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            IntegrationConfig.get.mockResolvedValue('http://uk-api:8085/api/v2');
            ukApiClient.get.mockResolvedValue(mockCounts);

            const result = await service.getRequestCounts();
            expect(result.buildings['a1b2c3d4-e5f6-7890-abcd-ef1234567890'].total).toBe(3);
            expect(ukApiClient.get).toHaveBeenCalledTimes(1);
        });

        it('returns cached data within 60s TTL', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            IntegrationConfig.get.mockResolvedValue('http://uk-api:8085/api/v2');
            ukApiClient.get.mockResolvedValue(mockCounts);

            await service.getRequestCounts();
            await service.getRequestCounts();
            expect(ukApiClient.get).toHaveBeenCalledTimes(1); // Only one actual call
        });

        it('re-fetches after cache invalidation', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            IntegrationConfig.get.mockResolvedValue('http://uk-api:8085/api/v2');
            ukApiClient.get.mockResolvedValue(mockCounts);

            await service.getRequestCounts();
            service.invalidateRequestCache();
            await service.getRequestCounts();
            expect(ukApiClient.get).toHaveBeenCalledTimes(2);
        });

        it('returns empty on UK API error (graceful degradation)', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            IntegrationConfig.get.mockResolvedValue('http://uk-api:8085/api/v2');
            ukApiClient.get.mockRejectedValue(new Error('ECONNREFUSED'));

            const result = await service.getRequestCounts();
            expect(result).toEqual({ buildings: {} });
        });
    });

    describe('getBuildingRequests()', () => {
        const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        // ukApiClient.get() returns response.data (already unwrapped, see Phase 3 ukApiClient.get)
        const mockRequests = {
            requests: [
                { id: 1, title: 'Протечка', urgency: 'Критическая', status: 'В работе' },
                { id: 2, title: 'Свет', urgency: 'Обычная', status: 'Новая' }
            ]
        };

        it('returns empty when integration is disabled', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(false);
            const result = await service.getBuildingRequests(VALID_UUID);
            expect(result).toEqual({ requests: [] });
        });

        it('fetches requests for a building from UK API', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockResolvedValue(mockRequests);

            const result = await service.getBuildingRequests(VALID_UUID, 3);
            expect(result.requests).toHaveLength(2);
            // ukApiClient.get(path) — single string argument, returns response.data
            expect(ukApiClient.get).toHaveBeenCalledWith(
                expect.stringContaining(VALID_UUID)
            );
        });

        it('returns empty on UK API error (graceful degradation)', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            ukApiClient.get.mockRejectedValue(new Error('timeout'));

            const result = await service.getBuildingRequests(VALID_UUID);
            expect(result).toEqual({ requests: [] });
        });

        it('validates externalId format', async () => {
            const result = await service.getBuildingRequests('not-a-uuid!!!');
            expect(result).toEqual({ requests: [] });
        });
    });

    describe('invalidateRequestCache()', () => {
        it('clears the request counts cache', async () => {
            IntegrationConfig.isEnabled.mockResolvedValue(true);
            IntegrationConfig.get.mockResolvedValue('http://uk-api:8085/api/v2');
            ukApiClient.get.mockResolvedValue({ data: { buildings: {} } });

            await service.getRequestCounts();
            service.invalidateRequestCache();
            await service.getRequestCounts();
            expect(ukApiClient.get).toHaveBeenCalledTimes(2);
        });
    });
});
```

- [ ] **Run test -- expect FAIL (methods do not exist)**

```bash
npm run test:unit -- --testPathPattern=requestCounts
```

### Step 1.2: Implement service methods (GREEN)

- [ ] **Add cache + methods to `src/services/ukIntegrationService.js`**

Add a UUID format regex constant near the top (no new requires needed — uses `ukApiClient` via lazy require):

```javascript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

Add cache storage inside the class constructor or as instance properties at the top of the class body:

```javascript
constructor() {
    this._requestCountsCache = null;
    this._requestCountsCacheTime = 0;
    this._CACHE_TTL_MS = 60_000; // 60 seconds
}
```

Add three new methods to the `UKIntegrationService` class before the closing `}`:

```javascript
/**
 * Get the UK API base URL from integration_config.
 * Returns null if not configured.
 * @returns {Promise<string|null>}
 */
async _getUkApiUrl() {
    try {
        return await IntegrationConfig.get('uk_api_url', null);
    } catch (error) {
        logger.error(`ukIntegrationService._getUkApiUrl error: ${error.message}`);
        return null;
    }
}

/**
 * Get request counts per building (with 60s cache).
 * Uses ukApiClient from Phase 3 for authentication (JWT login, token caching).
 * Returns { buildings: { [externalId]: { total, by_urgency } } }
 * On ANY error, returns empty (graceful degradation). Never throws.
 * @returns {Promise<Object>}
 */
async getRequestCounts() {
    const EMPTY = { buildings: {} };
    try {
        const enabled = await this.isEnabled();
        if (!enabled) return EMPTY;

        const now = Date.now();
        if (this._requestCountsCache && (now - this._requestCountsCacheTime) < this._CACHE_TTL_MS) {
            return this._requestCountsCache;
        }

        // Use ukApiClient (Phase 3) for authenticated UK API calls
        const ukApiClient = require('../clients/ukApiClient');
        const response = await ukApiClient.get('/requests/counts-by-building');

        const result = response || EMPTY;
        this._requestCountsCache = result;
        this._requestCountsCacheTime = Date.now();
        return result;
    } catch (error) {
        logger.error(`ukIntegrationService.getRequestCounts error: ${error.message}`);
        return EMPTY;
    }
}

/**
 * Get active requests for a specific building.
 * Returns { requests: [...] } sorted by urgency.
 * On ANY error, returns empty. Never throws.
 * @param {string} externalId - Building external_id (UUID)
 * @param {number} [limit=3] - Max requests to return
 * @returns {Promise<Object>}
 */
async getBuildingRequests(externalId, limit = 3) {
    const EMPTY = { requests: [] };
    try {
        if (!externalId || !UUID_RE.test(externalId)) return EMPTY;

        const enabled = await this.isEnabled();
        if (!enabled) return EMPTY;

        const ukApiUrl = await this._getUkApiUrl();
        // Use ukApiClient (Phase 3) for authenticated UK API calls
        const ukApiClient = require('../clients/ukApiClient');
        const response = await ukApiClient.get(
            `/requests/by-building?external_id=${encodeURIComponent(externalId)}&limit=${limit}`
        );

        return response || EMPTY;
    } catch (error) {
        logger.error(`ukIntegrationService.getBuildingRequests error: ${error.message}`);
        return EMPTY;
    }
}

/**
 * Invalidate the request counts cache.
 * Called from webhook handler when request.created / request.status_changed events arrive.
 */
invalidateRequestCache() {
    this._requestCountsCache = null;
    this._requestCountsCacheTime = 0;
}
```

- [ ] **Run test -- expect PASS**

```bash
npm run test:unit -- --testPathPattern=requestCounts
```

### Step 1.3: Commit

```bash
git add src/services/ukIntegrationService.js tests/jest/unit/requestCounts.test.js
git commit -m "feat(integration): add getRequestCounts, getBuildingRequests with 60s cache

Adds UK API proxy methods to ukIntegrationService with in-memory 60s TTL
cache for request counts. Graceful degradation on UK unreachable. Cache
invalidated via invalidateRequestCache() (for webhook handler)."
```

---

## Task 2: API Endpoints -- Request Counts + Building Requests

**Files:**
- Modify: `src/routes/integrationRoutes.js`
- Test: `tests/jest/integration/requestCountsApi.test.js`

### Step 2.1: Write failing tests (RED)

- [ ] **Create `tests/jest/integration/requestCountsApi.test.js`**

```javascript
// tests/jest/integration/requestCountsApi.test.js
'use strict';

jest.mock('../../../src/services/ukIntegrationService', () => ({
    getRequestCounts: jest.fn(),
    getBuildingRequests: jest.fn(),
    isEnabled: jest.fn(),
    getConfig: jest.fn(),
    updateConfig: jest.fn(),
    logEvent: jest.fn(),
    isDuplicateEvent: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    handleBuildingWebhook: jest.fn(),
    invalidateRequestCache: jest.fn()
}));
jest.mock('../../../src/models/IntegrationLog', () => ({
    findAll: jest.fn(), findById: jest.fn(), updateStatus: jest.fn(), incrementRetry: jest.fn()
}));
jest.mock('../../../src/models/AlertRule', () => ({ findAll: jest.fn() }));
// Simulate default-deny JWT + isAdmin:
// - No auth header → 401
// - Auth header with user role → passes JWT, blocked by isAdmin on admin routes
// - Auth header with admin role → passes both
jest.mock('../../../src/middleware/auth', () => ({
    authenticateJWT: (req, res, next) => {
        if (!req.headers.authorization) {
            return res.status(401).json({ success: false, message: 'Access token is missing' });
        }
        // Simulate role from header for testing
        req.user = { id: 1, role: req.headers['x-test-role'] || 'user' };
        next();
    },
    isAdmin: (req, res, next) => {
        if (req.user && req.user.role === 'admin') return next();
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const { authenticateJWT } = require('../../../src/middleware/auth');
const integrationRoutes = require('../../../src/routes/integrationRoutes');
const ukIntegrationService = require('../../../src/services/ukIntegrationService');

// Build test app WITH default-deny JWT (matches real index.js behavior)
const app = express();
app.use(express.json());
app.use('/integration', authenticateJWT, integrationRoutes);

describe('Integration API -- Request Counts', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('GET /integration/request-counts', () => {
        it('returns request counts for regular (non-admin) authenticated user', async () => {
            ukIntegrationService.getRequestCounts.mockResolvedValue({
                buildings: { 'uuid-1': { total: 2 } }
            });

            // Authorization header present, no x-test-role → role: 'user'
            // Proves endpoint is accessible without admin role
            const res = await request(app)
                .get('/integration/request-counts')
                .set('Authorization', 'Bearer mock-user-token');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.buildings['uuid-1'].total).toBe(2);
        });

        it('returns 401 without auth token', async () => {
            const res = await request(app)
                .get('/integration/request-counts');

            expect(res.status).toBe(401);
        });

        it('returns 500 on service error', async () => {
            ukIntegrationService.getRequestCounts.mockRejectedValue(new Error('fail'));

            const res = await request(app)
                .get('/integration/request-counts')
                .set('Authorization', 'Bearer mock-user-token');

            expect(res.status).toBe(500);
        });
    });

    describe('GET /integration/building-requests/:externalId', () => {
        it('returns requests for a valid externalId (non-admin user)', async () => {
            ukIntegrationService.getBuildingRequests.mockResolvedValue({
                requests: [{ id: 1, title: 'Leak' }]
            });

            // Regular user with auth token (not admin)
            const res = await request(app)
                .get('/integration/building-requests/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
                .set('Authorization', 'Bearer mock-user-token');

            expect(res.status).toBe(200);
            expect(res.body.data.requests).toHaveLength(1);
        });

        it('returns 400 for invalid externalId format', async () => {
            const res = await request(app)
                .get('/integration/building-requests/not-a-uuid')
                .set('Authorization', 'Bearer mock-user-token');

            expect(res.status).toBe(400);
        });
    });

    describe('Auth boundary verification', () => {
        it('GET /integration/config returns 403 for non-admin authenticated user', async () => {
            // Auth header present, role: 'user' → isAdmin rejects
            const res = await request(app)
                .get('/integration/config')
                .set('Authorization', 'Bearer mock-user-token');

            expect(res.status).toBe(403);
        });

        it('GET /integration/config returns 401 without auth', async () => {
            const res = await request(app)
                .get('/integration/config');

            expect(res.status).toBe(401);
        });

        it('GET /integration/config returns 200 for admin', async () => {
            ukIntegrationService.getConfig.mockResolvedValue({ uk_integration_enabled: 'false' });

            const res = await request(app)
                .get('/integration/config')
                .set('Authorization', 'Bearer mock-admin-token')
                .set('x-test-role', 'admin');

            expect(res.status).toBe(200);
        });
    });
});
```

- [ ] **Run test -- expect FAIL (routes not defined)**

```bash
npm run test:integration -- --testPathPattern=requestCountsApi
```

### Step 2.2: Add routes to integrationRoutes.js (GREEN)

- [ ] **Modify `src/routes/integrationRoutes.js`**

The two new endpoints need JWT auth (already enforced by default-deny middleware in `index.js`) but NOT admin. The current `integrationRoutes.js` applies `router.use(isAdmin)` at the top (line 14), which blocks regular users. We need to mount these two routes BEFORE the `router.use(isAdmin)` middleware.

Add to `handlers` object (inside the existing `const handlers = { ... }`):

```javascript
/**
 * GET /request-counts
 * Returns UK request counts per building for map layer.
 * Requires JWT auth (not admin -- any authenticated user).
 */
async getRequestCounts(req, res) {
    try {
        const data = await ukIntegrationService.getRequestCounts();
        return res.json({ success: true, data });
    } catch (error) {
        logger.error(`integrationRoutes.getRequestCounts error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
},

/**
 * GET /building-requests/:externalId
 * Returns top requests for a building popup.
 * Requires JWT auth (not admin -- any authenticated user).
 */
async getBuildingRequests(req, res) {
    try {
        const { externalId } = req.params;
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!externalId || !UUID_RE.test(externalId)) {
            return res.status(400).json({ success: false, message: 'Invalid externalId format' });
        }
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 3, 1), 10);
        const data = await ukIntegrationService.getBuildingRequests(externalId, limit);
        return res.json({ success: true, data });
    } catch (error) {
        logger.error(`integrationRoutes.getBuildingRequests error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
},
```

Mount the two public-auth routes BEFORE `router.use(isAdmin)` (line 14). Move the `router.use(isAdmin)` line down, inserting the new routes before it:

```javascript
// --- Routes accessible to any authenticated user (JWT, no admin) ---
router.get('/request-counts', handlers.getRequestCounts);
router.get('/building-requests/:externalId', handlers.getBuildingRequests);

// All remaining integration routes require admin access
router.use(isAdmin);
```

This replaces the current standalone `router.use(isAdmin);` at line 14.

- [ ] **Run test -- expect PASS**

```bash
npm run test:integration -- --testPathPattern=requestCountsApi
```

- [ ] **Run full test suite to verify no regressions**

```bash
npm test
```

### Step 2.3: Commit

```bash
git add src/routes/integrationRoutes.js tests/jest/integration/requestCountsApi.test.js
git commit -m "feat(api): add GET /integration/request-counts and building-requests endpoints

Two new endpoints for map layer: request counts per building and
per-building request details. JWT-auth required (not admin-only).
Routes mounted before isAdmin middleware in integrationRoutes."
```

---

## Task 3: Ensure `external_id` in Buildings-Metrics Query

> **MUST be done before frontend Tasks 5-6.** Frontend map layer and popup depend on `external_id` from `/buildings-metrics`, but current query does not return it.

**Files:**
- Modify: `src/models/Building.js` or `src/services/buildingMetricsService.js`

- [ ] **Search for the buildings-metrics SQL query** and add `b.external_id` to SELECT. Look in `buildingMetricsService.js` or `Building.js` (method powering `GET /api/buildings-metrics`).

- [ ] **Commit:**

```bash
git add <modified-file>
git commit -m "fix(model): include external_id in buildings-metrics query for UK map layer"
```

---

## Task 4: Webhook Cache Invalidation

**Files:**
- Modify: `src/services/ukIntegrationService.js` (handleRequestWebhook or webhook handler)

### Step 3.1: Add cache invalidation to request webhook flow

- [ ] **In `ukIntegrationService.js`, wherever `handleRequestWebhook` processes `request.created` or `request.status_changed` events, add a call to `this.invalidateRequestCache()`**

If `handleRequestWebhook` does not yet exist (Phase 4 not completed), add a placeholder note:

```javascript
// TODO Phase 4: handleRequestWebhook should call this.invalidateRequestCache()
// after processing request.created and request.status_changed events.
```

For now, the cache will expire naturally after 60s. When Phase 4 lands, the webhook handler will actively invalidate it.

- [ ] **Verify tests still pass**

```bash
npm test
```

### Step 3.2: Commit

```bash
git add src/services/ukIntegrationService.js
git commit -m "chore(integration): add cache invalidation placeholder for request webhooks

Documents that handleRequestWebhook (Phase 4) should call
invalidateRequestCache() on request.created/status_changed events."
```

---

## Task 5: Frontend -- UK Requests Map Layer

**Files:**
- Modify: `public/map-layers-control.js`

### Step 4.1: Register the overlay layer

- [ ] **In `initializeLayers()`, add `"📋 Заявки UK"` to `this.overlays`**

After `"⚠️ Алерты": L.layerGroup()` (line 222), add:

```javascript
"📋 Заявки UK": L.layerGroup()
```

### Step 4.2: Add layer to infrastructure layers list

- [ ] **In `loadInfrastructureLayers()` (line 72-81), add `"📋 Заявки UK"` to the `infraLayers` array**

```javascript
"📋 Заявки UK"
```

- [ ] **In `clearInfrastructureLayers()` (line 86-88), add `"📋 Заявки UK"` to `infraLayerNames`**

### Step 4.3: Add layer loading to switch statements

- [ ] **In `loadLayerDataSilent()` switch (around line 161), add a case:**

```javascript
case "📋 Заявки UK":
    await this.loadUKRequests(headers);
    break;
```

- [ ] **In `loadLayerData()` switch (around line 479), add the same case:**

```javascript
case "📋 Заявки UK":
    await this.loadUKRequests(headers);
    break;
```

### Step 4.4: Implement `loadUKRequests()` method

- [ ] **Add `loadUKRequests()` and `getUrgencyColor()` methods to the class**

Add after `loadAlerts()` method (after line ~1458).

**SECURITY NOTE:** All dynamic content in popups MUST go through `this.escapeHTML()` for text and `this.sanitizePopup()` for HTML blocks, matching the existing XSS protection pattern used by `loadAlerts()` and other layer loaders.

```javascript
// Urgency-to-color mapping for UK request badges
getUrgencyColor(urgency) {
    const colors = {
        'Критическая': '#d32f2f',  // Red
        'Срочная': '#f57c00',       // Orange
        'Средняя': '#1976d2',       // Blue
        'Обычная': '#1976d2'        // Blue
    };
    return colors[urgency] || '#757575';
}

// Determine highest urgency from by_urgency counts object
_getTopUrgency(byUrgency) {
    const priority = ['Критическая', 'Срочная', 'Средняя', 'Обычная'];
    for (const u of priority) {
        if (byUrgency[u] && byUrgency[u] > 0) return u;
    }
    return 'Обычная';
}

// Load UK requests layer onto the map
async loadUKRequests(headers) {
    const response = await fetch(`${this.apiBaseUrl}/integration/request-counts`, { headers });
    if (response.status === 401) throw new Error('401 Unauthorized');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const layer = this.overlays["📋 Заявки UK"];
    layer.clearLayers();

    const counts = (data.data && data.data.buildings) || {};

    // Need building coordinates -- fetch buildings-metrics
    const buildingsResponse = await fetch(`${this.apiBaseUrl}/buildings-metrics`, { headers });
    const buildingsData = await buildingsResponse.json();
    const buildingsArr = buildingsData.data || [];

    // Map by external_id for coordinate lookup
    const buildingsByExtId = {};
    buildingsArr.forEach(b => {
        if (b.external_id) {
            buildingsByExtId[b.external_id] = b;
        }
    });

    let displayed = 0;

    for (const [externalId, info] of Object.entries(counts)) {
        const building = buildingsByExtId[externalId];
        if (!building || !building.latitude || !building.longitude) continue;

        const lat = parseFloat(building.latitude);
        const lng = parseFloat(building.longitude);
        const total = info.total || 0;
        if (total === 0) continue;

        const topUrgency = this._getTopUrgency(info.by_urgency || {});
        const color = this.getUrgencyColor(topUrgency);

        const marker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'uk-request-marker',
                html: `<div style="background: ${color}; color: white; border-radius: 50%;
                    width: 30px; height: 30px; display: flex; align-items: center;
                    justify-content: center; font-weight: bold; font-size: 13px;
                    border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">
                    ${total}</div>`,
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            })
        });

        // XSS: all dynamic values go through escapeHTML
        const buildingName = this.escapeHTML(building.building_name || 'N/A');
        const urgencyLabel = this.escapeHTML(topUrgency);
        const safeExternalId = this.escapeHTML(externalId);

        const popupHtml = `
            <div style="min-width: 220px;">
                <h4 style="margin: 0 0 8px 0;">📋 Заявки UK</h4>
                <p style="margin: 4px 0;"><strong>Здание:</strong> ${buildingName}</p>
                <p style="margin: 4px 0;"><strong>Активных заявок:</strong> ${total}</p>
                <p style="margin: 4px 0;"><strong>Макс. срочность:</strong>
                    <span style="color: ${color}; font-weight: bold;">${urgencyLabel}</span>
                </p>
                <div class="uk-requests-detail"
                     data-external-id="${safeExternalId}"
                     style="margin: 8px 0 0 0; font-size: 0.85em; color: #607d8b;">
                    Загрузка деталей...
                </div>
            </div>
        `;

        // Sanitize popup through DOMPurify wrapper
        const sanitizedPopup = this.sanitizePopup(popupHtml);
        marker.bindPopup(sanitizedPopup);
        marker.bindTooltip(`📋 ${total} заявок (${urgencyLabel})`, {
            permanent: false,
            direction: 'top'
        });

        // Lazy-load request details on popup open
        // Use marker._popup to scope querySelector to THIS popup only
        marker.on('popupopen', async () => {
            const popup = marker.getPopup();
            const container = popup && popup.getElement();
            if (!container) return;
            const detailEl = container.querySelector('.uk-requests-detail');
            if (!detailEl) return;
            const extId = detailEl.dataset.externalId;
            try {
                const resp = await fetch(
                    `${this.apiBaseUrl}/integration/building-requests/${encodeURIComponent(extId)}?limit=3`,
                    { headers }
                );
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const detailData = await resp.json();
                const requests = (detailData.data && detailData.data.requests) || [];
                if (requests.length === 0) {
                    detailEl.textContent = 'Нет активных заявок';
                    return;
                }
                // Build detail list via DOM API (safe from XSS)
                detailEl.textContent = '';
                const strong = document.createElement('strong');
                strong.textContent = 'Последние заявки:';
                detailEl.appendChild(strong);
                const ul = document.createElement('ul');
                ul.style.cssText = 'margin: 4px 0; padding-left: 16px;';
                requests.forEach(r => {
                    const li = document.createElement('li');
                    li.style.cssText = 'margin: 2px 0;';
                    const titleSpan = document.createTextNode((r.title || 'Без названия') + ' — ');
                    const urgSpan = document.createElement('span');
                    urgSpan.style.color = this.getUrgencyColor(r.urgency);
                    urgSpan.style.fontWeight = 'bold';
                    urgSpan.textContent = r.urgency || '';
                    li.appendChild(titleSpan);
                    li.appendChild(urgSpan);
                    ul.appendChild(li);
                });
                detailEl.appendChild(ul);
            } catch (err) {
                detailEl.textContent = 'Не удалось загрузить детали';
            }
        });

        layer.addLayer(marker);
        displayed++;
    }

    this.updateLayerCount("📋 Заявки UK", displayed);
}
```

### Step 4.5: Verify layer appears in panel

- [ ] **Manual verification**: Start dev environment, log in, open layers panel. The "📋 Заявки UK" checkbox should appear in the overlay list. When checked (with UK integration enabled and UK API reachable), badge markers should appear on buildings.

```bash
docker compose -f docker-compose.dev.yml up --build
```

### Step 4.6: Commit

```bash
git add public/map-layers-control.js
git commit -m "feat(map): add UK requests badge layer with urgency-colored markers

New overlay layer shows colored badge markers on buildings with active
UK requests. Blue = Обычная/Средняя, Orange = Срочная, Red = Критическая.
Popup shows request count, top urgency, and lazy-loads top 3 requests
via safe DOM API (no raw HTML injection)."
```

---

## Task 6: Frontend -- Building Popup "ЗАЯВКИ" Section

**Files:**
- Modify: `public/script.js`

### Step 5.1: Add ЗАЯВКИ section to authenticated popup

- [ ] **In `public/script.js`, find the authenticated building popup template** (around line 1908, the `popupContent = \`...` block that builds the table with electricity/water/leak rows)

After the closing `</table>` tag (around line 1970, before the closing `</div>`), add:

```javascript
// UK Requests section placeholder (loaded dynamically on popup open)
${item.external_id ? `
<div id="uk-requests-section-${item.building_id}"
     data-external-id="${escapeHTML(item.external_id)}"
     style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #e0e0e0;
            font-size: 0.9em; color: #607d8b;">
    📋 Загрузка заявок UK...
</div>` : ''}
```

### Step 5.2: Load ЗАЯВКИ data on popup open

- [ ] **In the `marker.on('popupopen', async () => { ... })` handler** (around line 1989), after the existing power data loading code, add UK requests loading using safe DOM API:

```javascript
// Load UK requests if building has external_id
const ukSection = document.getElementById(`uk-requests-section-${item.building_id}`);
if (ukSection) {
    const extId = ukSection.dataset.externalId;
    try {
        const ukToken = (window.DOMSecurity && window.DOMSecurity.getValidToken)
            ? window.DOMSecurity.getValidToken()
            : localStorage.getItem('admin_token');
        const ukResp = await fetch(
            `${BACKEND_URL}/integration/building-requests/${encodeURIComponent(extId)}?limit=3`,
            { headers: { 'Authorization': `Bearer ${ukToken}`, 'Content-Type': 'application/json' } }
        );
        if (!ukResp.ok) throw new Error(`HTTP ${ukResp.status}`);
        const ukData = await ukResp.json();
        const requests = (ukData.data && ukData.data.requests) || [];
        if (requests.length === 0) {
            ukSection.textContent = '📋 Нет активных заявок UK';
        } else {
            // Build UI via safe DOM API (no raw HTML assignment)
            ukSection.textContent = '';
            const heading = document.createElement('strong');
            heading.textContent = '📋 ЗАЯВКИ UK:';
            ukSection.appendChild(heading);
            const ul = document.createElement('ul');
            ul.style.cssText = 'margin:4px 0;padding-left:16px;list-style:disc;';
            const urgencyColors = {
                'Критическая': '#d32f2f', 'Срочная': '#f57c00',
                'Средняя': '#1976d2', 'Обычная': '#1976d2'
            };
            requests.forEach(r => {
                const li = document.createElement('li');
                li.style.cssText = 'margin:2px 0;';
                li.appendChild(document.createTextNode((r.title || 'Без названия') + ' — '));
                const urgSpan = document.createElement('span');
                urgSpan.style.color = urgencyColors[r.urgency] || '#757575';
                urgSpan.style.fontWeight = 'bold';
                urgSpan.textContent = r.urgency || '';
                li.appendChild(urgSpan);
                ul.appendChild(li);
            });
            ukSection.appendChild(ul);
        }
    } catch (err) {
        ukSection.textContent = '📋 Заявки UK недоступны';
    }
}
```

### Step 5.3: Ensure `external_id` is available in building data

- [ ] **Verify that the `/api/buildings-metrics` endpoint returns `external_id`**. Check `src/models/Building.js` or the SQL query in `buildingMetricsRoutes.js`. If `external_id` is not included in the SELECT, add it.

If not present, add `b.external_id` to the SELECT column list in the buildings-metrics query.

### Step 5.4: Manual verification

- [ ] Start dev environment, log in, click a building marker that has `external_id` set. The popup should show "📋 Загрузка заявок UK..." which resolves to either request list or "Нет активных заявок UK".

### Step 5.5: Commit

```bash
git add public/script.js
git commit -m "feat(map): add ЗАЯВКИ UK section to building popup

Authenticated building popups now show a UK requests section (top 3 by
urgency) for buildings with external_id. Data loaded dynamically on
popup open via safe DOM API. Graceful fallback if UK unavailable."
```

---

## Task 7: Full Regression Test

- [ ] **Run complete test suite**

```bash
npm test
```

Expected: All 175+ tests pass, plus the new tests from Tasks 1-2.

- [ ] **Run lint**

```bash
npm run lint
```

- [ ] **Manual E2E check with Docker**

```bash
docker compose -f docker-compose.dev.yml up --build
```

Verify:
1. Log in as admin
2. Open layers panel
3. Toggle "📋 Заявки UK" checkbox
4. Badge markers appear on buildings with active requests (if UK API configured)
5. Badge color matches urgency (Blue/Orange/Red)
6. Click a building marker on the main layer
7. Popup shows "ЗАЯВКИ UK" section with request list or "Нет активных заявок"
8. Without UK integration enabled: layer shows 0 count, popup shows no section

---

## Summary

| Task | Files | Type |
| --- | --- | --- |
| 1 | `ukIntegrationService.js`, `requestCounts.test.js` | Backend service + cache |
| 2 | `integrationRoutes.js`, `requestCountsApi.test.js` | API endpoints |
| 3 | `ukIntegrationService.js` | Webhook cache invalidation hook |
| 4 | `map-layers-control.js` | Map layer with badge markers |
| 5 | `script.js` | Building popup ЗАЯВКИ section |
| 6 | Building model/query | Include `external_id` in metrics query |
| 7 | -- | Regression testing |

**Total new tests:** ~12 unit + ~3 integration
**Estimated effort:** 4-6 hours
**Dependencies:** Phase 1 complete (integration foundation), Phase 2 complete (building sync with `external_id`), **Phase 3 required** (provides `ukApiClient.js` with JWT auth used by `getRequestCounts()`/`getBuildingRequests()`).
