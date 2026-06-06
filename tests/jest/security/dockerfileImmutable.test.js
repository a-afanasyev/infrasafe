/**
 * SEC-14/15 — the unified app image must be an immutable production image, not a
 * dev-watcher with the whole project bind-mounted in.
 *
 * SEC-14: Dockerfile.unified ran `npm run dev` (nodemon) with devDependencies.
 * SEC-15: docker-compose.unified.yml bind-mounted `- .:/app` (exposing .env.prod,
 * .git, scripts/ to any Node RCE) + an anonymous `- /app/node_modules` volume.
 *
 * Content assertions (Docker/compose are not JS-executable here), matching the
 * xss-protection.test.js precedent. The real build + image-composition checks
 * run in the CI docker job.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../../..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.unified'), 'utf8');
const composeRaw = fs.readFileSync(path.join(root, 'docker-compose.unified.yml'), 'utf8');
// Assert on actual YAML directives, not explanatory comments (which may quote the
// very patterns we forbid, e.g. "removed `- .:/app`").
const compose = composeRaw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

describe('SEC-14 — Dockerfile.unified app stage is a production runtime', () => {
    test('starts with `npm start`, not the nodemon dev-watcher', () => {
        expect(dockerfile).toMatch(/CMD\s*\[\s*"npm"\s*,\s*"start"\s*\]/);
        expect(dockerfile).not.toMatch(/CMD\s*\[\s*"npm"\s*,\s*"run"\s*,\s*"dev"\s*\]/);
    });

    test('runtime install omits devDependencies', () => {
        expect(dockerfile).toMatch(/npm ci --omit=dev/);
    });
});

describe('SEC-15 — docker-compose.unified.yml app service has no project bind mount', () => {
    test('no `- .:/app` whole-project bind mount', () => {
        expect(compose).not.toMatch(/-\s*\.:\/app\b/);
    });

    test('no anonymous `- /app/node_modules` volume', () => {
        expect(compose).not.toMatch(/-\s*\/app\/node_modules\b/);
    });
});
