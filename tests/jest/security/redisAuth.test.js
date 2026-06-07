/**
 * SEC-21 / SEC-34f — Redis auth + dev-port hardening.
 *
 * SEC-21: prod Redis must run with requirepass, sourced from a mounted
 *   redis-config/redis.conf (NOT a compose `command` flag or ${REDIS_PASSWORD}
 *   interpolation — compose interpolation ignores env_file per B-023, and a
 *   secret in argv leaks via `docker inspect`/`ps`). The healthcheck must carry
 *   NO secret and accept only NOAUTH (proves server-up AND auth-enforced).
 * SEC-34f: dev compose must bind 3000/5435 to loopback, not 0.0.0.0.
 *
 * Content assertions (compose is not JS-executable here), mirroring
 * dockerfileImmutable.test.js. Comment lines are stripped so explanatory prose
 * cannot satisfy a match.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const unifiedRaw = read('docker-compose.unified.yml');
const unified = stripComments(unifiedRaw);
const devRaw = read('docker-compose.dev.yml');
const dev = stripComments(devRaw);

describe('SEC-21 — Redis requirepass via mounted conf (not argv/env)', () => {
    test('redis starts from the mounted config file', () => {
        expect(unified).toMatch(/redis-server[^\n]*\/usr\/local\/etc\/redis\/redis\.conf/);
    });

    test('redis-config directory is mounted into the container', () => {
        expect(unified).toMatch(/\.\/redis-config:\/usr\/local\/etc\/redis(:ro)?/);
    });

    test('no secret in argv: command does not carry --requirepass', () => {
        expect(unified).not.toMatch(/--requirepass/);
    });

    test('no secret via compose interpolation (B-023: ignored from env_file)', () => {
        expect(unified).not.toMatch(/\$\{REDIS_PASSWORD\}/);
    });

    test('healthcheck carries no secret and matches NOAUTH', () => {
        // Find the redis service's healthcheck test line.
        const m = unifiedRaw.match(/redis:[\s\S]*?healthcheck:[\s\S]*?test:\s*(\[[^\]]*\]|[^\n]*)/);
        expect(m).not.toBeNull();
        const hc = m[1];
        expect(hc).toMatch(/NOAUTH/);
        expect(hc).not.toMatch(/-a\b/);            // no redis-cli -a <secret>
        expect(hc).not.toMatch(/REDISCLI_AUTH/);   // env would show in docker inspect
        expect(hc).not.toMatch(/\$\{?REDIS_PASSWORD/);
    });
});

describe('SEC-21 — no plaintext secret committed', () => {
    test('redis-config/redis.conf.example exists and is a placeholder only', () => {
        const ex = read('redis-config/redis.conf.example');
        // No active (uncommented) requirepass with a real value in the template.
        expect(ex).not.toMatch(/^[\t ]*requirepass[\t ]+[0-9a-f]{64}/m);
    });

    test('the real redis.conf is gitignored and dockerignored', () => {
        expect(read('.gitignore')).toMatch(/^redis-config\/redis\.conf$/m);
        expect(read('.dockerignore')).toMatch(/^redis-config\/redis\.conf$/m);
    });

    test('compose YAML has no inline requirepass value', () => {
        expect(unified).not.toMatch(/requirepass\s+\S/);
    });
});

describe('SEC-34f — dev compose binds dev ports to loopback', () => {
    test('app dev port 3000 is loopback-only', () => {
        expect(dev).toMatch(/127\.0\.0\.1:3000:3000/);
        expect(dev).not.toMatch(/(^|[^.\d])"3000:3000"/);
    });

    test('postgres dev port 5435 is loopback-only', () => {
        expect(dev).toMatch(/127\.0\.0\.1:5435:5432/);
        expect(dev).not.toMatch(/(^|[^.\d])"5435:5432"/);
    });
});
