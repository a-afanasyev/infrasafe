#!/usr/bin/env bash
#
# migrate.sh — PR-1a (AUD-002): host-run PostgreSQL migration runner.
#
# Source of truth is the DB table `schema_migrations` (filename PK). The runner
# applies migrations from a PINNED git commit ($MIGRATE_TARGET_COMMIT) — never
# from the working tree — so a modified/untracked file on the deploy host cannot
# change what gets applied (no TOCTOU). It runs OUTSIDE the immutable app image
# (scripts/ is not baked in), talking to postgres via `docker compose exec`.
#
# Subcommands:
#   status        Report applied / pending / drift (+ ACL invariant). Exit:
#                 0 clean, 2 no schema_migrations (fail-close), 5 drift.
#   up            Apply pending migrations under a DB row-mutex. Records each in
#                 schema_migrations. Fail-closes (exit 2) if the table is absent.
#   baseline      One-time: create the runner tables, verify a sentinel matrix,
#                 and mark the frozen allowlist (003-034) applied WITHOUT running
#                 them — for a DB hand-migrated before the runner existed.
#   force-unlock  Clear a stale migrate_lock row (explicit operator action only).
#   repair-acl    Re-REVOKE runtime DML on the runner tables (recovery path).
#
# Required env:
#   MIGRATE_COMPOSE_FILE   compose file(s). ONE filename (prod: docker-compose.unified.yml)
#                          OR a whitespace-separated LIST that the runner splits into
#                          multiple `-f` args (staging: "docker-compose.unified.yml
#                          docker-compose.staging.yml") so `compose exec/images` validate
#                          against the SAME network/volume model as the deploy — a
#                          base-only file mis-validates an override that removes/changes
#                          external networks.
#   MIGRATE_PG_USER        psql role (prod: infrasafe_app, dev: postgres)
#   MIGRATE_TARGET_COMMIT  commit-ish the migrations are read from (status/up/baseline)
# Optional env:
#   MIGRATE_PG_SERVICE     compose service name (default: postgres)
#   MIGRATE_PG_DB          database name        (default: infrasafe)
#   MIGRATE_NODE_MODE      where to run migrate-discover.js: auto|host|image
#                          (default auto). Production deploy hosts have node ONLY
#                          inside the app image (scripts/ is not baked in per
#                          SEC-14 and the host has no node), so 'auto' falls back
#                          to running node from that image when the host has none.
#   MIGRATE_NODE_SERVICE   compose service whose container image carries node,
#                          used by the image fallback (default: app). Resolved via
#                          `docker compose images -q <service>` (service-scoped).
#   MIGRATE_NODE_IMAGE     pin the node-carrying image explicitly, bypassing
#                          service resolution (e.g. when the service has no
#                          container up).

set -Eeuo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
say()  { echo -e "${BLUE}$*${NC}"; }
ok()   { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}" >&2; }
err()  { echo -e "${RED}$*${NC}" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"   # git show / ls-tree resolve against the repo

# --- required env ----------------------------------------------------------
: "${MIGRATE_COMPOSE_FILE:?MIGRATE_COMPOSE_FILE is required (e.g. docker-compose.unified.yml)}"
: "${MIGRATE_PG_USER:?MIGRATE_PG_USER is required (prod: infrasafe_app, dev: postgres)}"
MIGRATE_PG_SERVICE="${MIGRATE_PG_SERVICE:-postgres}"
MIGRATE_PG_DB="${MIGRATE_PG_DB:-infrasafe}"

# MIGRATE_COMPOSE_FILE may name ONE file (backward-compatible) or a whitespace-
# separated LIST → build `-f a -f b`. Word-splitting is intentional here.
read -r -a _MIGRATE_COMPOSE_FILES <<< "$MIGRATE_COMPOSE_FILE"
COMPOSE_F_ARGS=()
for _cf in "${_MIGRATE_COMPOSE_FILES[@]}"; do COMPOSE_F_ARGS+=(-f "$_cf"); done

RUN_ID="$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)"
LOCK_ACQUIRED=0

# --- psql plumbing ---------------------------------------------------------
psql_base() {
    # -q suppresses the command-status tag ("INSERT 0 0") that otherwise pollutes
    # captured output — critical for the ON CONFLICT … RETURNING lock probe, whose
    # emptiness (0 rows) is the "lock already held" signal. Query results, NOTICEs,
    # and errors are unaffected.
    docker compose "${COMPOSE_F_ARGS[@]}" exec -T "$MIGRATE_PG_SERVICE" \
        psql -q -v ON_ERROR_STOP=1 -U "$MIGRATE_PG_USER" -d "$MIGRATE_PG_DB" "$@"
}
db_scalar() { psql_base -tA "$@"; }

# --- git / discovery -------------------------------------------------------
require_target() {
    [ -n "${MIGRATE_TARGET_COMMIT:-}" ] || { err "MIGRATE_TARGET_COMMIT is required"; exit 1; }
    git rev-parse --verify --quiet "${MIGRATE_TARGET_COMMIT}^{commit}" >/dev/null \
        || { err "MIGRATE_TARGET_COMMIT '$MIGRATE_TARGET_COMMIT' is not a valid commit"; exit 1; }
}

# discover_js runs migrate-discover.js. It is self-contained (reads stdin/argv,
# only the builtin crypto — no git, no repo state), so the bash side owns all git
# plumbing and merely pipes bytes in. Resolution:
#   host  — use the host's `node` (dev machines, CI).
#   image — `docker run` node from MIGRATE_NODE_SERVICE's image with the lib dir
#           bind-mounted read-only. This is the production path: deploy hosts have
#           no host node (node lives only inside the app image; scripts/ is NOT
#           baked into that immutable image, so `compose exec app` can't see this
#           file either — a fresh `docker run … -v lib` is the way in).
#   auto  — host if `node` is on PATH, else image.
MIGRATE_NODE_MODE="${MIGRATE_NODE_MODE:-auto}"
MIGRATE_NODE_SERVICE="${MIGRATE_NODE_SERVICE:-app}"
_use_host_node=0
case "$MIGRATE_NODE_MODE" in
    host)  _use_host_node=1 ;;
    image) _use_host_node=0 ;;
    auto)  command -v node >/dev/null 2>&1 && _use_host_node=1 || _use_host_node=0 ;;
    *)     err "invalid MIGRATE_NODE_MODE '$MIGRATE_NODE_MODE' (want auto|host|image)"; exit 1 ;;
esac

if [ "$_use_host_node" = 1 ]; then
    discover_js() { node "$LIB_DIR/migrate-discover.js" "$@"; }
else
    # Resolve the node-carrying image. MIGRATE_NODE_IMAGE pins it explicitly.
    # Otherwise use `compose images -q <svc>` — the image of THAT service's
    # container (deterministic, service-scoped). We deliberately do NOT use
    # `config --images <svc>`: that also lists the service's DEPENDENCIES (e.g.
    # the postgres/postgis image) in an unstable order, so `head` may pick the
    # wrong one — exactly the bug this avoids.
    _NODE_IMAGE="${MIGRATE_NODE_IMAGE:-}"
    if [ -z "$_NODE_IMAGE" ]; then
        _NODE_IMAGE="$(docker compose "${COMPOSE_F_ARGS[@]}" images -q "$MIGRATE_NODE_SERVICE" 2>/dev/null | head -n1 || true)"
    fi
    [ -n "${_NODE_IMAGE:-}" ] || {
        err "no host node and could not resolve an image for compose service '$MIGRATE_NODE_SERVICE'"
        err "ensure that service has a container (e.g. docker compose up -d $MIGRATE_NODE_SERVICE),"
        err "or pin it explicitly with MIGRATE_NODE_IMAGE=<image-carrying-node>."
        exit 1
    }
    warn "host 'node' absent — running migrate-discover.js via image '$_NODE_IMAGE' (service '$MIGRATE_NODE_SERVICE')"
    # -i keeps stdin open so the git-show / ls-tree pipe reaches node; --rm leaves
    # nothing behind; lib mounted read-only.
    discover_js() {
        docker run --rm -i -v "$LIB_DIR":/miglib:ro --entrypoint node "$_NODE_IMAGE" /miglib/migrate-discover.js "$@"
    }
fi

# Ordered "<filename>\t<path>" lines for the target commit. discover_js exits 3 on
# an unsafe filename → pipefail aborts the run.
discover_lines() {
    git ls-tree -r -z --format='%(objectname) %(path)' "$MIGRATE_TARGET_COMMIT" -- database/migrations/ \
        | discover_js discover
}

# sha256 of a blob's content at the target commit. $1 = repo-relative path.
file_checksum() {
    git show "$MIGRATE_TARGET_COMMIT:$1" | discover_js checksum
}

# --- shared guards ---------------------------------------------------------
failclose_if_no_table() {
    local have
    have="$(db_scalar -c "SELECT (to_regclass('public.schema_migrations') IS NOT NULL)")"
    if [ "$have" != "t" ]; then
        err "schema_migrations does not exist — fail-close (will NOT create it here)."
        err "Existing DB → run 'baseline' first; fresh DB → 99_schema_migrations_baseline.sql self-declares."
        exit 2
    fi
}

acl_enforce() {
    psql_base <<'SQL'
DO $acl$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        REVOKE ALL ON schema_migrations FROM infrasafe_runtime;
        REVOKE ALL ON migrate_lock      FROM infrasafe_runtime;
    END IF;
END
$acl$;
SQL
}

# NOTE: psql performs :'var' interpolation for stdin/-f input but NOT for -c, so
# every parameterized query below feeds SQL via stdin with -v flags as args.
acquire_lock() {
    local got
    got="$(psql_base -tA -v rid="$RUN_ID" <<'SQL'
INSERT INTO migrate_lock(id, locked_by) VALUES (1, :'rid')
ON CONFLICT (id) DO NOTHING RETURNING locked_by;
SQL
)"
    if [ -z "$got" ]; then
        local holder
        holder="$(db_scalar -c "SELECT locked_by || ' since ' || locked_at FROM migrate_lock WHERE id = 1")"
        err "migration lock held by: ${holder:-unknown}"
        err "if a previous run crashed, clear it explicitly with: $0 force-unlock"
        exit 1
    fi
    LOCK_ACQUIRED=1
}

release_lock() {
    psql_base -v rid="$RUN_ID" >/dev/null <<'SQL'
DELETE FROM migrate_lock WHERE id = 1 AND locked_by = :'rid';
SQL
}

# --- up --------------------------------------------------------------------
# Cleanup runs on ANY exit. ACL-enforce while still holding the lock (mutexed),
# then release the lock (owner-scoped). rc semantics:
#   migration failed (rc!=0): preserve rc; ACL/lock failures are warnings (lock
#                             failure is loud — next run may need force-unlock).
#   migration ok    (rc==0):  a failed lock-release OR ACL-enforce escalates to
#                             exit 1 — never finish "green" with the lock stuck
#                             or runner-table grants left open.
cleanup_up() {
    local rc=$?
    trap - EXIT
    set +e
    local lrf=0 aclf=0
    if [ "$LOCK_ACQUIRED" = 1 ]; then
        acl_enforce >/dev/null 2>&1 || aclf=1
        release_lock || lrf=1
    fi
    if [ "$rc" -ne 0 ]; then
        [ "$lrf" = 1 ] && err "‼️  lock release failed during cleanup (RUN_ID=$RUN_ID) — may need: $0 force-unlock"
        [ "$aclf" = 1 ] && warn "ACL enforce failed during error-path cleanup (best-effort)"
        exit "$rc"
    fi
    if [ "$lrf" = 1 ]; then err "‼️  lock release failed after successful up — run: $0 force-unlock"; exit 1; fi
    if [ "$aclf" = 1 ]; then err "‼️  ACL enforce REVOKE failed after successful up — runner-table grants NOT locked down; run: $0 repair-acl"; exit 1; fi
    exit 0
}

# Process one migration under the lock: re-SELECT its recorded checksum, then
# skip / abort-on-drift / apply+record.
process_one() {
    local fn="$1" path="$2"
    local db_ck file_ck
    db_ck="$(psql_base -tA -v fn="$fn" <<'SQL'
SELECT checksum FROM schema_migrations WHERE filename = :'fn';
SQL
)"
    file_ck="$(file_checksum "$path")"
    if [ -n "$db_ck" ]; then
        if [ "$db_ck" = "$file_ck" ]; then
            return 0
        fi
        err "  ✗ $fn checksum drift: applied != target — roll-forward-only violation (applied migrations are immutable)"
        return 1
    fi
    say "  + applying $fn"
    # pinned blob via stdin; pipefail catches a bad blob (git show fail) so we
    # never record a migration that did not actually run. The migration owns its
    # own txn (007 is CREATE INDEX CONCURRENTLY — non-transactional) so the
    # runner does NOT wrap it.
    git show "$MIGRATE_TARGET_COMMIT:$path" | psql_base
    # record in a SEPARATE statement
    psql_base -v fn="$fn" -v ck="$file_ck" <<'SQL'
INSERT INTO schema_migrations(filename, checksum) VALUES (:'fn', :'ck');
SQL
    ok "  ✓ $fn applied + recorded"
}

cmd_up() {
    require_target
    failclose_if_no_table
    trap cleanup_up EXIT
    acquire_lock
    local discovered
    discovered="$(discover_lines)"
    local count=0
    while IFS=$'\t' read -r fn path; do
        [ -z "$fn" ] && continue
        process_one "$fn" "$path"
        count=$((count + 1))
    done <<< "$discovered"
    ok "up: $count migration(s) reconciled (target $(git rev-parse --short "$MIGRATE_TARGET_COMMIT"))"
}

# --- status ----------------------------------------------------------------
acl_invariant_warn() {
    local viol
    viol="$(db_scalar <<'SQL'
SELECT count(*)::text
FROM information_schema.role_table_grants
WHERE grantee = 'infrasafe_runtime'
  AND table_schema = 'public'
  AND table_name IN ('schema_migrations', 'migrate_lock');
SQL
)"
    if [ -n "$viol" ] && [ "$viol" != "0" ]; then
        warn "⚠ ACL: infrasafe_runtime holds $viol grant(s) on runner tables — run: $0 repair-acl"
    fi
}

cmd_status() {
    require_target
    failclose_if_no_table
    local discovered db_rows
    discovered="$(discover_lines)"
    db_rows="$(db_scalar -c "SELECT filename || E'\t' || checksum FROM schema_migrations ORDER BY filename")"

    local applied=0 pending=0 drift=0 dbonly=0
    while IFS=$'\t' read -r fn path; do
        [ -z "$fn" ] && continue
        local db_ck
        db_ck="$(printf '%s\n' "$db_rows" | awk -F'\t' -v f="$fn" '$1==f{print $2}')"
        if [ -z "$db_ck" ]; then
            echo "  pending  $fn"; pending=$((pending + 1))
        else
            local file_ck; file_ck="$(file_checksum "$path")"
            if [ "$db_ck" = "$file_ck" ]; then
                applied=$((applied + 1))
            else
                echo "  DRIFT    $fn (applied checksum != target — applied migration was edited)"; drift=$((drift + 1))
            fi
        fi
    done <<< "$discovered"

    while IFS=$'\t' read -r dfn _dck; do
        [ -z "$dfn" ] && continue
        if ! printf '%s\n' "$discovered" | awk -F'\t' -v f="$dfn" '$1==f{ok=1} END{exit !ok}'; then
            echo "  DB-ONLY  $dfn (in schema_migrations, absent from target tree)"; dbonly=$((dbonly + 1))
        fi
    done <<< "$db_rows"

    # plain, uncolored, stable line for programmatic parsing (deploy guard)
    echo "migrate-status: applied=$applied pending=$pending drift=$drift db_only=$dbonly"
    acl_invariant_warn
    if [ "$drift" -gt 0 ] || [ "$dbonly" -gt 0 ]; then
        err "schema drift detected — aborting (roll-forward-only: applied migrations are immutable)"
        return 5
    fi
    ok "status OK"
    return 0
}

# --- baseline --------------------------------------------------------------
cmd_baseline() {
    require_target
    local have
    have="$(db_scalar -c "SELECT (to_regclass('public.schema_migrations') IS NOT NULL)")"
    if [ "$have" = "t" ]; then
        err "schema_migrations already exists — baseline is a one-time operation. Use 'up' / 'status'."
        exit 1
    fi
    # discovery must be a subset of the frozen allowlist — an extra file means an
    # un-baselined migration exists and must go through 'up', not baseline.
    discover_lines | cut -f1 | discover_js validate-baseline

    # Build the allowlist INSERT (checksums from target blobs). Filenames come
    # from the frozen allowlist (no quotes/metachars) and checksums are hex, so
    # single-quoting is safe.
    local values="" fn ck
    while IFS= read -r fn; do
        [ -z "$fn" ] && continue
        ck="$(file_checksum "database/migrations/$fn")"
        values="${values}    ('${fn}', '${ck}'),"$'\n'
    done < <(discover_js allowlist)
    values="${values%,$'\n'}"   # strip trailing comma+newline

    say "Running baseline as a single transaction (sentinel matrix → mark 33 applied)…"
    {
        echo "BEGIN;"
        cat "$LIB_DIR/baseline-prelude.sql"
        echo "INSERT INTO schema_migrations (filename, checksum) VALUES"
        echo "$values"
        echo ";"
        echo "COMMIT;"
    } | psql_base
    ok "baseline complete — 33 migrations (003-034) marked applied without execution."
}

# --- force-unlock / repair-acl ---------------------------------------------
cmd_force_unlock() {
    failclose_if_no_table
    local prev
    prev="$(db_scalar -c "SELECT locked_by || ' since ' || locked_at FROM migrate_lock WHERE id = 1")"
    db_scalar -c "DELETE FROM migrate_lock WHERE id = 1" >/dev/null
    if [ -n "$prev" ]; then ok "force-unlock: cleared lock held by $prev"; else say "force-unlock: no lock was held"; fi
}

cleanup_repair() {
    local rc=$?
    trap - EXIT
    set +e
    [ "$LOCK_ACQUIRED" = 1 ] && release_lock 2>/dev/null
    exit "$rc"
}

cmd_repair_acl() {
    failclose_if_no_table
    trap cleanup_repair EXIT
    acquire_lock
    acl_enforce >/dev/null
    ok "repair-acl: REVOKE ALL on schema_migrations,migrate_lock from infrasafe_runtime enforced."
}

# --- dispatch --------------------------------------------------------------
usage() {
    cat >&2 <<EOF
usage: $0 <status|up|baseline|force-unlock|repair-acl>
  env: MIGRATE_COMPOSE_FILE, MIGRATE_PG_USER, MIGRATE_TARGET_COMMIT (status/up/baseline)
       MIGRATE_PG_SERVICE (default postgres), MIGRATE_PG_DB (default infrasafe)
EOF
}

main() {
    case "${1:-}" in
        status)       cmd_status ;;
        up)           cmd_up ;;
        baseline)     cmd_baseline ;;
        force-unlock) cmd_force_unlock ;;
        repair-acl)   cmd_repair_acl ;;
        *)            usage; exit 2 ;;
    esac
}

main "$@"
