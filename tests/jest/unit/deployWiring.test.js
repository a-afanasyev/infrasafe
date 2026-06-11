// PR-1a (AUD-002): structural guard for the migration-runner deploy wiring in
// update-production.sh. The runner's runtime behavior is e2e-tested in
// tests/migrate/run-migrate-tests.sh; this test pins the WIRING contract:
//   * MIGRATE_WIRING_ENABLED defaults to false (dormant — PR-1a ships it off);
//   * `migrate.sh status` and `migrate.sh up` run ONLY in the enabled branch,
//     and BEFORE the app switch (Step 4);
//   * the disabled branch keeps the legacy `git pull --ff-only`;
//   * the divergence guard and runner-change guard precede `up`.

const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(
    path.resolve(__dirname, '../../../update-production.sh'),
    'utf8'
);

describe('update-production.sh migration wiring', () => {
    test('MIGRATE_WIRING_ENABLED defaults to false (dormant)', () => {
        expect(SCRIPT).toMatch(/MIGRATE_WIRING_ENABLED="\$\{MIGRATE_WIRING_ENABLED:-false\}"/);
    });

    test('migrate up/status live inside the enabled branch only', () => {
        const ifIdx = SCRIPT.indexOf('if [ "$MIGRATE_WIRING_ENABLED" = "true" ]');
        const elseIdx = SCRIPT.indexOf('else', ifIdx);
        const fiIdx = SCRIPT.indexOf('\nfi', elseIdx);
        expect(ifIdx).toBeGreaterThan(-1);
        expect(elseIdx).toBeGreaterThan(ifIdx);

        const enabledBranch = SCRIPT.slice(ifIdx, elseIdx);
        const disabledBranch = SCRIPT.slice(elseIdx, fiIdx);

        expect(enabledBranch).toMatch(/bash scripts\/migrate\.sh status/);
        expect(enabledBranch).toMatch(/bash scripts\/migrate\.sh up/);
        // legacy path must NOT invoke the runner
        expect(disabledBranch).not.toMatch(/migrate\.sh/);
        expect(disabledBranch).toMatch(/git pull --ff-only/);
    });

    test('schema is applied before the app switch (Step 4)', () => {
        const upIdx = SCRIPT.indexOf('scripts/migrate.sh up');
        const switchIdx = SCRIPT.indexOf('Step 4: switch app');
        expect(upIdx).toBeGreaterThan(-1);
        expect(switchIdx).toBeGreaterThan(upIdx);
    });

    test('divergence guard and runner-change guard precede up', () => {
        const ancestorIdx = SCRIPT.indexOf('merge-base --is-ancestor HEAD');
        const guardIdx = SCRIPT.indexOf('runner change +');
        const upIdx = SCRIPT.indexOf('scripts/migrate.sh up');
        expect(ancestorIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(ancestorIdx).toBeLessThan(upIdx);
        expect(guardIdx).toBeLessThan(upIdx);
    });
});
