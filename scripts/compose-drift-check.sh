#!/usr/bin/env bash
#
# compose-drift-check.sh — [B-016] deploy-host drift detector
#
# Read-only diagnostic. Compares the DECLARED docker-compose stack against the
# RUNTIME reality on the host where the stack actually runs. Catches two classes
# of drift that bit us in prod:
#   A) network drift   — a declared service attached to a different set of
#                        networks than it declares (B-010/B-011: app silently
#                        joined uk-network → auth-fail on the wrong postgres).
#   B) publish drift   — ANY container on the host publishing a port on
#                        0.0.0.0/:: that is NOT in the public whitelist
#                        (P-PENTEST-1/-4: app/frontend AND the separate UK-stack
#                        containers exposed plaintext to the internet).
#
# Usage:
#   bash scripts/compose-drift-check.sh [compose-file]
#   COMPOSE_FILE=docker-compose.unified.yml bash scripts/compose-drift-check.sh
#   ALLOWED_PUBLIC_PORTS="80 443 51820" bash scripts/compose-drift-check.sh
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
# Ports allowed to be published on 0.0.0.0/:: (public edge + VPN). Everything
# else MUST bind 127.0.0.1. Override with ALLOWED_PUBLIC_PORTS="80 443 ...".
ALLOWED_PUBLIC_PORTS="${ALLOWED_PUBLIC_PORTS:-80 443 51820}"

command -v docker  >/dev/null 2>&1 || die "docker not found"
command -v python3 >/dev/null 2>&1 || die "python3 not found"
[ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"

drift=0

# ---------------------------------------------------------------------------
# Check A — network drift (declared vs runtime, per declared service)
#
# Both sides are compared on REAL Docker network names. The rendered compose
# config carries the canonical real name for every network under top-level
# `networks.<key>.name` (external nets keep their explicit name; project nets
# default to "<project>_<key>"). Runtime `NetworkSettings.Networks` keys are
# already real names. We resolve declared keys → real names via the rendered
# config so logical (leaflet-network) and runtime (infrasafe_leaflet-network)
# never produce a false positive.
#
# Container → service mapping is STRICTLY via the com.docker.compose.service
# label (infrasafe-app-1 != app). A running container whose service is not in
# the compose is reported informationally (?) and does NOT fail the run.
# ---------------------------------------------------------------------------
log "Check A: network drift (compose '$COMPOSE_FILE' vs runtime)"

# Rendered config → project name + "service<TAB>realNet1,realNet2,..." per service.
config_json="$(docker compose -f "$COMPOSE_FILE" config --format json 2>/dev/null)" \
  || die "could not render '$COMPOSE_FILE' (docker compose config failed)"
# A transient daemon hiccup can return empty stdout with exit 0; fail cleanly
# rather than feeding empty input to the JSON parser below (ugly traceback).
[ -n "$config_json" ] || die "rendered config was empty — re-run on the deploy host"

PROJECT="$(printf '%s' "$config_json" | python3 -c 'import sys,json; print((json.load(sys.stdin).get("name") or ""))')"
[ -n "$PROJECT" ] || PROJECT="${PROJECT:-infrasafe}"

declared_map="$(
  printf '%s' "$config_json" | python3 -c '
import sys, json
d = json.load(sys.stdin)
project = d.get("name") or ""
topnets = d.get("networks") or {}
def real(key):
    n = topnets.get(key) or {}
    return n.get("name") or ((project + "_" + key) if project else key)
for svc, body in (d.get("services") or {}).items():
    nets = body.get("networks") or {}
    keys = list(nets.keys()) if isinstance(nets, dict) else list(nets)
    reals = sorted(real(k) for k in keys)
    print(svc + "\t" + ",".join(reals))
'
)"

declared_svcs="$(printf '%s\n' "$declared_map" | cut -f1)"
seen_svcs=""

while IFS=$'\t' read -r name svc; do
  [ -n "${name:-}" ] || continue
  # Strict label mapping — no name-derivation fallback.
  if [ -z "${svc:-}" ]; then
    printf '  ? %s: no com.docker.compose.service label — cannot map to a service\n' "$name"
    continue
  fi
  if ! printf '%s\n' "$declared_svcs" | grep -qxF "$svc"; then
    printf '  ? %s (%s): running but service not declared in %s (optional/other stack)\n' "$svc" "$name" "$COMPOSE_FILE"
    continue
  fi
  seen_svcs="$seen_svcs $svc"
  # Runtime real network names: one per line; drop empties (trailing newline
  # from the Go-template range), sort, csv. (Fixes the rev-1 leading-comma bug.)
  # `|| true`: a container with zero networks (mid-restart / detached) makes the
  # grep return 1 on all-empty input, which under `set -e`+pipefail would abort
  # the whole run before Check B — we want an empty rnets (→ reported as drift).
  rnets="$(
    docker inspect "$name" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' 2>/dev/null \
    | grep -v '^[[:space:]]*$' | sort | paste -sd, - || true
  )"
  dnets="$(printf '%s\n' "$declared_map" | awk -F'\t' -v s="$svc" '$1==s {print $2}')"
  if [ "$dnets" = "$rnets" ]; then
    printf '  ✓ %s (%s): [%s]\n' "$svc" "$name" "$rnets"
  else
    printf '  ✗ %s (%s): declared=[%s] runtime=[%s]\n' "$svc" "$name" "$dnets" "$rnets"
    drift=1
  fi
done < <(docker ps --filter "label=com.docker.compose.project=$PROJECT" \
           --format '{{.Names}}'$'\t''{{.Label "com.docker.compose.service"}}')

# Declared services with no running container (optional/profile/stopped) — info only.
while read -r svc; do
  [ -n "$svc" ] || continue
  case " $seen_svcs " in
    *" $svc "*) : ;;
    *) printf '  · %s: declared but no running container (optional/stopped)\n' "$svc" ;;
  esac
done <<< "$declared_svcs"

# ---------------------------------------------------------------------------
# Check B — publish drift (HOST-WIDE: every container, not just this project)
#
# P-PENTEST-4 lived in the *UK* stack (a different compose project). A
# project-scoped scan is blind to it, so this pass deliberately drops the
# project filter and inspects every running container on the host.
# Cross-ref: hardening.sh Phase K uses `ss -tln` for the same intent at the OS level.
# ---------------------------------------------------------------------------
log "Check B: public-publish drift HOST-WIDE (allowed public ports: $ALLOWED_PUBLIC_PORTS)"

b_drift=0
# Iterate in the MAIN shell via process substitution so b_drift mutations stick
# (a pipe-fed while runs in a subshell) and we avoid nesting a `case` with the
# [::] glob inside a command substitution (which mis-parses in some bash builds).
# Ports is a comma-separated list; only segments on a public bind (0.0.0.0: or
# [::]:) are internet-facing — loopback (127.0.0.1:) and bare container ports
# ("6379/tcp") are fine. Host port = text after the LAST ':' of the bind side
# (before '->'): handles "0.0.0.0:80->.." and "[::]:80->..".
b_seen=" "   # dedup key "name:hostport" — IPv4 and IPv6 rows are the same publish
while IFS='|' read -r name ports; do
  [ -n "${name:-}" ] || continue
  ports="${ports// /}"        # strip spaces
  ports="${ports//,/ }"       # commas -> spaces so the default-IFS split works
  set -f                      # no pathname expansion on the unquoted $ports
  for seg in $ports; do
    case "$seg" in
      0.0.0.0:*|\[::\]:*)
        hostport="${seg%%->*}"; hostport="${hostport##*:}"
        ok=0
        for p in $ALLOWED_PUBLIC_PORTS; do [ "$hostport" = "$p" ] && { ok=1; break; }; done
        [ "$ok" -eq 1 ] && continue
        case "$b_seen" in *" ${name}:${hostport} "*) continue ;; esac
        b_seen="${b_seen}${name}:${hostport} "
        printf '  ✗ %s publishes :%s on a public interface — should bind 127.0.0.1\n' "$name" "$hostport"
        b_drift=1
        ;;
    esac
  done
  set +f
done < <(docker ps --format '{{.Names}}|{{.Ports}}')

if [ "$b_drift" -eq 0 ]; then
  log "Check B: clean — only whitelisted ports are public host-wide"
else
  drift=1
fi

# ---------------------------------------------------------------------------
log "----------------------------------------"
if [ "$drift" -eq 0 ]; then
  log "RESULT: no drift ✓"
  exit 0
fi
warn "RESULT: drift detected — review the ✗ lines above (? / · lines are informational)"
exit 1
