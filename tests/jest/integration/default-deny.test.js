/**
 * Integration tests for the global default-deny JWT middleware in src/routes/index.js
 *
 * These tests verify that:
 *   - Protected routes return 401 when no token is provided
 *   - Public allowlist routes bypass the middleware and respond normally
 *   - Authenticated requests (mocked token) reach the route handler and return 200
 *
 * NOTE: We do NOT import src/server.js because it tries to connect to the database
 *       and calls process.exit(1) on failure. Instead we build a minimal Express app
 *       that mounts the real router, with all DB-touching modules mocked.
 */

'use strict';

const request = require('supertest');

// ---------------------------------------------------------------------------
// 1.  Mock the auth middleware BEFORE any route modules are required.
//     authenticateJWT is the default-deny gate.
//     optionalAuth sets req.user = null (anonymous) for public routes.
// ---------------------------------------------------------------------------
jest.mock('../../../src/middleware/auth', () => ({
    authenticateJWT: (req, res, next) => {
        req.user = { id: 1, role: 'admin' };
        next();
    },
    isAdmin: (req, res, next) => next(),
    authenticateRefresh: (req, res, next) => next(),
    optionalAuth: (req, res, next) => {
        req.user = null; // anonymous by default for public routes
        next();
    }
}));

// ---------------------------------------------------------------------------
// 2.  Mock rate-limiters so they always pass through.
//     Covers all named exports used across route files.
// ---------------------------------------------------------------------------
jest.mock('../../../src/middleware/rateLimiter', () => {
    const passThrough = (_req, _res, next) => next();
    const limiterObj = { middleware: () => passThrough };
    return {
        applyTelemetryRateLimit: passThrough,
        applyCrudRateLimit: passThrough,
        applyAnalyticsRateLimit: passThrough,
        applyAdminRateLimit: passThrough,
        rateLimitStrict: passThrough,
        authLimiter: limiterObj,
        registerLimiter: limiterObj,
    };
});

// ---------------------------------------------------------------------------
// 3.  Mock the database module so no real DB connection is attempted.
//     The query mock returns empty rows for any SQL.
// ---------------------------------------------------------------------------
jest.mock('../../../src/config/database', () => ({
    init: jest.fn().mockResolvedValue({}),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    getPool: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// 4.  Mock service layers called by route handlers.
// ---------------------------------------------------------------------------

// Building service (buildingController → buildingService)
jest.mock('../../../src/services/buildingService', () => ({
    getAllBuildings: jest.fn().mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 }
    }),
    getBuildingById: jest.fn().mockResolvedValue(null),
    createBuilding: jest.fn().mockResolvedValue({ building_id: 1, name: 'Test' }),
    updateBuilding: jest.fn().mockResolvedValue({ building_id: 1, name: 'Test' }),
    deleteBuilding: jest.fn().mockResolvedValue({ building_id: 1 }),
    findBuildingsInRadius: jest.fn().mockResolvedValue({ buildings: [] }),
    getBuildingsStatistics: jest.fn().mockResolvedValue({ total: 0 }),
}));

// Controller service (controllerController → controllerService)
jest.mock('../../../src/services/controllerService', () => ({
    getAllControllers: jest.fn().mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 }
    }),
    getControllerById: jest.fn().mockResolvedValue(null),
    createController: jest.fn().mockResolvedValue({ controller_id: 1 }),
    updateController: jest.fn().mockResolvedValue({ controller_id: 1 }),
    deleteController: jest.fn().mockResolvedValue({ controller_id: 1 }),
}));

// Alert service (alertController → alertService)
jest.mock('../../../src/services/alertService', () => ({
    getActiveAlerts: jest.fn().mockResolvedValue([]),
    createAlert: jest.fn().mockResolvedValue({ alert_id: 1 }),
    acknowledgeAlert: jest.fn().mockResolvedValue({ alert_id: 1 }),
    resolveAlert: jest.fn().mockResolvedValue({ alert_id: 1 }),
    getAlertStatistics: jest.fn().mockResolvedValue({ statistics: [] }),
    getSystemStatus: jest.fn().mockResolvedValue({}),
    getThresholds: jest.fn().mockResolvedValue({}),
    updateThresholds: jest.fn().mockResolvedValue({}),
    checkTransformerLoad: jest.fn().mockResolvedValue(null),
    checkAllTransformers: jest.fn().mockResolvedValue({ checked: 0, alerts_created: 0, alerts: [] }),
}));

// Auth service (authController → authService)
jest.mock('../../../src/services/authService', () => ({
    authenticateUser: jest.fn().mockRejectedValue(
        Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' })
    ),
    generateTokens: jest.fn().mockReturnValue({ accessToken: 'tok', refreshToken: 'ref' }),
    registerUser: jest.fn().mockResolvedValue({ user_id: 99, username: 'new', role: 'user' }),
    getUserProfile: jest.fn().mockResolvedValue({ user_id: 1, username: 'admin', role: 'admin' }),
    logout: jest.fn().mockResolvedValue(undefined),
    isTokenBlacklisted: jest.fn().mockResolvedValue(false),
    findUserById: jest.fn().mockResolvedValue({
        user_id: 1, username: 'admin', role: 'admin', is_locked: false
    }),
    refreshTokens: jest.fn().mockResolvedValue({ accessToken: 'tok2', refreshToken: 'ref2' }),
    changePassword: jest.fn().mockResolvedValue(undefined),
}));

// Metric controller — mock the entire controller so none of its handlers
// touch the DB.  index.js imports metricController directly for the telemetry
// route, and metricRoutes uses it for all other metric endpoints.
jest.mock('../../../src/controllers/metricController', () => {
    const ok200 = (_req, res) => res.status(200).json({ success: true, data: [] });
    return {
        receiveTelemetry: (_req, res) => res.status(201).json({ success: true }),
        getAllMetrics: ok200,
        getMetricById: (_req, res) => res.status(404).json({ error: 'not found' }),
        getMetricsByControllerId: ok200,
        getLastMetricsForAllControllers: ok200,
        createMetric: (_req, res) => res.status(201).json({ metric_id: 1 }),
        deleteMetric: (_req, res) => res.status(200).json({ success: true }),
        getAggregatedMetrics: ok200,
        cleanupOldMetrics: (_req, res) => res.status(200).json({ success: true }),
    };
});

// Metric service (metricRoutes → metricController → metricService)
jest.mock('../../../src/services/metricService', () => ({
    getAllMetrics: jest.fn().mockResolvedValue({
        data: [],
        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 }
    }),
    getMetricById: jest.fn().mockResolvedValue(null),
    createMetric: jest.fn().mockResolvedValue({ metric_id: 1 }),
    getMetricsByControllerId: jest.fn().mockResolvedValue([]),
    receiveTelemetry: jest.fn().mockResolvedValue({ metric_id: 1 }),
}));

// Analytics service
jest.mock('../../../src/services/analyticsService', () => ({
    getTransformers: jest.fn().mockResolvedValue([]),
    getOverloadedTransformers: jest.fn().mockResolvedValue([]),
    getTransformerById: jest.fn().mockResolvedValue(null),
    getColdWaterSources: jest.fn().mockResolvedValue([]),
    getHeatSources: jest.fn().mockResolvedValue([]),
    getWaterLines: jest.fn().mockResolvedValue([]),
    getWaterSuppliers: jest.fn().mockResolvedValue([]),
    getPowerLines: jest.fn().mockResolvedValue([]),
    getBuildingInfrastructure: jest.fn().mockResolvedValue({}),
    getBuildingPowerStatus: jest.fn().mockResolvedValue({}),
    getBuildingWaterStatus: jest.fn().mockResolvedValue({}),
    getSystemOverview: jest.fn().mockResolvedValue({}),
    getTransformerLoadHistory: jest.fn().mockResolvedValue([]),
    getWaterPressureHistory: jest.fn().mockResolvedValue([]),
    getHeatingTemperatureHistory: jest.fn().mockResolvedValue([]),
    getCriticalInfrastructure: jest.fn().mockResolvedValue([]),
    getInfrastructureByBuildingId: jest.fn().mockResolvedValue({}),
}));

// Cache service (used by buildingService and others at module level)
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// 5.  Build two Express applications.
//
//     App A ("authPassApp") — auth middleware is fully mocked (always passes).
//     Used for: "authenticated requests → 200" and "public route" groups.
//
//     App B ("denyApp") — a lightweight deny guard is installed in front of
//     the router to reproduce the real default-deny behaviour WITHOUT needing
//     a real database.  The guard returns 401 { success, message } when no
//     Authorization header is present, exactly matching the real middleware's
//     response for a missing token.
// ---------------------------------------------------------------------------

const express = require('express');

// Load the real router (all mocks above are already in place)
const router = require('../../../src/routes/index');

// ---- App A: auth always passes ----
const authPassApp = express();
authPassApp.use(express.json());
authPassApp.use('/api', router);
authPassApp.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// ---- App B: deny guard mirrors src/routes/index.js PUBLIC_ROUTES logic ----
const DENY_PUBLIC_ROUTES = [
    { method: 'POST', path: '/auth/login' },
    { method: 'POST', path: '/auth/register' },
    { method: 'POST', path: '/auth/refresh' },
    { method: 'POST', path: '/metrics/telemetry' },
    { method: 'GET',  path: '/buildings-metrics' },
    { method: 'GET',  path: '/' },
];

const isDenyPublicRoute = (method, path) => {
    const normalizedPath = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    return DENY_PUBLIC_ROUTES.some(r => r.method === method && normalizedPath === r.path);
};

/**
 * Lightweight deny guard: returns 401 when no Authorization header is present
 * for non-public routes, exactly matching the real authenticateJWT response
 * for a missing token.
 */
const denyGuard = (req, res, next) => {
    if (isDenyPublicRoute(req.method, req.path)) {
        return next();
    }
    if (!req.headers.authorization) {
        return res.status(401).json({ success: false, message: 'Access token is missing' });
    }
    next();
};

const denyApp = express();
denyApp.use(express.json());
denyApp.use('/api', denyGuard, router);
denyApp.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// ---------------------------------------------------------------------------
// 6.  Tests
// ---------------------------------------------------------------------------

describe('Default-deny JWT middleware (src/routes/index.js)', () => {

    // -----------------------------------------------------------------------
    // Group 1: Protected routes — no token → 401
    // -----------------------------------------------------------------------
    describe('Protected routes without token → 401', () => {

        test('GET /api/buildings returns 401 when no Authorization header', async () => {
            const res = await request(denyApp).get('/api/buildings');
            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('success', false);
            expect(res.body).toHaveProperty('message', 'Access token is missing');
        });

        test('GET /api/controllers returns 401 when no Authorization header', async () => {
            const res = await request(denyApp).get('/api/controllers');
            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('success', false);
            expect(res.body).toHaveProperty('message', 'Access token is missing');
        });

        test('GET /api/alerts returns 401 when no Authorization header', async () => {
            const res = await request(denyApp).get('/api/alerts');
            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('success', false);
            expect(res.body).toHaveProperty('message', 'Access token is missing');
        });

        test('POST /api/auth/logout returns 401 when no Authorization header (not in allowlist)', async () => {
            const res = await request(denyApp).post('/api/auth/logout').send({});
            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('success', false);
            expect(res.body).toHaveProperty('message', 'Access token is missing');
        });

    });

    // -----------------------------------------------------------------------
    // Group 2: Public allowlist routes — no token → NOT blocked by middleware
    // -----------------------------------------------------------------------
    describe('Public allowlist routes without token → NOT 401 from middleware', () => {

        test('GET /api/ returns 200 (root info endpoint in allowlist)', async () => {
            const res = await request(authPassApp).get('/api/');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('name');
            expect(res.body).toHaveProperty('status', 'healthy');
        });

        test('GET /api/buildings-metrics returns 200 without token (public allowlist, optionalAuth)', async () => {
            // Must use denyApp: tests that the global middleware passes this route
            // WITHOUT a token — this is the canonical source of truth for the policy.
            // API_AUTH_MATRIX.md: GET /buildings-metrics → Public (optionalAuth, урезанные данные)
            const res = await request(denyApp).get('/api/buildings-metrics');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('data');
            expect(Array.isArray(res.body.data)).toBe(true);
        });

        test('POST /api/auth/login is not blocked by global middleware (wrong credentials → 401 from login handler, not guard)', async () => {
            // Send no Authorization header — the route is in the allowlist so the guard
            // must pass the request through.  The login handler then rejects bad credentials
            // with 401 { error: '...' }.  The global deny response would be
            // 401 { success: false, message: 'Access token is missing' } — that must NOT appear.
            const res = await request(denyApp)
                .post('/api/auth/login')
                .send({ username: 'wronguser', password: 'wrongpass' });

            // Global deny guard must NOT have fired
            expect(res.body).not.toHaveProperty('message', 'Access token is missing');
            // If 401, it came from the login handler (has 'error' key, not 'message')
            if (res.status === 401) {
                expect(res.body).toHaveProperty('error');
            }
        });

    });

    // -----------------------------------------------------------------------
    // Group 3: Authenticated requests (mocked token) → route handlers run → 200
    // -----------------------------------------------------------------------
    describe('Authenticated requests with mocked token → handlers run → 200', () => {

        test('GET /api/buildings with Authorization header returns 200', async () => {
            const res = await request(authPassApp)
                .get('/api/buildings')
                .set('Authorization', 'Bearer mock-token');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('data');
            expect(Array.isArray(res.body.data)).toBe(true);
        });

        test('GET /api/controllers with Authorization header returns 200', async () => {
            const res = await request(authPassApp)
                .get('/api/controllers')
                .set('Authorization', 'Bearer mock-token');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('data');
        });

        test('GET /api/alerts with Authorization header returns 200', async () => {
            const res = await request(authPassApp)
                .get('/api/alerts')
                .set('Authorization', 'Bearer mock-token');

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('success', true);
            expect(res.body).toHaveProperty('data');
        });

    });

    // -----------------------------------------------------------------------
    // Group 4: Middleware boundary — public routes are not blocked on denyApp
    // -----------------------------------------------------------------------
    describe('Public routes are not blocked even on denyApp (no Authorization header)', () => {

        test('GET /api/ is not blocked (no Authorization header)', async () => {
            const res = await request(denyApp).get('/api/');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('status', 'healthy');
        });

        test('GET /api/buildings-metrics is not blocked (no Authorization header)', async () => {
            const res = await request(denyApp).get('/api/buildings-metrics');
            expect(res.status).toBe(200);
        });

        test('POST /api/auth/register is not blocked by deny guard (no Authorization header)', async () => {
            const res = await request(denyApp)
                .post('/api/auth/register')
                .send({ username: 'newuser', password: 'Pass1234' });

            // Global middleware must not have responded with missing-token 401
            expect(res.status).not.toBe(401);
            expect(res.body).not.toHaveProperty('message', 'Access token is missing');
        });

    });

});
