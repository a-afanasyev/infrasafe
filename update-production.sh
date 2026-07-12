#!/bin/bash
#
# update-production.sh — [SEC-14/15] immutable-app deploy with extracted static (C-extract)
#
# Model: the app is an immutable image (no .:/app bind mount). Deploying backend =
# rebuild image. Frontend dist is EXTRACTED from the new image into host public/dist
# (scripts/rebuild-frontend.sh prepare|publish), then byte-verified. Phased rollback
# restores app image + tracked static + dist on any failure.
#
# [R2-15] DEPLOY_ENV selects the compose -f set, env file, edge health URL and
# verify base. 'prod' (default, = an unset call) = the profk production box
# (docker-compose.unified.yml + docker-compose.profk.yml, profk.uz). 'staging' =
# the future staging VM (+ docker-compose.staging.yml, staging.infrasafe.uz).
# 'infrasafe' = the ORIGINAL infrasafe.uz production box (.105) — a second live
# prod, kept on the plain docker-compose.unified.yml (no override) since it
# predates the profk-specific overlay; this is the exact byte-identical
# behavior the pre-R2-15-Phase-A script always had for this host. docker-compose.prod.yml
# is DEPRECATED. This is an UPDATE tool — it does NOT bootstrap an empty host (no
# `up -d postgres`; migrate needs a live postgres). Fresh staging VM →
# scripts/bootstrap-staging.sh first, then this script for subsequent updates.
#
set -Eeuo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

DEPLOY_ENV="${DEPLOY_ENV:-prod}"
case "$DEPLOY_ENV" in
    prod)
        COMPOSE_FILES=(docker-compose.unified.yml docker-compose.profk.yml)
        ENV_FILE=".env.prod"
        EDGE_HEALTH_URL="${EDGE_HEALTH_URL:-https://profk.uz/health}"
        VERIFY_URL_BASE="${VERIFY_URL_BASE:-https://profk.uz}"
        ;;
    staging)
        COMPOSE_FILES=(docker-compose.unified.yml docker-compose.staging.yml)
        ENV_FILE=".env.staging"
        EDGE_HEALTH_URL="${EDGE_HEALTH_URL:-https://staging.infrasafe.uz/health}"
        VERIFY_URL_BASE="${VERIFY_URL_BASE:-https://staging.infrasafe.uz}"
        ;;
    infrasafe)
        COMPOSE_FILES=(docker-compose.unified.yml)
        ENV_FILE=".env.prod"
        EDGE_HEALTH_URL="${EDGE_HEALTH_URL:-https://infrasafe.uz/health}"
        VERIFY_URL_BASE="${VERIFY_URL_BASE:-https://infrasafe.uz}"
        ;;
    *) echo "❌ bad DEPLOY_ENV=$DEPLOY_ENV (want prod|staging|infrasafe)" >&2; exit 1 ;;
esac
# Filenames-only list → migrate.sh; -f-prefixed array → local docker compose calls.
COMPOSE_ARGS=(); for _cf in "${COMPOSE_FILES[@]}"; do COMPOSE_ARGS+=(-f "$_cf"); done
# rebuild-frontend.sh byte-verifies THIS domain (its default is https://infrasafe.uz).
export VERIFY_URL_BASE
APP_CONTAINER="infrasafe-app-1"
ROLLBACK_TAG="infrasafe-app:rollback"

# [R2-15] Image source. Default 'registry': pull the CI-built, CI-verified image
# from GHCR instead of building on the host (OPS-001: host build cache filled the
# 20G disk and crash-looped the app). Escape hatch 'build' restores the legacy
# host build (break-glass; NOT pre-migrate-safe — see Step 2). The pulled image is
# retagged to infrasafe-app:latest so compose / rebuild-frontend.sh / rollback all
# resolve the same local tag, unchanged.
GHCR_IMAGE="${GHCR_IMAGE:-ghcr.io/a-afanasyev/infrasafe-app}"
APP_IMAGE_SOURCE="${APP_IMAGE_SOURCE:-registry}"
# [R2-15] Optional pinned deploy target for staging→prod promotion. Unset = deploy
# the origin/$BRANCH tip (current behaviour). When set, prod deploys EXACTLY this
# commit's image (the SHA validated on staging), guarded to stay on-branch.
DEPLOY_TARGET_COMMIT="${DEPLOY_TARGET_COMMIT:-}"

# [PR-1a/1b / AUD-002] migration-runner wiring — ENABLED (PR-1b, after the one-time
# prod `migrate.sh baseline` on 2026-06-12). When true the runner applies pending
# migrations from the fetched target BEFORE the app switch. Override to "false" to
# fall back to the legacy `git pull --ff-only` with no schema step (escape hatch).
MIGRATE_WIRING_ENABLED="${MIGRATE_WIRING_ENABLED:-true}"
export MIGRATE_COMPOSE_FILE="${COMPOSE_FILES[*]}"   # whitespace-joined; migrate.sh splits into -f args
export MIGRATE_PG_SERVICE="${MIGRATE_PG_SERVICE:-postgres}"
export MIGRATE_PG_USER="${MIGRATE_PG_USER:-infrasafe_app}"
export MIGRATE_PG_DB="${MIGRATE_PG_DB:-infrasafe}"

# rollback state flags (read by the ERR trap)
APP_SWITCHED=0
DIST_PUBLISHED=0
PREV_COMMIT=""
OLD_IMG=""

say()  { echo -e "${BLUE}$*${NC}"; }
ok()   { echo -e "${GREEN}$*${NC}"; }
warn() { echo -e "${YELLOW}$*${NC}"; }
err()  { echo -e "${RED}$*${NC}"; }

# Wait for the APP container's Docker healthcheck (NOT the edge /health, which only
# proves nginx is up). Timeout → failure → caller's trap rolls back.
app_health_wait() {
    local tries=60 status
    while [ "$tries" -gt 0 ]; do
        status="$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null || echo missing)"
        [ "$status" = "healthy" ] && return 0
        [ "$status" = "unhealthy" ] && { err "app reported unhealthy"; return 1; }
        sleep 2; tries=$((tries - 1))
    done
    err "app health-wait timed out"
    return 1
}

# Phased, idempotent, best-effort. set +e so a failure mid-rollback doesn't abort
# the remaining recovery; trap - ERR so we don't recurse. Loud final status.
rollback() {
    local rc=$?
    trap - ERR
    set +e
    local rollback_failed=0
    err "‼️  deploy failed (rc=$rc) — rolling back"

    # tracked static: git pull already updated bind-mounted frontend-html/css/data/public
    # → restore to PREV_COMMIT (worktree only, not index), else old app + NEW static.
    if [ -n "$PREV_COMMIT" ]; then
        git restore --source="$PREV_COMMIT" --worktree -- frontend-html css data public || rollback_failed=1
    fi
    # dist (gitignored — git restore can't touch it): restore via the staged rollback set.
    [ "$DIST_PUBLISHED" = 1 ] && { bash scripts/rebuild-frontend.sh restore || rollback_failed=1; }
    if [ "$APP_SWITCHED" = 1 ] && [ -n "$OLD_IMG" ]; then
        docker tag "$OLD_IMG" infrasafe-app:latest || rollback_failed=1
        docker compose "${COMPOSE_ARGS[@]}" up -d --no-deps --force-recreate --no-build app || rollback_failed=1
        app_health_wait || rollback_failed=1
    fi
    bash scripts/rebuild-frontend.sh verify || rollback_failed=1

    if [ "$rollback_failed" = 1 ]; then
        err "‼️  ROLLBACK INCOMPLETE — manual intervention required"
    else
        ok  "✓ rollback complete"
    fi
    exit "$rc"
}
trap rollback ERR

# ---------------------------------------------------------------------------
say "🔄 InfraSafe deploy (env=$DEPLOY_ENV, immutable app + extracted static)"
say "Compose: ${COMPOSE_FILES[*]}"

for _cf in "${COMPOSE_FILES[@]}"; do
    [ -f "$_cf" ] || { err "❌ $_cf not found — run from repo root"; exit 1; }
done

# [SEC-15] the deploy must not boot with the wrong env file (dev config: NODE_ENV,
# weak secrets — or, on staging, prod secrets via compose env_file precedence). A
# `.env` that's just a symlink to $ENV_FILE is fine (identical content). Hard-fail.
test -f "$ENV_FILE" || { err "❌ $ENV_FILE missing"; exit 1; }
if [ -e .env ] && [ "$(readlink -f .env)" != "$(readlink -f "$ENV_FILE")" ]; then
    err "❌ .env is not a symlink to $ENV_FILE — remove/fix it before deploying (env=$DEPLOY_ENV)"
    exit 1
fi
# compose lists env_file [.env, .env.prod] (later wins), so a stray .env.prod on
# staging would silently override .env.staging with prod secrets — fail closed.
if [ "$DEPLOY_ENV" = "staging" ] && [ -e .env.prod ]; then
    err "❌ .env.prod present on staging — compose env_file would override .env.staging; remove it"
    exit 1
fi

# [R2-15] Validate the image-source mode up front so a typo can't silently fall
# through to a host build.
case "$APP_IMAGE_SOURCE" in
    registry|build) ;;
    *) err "❌ bad APP_IMAGE_SOURCE=$APP_IMAGE_SOURCE (want registry|build)"; exit 1 ;;
esac
say "Image source: $APP_IMAGE_SOURCE"

# Step 1 — resolve target, acquire the image (preflight), then (optional) schema
# migrations — all BEFORE the app switch.
PREV_COMMIT="$(git rev-parse HEAD)"
# DEPLOY_BRANCH pins the branch to fetch/resolve against — required for cron /
# detached-HEAD auto-deploy (staging), where `git branch --show-current` is empty
# or wrong. Defaults to the checked-out branch (current interactive-prod behaviour).
BRANCH="${DEPLOY_BRANCH:-$(git branch --show-current)}"
[ -n "$BRANCH" ] || { err "❌ no branch (detached HEAD?) — set DEPLOY_BRANCH=main"; exit 1; }

say "📥 Step 1: fetch + resolve deploy target"
git fetch origin "$BRANCH"
# Target = pinned promotion commit (staging→prod), else the fetched branch tip.
# Normalize to a full 40-char SHA (an operator may pass a short SHA / tag) so it
# matches CI's ghcr tag `sha-<full github.sha>` exactly.
TARGET="${DEPLOY_TARGET_COMMIT:-$(git rev-parse "origin/$BRANCH")}"
TARGET="$(git rev-parse --verify "$TARGET^{commit}" 2>/dev/null)" \
    || { err "❌ bad DEPLOY_TARGET_COMMIT: ${DEPLOY_TARGET_COMMIT:-<unset>}"; exit 1; }
# Guard A: target must be a fast-forward descendant of HEAD (no rewind) — abort
# BEFORE any schema change if origin diverged/force-pushed.
git merge-base --is-ancestor HEAD "$TARGET" \
    || { err "❌ target $TARGET not ahead of HEAD — aborting before any schema change"; exit 1; }
# Guard B: a pinned target must be an ancestor of the fetched branch tip — never
# deploy an arbitrary / unmerged commit.
git merge-base --is-ancestor "$TARGET" "origin/$BRANCH" \
    || { err "❌ target $TARGET not on origin/$BRANCH — refusing an unmerged commit"; exit 1; }
MIGRATE_TARGET_COMMIT="$TARGET"; export MIGRATE_TARGET_COMMIT
ok "  → target $(git rev-parse --short "$TARGET")"

# Preflight: acquire the new app image BEFORE any schema change, so a missing image
# aborts with the DB and container both untouched. Registry mode only — 'build'
# must compile the MERGED worktree, so it runs AFTER the merge (Step 2).
if [ "$APP_IMAGE_SOURCE" = "registry" ]; then
    PULL_REF="$GHCR_IMAGE:sha-$TARGET"
    say "  → pull $PULL_REF (preflight, before schema)"
    docker pull "$PULL_REF" \
        || { err "❌ $PULL_REF not in GHCR (CI not finished?) — aborting BEFORE migrate/switch"; exit 1; }
    # migrate.sh (no host node) resolves its node image via `docker compose images
    # -q app`, which is EMPTY on a fresh host with no app container. Pin the runner
    # to the just-pulled image so migrate status/up works (harmless on prod).
    export MIGRATE_NODE_IMAGE="$PULL_REF"
fi

if [ "$MIGRATE_WIRING_ENABLED" = "true" ]; then
    say "  → schema migrations (runner wiring ENABLED)"
    # Drift / missing-table guard: status exits non-zero on no schema_migrations
    # (run baseline first) or on checksum/db-only drift.
    say "  → migrate status"
    status_out="$(bash scripts/migrate.sh status)" \
        || { echo "$status_out"; err "❌ migrate status failed (no schema_migrations, or drift)"; exit 1; }
    echo "$status_out"
    pending_n="$(echo "$status_out" | sed -n 's/.*migrate-status: applied=[0-9]* pending=\([0-9]*\).*/\1/p')"
    # Runner-change deploy-guard: never ship a runner-code change AND pending
    # migrations in the same release — the runner executes from the OLD checkout,
    # so a runner change must land in a SEPARATE earlier release.
    if [ -n "$(git diff --name-only HEAD "$TARGET" -- scripts/migrate.sh scripts/lib/)" ] \
       && [ "${pending_n:-0}" -gt 0 ]; then
        err "❌ runner change + ${pending_n} pending migration(s) in one release — split them"
        exit 1
    fi
    say "  → migrate up (schema before code)"
    bash scripts/migrate.sh up
    git merge --ff-only "$TARGET"
    ok "✅ migrated + code at $(git rev-parse --short HEAD) (prev $(git rev-parse --short "$PREV_COMMIT"))"
else
    say "  → git merge (migration-runner wiring DISABLED)"
    git merge --ff-only "$TARGET"
    ok "✅ code at $(git rev-parse --short HEAD) (prev $(git rev-parse --short "$PREV_COMMIT"))"
fi

# Step 2 — capture rollback image, then make the target image the local
# infrasafe-app:latest (registry: retag the preflight-pulled image; build: legacy
# host build of the merged worktree — break-glass, NOT pre-migrate-safe).
say "🔨 Step 2: prepare app image ($APP_IMAGE_SOURCE)"
OLD_IMG="$(docker inspect -f '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || echo '')"
if [ "$APP_IMAGE_SOURCE" = "registry" ]; then
    docker tag "$PULL_REF" infrasafe-app:latest
elif [ "$APP_IMAGE_SOURCE" = "build" ]; then
    warn "⚠ APP_IMAGE_SOURCE=build: legacy host build of the merged worktree (OPS-001"
    warn "  disk risk; schema already applied → a build failure here needs manual"
    warn "  recovery). Break-glass only."
    docker compose "${COMPOSE_ARGS[@]}" build app
fi
[ -n "$OLD_IMG" ] && docker tag "$OLD_IMG" "$ROLLBACK_TAG"
ok "✅ image ready (rollback tagged: ${OLD_IMG:-none})"

# Step 3 — extract baked dist from the NEW image (app still old)
say "🧩 Step 3: prepare frontend dist (extract from new image)"
bash scripts/rebuild-frontend.sh prepare

# Step 4 — switch app (flag BEFORE the command: `up` may recreate then error)
say "🚀 Step 4: switch app to new image"
APP_SWITCHED=1
docker compose "${COMPOSE_ARGS[@]}" up -d --no-deps --force-recreate --no-build app

# Step 5 — wait for the app's own health
say "🏥 Step 5: app health-wait"
app_health_wait
ok "✅ app healthy"

# Step 6 — publish dist (flag AFTER success; two statements so a publish failure
# fires the ERR trap with DIST_PUBLISHED still 0 — publish already self-restored).
say "📦 Step 6: publish frontend dist"
bash scripts/rebuild-frontend.sh publish
DIST_PUBLISHED=1

# Step 6b — the app switch (Step 4) recreates ONLY app; edge nginx keeps its running
# config. nginx-config/ is a directory bind-mount, so if this release changed it,
# `nginx -s reload` picks up the new file content live. (compose-level command /
# mount changes still need a manual `up -d --force-recreate nginx` — see the runbook.)
# Done before verify/smoke so they test the live config; a bad config fails 'nginx -t'
# → abort (edge keeps the old, working config; ERR trap rolls the app back).
if [ -n "$(git diff --name-only "$PREV_COMMIT" HEAD -- nginx-config/)" ]; then
    say "🔁 Step 6b: nginx config changed this release — test + reload edge"
    if docker compose "${COMPOSE_ARGS[@]}" exec -T nginx nginx -t; then
        docker compose "${COMPOSE_ARGS[@]}" exec -T nginx nginx -s reload
        ok "✅ edge nginx reloaded"
    else
        err "❌ new nginx config failed 'nginx -t' — NOT reloading (edge keeps old config)"; exit 1
    fi
fi

# Step 7 — verify served bundles == published dist
say "🔎 Step 7: verify served bundles"
bash scripts/rebuild-frontend.sh verify

# Step 8 — edge smoke
say "🌐 Step 8: edge smoke"
curl -fsS "$EDGE_HEALTH_URL" >/dev/null && ok "✅ edge healthy" || { err "edge health failed"; exit 1; }

trap - ERR

# [R2-15 / OPS-001] Bounded image retention — SUCCESS PATH ONLY (never in the ERR
# trap; never `prune --all`, which would delete the rollback-tagged image). Pull
# mode ends build-cache growth, but pulled images now accumulate on the tight 20G
# disk: drop dangling layers + keep only the newest 3 GHCR tags.
say "🧹 image retention (dangling + keep newest 3 ${GHCR_IMAGE} tags)"
docker image prune -f >/dev/null 2>&1 || true
docker images "$GHCR_IMAGE" --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' \
    | sort -rk2 | awk 'NR>3{print $1}' | xargs -r docker rmi >/dev/null 2>&1 || true

echo ""
ok "✨ Deploy complete (env=$DEPLOY_ENV)."
echo "  logs:   docker compose ${COMPOSE_ARGS[*]} logs -f app"
echo "  status: docker compose ${COMPOSE_ARGS[*]} ps"
