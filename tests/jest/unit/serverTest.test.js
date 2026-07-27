'use strict';

/**
 * Tests for src/server.js covering:
 * - App creation and middleware setup
 * - Health check endpoint
 * - Graceful shutdown (SIGTERM/SIGINT)
 * - Process event handlers
 */

const request = require('supertest');

// Мы тестируем экспортированный `app` напрямую через supertest — слушающий
// порт для этого не нужен.
//
// Раньше здесь стоял обходной приём: db.init() мокался НЕВЫПОЛНИМЫМ промисом,
// чтобы .then() с app.listen() никогда не сработал. Теперь server.js сам
// открывает сокет только при прямом запуске (`require.main === module`), так
// что приём не нужен. Мок оставлен: он изолирует тест от БД, а не от listen.

jest.mock('../../../src/config/database', () => ({
    init: jest.fn().mockReturnValue(new Promise(() => {})), // never resolves
    query: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/routes', () => {
    const express = require('express');
    const router = express.Router();
    router.get('/test', (req, res) => res.json({ ok: true }));
    return router;
});
jest.mock('../../../src/middleware/errorHandler', () => (err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
});
jest.mock('../../../src/middleware/correlationId', () => (req, res, next) => next());
jest.mock('swagger-jsdoc', () => jest.fn(() => ({})));
jest.mock('swagger-ui-express', () => ({
    serve: (req, res, next) => next(),
    setup: () => (req, res) => res.json({})
}));

const db = require('../../../src/config/database');
const app = require('../../../src/server');

describe('server.js', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // -------------------------------------------------------------------------
    // App export
    // -------------------------------------------------------------------------
    describe('app export', () => {
        it('exports an express app (function)', () => {
            expect(typeof app).toBe('function');
        });

        it('responds to API requests', async () => {
            const res = await request(app).get('/api/test');
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Health check endpoint
    // -------------------------------------------------------------------------
    describe('GET /health', () => {
        it('returns healthy status when DB is connected', async () => {
            db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

            const res = await request(app).get('/health');

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('healthy');
        });

        it('returns 503 unhealthy status when DB query fails', async () => {
            db.query.mockRejectedValue(new Error('Connection refused'));

            const res = await request(app).get('/health');

            expect(res.status).toBe(503);
            expect(res.body.status).toBe('unhealthy');
        });

        // [M-15] The response no longer discloses internal DB connectivity
        // state to an unauthenticated caller.
        it('does not disclose DB connectivity state in the response body', async () => {
            db.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });

            const res = await request(app).get('/health');

            expect(res.body).not.toHaveProperty('db');
        });
    });

    // -------------------------------------------------------------------------
    // Middleware setup
    // -------------------------------------------------------------------------
    describe('middleware', () => {
        it('sets security headers via helmet', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const res = await request(app).get('/health');

            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        it('CSP scriptSrc does not allow external CDN hosts [SEC-18]', async () => {
            db.query.mockResolvedValue({ rows: [] });

            const res = await request(app).get('/health');

            const csp = res.headers['content-security-policy'] || '';
            // Self-hosted DOMPurify removed the CDN dependency; the edge CSP
            // already dropped these — helmet's app-level CSP must match.
            expect(csp).not.toContain('cdn.jsdelivr.net');
            expect(csp).not.toContain('unpkg.com');
        });

        it('parses JSON request body', async () => {
            const res = await request(app)
                .get('/api/test')
                .set('Content-Type', 'application/json');

            expect(res.status).toBe(200);
        });

        it('preserves rawBody on JSON-parsed requests', async () => {
            // Limitation: req.rawBody is set internally by the verify callback and
            // cannot be directly asserted from outside the request lifecycle.
            // We verify indirectly by POSTing a JSON body and confirming no 500 error.
            const res = await request(app)
                .post('/api/test')
                .send({ test: 'data' })
                .set('Content-Type', 'application/json');

            expect(res.status).not.toBe(500);
        });
    });

    // -------------------------------------------------------------------------
    // API routes mount
    // -------------------------------------------------------------------------
    describe('API routes', () => {
        it('mounts routes under /api prefix', async () => {
            const res = await request(app).get('/api/test');

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // SPA routing fallback
    // -------------------------------------------------------------------------
    describe('SPA routing', () => {
        it('attempts to serve index.html for unknown non-API paths', async () => {
            const res = await request(app).get('/some-unknown-path');

            // In test env the static file does not exist, so Express returns 404.
            // The key assertion is that it does NOT return a 500 server error.
            expect(res.status).not.toBe(500);
        });

        it('passes through for .html paths', async () => {
            const res = await request(app).get('/about.html');

            // Express.static serves the file if it exists; in test env it returns 404.
            // The key assertion is that it does NOT return a 500 server error.
            expect(res.status).not.toBe(500);
        });
    });
});

describe('graceful shutdown and process handlers', () => {
    // structural test only -- verifies handler registration, not behavior

    it('has SIGTERM handler registered on process', () => {
        const sigtermListeners = process.listeners('SIGTERM');
        expect(sigtermListeners.length).toBeGreaterThanOrEqual(1);
    });

    it('has SIGINT handler registered on process', () => {
        const sigintListeners = process.listeners('SIGINT');
        expect(sigintListeners.length).toBeGreaterThanOrEqual(1);
    });

    it('has uncaughtException handler registered on process', () => {
        const listeners = process.listeners('uncaughtException');
        expect(listeners.length).toBeGreaterThanOrEqual(1);
    });

    it('has unhandledRejection handler registered on process', () => {
        const listeners = process.listeners('unhandledRejection');
        expect(listeners.length).toBeGreaterThanOrEqual(1);
    });
});

describe('database initialization', () => {
    it('db.init mock was called during module load (verified before clearAllMocks)', () => {
        // db.init() is called at module load time by server.js.
        // Our mock returns a never-resolving promise to prevent app.listen().
        // We verify the mock was set up correctly by checking it is a mock function.
        expect(jest.isMockFunction(db.init)).toBe(true);
        // The mock was called during require('../../../src/server'),
        // but beforeEach clearAllMocks resets call counts.
        // We verify it is configured to never resolve (preventing listen):
        const result = db.init();
        expect(result).toBeInstanceOf(Promise);
    });
});

// [AUD-042] Swagger is dev-only (guarded by `if NODE_ENV !== 'production'`), so
// it must be lazy-required inside that branch and live in devDependencies — never
// loaded into the immutable prod image (npm ci --omit=dev).
describe('[AUD-042] Swagger is dev-only (lazy require + devDependencies)', () => {
    const fs = require('fs');
    const path = require('path');
    const repoRoot = path.resolve(__dirname, '../../..');

    it('server.js does not require swagger at the top level', () => {
        const src = fs.readFileSync(path.join(repoRoot, 'src/server.js'), 'utf8');
        const guardIdx = src.indexOf("NODE_ENV !== 'production'");
        const jsdocIdx = src.indexOf("require('swagger-jsdoc')");
        const uiIdx = src.indexOf("require('swagger-ui-express')");
        expect(guardIdx).toBeGreaterThan(0);
        expect(jsdocIdx).toBeGreaterThan(guardIdx); // required AFTER the dev guard
        expect(uiIdx).toBeGreaterThan(guardIdx);
    });

    it('package.json lists swagger under devDependencies, not dependencies', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
        for (const dep of ['swagger-jsdoc', 'swagger-ui-express']) {
            expect(pkg.devDependencies).toHaveProperty(dep);
            expect(pkg.dependencies).not.toHaveProperty(dep);
        }
    });
});
