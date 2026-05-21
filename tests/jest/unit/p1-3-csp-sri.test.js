/**
 * [P1-3] Contract tests for CSP hardening + SRI.
 *
 * These pin the artifact expectations rather than runtime behavior:
 *   - every CDN <script> tag carries integrity= + crossorigin=
 *   - no HTML page still contains an inline <script>...</script> block
 *   - nginx.production.conf CSP no longer has 'unsafe-inline' on script-src
 *   - helmet CSP no longer has 'unsafe-eval' in dev mode
 *
 * If a future change re-introduces inline scripts or unsafe-* on the
 * script-src directive, these tests fail loudly.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
function read(p) {
    return fs.readFileSync(path.resolve(REPO_ROOT, p), 'utf8');
}

const HTML_PAGES = [
    'index.html',
    'admin.html',
    'about.html',
    'contacts.html',
    'documentation.html',
    'public/login.html'
];

describe('[P1-3] SRI on CDN <script> tags', () => {
    test.each([
        'index.html',
        'admin.html',
        'public/login.html'
    ])('%s — DOMPurify CDN tag carries integrity + crossorigin + referrerpolicy', (file) => {
        const html = read(file);
        const dompurifyTag = html.match(
            /<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/dompurify@[^"]+\.min\.js"[^>]*>/i
        );
        expect(dompurifyTag).toBeTruthy();
        expect(dompurifyTag[0]).toMatch(/integrity="sha(?:256|384|512)-[A-Za-z0-9+/=]+"/);
        expect(dompurifyTag[0]).toMatch(/crossorigin="anonymous"/);
        expect(dompurifyTag[0]).toMatch(/referrerpolicy="no-referrer"/);
    });

    test('no CDN <script> tag in repo is missing integrity=', () => {
        const violations = [];
        for (const file of HTML_PAGES) {
            const html = read(file);
            const cdnTags = html.match(/<script[^>]*src="https:\/\/[^"]+"[^>]*>/gi) || [];
            for (const tag of cdnTags) {
                if (!/integrity=/.test(tag)) {
                    violations.push(`${file}: ${tag}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });
});

describe('[P1-3] inline <script> blocks have been extracted', () => {
    test.each(HTML_PAGES)('%s — has no inline <script>...</script> block', (file) => {
        const html = read(file);
        // matchAll avoids stateful regex iteration (and avoids triggering
        // false-positive hooks that scan for the literal `.exec(` token).
        const inlineScripts = [];
        const matches = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
        for (const m of matches) {
            const attrs = m[1] || '';
            const body = m[2] || '';
            if (/\bsrc\s*=/.test(attrs)) continue;
            if (/\btype\s*=\s*"(?:application\/json|application\/ld\+json)"/i.test(attrs)) continue;
            if (body.trim().length === 0) continue;
            inlineScripts.push(body.trim().slice(0, 100));
        }
        expect(inlineScripts).toEqual([]);
    });
});

describe('[P1-3] nginx production CSP no longer permits unsafe-inline on script-src', () => {
    const nginxConf = read('nginx.production.conf');

    test('Content-Security-Policy header exists in https server block', () => {
        expect(nginxConf).toMatch(/add_header\s+Content-Security-Policy\s+"[^"]+"/);
    });

    test('script-src does NOT include unsafe-inline or unsafe-eval', () => {
        const cspMatch = nginxConf.match(
            /add_header\s+Content-Security-Policy\s+"([^"]+)"/
        );
        expect(cspMatch).toBeTruthy();
        const csp = cspMatch[1];

        const scriptSrcMatch = csp.match(/script-src([^;]+);/);
        expect(scriptSrcMatch).toBeTruthy();
        const scriptSrc = scriptSrcMatch[1];

        expect(scriptSrc).not.toMatch(/'unsafe-inline'/);
        expect(scriptSrc).not.toMatch(/'unsafe-eval'/);
    });

    test('script-src still allows jsdelivr (DOMPurify CDN)', () => {
        const cspMatch = nginxConf.match(
            /add_header\s+Content-Security-Policy\s+"([^"]+)"/
        );
        const scriptSrc = cspMatch[1].match(/script-src([^;]+);/)[1];
        expect(scriptSrc).toMatch(/https:\/\/cdn\.jsdelivr\.net/);
    });

    // [1A-FU-S-L1] fonts.googleapis.com serves CSS, not JS, so it has
    // no business being in script-src.
    test('script-src does NOT list fonts.googleapis.com (style-only origin)', () => {
        const cspMatch = nginxConf.match(
            /add_header\s+Content-Security-Policy\s+"([^"]+)"/
        );
        const scriptSrc = cspMatch[1].match(/script-src([^;]+);/)[1];
        expect(scriptSrc).not.toMatch(/fonts\.googleapis\.com/);
    });

    test('style-src still allows fonts.googleapis.com (CSS source)', () => {
        const cspMatch = nginxConf.match(
            /add_header\s+Content-Security-Policy\s+"([^"]+)"/
        );
        const styleSrc = cspMatch[1].match(/style-src([^;]+);/)[1];
        expect(styleSrc).toMatch(/fonts\.googleapis\.com/);
    });

    // [1A-FU-S-M2] CSP violations are POSTed to /api/csp-report so
    // bypass / misconfig is observable instead of silent.
    test('CSP includes report-uri pointing at the API endpoint', () => {
        const cspMatch = nginxConf.match(
            /add_header\s+Content-Security-Policy\s+"([^"]+)"/
        );
        expect(cspMatch[1]).toMatch(/report-uri\s+\/api\/csp-report/);
    });
});

describe('[P1-3] helmet CSP no longer carries unsafe-eval anywhere', () => {
    const serverJs = read('src/server.js');

    test('the helmet block contains no unsafe-eval', () => {
        // Trim to the helmet() invocation to avoid matching comments
        // elsewhere in the file. The block is bounded by `app.use(helmet({`
        // and the next `app.use(`.
        const helmetStart = serverJs.indexOf('helmet({');
        expect(helmetStart).toBeGreaterThan(0);
        const helmetEnd = serverJs.indexOf("}));", helmetStart);
        expect(helmetEnd).toBeGreaterThan(helmetStart);
        const helmetBlock = serverJs.slice(helmetStart, helmetEnd);
        expect(helmetBlock).not.toMatch(/'unsafe-eval'/);
    });

    test('production scriptSrc has no unsafe-* tokens', () => {
        // The ternary lives on one line; split on `:` and the prod branch
        // is the part between `?` and `:`. Permissive grep — we just
        // want to confirm no unsafe-* on the prod arm.
        const ternaryMatch = serverJs.match(
            /scriptSrc:\s*isProduction\s*\?\s*(\[[^\]]+\])\s*:\s*(\[[^\]]+\])/
        );
        expect(ternaryMatch).toBeTruthy();
        const prodArr = ternaryMatch[1];
        expect(prodArr).not.toMatch(/'unsafe-inline'/);
        expect(prodArr).not.toMatch(/'unsafe-eval'/);
    });

    // [1A-FU-S-M2] helmet config also routes CSP violations to the API.
    test('helmet directives include reportUri pointing at /api/csp-report', () => {
        const helmetStart = serverJs.indexOf('helmet({');
        const helmetEnd = serverJs.indexOf("}));", helmetStart);
        const helmetBlock = serverJs.slice(helmetStart, helmetEnd);
        expect(helmetBlock).toMatch(/reportUri:\s*\[\s*['"]\/api\/csp-report['"]\s*\]/);
    });
});
