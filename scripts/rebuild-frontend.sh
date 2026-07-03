#!/usr/bin/env bash
#
# rebuild-frontend.sh — [SEC-14/15 / B-027] deliver + verify frontend dist on prod
#
# MODEL: immutable app image + extracted static artifacts (C-extract).
#   The app image is immutable (no `.:/app` bind mount). public/dist is BAKED into
#   the image at build time. The edge nginx still serves /public from the host
#   `./public` dir, so on each deploy we EXTRACT the baked dist out of the new
#   image into the host `public/dist` (near-atomically), then byte-verify that what
#   nginx serves over HTTPS matches the extracted bytes.
#
# Staging lives in .deploy/ (gitignored + dockerignored) — OUTSIDE public/, so the
# edge never serves the temp dirs and the next `docker build` never bakes them in.
#
# SUBCOMMANDS (called by update-production.sh in deploy order):
#   prepare   — extract baked dist from the new image into .deploy/frontend-dist-next
#               (+ completeness check vs the image's own manifest). App may be old.
#   publish   — near-atomic swap host public/dist <- .deploy/frontend-dist-next
#               (old dist preserved as .deploy/frontend-dist-rollback). Self-rolls-back
#               its own mid-failure so the edge is never left without a dist.
#   restore   — roll public/dist back to .deploy/frontend-dist-rollback (also self-safe).
#   verify    — byte-verify: sha256 of each served bundle (HTTPS) == current public/dist.
#
# Exit codes: 0 = ok, 1 = operation/verify failed, 2 = usage/precondition error.
#
set -Eeuo pipefail

log()       { printf '[rebuild-frontend %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn()      { printf '[rebuild-frontend WARN] %s\n' "$*" >&2; }
die()       { printf '[rebuild-frontend FATAL] %s\n' "$*" >&2; exit 2; }   # precondition
die_exit1() { printf '[rebuild-frontend FATAL] %s\n' "$*" >&2; exit 1; }   # operation failure

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.unified.yml}"
IMAGE_TAG="${IMAGE_TAG:-infrasafe-app:latest}"
VERIFY_URL_BASE="${VERIFY_URL_BASE:-https://infrasafe.uz}"

# [deploy-reliability] verify runs right after update-production.sh recreates the
# app container. The node-startup CPU spike briefly slows the edge's TLS
# handshakes, so a single `curl -m 10` per bundle can time out (rc=28) and
# false-fail a CORRECT deploy → the ERR trap auto-rolls-back (observed twice on
# 2026-07-03). Settle once, then retry each bundle a few times before declaring
# failure. All knobs are env-overridable (set *_SECONDS/ATTEMPTS=0/1 to disable).
VERIFY_SETTLE_SECONDS="${VERIFY_SETTLE_SECONDS:-20}"
VERIFY_ATTEMPTS="${VERIFY_ATTEMPTS:-6}"
VERIFY_RETRY_SLEEP="${VERIFY_RETRY_SLEEP:-5}"
VERIFY_CURL_TIMEOUT="${VERIFY_CURL_TIMEOUT:-20}"

PUBLIC_DIST="public/dist"
STAGING=".deploy"
NEXT="$STAGING/frontend-dist-next"
ROLLBACK="$STAGING/frontend-dist-rollback"
FAILED="$STAGING/frontend-dist-failed"

command -v docker >/dev/null 2>&1 || die "docker not found"

# ---------------------------------------------------------------------------
preflight() {
  # .deploy is gitignored → may be absent on first run; create before testing -w.
  mkdir -p "$STAGING"
  test -w public && test -w "$STAGING" \
    || die "public/ or $STAGING/ not writable on host (after dropping .:/app the \
container can no longer fix host perms — chown on the host)"
}

resolve_image() {
  # Exact ID of the NEWLY BUILT image. Don't use `docker compose images -q app`:
  # while the old container is alive it may report the OLD image.
  IMG="$(docker image inspect -f '{{.Id}}' "$IMAGE_TAG" 2>/dev/null || true)"
  [ -n "$IMG" ] || die "image '$IMAGE_TAG' not found — run 'docker compose -f $COMPOSE_FILE build app' first"
}

# ---------------------------------------------------------------------------
# prepare — extract baked dist out of the new image into .deploy/frontend-dist-next
# ---------------------------------------------------------------------------
cmd_prepare() {
  preflight
  resolve_image
  log "prepare: extract /app/public/dist from $IMAGE_TAG ($IMG) → $NEXT"

  rm -rf "$NEXT" && mkdir -p "$NEXT"   # clean: docker cp would otherwise merge with leftovers

  TMP="$(docker create "$IMG")"
  cleanup_tmp() { docker rm -f "$TMP" >/dev/null 2>&1 || true; }
  trap cleanup_tmp EXIT INT TERM
  docker cp "$TMP":/app/public/dist/. "$NEXT"/
  cleanup_tmp; trap - EXIT INT TERM

  # Completeness vs the image's OWN manifest (not a hardcoded count; `find` because
  # alpine sh has no globstar and `ls **/*.js` would miss top-level bundles).
  local missing=0 rel
  while IFS= read -r f; do
    rel="${f#/app/public/dist/}"
    if [ ! -f "$NEXT/$rel" ]; then
      printf '  ✗ missing in extract: %s\n' "$rel"; missing=1
    fi
  done < <(docker run --rm "$IMG" find /app/public/dist -type f -name '*.js' -print)
  [ "$missing" -eq 0 ] || die_exit1 "extract incomplete — image bundles missing from $NEXT"

  log "prepare: ok ($(find "$NEXT" -type f -name '*.js' | wc -l | tr -d ' ') js files staged)"
}

# ---------------------------------------------------------------------------
# publish — near-atomic swap (short 404 window between the two mv); self-rollback
# ---------------------------------------------------------------------------
cmd_publish() {
  preflight
  [ -d "$NEXT" ] || die "no staged dist at $NEXT — run 'prepare' first"
  log "publish: $NEXT → $PUBLIC_DIST (old → $ROLLBACK)"

  rm -rf "$ROLLBACK"
  if [ -d "$PUBLIC_DIST" ]; then
    mv "$PUBLIC_DIST" "$ROLLBACK"
  fi
  if ! mv "$NEXT" "$PUBLIC_DIST"; then
    warn "publish failed mid-swap — restoring previous dist"
    [ -d "$ROLLBACK" ] && mv "$ROLLBACK" "$PUBLIC_DIST"   # never leave edge without dist
    die_exit1 "publish failed"
  fi
  log "publish: ok"
}

# ---------------------------------------------------------------------------
# restore — roll public/dist back to the preserved rollback set; self-safe
# ---------------------------------------------------------------------------
cmd_restore() {
  preflight
  [ -d "$ROLLBACK" ] || die_exit1 "no rollback dist at $ROLLBACK — cannot restore"
  log "restore: $ROLLBACK → $PUBLIC_DIST"

  rm -rf "$FAILED"
  if [ -d "$PUBLIC_DIST" ]; then
    mv "$PUBLIC_DIST" "$FAILED"
  fi
  if ! mv "$ROLLBACK" "$PUBLIC_DIST"; then
    warn "restore failed mid-swap — putting failed dist back"
    [ -d "$FAILED" ] && mv "$FAILED" "$PUBLIC_DIST"
    die_exit1 "restore failed"
  fi
  log "restore: ok"
}

# ---------------------------------------------------------------------------
# verify — served bundle (HTTPS) == CURRENT public/dist (valid after publish OR restore)
# ---------------------------------------------------------------------------
# Verify one served bundle against its built sha256, with bounded retries so a
# transient (TLS timeout / momentary stale-cache right after the near-atomic
# publish swap) self-heals instead of false-failing the deploy. Echoes ✓/…/✗
# lines. Returns 0 on success, 1 after exhausting VERIFY_ATTEMPTS. Success
# criteria are UNCHANGED: HTTP 200 + non-empty body + served sha == built sha.
_verify_one() {
  local f="$1" tmp="$2" rel built code crc size served attempt
  rel="${f#public/}"                         # public/dist/script.js → dist/script.js (served at /public/…)
  built="$(sha256sum "$f" | awk '{print $1}')"
  for attempt in $(seq 1 "$VERIFY_ATTEMPTS"); do
    set +e
    code="$(curl -sk -m "$VERIFY_CURL_TIMEOUT" -o "$tmp" -w '%{http_code}' "$VERIFY_URL_BASE/public/$rel")"; crc=$?
    set -e
    size="$(wc -c <"$tmp" 2>/dev/null | tr -d ' ')"
    served="$(sha256sum "$tmp" 2>/dev/null | awk '{print $1}')"
    if [ "$crc" -eq 0 ] && [ "$code" = "200" ] && [ "${size:-0}" -gt 0 ] && [ "$built" = "$served" ]; then
      printf '  ✓ %s (%s bytes, attempt %s/%s)\n' "$rel" "$size" "$attempt" "$VERIFY_ATTEMPTS"
      return 0
    fi
    if [ "$attempt" -lt "$VERIFY_ATTEMPTS" ]; then
      printf '  … %s: not ready (rc=%s HTTP=%s) — retry %s/%s in %ss\n' \
        "$rel" "$crc" "${code:-?}" "$attempt" "$VERIFY_ATTEMPTS" "$VERIFY_RETRY_SLEEP"
      sleep "$VERIFY_RETRY_SLEEP"
    fi
  done
  printf '  ✗ %s: HTTP=%s size=%s rc=%s after %s attempts\n      built=%s\n      served=%s\n' \
    "$rel" "${code:-?}" "${size:-0}" "${crc:-?}" "$VERIFY_ATTEMPTS" "$built" "$served"
  return 1
}

cmd_verify() {
  [ -d "$PUBLIC_DIST" ] || die_exit1 "$PUBLIC_DIST does not exist — nothing to verify"
  log "verify: served sha256 == $PUBLIC_DIST sha256 ($VERIFY_URL_BASE)"

  local bundles fail=0 tmp
  bundles="$(find "$PUBLIC_DIST" -type f -name '*.js' | sort)"
  [ -n "$bundles" ] || die_exit1 "no bundles under $PUBLIC_DIST"

  # Settle once before probing: let the just-recreated app's startup CPU spike
  # quiesce so the ~14 rapid TLS handshakes below don't hit the transient.
  if [ "${VERIFY_SETTLE_SECONDS:-0}" -gt 0 ]; then
    log "verify: settling ${VERIFY_SETTLE_SECONDS}s for the recreated app to quiesce"
    sleep "$VERIFY_SETTLE_SECONDS"
  fi

  tmp="$(mktemp)"
  for f in $bundles; do
    _verify_one "$f" "$tmp" || fail=1
  done
  rm -f "$tmp"

  if [ "$fail" -ne 0 ]; then
    warn "==================================================="
    warn " BUNDLE DID NOT REACH PROD — review the ✗ lines above"
    warn "==================================================="
    exit 1
  fi
  log "verify: all bundles served live ✓"
}

# ---------------------------------------------------------------------------
case "${1:-}" in
  prepare) cmd_prepare ;;
  publish) cmd_publish ;;
  restore) cmd_restore ;;
  verify)  cmd_verify ;;
  *) die "usage: $0 {prepare|publish|verify|restore}" ;;
esac
