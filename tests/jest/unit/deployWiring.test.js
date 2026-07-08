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
        const buildIdx = SCRIPT.indexOf('docker compose "${COMPOSE_ARGS[@]}" build app');
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

// R2-15 Phase A: DEPLOY_ENV parameterization (prod=profk | staging). Real prod is
// now the profk box, so `prod` MUST select the profk compose override + profk.uz
// URLs — this is NOT byte-compatible with the old infrasafe.uz prod. `staging`
// selects the staging override + staging.infrasafe.uz.
describe('update-production.sh DEPLOY_ENV parameterization (R2-15 Phase A)', () => {
    test('DEPLOY_ENV defaults to prod (an unset call == DEPLOY_ENV=prod == profk)', () => {
        expect(SCRIPT).toMatch(/DEPLOY_ENV="\$\{DEPLOY_ENV:-prod\}"/);
    });

    test('prod selects the profk compose set + profk.uz edge/verify URLs', () => {
        const prodIdx = SCRIPT.indexOf('    prod)');
        const stagingIdx = SCRIPT.indexOf('    staging)');
        expect(prodIdx).toBeGreaterThan(-1);
        expect(stagingIdx).toBeGreaterThan(prodIdx);
        const prodBranch = SCRIPT.slice(prodIdx, stagingIdx);
        expect(prodBranch).toMatch(/COMPOSE_FILES=\(docker-compose\.unified\.yml docker-compose\.profk\.yml\)/);
        expect(prodBranch).toMatch(/ENV_FILE="\.env\.prod"/);
        expect(prodBranch).toMatch(/https:\/\/profk\.uz\/health/);
        expect(prodBranch).toMatch(/VERIFY_URL_BASE:-https:\/\/profk\.uz/);
    });

    test('staging selects the staging compose set + staging.infrasafe.uz URLs', () => {
        const stagingIdx = SCRIPT.indexOf('    staging)');
        const escIdx = SCRIPT.indexOf('bad DEPLOY_ENV', stagingIdx);
        const stagingBranch = SCRIPT.slice(stagingIdx, escIdx);
        expect(stagingBranch).toMatch(/COMPOSE_FILES=\(docker-compose\.unified\.yml docker-compose\.staging\.yml\)/);
        expect(stagingBranch).toMatch(/ENV_FILE="\.env\.staging"/);
        expect(stagingBranch).toMatch(/staging\.infrasafe\.uz/);
    });

    test('an unknown DEPLOY_ENV fails closed (no default host/compose fallthrough)', () => {
        expect(SCRIPT).toMatch(/\*\)\s*echo "❌ bad DEPLOY_ENV=\$DEPLOY_ENV \(want prod\|staging\)"[^\n]*exit 1/);
    });

    test('every docker compose call uses the ${COMPOSE_ARGS[@]} set — incl. rollback + switch', () => {
        // COMPOSE_ARGS is derived from COMPOSE_FILES with a -f per file
        expect(SCRIPT).toMatch(/COMPOSE_ARGS=\(\); for _cf in "\$\{COMPOSE_FILES\[@\]\}"; do COMPOSE_ARGS\+=\(-f "\$_cf"\); done/);
        // no `docker compose -f "$COMPOSE_FILE" …` (scalar) survivors anywhere
        expect(SCRIPT).not.toMatch(/docker compose -f "\$COMPOSE_FILE"/);
        // rollback trap recreates app with the array (network model must match deploy)
        const rollbackIdx = SCRIPT.indexOf('rollback() {');
        const trapEnd = SCRIPT.indexOf('trap rollback ERR');
        const rollbackFn = SCRIPT.slice(rollbackIdx, trapEnd);
        expect(rollbackFn).toMatch(/docker compose "\$\{COMPOSE_ARGS\[@\]\}" up -d --no-deps --force-recreate --no-build app/);
    });

    test('migrate runner gets the SAME compose set as the deploy (filenames joined)', () => {
        expect(SCRIPT).toMatch(/export MIGRATE_COMPOSE_FILE="\$\{COMPOSE_FILES\[\*\]\}"/);
    });

    test('BRANCH honors DEPLOY_BRANCH for cron/detached-HEAD auto-deploy', () => {
        expect(SCRIPT).toMatch(/BRANCH="\$\{DEPLOY_BRANCH:-\$\(git branch --show-current\)\}"/);
    });

    test('SEC-15 env check is per-env, and staging fails closed on a stray .env.prod', () => {
        expect(SCRIPT).toMatch(/test -f "\$ENV_FILE"/);
        expect(SCRIPT).toMatch(/readlink -f "\$ENV_FILE"/);
        expect(SCRIPT).toMatch(/DEPLOY_ENV" = "staging" \] && \[ -e \.env\.prod \]/);
    });

    test('VERIFY_URL_BASE is exported so rebuild-frontend.sh verifies the right domain', () => {
        expect(SCRIPT).toMatch(/export VERIFY_URL_BASE/);
    });

    test('edge nginx is reloaded only when nginx-config changed this release', () => {
        const stepIdx = SCRIPT.indexOf('Step 6b');
        expect(stepIdx).toBeGreaterThan(-1);
        const step = SCRIPT.slice(stepIdx, stepIdx + 600);
        expect(step).toMatch(/git diff --name-only "\$PREV_COMMIT" HEAD -- nginx-config\//);
        expect(step).toMatch(/nginx -t/);
        expect(step).toMatch(/nginx -s reload/);
    });
});
