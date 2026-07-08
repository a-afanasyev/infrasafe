// R2-15 Phase A: scripts/migrate.sh must accept the SAME compose `-f` set as the
// deploy. On staging the override removes/changes the prod-only external networks,
// so a base-only `docker compose exec/images` mis-validates the network model.
// MIGRATE_COMPOSE_FILE therefore may carry ONE filename (backward-compatible) OR a
// whitespace-separated LIST that the runner splits into `-f a -f b`.
//
// Structural guard + a behavioral check of the split logic in isolation (the
// runner's full behavior is e2e-tested in tests/migrate/run-migrate-tests.sh).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MIGRATE = fs.readFileSync(
    path.resolve(__dirname, '../../../scripts/migrate.sh'),
    'utf8'
);

// The exact parsing block lifted from migrate.sh — run in isolation so we assert
// the OBSERVABLE `-f`-arg expansion, not just a regex.
const SPLIT_SNIPPET = `
set -Eeuo pipefail
MIGRATE_COMPOSE_FILE="$1"
read -r -a _MIGRATE_COMPOSE_FILES <<< "$MIGRATE_COMPOSE_FILE"
COMPOSE_F_ARGS=()
for _cf in "\${_MIGRATE_COMPOSE_FILES[@]}"; do COMPOSE_F_ARGS+=(-f "$_cf"); done
printf '%s\\n' "\${COMPOSE_F_ARGS[@]}"
`;

function expand(composeFileValue) {
    return execFileSync('bash', ['-c', SPLIT_SNIPPET, 'x', composeFileValue], {
        encoding: 'utf8',
    }).trim().split('\n');
}

describe('migrate.sh compose-file set (R2-15 Phase A)', () => {
    test('parses MIGRATE_COMPOSE_FILE into a -f arg array', () => {
        expect(MIGRATE).toMatch(/read -r -a _MIGRATE_COMPOSE_FILES <<< "\$MIGRATE_COMPOSE_FILE"/);
        expect(MIGRATE).toMatch(/COMPOSE_F_ARGS\+=\(-f "\$_cf"\)/);
    });

    test('both docker compose calls use the ${COMPOSE_F_ARGS[@]} set (no scalar -f)', () => {
        expect(MIGRATE).toMatch(/docker compose "\$\{COMPOSE_F_ARGS\[@\]\}" exec -T/);
        expect(MIGRATE).toMatch(/docker compose "\$\{COMPOSE_F_ARGS\[@\]\}" images -q/);
        expect(MIGRATE).not.toMatch(/docker compose -f "\$MIGRATE_COMPOSE_FILE"/);
    });

    test('a single filename expands to one -f (backward-compatible)', () => {
        expect(expand('docker-compose.unified.yml')).toEqual([
            '-f', 'docker-compose.unified.yml',
        ]);
    });

    test('a whitespace-separated list expands to -f per file (staging)', () => {
        expect(expand('docker-compose.unified.yml docker-compose.staging.yml')).toEqual([
            '-f', 'docker-compose.unified.yml',
            '-f', 'docker-compose.staging.yml',
        ]);
    });
});
