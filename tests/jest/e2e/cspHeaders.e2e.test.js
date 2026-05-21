/**
 * [1A-FU-C-M4] Live CSP header check.
 *
 * The file-content unit tests in tests/jest/unit/p1-3-csp-sri.test.js
 * verify the directive text exists in nginx.production.conf and
 * src/server.js. They CANNOT catch:
 *   - whitespace/quoting bugs in nginx.conf that prevent the header
 *     from ever being sent
 *   - directive ordering issues where a later add_header overrides
 *     the CSP entirely
 *   - express-only routes that bypass helmet
 *
 * This E2E test makes a real HTTP GET against the running stack and
 * asserts the served CSP header satisfies the security contract.
 *
 * Requires: docker compose -f docker-compose.dev.yml up
 * (or any environment that serves the same nginx + Express stack)
 */

const request = require('supertest');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

describe('E2E: [1A-FU-C-M4] CSP headers on live response', () => {
    // We hit /api/auth/profile (always 401 if unauth, but headers are
    // attached regardless) so the test is independent of seeded data.
    // For nginx-served HTML responses (where the production CSP is
    // strongest), set E2E_NGINX_URL to the nginx host:port and the
    // test also probes /admin.html.

    test('Express response carries a Content-Security-Policy header', async () => {
        const res = await request(BASE_URL).get('/api/auth/profile');

        // helmet attaches CSP to every response, even error responses.
        const csp = res.headers['content-security-policy'];
        expect(csp).toBeDefined();
        expect(typeof csp).toBe('string');
        expect(csp.length).toBeGreaterThan(50);
    });

    test('Express CSP script-src has NO unsafe-inline (production posture)', async () => {
        const res = await request(BASE_URL).get('/api/auth/profile');
        const csp = res.headers['content-security-policy'] || '';

        // Only assert against prod posture if NODE_ENV is production.
        // In dev the script-src deliberately includes 'unsafe-inline'
        // for Swagger UI.
        if (process.env.NODE_ENV === 'production') {
            const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
            expect(scriptSrcMatch).toBeTruthy();
            expect(scriptSrcMatch[1]).not.toMatch(/'unsafe-inline'/);
        }
        // unsafe-eval must NOT appear in either mode (helmet config dropped it).
        expect(csp).not.toMatch(/'unsafe-eval'/);
    });

    test('Express CSP includes report-uri pointing at /api/csp-report', async () => {
        const res = await request(BASE_URL).get('/api/auth/profile');
        const csp = res.headers['content-security-policy'] || '';
        expect(csp).toMatch(/report-uri\s+\/api\/csp-report/);
    });

    test('nginx /admin.html carries CSP — script-src clean of unsafe-* (when E2E_NGINX_URL set)', async () => {
        // This part only runs when the operator points the test at the
        // nginx fronting URL. The default BASE_URL goes directly to the
        // app container which uses helmet's CSP, not nginx's.
        const nginxUrl = process.env.E2E_NGINX_URL;
        if (!nginxUrl) {
            return;  // pass-through — file-content unit tests cover nginx.conf
        }

        const res = await request(nginxUrl).get('/admin.html');
        const csp = res.headers['content-security-policy'];
        expect(csp).toBeDefined();

        const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
        expect(scriptSrcMatch).toBeTruthy();
        expect(scriptSrcMatch[1]).not.toMatch(/'unsafe-inline'/);
        expect(scriptSrcMatch[1]).not.toMatch(/'unsafe-eval'/);
        expect(scriptSrcMatch[1]).not.toMatch(/fonts\.googleapis\.com/);
        expect(scriptSrcMatch[1]).toMatch(/https:\/\/cdn\.jsdelivr\.net/);

        expect(csp).toMatch(/report-uri\s+\/api\/csp-report/);
    });

    test('CSP report endpoint is publicly reachable (no auth required)', async () => {
        // The browser cannot send Authorization headers on report-uri
        // POSTs by spec — the endpoint MUST accept anonymous requests
        // OR the reporting feature is silently broken.
        const res = await request(BASE_URL)
            .post('/api/csp-report')
            .set('Content-Type', 'application/csp-report')
            .send(JSON.stringify({
                'csp-report': {
                    'document-uri': 'https://infrasafe.uz/admin.html',
                    'violated-directive': 'script-src',
                    'blocked-uri': 'https://example.test/e2e-probe.js'
                }
            }));

        expect([200, 204]).toContain(res.status);
    });
});
