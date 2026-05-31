#!/usr/bin/env bash
#
# rebuild-frontend.sh — [B-027] rebuild + verify the frontend bundles on prod
#
# WHY this exists:
#   Frontend bundles (public/dist/*.js) silently never reached prod for ~5 weeks.
#   Root cause: Dockerfile.unified bakes public/dist INTO the app image, but
#   docker-compose.unified.yml bind-mounts `.:/app`, so at runtime the HOST's
#   public/dist/ shadows the image's baked dist. nginx serves public/dist from
#   that host dir (./public:/usr/share/nginx/html/public:ro). public/dist/ is
#   gitignored, so `git pull` never updates it — and rebuilding the app image
#   never touches the host dir. The ONLY thing that refreshes the served bundle
#   is running esbuild through the bind mount from inside the container.
#
# WHAT this does (run on the deploy HOST, in ~/infrasafe, AFTER `docker compose up -d`):
#   1. rebuilds public/dist via the running app container (writes through the
#      .:/app bind mount onto the host)
#   2. byte-verifies every served bundle: sha256 of the in-container file MUST
#      equal sha256 of what nginx actually serves over HTTPS. Mismatch / 404 /
#      network error → exit 1 ("BUNDLE DID NOT REACH PROD"). This is the guard
#      that makes a B-027 recurrence loud instead of silent.
#
# Usage:
#   bash scripts/rebuild-frontend.sh
#   VERIFY_BUNDLES="public/dist/admin.js" bash scripts/rebuild-frontend.sh   # narrow
#   FIX_DIST_OWNER=1 bash scripts/rebuild-frontend.sh                        # one-time chown
#
# Exit codes: 0 = built + every bundle verified live, 1 = build or verify failed,
#             2 = usage / precondition error.
#
# NOTE: UNIFIED-LAYOUT ONLY. docker-compose.prod.yml builds app via Dockerfile.prod
# (`npm ci --omit=dev --ignore-scripts`) which has NO esbuild and no build/ dir, so
# `npm run build:frontend` cannot run there. Preflight enforces the unified layout.
#
set -euo pipefail

trap 'echo "[rebuild-frontend] FAIL at line $LINENO: $BASH_COMMAND" >&2' ERR

log()       { printf '[rebuild-frontend %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn()      { printf '[rebuild-frontend WARN] %s\n' "$*" >&2; }
die()       { printf '[rebuild-frontend FATAL] %s\n' "$*" >&2; exit 2; }   # precondition
die_exit1() { printf '[rebuild-frontend FATAL] %s\n' "$*" >&2; exit 1; }   # build/verify failure

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.unified.yml}"   # unified-only (see header)
APP_CONTAINER="${APP_CONTAINER:-infrasafe-app-1}"
VERIFY_URL_BASE="${VERIFY_URL_BASE:-https://infrasafe.uz}"
# Empty = verify EVERY built bundle (enumerated in-container). Set to a
# space-separated subset (e.g. "public/dist/admin.js") to narrow.
VERIFY_BUNDLES="${VERIFY_BUNDLES:-}"
# Opt-in one-time fix: after a root build, chown dist back to the app user so
# future runs don't need `-u 0`. Off by default — don't surprise-chown.
FIX_DIST_OWNER="${FIX_DIST_OWNER:-0}"

command -v docker >/dev/null 2>&1 || die "docker not found"

# ---------------------------------------------------------------------------
# Phase 1 — preflight (exit 2 on failure)
# ---------------------------------------------------------------------------
log "Preflight: app container '$APP_CONTAINER' + unified layout (build/ esbuild present)"

docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER" \
  || die "container '$APP_CONTAINER' is not running — run 'docker compose -f $COMPOSE_FILE up -d' first"

# This single check also rejects the prod.yml layout: Dockerfile.prod doesn't
# ship build/ or esbuild, so build/esbuild.config.mjs won't exist in /app.
docker exec "$APP_CONTAINER" sh -lc 'test -f /app/build/esbuild.config.mjs && test -d /app/public' \
  || die "unified layout expected: /app/build/esbuild.config.mjs + /app/public not found in container \
(prod.yml/Dockerfile.prod has no esbuild — this script is unified-only)"

# Past preflight, Phase 2 (build) and Phase 3 (verify) do their OWN explicit
# error handling (rc capture, EACCES root-retry, controlled ✗). The ERR trap is
# only useful for unexpected failures in preflight — drop it now so the
# deliberate "first attempt fails EACCES → retry as root" path and missing-bundle
# checks don't emit misleading "FAIL at line N" lines (the trap fires even under
# set +e / || true).
trap - ERR

# ---------------------------------------------------------------------------
# Phase 2 — build public/dist in-container (writes through the .:/app bind mount)
# ---------------------------------------------------------------------------
log "Build: npm run build:frontend inside '$APP_CONTAINER'"

build_once() {  # $1 = extra docker-exec args (e.g. "-u 0" or "")
  # shellcheck disable=SC2086
  docker exec $1 "$APP_CONTAINER" sh -lc 'cd /app && npm run build:frontend' 2>&1
}

set +e
out="$(build_once "")"; rc=$?
set -e
if [ "$rc" -ne 0 ] && grep -qiE 'EACCES|permission denied' <<<"$out"; then
  warn "build hit EACCES (public/dist is root-owned, container runs as nodejs) — retrying as root"
  set +e
  out="$(build_once "-u 0")"; rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    warn "build needed root — run once with FIX_DIST_OWNER=1 to chown dist and drop the root requirement"
  fi
fi
printf '%s\n' "$out" | sed 's/^/    /'
[ "$rc" -eq 0 ] || die_exit1 "build:frontend failed (exit $rc)"

if [ "$FIX_DIST_OWNER" = "1" ]; then
  log "FIX_DIST_OWNER=1 → chown public/dist to nodejs:nodejs (one-time)"
  docker exec -u 0 "$APP_CONTAINER" sh -lc 'chown -R nodejs:nodejs /app/public/dist' \
    && log "ownership fixed — future runs no longer need root" \
    || warn "chown failed (non-fatal) — dist may stay root-owned"
fi

# ---------------------------------------------------------------------------
# Phase 3 — verify the SERVED bundle == the just-built bundle (the anti-B-027 guard)
# ---------------------------------------------------------------------------
log "Verify: served bundle sha256 == in-container sha256 ($VERIFY_URL_BASE)"

if [ -n "$VERIFY_BUNDLES" ]; then
  bundles="$VERIFY_BUNDLES"
else
  # All built bundles (12 entrypoints + utils), enumerated from the container.
  bundles="$(docker exec "$APP_CONTAINER" sh -lc 'cd /app && find public/dist -name "*.js" -type f' | sort)"
fi
[ -n "$bundles" ] || die "no bundles found under public/dist — did the build produce output?"

fail=0
tmp="/tmp/rebuild-frontend-served-$$"
for b in $bundles; do
  # `|| true`: a missing file makes `docker exec sha256sum` exit non-zero, which
  # would otherwise fire the ERR trap (it triggers even under set +e). The
  # trailing `|| true` makes the pipeline always succeed, so a missing/typo'd
  # bundle becomes a controlled `✗` below instead of a misleading trap message.
  built="$(docker exec "$APP_CONTAINER" sh -lc "sha256sum /app/$b" 2>/dev/null | awk '{print $1}' || true)"
  if [ -z "$built" ]; then
    printf '  ✗ %s: missing in container after build\n' "$b"
    fail=1; continue
  fi
  # Capture curl rc explicitly so a timeout/DNS/TLS/connect error becomes a
  # controlled verify-fail instead of aborting the script under set -e.
  set +e
  code="$(curl -sk -m 10 -o "$tmp" -w '%{http_code}' "$VERIFY_URL_BASE/$b")"; crc=$?
  set -e
  if [ "$crc" -ne 0 ]; then
    printf '  ✗ %s: curl error (rc=%s)\n' "$b" "$crc"
    fail=1; continue
  fi
  size="$(wc -c <"$tmp" 2>/dev/null | tr -d ' ')"
  served="$(sha256sum "$tmp" 2>/dev/null | awk '{print $1}')"
  if [ "$code" = "200" ] && [ "${size:-0}" -gt 0 ] && [ "$built" = "$served" ]; then
    printf '  ✓ %s (%s bytes)\n' "$b" "$size"
  else
    printf '  ✗ %s: HTTP=%s size=%s\n      built=%s\n      served=%s\n' \
      "$b" "$code" "${size:-0}" "$built" "$served"
    fail=1
  fi
done
rm -f "$tmp"

# ---------------------------------------------------------------------------
log "----------------------------------------"
if [ "$fail" -ne 0 ]; then
  warn "==================================================="
  warn " BUNDLE DID NOT REACH PROD — review the ✗ lines above"
  warn " (served bundle != freshly built bundle / 404 / network error)"
  warn "==================================================="
  exit 1
fi
docker exec "$APP_CONTAINER" sh -lc 'ls -la /app/public/dist' 2>/dev/null | sed 's/^/    /' || true
log "RESULT: all bundles built + verified live ✓"
exit 0
