#!/usr/bin/env bash
#
# run-migrate-tests.sh — PR-1a (AUD-002): e2e harness for scripts/migrate.sh.
#
# Brings up a throwaway postgres, seeds a synthetic prod-like schema (the 33
# baseline sentinel objects), and exercises the runner end-to-end: fail-close,
# baseline (one-txn + sentinel matrix + allowlist guard + ACL REVOKE), status
# (drift / db-only), up (apply via pinned blob + record, no-op repeat, SQL-error
# not recorded), the migrate_lock row-mutex, force-unlock, repair-acl, and the
# pinned-blob guarantee (a dirtied worktree file is ignored).
#
# `up` test migrations are injected as DANGLING git commits built with a TEMP
# index (GIT_INDEX_FILE) so the working tree, the real index, and branches are
# never touched. Run: npm run migrate:test   (or: bash tests/migrate/run-migrate-tests.sh)

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

COMPOSE="$HERE/docker-compose.migrate-test.yml"
SEED="$HERE/synthetic-baseline-seed.sql"
PGDB="infrasafe_migrate_test"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
PASS=0; FAIL=0
pass() { echo -e "${GREEN}  ✓ $*${NC}"; PASS=$((PASS + 1)); }
fail() { echo -e "${RED}  ✗ $*${NC}"; FAIL=$((FAIL + 1)); }
info() { echo -e "${YELLOW}» $*${NC}"; }

cleanup() {
    local rc=$?
    trap - EXIT
    info "tearing down ephemeral postgres"
    docker compose -f "$COMPOSE" down -v --remove-orphans >/dev/null 2>&1 || true
    # restore ONLY the file step 11 dirties — never the whole dir (that would nuke
    # unrelated uncommitted changes like README/new migrations).
    git checkout -- database/migrations/022_uk_outbox.sql >/dev/null 2>&1 || true
    if [ "$rc" -eq 0 ] && [ "$FAIL" -eq 0 ]; then
        echo -e "${GREEN}ALL MIGRATE E2E PASSED ($PASS assertions)${NC}"
    else
        echo -e "${RED}MIGRATE E2E FAILED (pass=$PASS fail=$FAIL rc=$rc)${NC}"
        [ "$rc" -eq 0 ] && exit 1
    fi
    exit "$rc"
}
trap cleanup EXIT

# --- helpers ---------------------------------------------------------------
tpsql() { docker compose -f "$COMPOSE" exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d "$PGDB" -tA "$@"; }

# run the runner; usage: migrate <target_sha> <subcommand...>; echoes nothing,
# returns the runner's exit code (callers capture it).
migrate() {
    local target="$1"; shift
    MIGRATE_COMPOSE_FILE="$COMPOSE" MIGRATE_PG_SERVICE=postgres MIGRATE_PG_USER=postgres \
        MIGRATE_PG_DB="$PGDB" MIGRATE_TARGET_COMMIT="$target" \
        bash scripts/migrate.sh "$@"
}

# build a dangling commit = BASELINE_TARGET + one migration file, without touching
# the working tree / index / branches. echoes the commit SHA. Based on
# BASELINE_TARGET (003-034 only) so an `up`-test adds exactly ONE pending file,
# regardless of real 035+ migrations present in HEAD.
commit_with() {  # $1=filename  $2=content
    local fn="$1" content="$2" idx blob tree commit
    idx="$(mktemp)"
    GIT_INDEX_FILE="$idx" git read-tree "$BASELINE_TARGET"
    blob="$(printf '%s' "$content" | git hash-object -w --stdin)"
    GIT_INDEX_FILE="$idx" git update-index --add --cacheinfo "100644,$blob,database/migrations/$fn"
    tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
    commit="$(git commit-tree "$tree" -p "$BASELINE_TARGET" -m "e2e: $fn")"
    rm -f "$idx"
    echo "$commit"
}

# Stable baseline target: HEAD's tree with database/migrations/ pruned to ONLY the
# 33 frozen allowlist files (003-034). Real migrations beyond the allowlist (035
# voltage rule, 036+) live in HEAD and go through `up` on prod — they must NOT be
# in the baseline target, or `baseline` would reject them and `status` would count
# them pending. Echoes the dangling commit SHA. Future-proofs the harness as new
# migrations land.
build_baseline_target() {
    local idx tree commit p fn allow
    idx="$(mktemp)"
    GIT_INDEX_FILE="$idx" git read-tree HEAD
    allow="$(node scripts/lib/migrate-discover.js allowlist)"
    while IFS= read -r p; do
        [ -z "$p" ] && continue
        fn="${p##*/}"
        printf '%s\n' "$allow" | grep -qxF -- "$fn" \
            || GIT_INDEX_FILE="$idx" git update-index --force-remove "$p"
    done < <(git ls-tree -r --name-only HEAD -- database/migrations/ | grep -E '\.sql$')
    tree="$(GIT_INDEX_FILE="$idx" git write-tree)"
    commit="$(git commit-tree "$tree" -p HEAD -m 'e2e: baseline target (003-034 only)')"
    rm -f "$idx"
    echo "$commit"
}

count_applied() { tpsql -c "SELECT count(*) FROM schema_migrations"; }
runtime_grants_on_runner() {
    tpsql -c "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee='infrasafe_runtime' AND table_schema='public' AND table_name IN ('schema_migrations','migrate_lock')"
}

# --- bring up + seed -------------------------------------------------------
BASELINE_TARGET="$(build_baseline_target)"
info "baseline target (003-034 only): $(git rev-parse --short "$BASELINE_TARGET") (HEAD $(git rev-parse --short HEAD))"

info "starting ephemeral postgres (project infrasafe-migrate-test)"
docker compose -f "$COMPOSE" up -d >/dev/null
# Robust readiness gate. The postgres image runs a TEMPORARY bootstrap server
# during initdb (to create POSTGRES_DB + run init scripts), then shuts it down
# and restarts the real server. A single pg_isready/one-shot query can catch
# that transient server, after which the seed load hits "server closed the
# connection unexpectedly" — seen on CI, not locally, purely from timing. So we
# require a REAL query (`SELECT 1`) to succeed on TWO consecutive attempts a
# second apart: the bootstrap→restart window cannot yield two in a row, so this
# is provably past init.
ready=0
for i in $(seq 1 60); do
    if docker compose -f "$COMPOSE" exec -T postgres psql -U postgres -d "$PGDB" -tAc 'SELECT 1' >/dev/null 2>&1; then
        ready=$((ready + 1))
        [ "$ready" -ge 2 ] && break
    else
        ready=0
    fi
    sleep 1
done
[ "$ready" -ge 2 ] || { echo "postgres did not become ready in time"; exit 1; }
docker compose -f "$COMPOSE" exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d "$PGDB" -q < "$SEED"
info "synthetic baseline seed loaded"

# ===========================================================================
info "1) fail-close before baseline (no schema_migrations table)"
rc=0; migrate "$BASELINE_TARGET" status >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] && pass "status fail-closes with exit 2" || fail "status exit $rc (want 2)"
rc=0; migrate "$BASELINE_TARGET" up >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] && pass "up fail-closes with exit 2" || fail "up exit $rc (want 2)"

# ===========================================================================
info "2) baseline: sentinel matrix passes, marks 33 applied, both tables, ACL revoked"
rc=0; migrate "$BASELINE_TARGET" baseline >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && pass "baseline exit 0" || fail "baseline exit $rc (want 0)"
n="$(count_applied)"; [ "$n" = "33" ] && pass "schema_migrations has 33 rows" || fail "rows=$n (want 33)"
t="$(tpsql -c "SELECT (to_regclass('public.migrate_lock') IS NOT NULL)")"
[ "$t" = "t" ] && pass "migrate_lock table created" || fail "migrate_lock missing"
g="$(runtime_grants_on_runner)"; [ "$g" = "0" ] && pass "ACL: runtime has 0 grants on runner tables" || fail "runtime grants=$g (want 0)"

# ===========================================================================
info "3) baseline refuses to re-run once schema_migrations exists"
rc=0; migrate "$BASELINE_TARGET" baseline >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] && pass "second baseline exits 1" || fail "second baseline exit $rc (want 1)"

# ===========================================================================
info "4) status clean: 33 applied, 0 pending, exit 0"
out="$(migrate "$BASELINE_TARGET" status 2>/dev/null)"; rc=$?
echo "$out" | grep -q "applied=33 pending=0 drift=0 db_only=0" && pass "status reports applied=33 pending=0" || fail "status: $out"
[ "${rc:-0}" -eq 0 ] && pass "status exit 0 when clean" || fail "status exit $rc"

# ===========================================================================
info "5) ACL: manual grant → status warns → repair-acl restores"
tpsql -c "GRANT SELECT ON schema_migrations TO infrasafe_runtime" >/dev/null
warnout="$(migrate "$BASELINE_TARGET" status 2>&1 >/dev/null || true)"
echo "$warnout" | grep -qi "ACL" && pass "status warns on ACL violation" || fail "no ACL warning: $warnout"
migrate "$BASELINE_TARGET" repair-acl >/dev/null 2>&1
g="$(runtime_grants_on_runner)"; [ "$g" = "0" ] && pass "repair-acl re-revoked (0 grants)" || fail "after repair-acl grants=$g"

# ===========================================================================
info "6) up applies a new migration from a pinned commit, records it, then no-ops"
C1="$(commit_with "035_e2e_marker.sql" $'BEGIN;\nCREATE TABLE e2e_marker_035 (id int);\nCOMMIT;\n')"
rc=0; migrate "$C1" up >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && pass "up exit 0" || fail "up exit $rc"
n="$(count_applied)"; [ "$n" = "34" ] && pass "schema_migrations now 34" || fail "rows=$n (want 34)"
t="$(tpsql -c "SELECT (to_regclass('public.e2e_marker_035') IS NOT NULL)")"
[ "$t" = "t" ] && pass "035 actually executed (table exists)" || fail "035 table missing"
rc=0; migrate "$C1" up >/dev/null 2>&1 || rc=$?
n="$(count_applied)"; [ "$rc" -eq 0 ] && [ "$n" = "34" ] && pass "second up is a no-op (still 34)" || fail "re-up rc=$rc rows=$n"
# 035_e2e_marker exists only in commit C1, not HEAD — drop its record so later
# HEAD-target status checks don't see it as db-only drift.
tpsql -c "DELETE FROM schema_migrations WHERE filename='035_e2e_marker.sql'" >/dev/null

# ===========================================================================
info "7) drift: an edited applied-migration checksum makes status exit 5"
tpsql -c "UPDATE schema_migrations SET checksum='deadbeef' WHERE filename='022_uk_outbox.sql'" >/dev/null
rc=0; migrate "$BASELINE_TARGET" status >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 5 ] && pass "checksum drift → status exit 5" || fail "drift status exit $rc (want 5)"
tpsql -c "DELETE FROM schema_migrations WHERE filename='022_uk_outbox.sql'" >/dev/null
# re-record correct checksum via a fresh up so later steps stay clean
migrate "$BASELINE_TARGET" up >/dev/null 2>&1 || true

# ===========================================================================
info "8) db-only: a recorded file absent from target makes status exit 5"
tpsql -c "INSERT INTO schema_migrations(filename,checksum) VALUES ('999_ghost.sql','x')" >/dev/null
rc=0; migrate "$BASELINE_TARGET" status >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 5 ] && pass "db-only → status exit 5" || fail "db-only status exit $rc (want 5)"
tpsql -c "DELETE FROM schema_migrations WHERE filename='999_ghost.sql'" >/dev/null

# ===========================================================================
info "9) migrate_lock row-mutex: a foreign lock blocks up; force-unlock clears it"
tpsql -c "INSERT INTO migrate_lock(id,locked_by,locked_at) VALUES (1,'someone-else',now())" >/dev/null
rc=0; migrate "$BASELINE_TARGET" up >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] && pass "up aborts while lock held (exit 1)" || fail "locked up exit $rc (want 1)"
held="$(tpsql -c "SELECT count(*) FROM migrate_lock WHERE id=1")"
[ "$held" = "1" ] && pass "foreign lock NOT stolen by aborted run" || fail "lock rows=$held (want 1)"
migrate "$BASELINE_TARGET" force-unlock >/dev/null 2>&1
held="$(tpsql -c "SELECT count(*) FROM migrate_lock WHERE id=1")"
[ "$held" = "0" ] && pass "force-unlock cleared the lock" || fail "after force-unlock rows=$held"

# ===========================================================================
info "10) a failing migration is NOT recorded and the lock is released"
before="$(count_applied)"
C2="$(commit_with "036_e2e_bad.sql" $'BEGIN;\nSELECT this_is_not_valid_sql_function();\nCOMMIT;\n')"
rc=0; migrate "$C2" up >/dev/null 2>&1 || rc=$?
[ "$rc" -ne 0 ] && pass "failing migration → up non-zero" || fail "bad up exit $rc (want non-zero)"
after="$(count_applied)"; [ "$after" = "$before" ] && pass "failed migration not recorded" || fail "rows $before→$after"
rec="$(tpsql -c "SELECT count(*) FROM schema_migrations WHERE filename='036_e2e_bad.sql'")"
[ "$rec" = "0" ] && pass "036 absent from schema_migrations" || fail "036 recorded"
held="$(tpsql -c "SELECT count(*) FROM migrate_lock WHERE id=1")"
[ "$held" = "0" ] && pass "lock released after failed up" || fail "lock stuck after fail (rows=$held)"

# ===========================================================================
info "11) pinned-blob: a dirtied worktree migration file is ignored (target blob wins)"
echo "-- e2e junk appended to worktree (must be ignored by runner)" >> database/migrations/022_uk_outbox.sql
rc=0; migrate "$BASELINE_TARGET" status >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 0 ] && pass "worktree edit ignored — status still clean (reads target blob)" || fail "status exit $rc with dirty worktree (want 0)"
git checkout -- database/migrations/022_uk_outbox.sql

# ===========================================================================
info "12) fresh-init: 99_schema_migrations_baseline.sql self-declares 003-017"
docker compose -f "$COMPOSE" exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d "$PGDB" -q \
    -c "CREATE DATABASE fresh_init_test" >/dev/null 2>&1
docker compose -f "$COMPOSE" exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d fresh_init_test -q \
    < database/init/99_schema_migrations_baseline.sql >/dev/null 2>&1 && pass "99_ runs clean on a fresh DB" || fail "99_ failed to execute"
fi_n="$(docker compose -f "$COMPOSE" exec -T postgres psql -tA -U postgres -d fresh_init_test -c "SELECT count(*) FROM schema_migrations")"
[ "$fi_n" = "16" ] && pass "fresh-init declared 16 migrations (003-017)" || fail "fresh-init rows=$fi_n (want 16)"
fi_max="$(docker compose -f "$COMPOSE" exec -T postgres psql -tA -U postgres -d fresh_init_test -c "SELECT max(left(filename,3)) FROM schema_migrations")"
[ "$fi_max" = "017" ] && pass "highest declared migration is 017 (018+ left for up)" || fail "fresh-init max=$fi_max (want 017)"
fi_lock="$(docker compose -f "$COMPOSE" exec -T postgres psql -tA -U postgres -d fresh_init_test -c "SELECT (to_regclass('public.migrate_lock') IS NOT NULL)")"
[ "$fi_lock" = "t" ] && pass "fresh-init created migrate_lock" || fail "fresh-init migrate_lock missing"

# ===========================================================================
info "13) image-mode discover_js: runner works with NO host node (prod path)"
# MIGRATE_NODE_MODE=image forces the container fallback even though this dev host
# HAS node — reproducing exactly what prod does (node only inside an image). The
# invariant: image-mode must yield the SAME reconcile as host-mode. This drives
# discover (ls-tree → image node) AND file_checksum (git show → image node) — a
# differing checksum or discovery would flip an applied file to drift/pending and
# diverge the lines. Regression guard for the node-not-found prod bug. (We compare
# to host-mode rather than hardcode counts, since earlier steps mutated state.)
host_line="$(migrate "$BASELINE_TARGET" status 2>/dev/null | grep '^migrate-status:' || true)"
img_line="$(MIGRATE_COMPOSE_FILE="$COMPOSE" MIGRATE_PG_SERVICE=postgres MIGRATE_PG_USER=postgres \
    MIGRATE_PG_DB="$PGDB" MIGRATE_TARGET_COMMIT="$BASELINE_TARGET" \
    MIGRATE_NODE_MODE=image MIGRATE_NODE_SERVICE=mignode \
    bash scripts/migrate.sh status 2>/dev/null | grep '^migrate-status:' || true)"
[ -n "$img_line" ] && pass "image-mode status ran (node via image)" || fail "image-mode produced no status line"
[ -n "$img_line" ] && [ "$img_line" = "$host_line" ] \
    && pass "image-mode reconcile identical to host-mode ($img_line)" \
    || fail "host[$host_line] != image[$img_line]"
# invalid mode is rejected loudly
rc=0; MIGRATE_COMPOSE_FILE="$COMPOSE" MIGRATE_PG_USER=postgres MIGRATE_PG_DB="$PGDB" \
    MIGRATE_TARGET_COMMIT="$BASELINE_TARGET" MIGRATE_NODE_MODE=bogus \
    bash scripts/migrate.sh status >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] && pass "invalid MIGRATE_NODE_MODE rejected (exit 1)" || fail "bogus mode exit $rc (want 1)"

echo ""
info "summary: pass=$PASS fail=$FAIL"
