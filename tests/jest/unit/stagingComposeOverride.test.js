// [R2-15 Phase 2] Structural guard for the staging compose override. The runtime
// merge is verified operationally with `docker compose -f docker-compose.unified.yml
// -f docker-compose.staging.yml config` (see the R2-15 memory / staging runbook);
// this test pins the override's CONTRACT so a future edit to the base compose or
// the override can't silently break the staging deployment shape.
//
// Verified merge semantics this override relies on (docker compose config, 2026-07-05):
//   * top-level `networks: {external: false}` REPLACES the base `external: true`
//     → a fresh staging VM creates local bridges (no docker network create prereq);
//   * `command` + `healthcheck.test` REPLACE → staging nginx conf;
//   * a volume with the SAME container target REPLACES the base source (staging
//     certs + the neutralized database.sql); a DIFFERENT target APPENDS (init dir);
//   * env_file APPENDS `.env.staging` LAST → it wins over any stray `.env.prod`.

const fs = require('fs');
const path = require('path');

const OVERRIDE = fs.readFileSync(
    path.resolve(__dirname, '../../../docker-compose.staging.yml'),
    'utf8'
);
const BASE = fs.readFileSync(
    path.resolve(__dirname, '../../../docker-compose.unified.yml'),
    'utf8'
);

describe('docker-compose.staging.yml override contract (R2-15 Phase 2)', () => {
    test('nginx edge points at the staging config (command + healthcheck)', () => {
        // both the run command and the healthcheck -t must validate nginx.staging.conf,
        // NOT the prod config the base pins.
        const staging = OVERRIDE.match(/nginx\.staging\.conf/g) || [];
        expect(staging.length).toBeGreaterThanOrEqual(2);
        // ignore explanatory comments; no ACTIVE directive may reference the prod conf.
        const active = OVERRIDE
            .split('\n')
            .filter((l) => !l.trim().startsWith('#'))
            .join('\n');
        expect(active).not.toMatch(/nginx\.production\.conf/);
    });

    test('nginx TLS certs are overridden to the staging host (same-target replace)', () => {
        // same /etc/nginx/ssl/*.pem targets as the base → the override replaces the
        // cert SOURCE; must be the staging.infrasafe.uz certbot live dir.
        for (const pem of ['fullchain', 'privkey', 'chain']) {
            expect(OVERRIDE).toMatch(
                new RegExp(`/etc/letsencrypt/live/staging\\.infrasafe\\.uz/${pem}\\.pem:/etc/nginx/ssl/${pem}\\.pem`)
            );
        }
    });

    test('postgres bootstraps from database/init and neutralizes database.sql', () => {
        // fresh-init seed: the whole init dir (carries 99_schema_migrations_baseline.sql)
        expect(OVERRIDE).toMatch(/\.\/database\/init:\/docker-entrypoint-initdb\.d:ro/);
        // same target as the base database.sql mount → source replaced with the no-op,
        // so the manifest-less legacy snapshot never runs (would fail-close migrate).
        expect(OVERRIDE).toMatch(
            /\.\/database\/staging-initdb-noop\.sql:\/docker-entrypoint-initdb\.d\/database\.sql:ro/
        );
    });

    test('the staging no-op init file exists and is a no-op', () => {
        const noop = fs.readFileSync(
            path.resolve(__dirname, '../../../database/staging-initdb-noop.sql'),
            'utf8'
        );
        // comments only — no executable SQL statement
        const code = noop
            .split('\n')
            .filter((l) => !l.trim().startsWith('--') && l.trim() !== '')
            .join('');
        expect(code).toBe('');
    });

    test('external prod networks are redeclared non-external (fresh-VM bridges)', () => {
        // the base declares both as external: true; the override must flip them so a
        // fresh staging VM can create local bridges without a pre-create prereq.
        expect(BASE).toMatch(/infrasafe-network:\s*\n\s*external:\s*true/);
        expect(OVERRIDE).toMatch(/infrasafe-network:\s*\n\s*external:\s*false/);
        expect(OVERRIDE).toMatch(/uk-network:\s*\n\s*external:\s*false/);
    });

    test('app + postgres append .env.staging (wins over a stray .env.prod)', () => {
        const occurrences = OVERRIDE.match(/path:\s*\.env\.staging/g) || [];
        expect(occurrences.length).toBeGreaterThanOrEqual(2); // app + postgres
    });
});
