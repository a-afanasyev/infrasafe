#!/usr/bin/env bash
#
# compose-drift-check.sh — [B-016] deploy-host drift detector
#
# Read-only diagnostic. Compares the DECLARED docker-compose stack against the
# RUNTIME reality on the host where the stack actually runs. Catches two classes
# of drift that bit us in prod:
#   A) network drift   — a service attached to a network it does not declare
#                        (B-010/B-011: app silently joined uk-network → auth-fail).
#   B) publish drift   — a container publishing a port on 0.0.0.0/:: that is NOT
#                        in the public whitelist (P-PENTEST-1/-4: app/frontend and
#                        UK-stack containers exposed plaintext to the internet).
#
# Usage:
#   bash scripts/compose-drift-check.sh [compose-file]
#   COMPOSE_FILE=docker-compose.unified.yml PROJECT=infrasafe bash scripts/compose-drift-check.sh
#
# Exit code: 0 = clean, 1 = drift found, 2 = usage/precondition error.
# NOTE: must run on the deploy HOST (needs the running containers). Not a CI check.
#
set -euo pipefail

trap 'echo "[drift-check] FAIL at line $LINENO: $BASH_COMMAND" >&2' ERR

log()  { printf '[drift-check %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[drift-check WARN] %s\n' "$*" >&2; }
die()  { printf '[drift-check FATAL] %s\n' "$*" >&2; exit 2; }

COMPOSE_FILE="${1:-${COMPOSE_FILE:-docker-compose.unified.yml}}"
PROJECT="${PROJECT:-infrasafe}"
# Ports allowed to be published on 0.0.0.0/:: (public edge + VPN). Everything
# else MUST bind 127.0.0.1. Override with ALLOWED_PUBLIC_PORTS="80 443 ...".
ALLOWED_PUBLIC_PORTS="${ALLOWED_PUBLIC_PORTS:-80 443 51820}"

command -v docker >/dev/null 2>&1 || die "docker not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found"
[ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"

drift=0

# ---------------------------------------------------------------------------
# Check A — network drift (declared vs runtime, per service)
# ---------------------------------------------------------------------------
log "Check A: network drift (compose '$COMPOSE_FILE' vs runtime project '$PROJECT')"

declared_json="$(docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null)" \
  || die "could not render '$COMPOSE_FILE' (docker compose config failed)"

# Map of running container -> compose service + runtime network names (JSON).
runtime_rows="$(
  docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}' \
  | while read -r name; do
      [ -n "$name" ] || continue
      svc="$(docker inspect "$name" --format '{{index .Config.Labels "com.docker.compose.service"}}')"
      nets="$(docker inspect "$name" --format '{{json .NetworkSettings.Networks}}')"
      printf '%s\t%s\t%s\n' "$svc" "$name" "$nets"
    done
)"

A_OUT="$(
  DECLARED_JSON="$declared_json" RUNTIME_ROWS="$runtime_rows" PROJECT="$PROJECT" \
  python3 - <<'PY'
import json, os, sys

cfg = json.loads(os.environ["DECLARED_JSON"])
project = os.environ["PROJECT"]
top_nets = cfg.get("networks", {}) or {}

def real_name(key):
    n = top_nets.get(key) or {}
    # external/explicit name wins; otherwise compose prefixes the project.
    return n.get("name") or f"{project}_{key}"

declared = {}
for svc, body in (cfg.get("services", {}) or {}).items():
    nets = body.get("networks", {}) or {}
    keys = nets.keys() if isinstance(nets, dict) else nets
    declared[svc] = sorted(real_name(k) for k in keys)

drift = 0
seen = set()
for line in os.environ["RUNTIME_ROWS"].splitlines():
    if not line.strip():
        continue
    svc, name, nets_json = line.split("\t", 2)
    seen.add(svc)
    runtime = sorted((json.loads(nets_json) or {}).keys())
    want = declared.get(svc)
    if want is None:
        print(f"  ? {svc} ({name}): running but not declared in compose")
        drift += 1
        continue
    if set(runtime) != set(want):
        extra = sorted(set(runtime) - set(want))
        missing = sorted(set(want) - set(runtime))
        msg = []
        if extra:   msg.append(f"extra={extra}")
        if missing: msg.append(f"missing={missing}")
        print(f"  ✗ {svc} ({name}): {' '.join(msg)}  declared={want} runtime={runtime}")
        drift += 1
    else:
        print(f"  ✓ {svc} ({name}): {runtime}")

for svc in declared:
    if svc not in seen:
        print(f"  · {svc}: declared but no running container (skipped/optional)")

sys.exit(1 if drift else 0)
PY
)" && a_rc=0 || a_rc=$?
printf '%s\n' "$A_OUT"
[ "${a_rc:-0}" -eq 0 ] || drift=1

# ---------------------------------------------------------------------------
# Check B — publish drift (0.0.0.0/:: outside the public whitelist)
# Cross-ref: hardening.sh Phase K uses `ss -tln` for the same intent at the OS level.
# ---------------------------------------------------------------------------
log "Check B: public-publish drift (allowed public ports: $ALLOWED_PUBLIC_PORTS)"

b_drift=0
while IFS=$'\t' read -r name ports; do
  [ -n "${name:-}" ] || continue
  # Each publish segment looks like: 0.0.0.0:80->80/tcp  or  :::80->80/tcp
  while read -r hostport; do
    [ -n "$hostport" ] || continue
    ok=0
    for p in $ALLOWED_PUBLIC_PORTS; do [ "$hostport" = "$p" ] && ok=1 && break; done
    if [ "$ok" -eq 0 ]; then
      printf '  ✗ %s publishes :%s on a public interface (0.0.0.0/::) — should be 127.0.0.1\n' "$name" "$hostport"
      b_drift=1
    fi
  done < <(printf '%s\n' "$ports" | grep -oE '(0\.0\.0\.0|::|\[::\]):[0-9]+->' | grep -oE ':[0-9]+->' | tr -d ':->')
done < <(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}}\t{{.Ports}}')

if [ "$b_drift" -eq 0 ]; then
  log "Check B: clean — only whitelisted ports are public"
else
  drift=1
fi

# ---------------------------------------------------------------------------
log "----------------------------------------"
if [ "$drift" -eq 0 ]; then
  log "RESULT: no drift ✓"
  exit 0
fi
warn "RESULT: drift detected — review the ✗ lines above"
exit 1
