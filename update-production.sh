#!/bin/bash
#
# update-production.sh — [SEC-14/15] immutable-app deploy with extracted static (C-extract)
#
# Model: the app is an immutable image (no .:/app bind mount). Deploying backend =
# rebuild image. Frontend dist is EXTRACTED from the new image into host public/dist
# (scripts/rebuild-frontend.sh prepare|publish), then byte-verified. Phased rollback
# restores app image + tracked static + dist on any failure.
#
# NOTE: unified-only. docker-compose.prod.yml is DEPRECATED (kept for a local Mac
# instance) — this script no longer auto-selects it.
#
set -Eeuo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

COMPOSE_FILE="docker-compose.unified.yml"   # explicit (do NOT fall back to prod.yml)
APP_CONTAINER="infrasafe-app-1"
ROLLBACK_TAG="infrasafe-app:rollback"
EDGE_HEALTH_URL="https://infrasafe.uz/health"

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
        docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate --no-build app || rollback_failed=1
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
say "🔄 InfraSafe production deploy (immutable app + extracted static)"
say "Compose: $COMPOSE_FILE"

[ -f "$COMPOSE_FILE" ] || { err "❌ $COMPOSE_FILE not found — run from repo root"; exit 1; }

# [SEC-15] prod must not carry a SEPARATE dev .env (would risk booting with dev
# config: NODE_ENV, weak secrets). A `.env` that's just a symlink to .env.prod is
# fine (identical content). Hard-fail, not just runbook.
test -f .env.prod || { err "❌ .env.prod missing"; exit 1; }
if [ -e .env ] && [ "$(readlink -f .env)" != "$(readlink -f .env.prod)" ]; then
    err "❌ separate dev .env present on prod (not a symlink to .env.prod) — remove it before deploying"
    exit 1
fi

# Step 1 — git
say "📥 Step 1: git pull"
PREV_COMMIT="$(git rev-parse HEAD)"
git pull --ff-only origin "$(git branch --show-current)"
ok "✅ code at $(git rev-parse --short HEAD) (prev $(git rev-parse --short "$PREV_COMMIT"))"

# Step 2 — capture rollback image, then build the new app image
say "🔨 Step 2: build app image"
OLD_IMG="$(docker inspect -f '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || echo '')"
docker compose -f "$COMPOSE_FILE" build app
[ -n "$OLD_IMG" ] && docker tag "$OLD_IMG" "$ROLLBACK_TAG"
ok "✅ image built (rollback tagged: ${OLD_IMG:-none})"

# Step 3 — extract baked dist from the NEW image (app still old)
say "🧩 Step 3: prepare frontend dist (extract from new image)"
bash scripts/rebuild-frontend.sh prepare

# Step 4 — switch app (flag BEFORE the command: `up` may recreate then error)
say "🚀 Step 4: switch app to new image"
APP_SWITCHED=1
docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate app

# Step 5 — wait for the app's own health
say "🏥 Step 5: app health-wait"
app_health_wait
ok "✅ app healthy"

# Step 6 — publish dist (flag AFTER success; two statements so a publish failure
# fires the ERR trap with DIST_PUBLISHED still 0 — publish already self-restored).
say "📦 Step 6: publish frontend dist"
bash scripts/rebuild-frontend.sh publish
DIST_PUBLISHED=1

# Step 7 — verify served bundles == published dist
say "🔎 Step 7: verify served bundles"
bash scripts/rebuild-frontend.sh verify

# Step 8 — edge smoke
say "🌐 Step 8: edge smoke"
curl -fsS "$EDGE_HEALTH_URL" >/dev/null && ok "✅ edge healthy" || { err "edge health failed"; exit 1; }

trap - ERR
echo ""
ok "✨ Deploy complete."
echo "  logs:   docker compose -f $COMPOSE_FILE logs -f app"
echo "  status: docker compose -f $COMPOSE_FILE ps"
