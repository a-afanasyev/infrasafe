/**
 * SEC-20 / SEC-34g — edge nginx hardening (production config).
 *
 * SEC-20: defense-in-depth rate-limit at the nginx edge (orthogonal to the
 *   app-layer limiter, SEC-6). A general /api/ zone plus a strict
 *   credential-only zone keyed via `map $uri` (so profile/logout/2FA-management
 *   are NOT throttled to 5r/m on shared NAT).
 * SEC-34g: Swagger /api-docs closed in prod (both exact + prefix forms).
 *
 * Content assertions — the prod conf needs SSL cert files + the docker DNS
 * resolver to actually parse, so a JS test can't run `nginx -t`; that runs on
 * prod (`nginx -t -c /etc/nginx/custom/nginx.production.conf`). Here we guard
 * the directives against regression, mirroring dockerfileImmutable.test.js.
 * Comment lines are stripped so explanatory prose can't satisfy a match.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const confRaw = fs.readFileSync(path.join(root, 'nginx-config/nginx.production.conf'), 'utf8');
// Strip `#` comment lines — assert on real directives only.
const conf = confRaw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('SEC-20 — edge rate-limit zones declared in http context', () => {
    test('general api zone', () => {
        expect(conf).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=api:/);
    });

    test('credential-only zone keyed by a $uri map (not all of /api/auth/)', () => {
        expect(conf).toMatch(/map\s+\$uri\s+\$cred_limit_key\s*\{/);
        expect(conf).toMatch(/limit_req_zone\s+\$cred_limit_key\s+zone=api_cred:/);
    });

    test('credential map is case-insensitive and tolerates a trailing slash', () => {
        // Express routing is case-insensitive + non-strict, so the regex must be
        // ~* and accept an optional trailing slash, else it is trivially bypassed.
        expect(conf).toMatch(/"~\*\^\/api\/auth\/\(login\|register\|refresh\|verify-2fa\|setup-2fa\|confirm-2fa\)\/\?\$"/);
    });

    test('429 (not 503) on limiting', () => {
        expect(conf).toMatch(/limit_req_status\s+429/);
    });
});

describe('SEC-20 — both limits applied (stacked) inside the existing /api/ location', () => {
    test('general + credential limit_req both present', () => {
        expect(conf).toMatch(/limit_req\s+zone=api\s+burst=\d+\s+nodelay/);
        expect(conf).toMatch(/limit_req\s+zone=api_cred\s+burst=\d+\s+nodelay/);
    });
});

describe('SEC-22 — /uk/api/ prefix-allowlist + edge rate-limit', () => {
    test('allowlist map exists and defaults to deny', () => {
        expect(conf).toMatch(/map\s+\$uri\s+\$uk_api_allowed\s*\{/);
        expect(conf).toMatch(/\$uk_api_allowed\s*\{[\s\S]*?default\s+0;/);
    });

    test('UK-confirmed allowed prefixes are present', () => {
        // Bare-callable resources (UK SPA/TWA hits the exact path with no trailing
        // slash — e.g. GET /api/v2/requests?…, POST /api/v2/shifts) MUST use the
        // (/|$) idiom so the regex matches exact-path-or-subtree. A trailing-slash-
        // only regex 404s the bare path at the edge (prod incidents 2026-06-08:
        // profile broke first on login; requests/shifts/feedback confirmed by UK).
        for (const p of [
            '/uk/api/v2/public', '/uk/api/v2/board-config', '/uk/api/v2/announcements',
            '/uk/api/v2/requests(/|$)', '/uk/api/v2/profile(/|$)', '/uk/api/v2/shifts(/|$)',
            '/uk/api/v2/feedback(/|$)',
            // Always called with a subpath per UK (auth/login, callcenter/requests,
            // executor/shifts/current, addresses/yards, media/upload, registration/…)
            // — trailing-slash form is correct and intentionally kept.
            '/uk/api/v2/auth/', '/uk/api/v2/registration/', '/uk/api/v2/callcenter/',
            '/uk/api/v2/executor/shifts/', '/uk/api/v2/addresses/', '/uk/api/v2/media/',
            // Запрос УК 22.08.2026. Group Intake — CRUD реестра Telegram-групп
            // из веб-дашборда; work-reports — модерация отчётов «до/после»
            // (на profk стоял с 25.07, сюда перенесён не был). Оба —
            // bare-вызываемые коллекции, поэтому та же идиома (/|$).
            '/uk/api/v2/monitored-groups(/|$)',
            '/uk/api/v2/work-reports(/|$)',
            // residents — тот же перенос: стоял только на profk с 28.07,
            // из-за чего раздел «Жители» на infrasafe.uz был сломан.
            '/uk/api/v2/residents(/|$)',
            // Запрос УК 06.09.2026. «Контроль платежей» — реестры долгов и
            // платежей; bare-вызываемая коллекция + подпути, та же идиома.
            '/uk/api/v2/payment-control(/|$)',
        ]) {
            expect(conf).toContain(p);
        }
    });

    // Голый префикс без границы пустил бы и соседние пути с тем же началом
    // (/monitored-groups-admin и подобные), которых УК не запрашивали.
    test('bare-callable prefixes are bounded by (/|$), not open-ended', () => {
        for (const name of ['monitored-groups', 'work-reports', 'residents', 'payment-control', 'requests', 'shifts', 'feedback', 'profile']) {
            expect(conf).toMatch(new RegExp(`/uk/api/v2/${name}\\(/\\|\\$\\)"\\s+1;`));
            expect(conf).not.toMatch(new RegExp(`/uk/api/v2/${name}"\\s+1;`));
        }
    });

    test('inbound webhook is the exact path only (anchored)', () => {
        expect(conf).toMatch(/\/uk\/api\/v2\/webhooks\/infrasafe\/alert\$"\s+1;/);
    });

    test('internal/ops paths are NOT allowlisted', () => {
        // These must fall through to the default 404 — never appear as allowed keys.
        for (const blocked of ['notifications', 'health/ratelimit', 'health/outbox']) {
            expect(conf).not.toMatch(new RegExp(`/uk/api/[^"\\n]*${blocked.replace('/', '\\/')}[^\\n]*\\s+1;`));
        }
    });

    test('location enforces the allowlist with a 404 gate', () => {
        expect(conf).toMatch(/if\s*\(\$uk_api_allowed\s*=\s*0\)\s*\{\s*return\s+404;\s*\}/);
    });

    test('UK edge rate-limit zones declared + applied', () => {
        expect(conf).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=uk_api:/);
        expect(conf).toMatch(/limit_req_zone\s+\$uk_cred_limit_key\s+zone=uk_api_cred:/);
        expect(conf).toMatch(/limit_req\s+zone=uk_api\s+burst=\d+\s+nodelay/);
        expect(conf).toMatch(/limit_req\s+zone=uk_api_cred\s+burst=\d+\s+nodelay/);
    });

    test('credential limit keys on $request_uri, not $uri (rewrite runs before limit_req)', () => {
        // The /uk/api/ location rewrites /uk/api/(.*) -> /api/$1. limit_req (preaccess)
        // evaluates the map AFTER the rewrite phase, so $uri is already /api/... — keying
        // the cred map on $uri silently disables the limit. Must use $request_uri.
        expect(conf).toMatch(/map\s+\$request_uri\s+\$uk_cred_limit_key\s*\{/);
        expect(conf).not.toMatch(/map\s+\$uri\s+\$uk_cred_limit_key\s*\{/);
    });

    test('WebSocket narrowed to the canonical /uk/ws/v2/ prefix', () => {
        expect(conf).toMatch(/location\s+\^~\s+\/uk\/ws\/v2\//);
        expect(conf).not.toMatch(/location\s+\^~\s+\/uk\/ws\/\s*\{/);
    });
});

describe('SEC-34g — /api-docs closed in prod (both forms)', () => {
    test('exact /api-docs returns 404', () => {
        expect(conf).toMatch(/location\s*=\s*\/api-docs\s*\{\s*return\s+404;\s*\}/);
    });

    test('prefix /api-docs/ returns 404', () => {
        expect(conf).toMatch(/location\s*\^~\s*\/api-docs\/\s*\{\s*return\s+404;\s*\}/);
    });

    test('no proxy_pass to app for /api-docs anymore', () => {
        // The old block proxied /api-docs/ to app:3000 — ensure it's gone.
        const apiDocsBlock = conf.match(/location[^\n]*\/api-docs[\s\S]{0,200}/g) || [];
        for (const block of apiDocsBlock) {
            expect(block).not.toMatch(/proxy_pass/);
        }
    });
});
