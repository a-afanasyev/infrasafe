// PR-1a (AUD-002): structural guard for the migration-runner deploy wiring in
// update-production.sh. The runner's runtime behavior is e2e-tested in
// tests/migrate/run-migrate-tests.sh; this test pins the WIRING contract:
//   * MIGRATE_WIRING_ENABLED defaults to true (PR-1b enabled it after the one-time
//     prod baseline; PR-1a shipped it off, 1b flipped the default);
//   * `migrate.sh status` and `migrate.sh up` run ONLY in the enabled branch,
//     and BEFORE the app switch (Step 4);
//   * both branches fast-forward with `git merge --ff-only "$TARGET"` (R2-15
//     moved the shared `git fetch` + target resolution ABOVE the if/else so the
//     registry image can be pulled once, before either branch);
//   * the disabled branch does NOT invoke the runner;
//   * the divergence guard and runner-change guard precede `up`.
//
// R2-15 additions (image source): APP_IMAGE_SOURCE is validated up front; the
// registry image is pulled as a PREFLIGHT before `migrate up`; the app switch
// runs with `--no-build`.

const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(
    path.resolve(__dirname, '../../../update-production.sh'),
    'utf8'
);

describe('update-production.sh migration wiring', () => {
    test('MIGRATE_WIRING_ENABLED defaults to true (enabled post-baseline)', () => {
        expect(SCRIPT).toMatch(/MIGRATE_WIRING_ENABLED="\$\{MIGRATE_WIRING_ENABLED:-true\}"/);
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
        // R2-15: both branches fast-forward with `git merge --ff-only "$TARGET"`
        // (the shared `git fetch` now lives above the if/else). The legacy branch
        // no longer runs `git pull` (that would re-fetch and bypass the target pin).
        expect(disabledBranch).toMatch(/git merge --ff-only "\$TARGET"/);
        expect(disabledBranch).not.toMatch(/git pull/);
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

// R2-15: image comes from GHCR (deploy-by-pull) instead of a host build.
describe('update-production.sh image-source wiring (R2-15)', () => {
    test('APP_IMAGE_SOURCE defaults to registry and is validated up front', () => {
        expect(SCRIPT).toMatch(/APP_IMAGE_SOURCE="\$\{APP_IMAGE_SOURCE:-registry\}"/);
        // a case-guard rejects any value other than registry|build (no bare else
        // falling through to a host build)
        expect(SCRIPT).toMatch(/case "\$APP_IMAGE_SOURCE" in\s*\n\s*registry\|build\)/);
    });

    test('registry image is pulled as a PREFLIGHT before migrate up (schema-safe)', () => {
        const pullIdx = SCRIPT.indexOf('docker pull "$PULL_REF"');
        const upIdx = SCRIPT.indexOf('scripts/migrate.sh up');
        const switchIdx = SCRIPT.indexOf('Step 4: switch app');
        expect(pullIdx).toBeGreaterThan(-1);
        // pull must precede both the schema change and the app switch, so a
        // missing image aborts with the DB + container untouched
        expect(pullIdx).toBeLessThan(upIdx);
        expect(pullIdx).toBeLessThan(switchIdx);
    });

    test('build escape hatch host-builds only AFTER the merge (not pre-migrate-safe)', () => {
        const buildIdx = SCRIPT.indexOf('docker compose -f "$COMPOSE_FILE" build app');
        const mergeIdx = SCRIPT.indexOf('git merge --ff-only "$TARGET"');
        expect(buildIdx).toBeGreaterThan(-1);
        expect(mergeIdx).toBeGreaterThan(-1);
        expect(buildIdx).toBeGreaterThan(mergeIdx);
    });

    test('DEPLOY_TARGET_COMMIT is normalized to a full SHA and Guard B keeps it on-branch', () => {
        expect(SCRIPT).toMatch(/git rev-parse --verify "\$TARGET\^\{commit\}"/);
        expect(SCRIPT).toMatch(/merge-base --is-ancestor "\$TARGET" "origin\/\$BRANCH"/);
    });

    test('app switch runs with --no-build (never a host build on recreate)', () => {
        expect(SCRIPT).toMatch(/up -d --no-deps --force-recreate --no-build app/);
    });

    test('image retention prunes on the success path, never prune --all', () => {
        expect(SCRIPT).toMatch(/docker image prune -f/);
        expect(SCRIPT).not.toMatch(/image prune[^\n]*--all/);
    });
});
