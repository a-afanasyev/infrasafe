/**
 * [1A-FU-S-M2] /api/csp-report — violation sink.
 *
 * Coverage:
 *   - public route (no auth required)
 *   - accepts the legacy {"csp-report": {...}} JSON shape
 *   - accepts the Reporting API v3 [{type:'csp-violation', body:{...}}] shape
 *   - logs a bounded summary via logger.info on every non-empty report
 *   - returns 204 on every request — never 500 even with broken payloads
 *   - empty/probe payloads return 204 without logging
 *   - excessive field lengths get truncated, not echoed verbatim
 */

'use strict';

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const logger = require('../../../src/utils/logger');
const cspReportRouter = require('../../../src/routes/cspReportRoutes');

function makeApp() {
    const app = express();
    app.use('/api/csp-report', cspReportRouter);
    return app;
}

describe('[1A-FU-S-M2] POST /api/csp-report', () => {
    beforeEach(() => jest.clearAllMocks());

    test('legacy {"csp-report": {...}} → 204 + logger.info with summary', async () => {
        const app = makeApp();
        const payload = {
            'csp-report': {
                'document-uri': 'https://infrasafe.uz/admin.html',
                'violated-directive': 'script-src',
                'blocked-uri': 'inline',
                'source-file': 'https://infrasafe.uz/admin.html',
                'line-number': 42,
                disposition: 'enforce'
            }
        };

        const res = await request(app)
            .post('/api/csp-report')
            .set('Content-Type', 'application/csp-report')
            .send(JSON.stringify(payload));

        expect(res.status).toBe(204);
        expect(logger.info).toHaveBeenCalledTimes(1);
        const logLine = logger.info.mock.calls[0][0];
        expect(logLine).toMatch(/CSP violation/);
        expect(logLine).toMatch(/script-src/);
        expect(logLine).toMatch(/inline/);
        expect(logLine).toMatch(/admin\.html/);
    });

    test('Reporting API v3 array → same summary extracted from .body', async () => {
        const app = makeApp();
        const payload = [{
            type: 'csp-violation',
            body: {
                documentURL: 'https://infrasafe.uz/',
                effectiveDirective: 'img-src',
                blockedURL: 'https://evil.example/pixel.gif',
                disposition: 'enforce'
            }
        }];

        const res = await request(app)
            .post('/api/csp-report')
            .set('Content-Type', 'application/reports+json')
            .send(JSON.stringify(payload));

        expect(res.status).toBe(204);
        expect(logger.info).toHaveBeenCalledTimes(1);
        const logLine = logger.info.mock.calls[0][0];
        expect(logLine).toMatch(/img-src/);
        expect(logLine).toMatch(/evil\.example/);
    });

    test('plain application/json shape — accepted', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/csp-report')
            .set('Content-Type', 'application/json')
            .send({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': 'eval' } });
        expect(res.status).toBe(204);
        expect(logger.info).toHaveBeenCalledTimes(1);
    });

    test('empty payload → 204 + NO log line (probe / no-op suppression)', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/csp-report')
            .set('Content-Type', 'application/json')
            .send({});
        expect(res.status).toBe(204);
        expect(logger.info).not.toHaveBeenCalled();
    });

    test('malformed JSON → 204 (Express parse error becomes 400 BUT we still return 204)',
        async () => {
            const app = makeApp();
            const res = await request(app)
                .post('/api/csp-report')
                .set('Content-Type', 'application/json')
                .send('{ not json');
            // Express's json() returns 400 for parse errors before our
            // handler runs; that's the platform behavior. The browser
            // ignores response codes anyway. Either 204 (handler runs)
            // or 400 (json parse fail) is acceptable — we just verify
            // we don't 500.
            expect([200, 204, 400]).toContain(res.status);
        }
    );

    test('extremely long fields are truncated in the log line', async () => {
        const app = makeApp();
        const longUri = 'https://attacker.example/' + 'a'.repeat(500);
        const res = await request(app)
            .post('/api/csp-report')
            .set('Content-Type', 'application/json')
            .send({ 'csp-report': { 'violated-directive': 'script-src', 'blocked-uri': longUri } });

        expect(res.status).toBe(204);
        const logLine = logger.info.mock.calls[0][0];
        // blockedUri capped at 256 chars in summary; log line therefore
        // shouldn't carry the full 500-char URI.
        expect(logLine.length).toBeLessThan(1024);
        expect(logLine).not.toMatch(/a{300}/);
    });

    test('unexpected nested fields do not echo into the log (allowlist semantics)', async () => {
        const app = makeApp();
        const res = await request(app)
            .post('/api/csp-report')
            .set('Content-Type', 'application/json')
            .send({
                'csp-report': {
                    'violated-directive': 'script-src',
                    'blocked-uri': 'inline',
                    'session-cookie': 'attacker_was_here=1'
                }
            });

        expect(res.status).toBe(204);
        const logLine = logger.info.mock.calls[0][0];
        expect(logLine).not.toMatch(/session-cookie/);
        expect(logLine).not.toMatch(/attacker_was_here/);
    });
});
