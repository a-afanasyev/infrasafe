/**
 * Аудит 28.11.2026 — правки edge nginx (Q-25, Q-26, Q-28, Q-37).
 *
 * Оба боевых конфига проверяются одним набором. Это проверка текста директив;
 * поведение доказано живым nginx того же образа (описание PR fix/ops-perimeter),
 * разбор — `scripts/nginx-config-test.sh` в CI.
 */

const fs = require('fs');
const path = require('path');
const { stripComments, tlsVhosts, topLevelLocations } = require('../helpers/nginxConfig');

const root = path.join(__dirname, '../../..');
const read = (name) => fs.readFileSync(path.join(root, 'nginx-config', name), 'utf8');

const CONFS = ['nginx.production.conf', 'nginx.profk.conf'];

describe.each(CONFS)('%s', (file) => {
    const raw = read(file);
    const conf = stripComments(raw);
    const httpLevel = conf.slice(0, conf.search(/^\s{4}server\s*\{/m));
    const vhosts = tlsVhosts(raw);

    describe('Q-25 — TLS-параметры одни на все vhost', () => {
        test.each(['ssl_protocols', 'ssl_ciphers', 'ssl_prefer_server_ciphers', 'ssl_session_cache', 'ssl_session_timeout', 'ssl_session_tickets'])(
            '%s задан на уровне http{} и больше нигде',
            (directive) => {
                const re = new RegExp(`^\\s*${directive}\\s`, 'gm');
                expect(httpLevel.match(re)).toHaveLength(1);
                expect(conf.match(re)).toHaveLength(1);
            },
        );

        test('в списке шифров только AEAD (нет CBC-наборов с SHA1/SHA256-MAC)', () => {
            const ciphers = /ssl_ciphers\s+'([^']+)'/.exec(httpLevel)[1].split(':');
            for (const c of ciphers) expect(c).toMatch(/GCM|CHACHA20-POLY1305/);
        });
    });

    describe('Q-26 — свой proxy_hide_header в location повторяет HSTS и XFO', () => {
        // proxy_hide_header наследуется как add_header: любой свой в location
        // отменяет серверный набор (пентест 26.11 так вернул в /api/ копии helmet).
        test.each(vhosts.map((v) => [v.name, v]))('%s', (_name, vhost) => {
            for (const loc of topLevelLocations(vhost.body)) {
                if (!/proxy_hide_header/.test(loc.body)) continue;
                expect({ loc: loc.name, hsts: /proxy_hide_header\s+Strict-Transport-Security;/.test(loc.body) })
                    .toEqual({ loc: loc.name, hsts: true });
                expect({ loc: loc.name, xfo: /proxy_hide_header\s+X-Frame-Options;/.test(loc.body) })
                    .toEqual({ loc: loc.name, xfo: true });
            }
        });
    });

    describe('Q-28 — /uk/api/resource/ пропускает только health и v1/*', () => {
        const mapBody = /map\s+\$uri\s+\$uk_resource_allowed\s*\{([^}]*)\}/.exec(httpLevel);
        const allowed = (uri) => [...mapBody[1].matchAll(/"~([^"]+)"\s+1;/g)].some((m) => new RegExp(m[1]).test(uri));

        test('map объявлен по нормализованному $uri, по умолчанию закрыто', () => {
            expect(mapBody).not.toBeNull();
            expect(mapBody[1]).toMatch(/default\s+0;/);
        });

        test.each([
            ['/uk/api/resource/health', true],
            ['/uk/api/resource/v1/auth/me', true],
            ['/uk/api/resource/docs', false],
            ['/uk/api/resource/openapi.json', false],
            ['/uk/api/resource/metrics', false],
            ['/uk/api/resource/health/x', false],
            ['/uk/api/resource/v1', false],
        ])('%s → %s', (uri, ok) => {
            expect(allowed(uri)).toBe(ok);
        });

        test('location отбивает 404 до limit_req и rewrite', () => {
            const main = vhosts[0];
            const loc = topLevelLocations(main.body).find((l) => l.name === '^~ /uk/api/resource/');
            expect(loc).toBeDefined();
            const gate = loc.body.search(/if\s*\(\$uk_resource_allowed\s*=\s*0\)\s*\{\s*return 404;\s*\}/);
            expect(gate).toBeGreaterThan(-1);
            expect(gate).toBeLessThan(loc.body.indexOf('limit_req'));
            expect(gate).toBeLessThan(loc.body.indexOf('rewrite'));
        });
    });

    describe('Q-37 — мёртвые директивы', () => {
        test('нет error_page 404 на несуществующий /404.html', () => {
            expect(conf).not.toMatch(/error_page\s+404\b/);
            expect(conf).not.toMatch(/location\s*=\s*\/404\.html/);
        });
    });
});

test('Q-37 — на .105 нет OCSP stapling (у Let\'s Encrypt нет OCSP)', () => {
    // profk снимает его в fix/profk-cert-mount (Q-12) — там же меняются пути сертификата.
    expect(stripComments(read('nginx.production.conf'))).not.toMatch(/ssl_stapling|ssl_trusted_certificate/);
});

test('Q-37 — CI гоняет настоящий nginx -t обоих edge-конфигов', () => {
    const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/run:\s*bash scripts\/nginx-config-test\.sh/);
    const script = fs.readFileSync(path.join(root, 'scripts/nginx-config-test.sh'), 'utf8');
    expect(script).toMatch(/nginx\.production\.conf nginx\.profk\.conf/);
    // образ берётся из compose, а не дублируется
    expect(script).toMatch(/docker-compose\.unified\.yml/);
});
