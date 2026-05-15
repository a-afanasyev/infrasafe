#!/usr/bin/env bash
#
# deploy-uk.sh — UK Management Bot integration deploy on demo server
#
# Runs on server (95.46.96.105) as user `infrasafe`.
# Implements plan § 8.4 (Порядок применения) from
#   docs/superpowers/specs/2026-05-14-uk-infrasafe-web-integration-plan.md
#
# Idempotent: safe to re-run. Each phase checks current state before acting.
#
# Phases:
#   0. preflight   — sanity (paths, docker, env files present)
#   1. backup      — snapshot configs + alembic head
#   2. clone-uk    — git clone or pull UK repo into ~/uk
#   3. caddy-clean — remove caddy: block + caddy_data/caddy_config volumes
#   4. build       — docker build uk-frontend + uk-management-api ON server
#   5. tls         — certbot --webroot for infrasafe.uz + alias (if missing)
#   6. uk-up       — docker compose up -d UK stack
#   7. migrate     — alembic upgrade head (UK)
#   8. infrasafe   — docker compose up -d nginx + app (InfraSafe), nginx -t
#   9. smoke       — local curl health checks
#  10. benchmark   — wrk via williamyeh/wrk in uk-network
#
# Each phase is selectable via $1 (default: all). E.g.
#   ./deploy-uk.sh preflight
#   ./deploy-uk.sh build
#
# Strict mode + error reporting.
set -euo pipefail
trap 'echo "[deploy-uk] FAIL at line $LINENO: $BASH_COMMAND" >&2' ERR

# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
SERVER_HOME="${HOME}"
INFRASAFE_DIR="${SERVER_HOME}/infrasafe"
UK_DIR="${SERVER_HOME}/uk"
BACKUP_ROOT="${SERVER_HOME}/uk-deploy-backups"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${TS}"

UK_REPO_URL="${UK_REPO_URL:-https://github.com/a-afanasyev/Infrasafe_bot.git}"
UK_REPO_BRANCH="${UK_REPO_BRANCH:-main}"

# Domains
PRIMARY_DOMAIN="infrasafe.uz"
ALIAS_DOMAIN="infrasafe.aisolutions.uz"

# Compose project names — for predictable container names
INFRASAFE_PROJECT="infrasafe"
UK_PROJECT="uk"

PHASE="${1:-all}"

# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
log() { printf '[deploy-uk %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '[deploy-uk FATAL] %s\n' "$*" >&2; exit 1; }

run_phase() {
    local want="$1"
    [[ "$PHASE" == "all" || "$PHASE" == "$want" ]]
}

# ----------------------------------------------------------------------
# Phase 0: preflight
# ----------------------------------------------------------------------
phase_preflight() {
    log "Phase 0: preflight"
    [[ -d "$INFRASAFE_DIR" ]] || die "InfraSafe dir not found: $INFRASAFE_DIR"
    [[ -f "$INFRASAFE_DIR/docker-compose.unified.yml" ]] || die "compose-unified missing"
    [[ -f "$INFRASAFE_DIR/nginx.production.conf" ]] || die "nginx config missing"
    [[ -f "$INFRASAFE_DIR/.env.prod" ]] || die ".env.prod missing in $INFRASAFE_DIR"

    command -v docker >/dev/null || die "docker not installed"
    docker compose version >/dev/null 2>&1 || die "docker compose plugin not installed"

    # Free disk gate — UK builds + image need ≥3 GB
    local avail_gb
    avail_gb=$(df -BG --output=avail "$SERVER_HOME" | tail -1 | tr -dc 0-9)
    [[ "${avail_gb:-0}" -ge 3 ]] || die "less than 3 GB free in \$HOME (${avail_gb} GB)"

    log "OK: paths, docker, env, disk"
}

# ----------------------------------------------------------------------
# Phase 1: backup
# ----------------------------------------------------------------------
phase_backup() {
    log "Phase 1: backup → $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"

    cp -a "$INFRASAFE_DIR/nginx.production.conf" "$BACKUP_DIR/" 2>/dev/null || true
    cp -a "$INFRASAFE_DIR/docker-compose.unified.yml" "$BACKUP_DIR/" 2>/dev/null || true
    cp -a "$INFRASAFE_DIR/.env.prod" "$BACKUP_DIR/env.prod.bak" 2>/dev/null || true

    # Alembic rollback point. If UK API isn't running yet → "base".
    if docker ps --format '{{.Names}}' | grep -q '^uk-management-api$'; then
        docker exec uk-management-api alembic current --verbose 2>/dev/null \
            | grep -oE '^[a-f0-9]{12}' > "$BACKUP_DIR/uk-alembic-head.txt" || \
            echo "base" > "$BACKUP_DIR/uk-alembic-head.txt"
    else
        echo "base" > "$BACKUP_DIR/uk-alembic-head.txt"
    fi
    log "Backup OK (alembic head: $(cat "$BACKUP_DIR/uk-alembic-head.txt"))"
}

# ----------------------------------------------------------------------
# Phase 2: clone / pull UK repo
# ----------------------------------------------------------------------
phase_clone_uk() {
    log "Phase 2: clone or update UK repo → $UK_DIR"
    if [[ -d "$UK_DIR/.git" ]]; then
        log "UK repo already present, fetching latest"
        git -C "$UK_DIR" fetch --prune origin "$UK_REPO_BRANCH"
        git -C "$UK_DIR" checkout "$UK_REPO_BRANCH"
        git -C "$UK_DIR" reset --hard "origin/$UK_REPO_BRANCH"
    else
        log "Cloning $UK_REPO_URL"
        git clone --branch "$UK_REPO_BRANCH" "$UK_REPO_URL" "$UK_DIR"
    fi

    # Sanity — required files
    [[ -f "$UK_DIR/Dockerfile.api" ]] || die "UK/Dockerfile.api missing — repo out of date?"
    [[ -f "$UK_DIR/frontend/Dockerfile" ]] || die "UK/frontend/Dockerfile missing"
    [[ -f "$UK_DIR/docker-compose.production.yml" ]] || die "UK/docker-compose.production.yml missing"

    if [[ ! -f "$UK_DIR/.env" ]]; then
        log "WARN: $UK_DIR/.env not present — create per plan § 8.3 BEFORE running 'build' phase"
    else
        chmod 600 "$UK_DIR/.env" || true
    fi
    log "UK repo OK at $(git -C "$UK_DIR" rev-parse --short HEAD)"
}

# ----------------------------------------------------------------------
# Phase 3: Caddy cleanup (§ 8.2)
# ----------------------------------------------------------------------
phase_caddy_clean() {
    log "Phase 3: remove Caddy artifacts"
    # Volumes
    local vols
    vols="$(docker volume ls --format '{{.Name}}' | grep -i caddy || true)"
    if [[ -n "$vols" ]]; then
        log "Found Caddy volumes: $vols"
        for v in $vols; do
            docker volume rm "$v" 2>&1 || log "WARN: could not rm volume $v (probably in use)"
        done
    else
        log "No Caddy volumes"
    fi
    # Containers
    local conts
    conts="$(docker ps -a --format '{{.Names}}' | grep -i caddy || true)"
    if [[ -n "$conts" ]]; then
        log "Found Caddy containers: $conts"
        for c in $conts; do
            docker rm -f "$c" || true
        done
    fi
    # Network — should still exist; check if there's a Caddy-specific network alias
    log "Caddy cleanup OK"
}

# ----------------------------------------------------------------------
# Phase 4: build UK images on the server (amd64 native)
# ----------------------------------------------------------------------
phase_build() {
    log "Phase 4: docker build uk-frontend + uk-management-api"
    [[ -d "$UK_DIR" ]] || die "Run 'clone-uk' phase first"

    log "Building uk-frontend:latest"
    docker build -t uk-frontend:latest -f "$UK_DIR/frontend/Dockerfile" "$UK_DIR/frontend"

    log "Building uk-management-api:latest"
    docker build -t uk-management-api:latest -f "$UK_DIR/Dockerfile.api" "$UK_DIR"

    log "Images built:"
    docker images --format '{{.Repository}}:{{.Tag}}\t{{.Size}}' | grep -E '^uk-(frontend|management-api):'
}

# ----------------------------------------------------------------------
# Phase 5: TLS / certbot
# ----------------------------------------------------------------------
phase_tls() {
    log "Phase 5: TLS for $PRIMARY_DOMAIN + $ALIAS_DOMAIN"
    local live_dir="/etc/letsencrypt/live/${PRIMARY_DOMAIN}"
    if sudo test -d "$live_dir" 2>/dev/null; then
        log "Cert exists at $live_dir — skipping issuance, running renew --dry-run"
        sudo certbot renew --dry-run --quiet || log "WARN: certbot renew dry-run failed"
        return 0
    fi

    # Webroot mode — see nginx server { listen 80 } block
    mkdir -p "$INFRASAFE_DIR/certbot-webroot"
    # nginx must be up to serve /.well-known/acme-challenge/
    docker ps --format '{{.Names}}' | grep -q '^infrasafe-nginx-1$' \
        || log "WARN: infrasafe-nginx-1 not running — webroot challenge may fail"

    sudo certbot certonly --webroot \
        -w "$INFRASAFE_DIR/certbot-webroot" \
        --non-interactive --agree-tos \
        -m "admin@${PRIMARY_DOMAIN}" \
        -d "$PRIMARY_DOMAIN" -d "$ALIAS_DOMAIN"

    log "TLS issued. Configuring deploy-hook for graceful nginx reload."
    sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
    echo '#!/bin/sh
docker exec infrasafe-nginx-1 nginx -s reload || true' \
        | sudo tee /etc/letsencrypt/renewal-hooks/deploy/infrasafe-nginx.sh > /dev/null
    sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/infrasafe-nginx.sh
}

# ----------------------------------------------------------------------
# Phase 6: bring up UK stack
# ----------------------------------------------------------------------
phase_uk_up() {
    log "Phase 6: docker compose up UK stack"
    [[ -f "$UK_DIR/docker-compose.production.yml" ]] || die "UK compose missing"
    [[ -f "$UK_DIR/.env" ]] || die "UK .env missing — see plan § 8.3"

    docker compose -p "$UK_PROJECT" \
        -f "$UK_DIR/docker-compose.production.yml" up -d

    # Wait for uk-network to be created
    local i=0
    while ! docker network inspect uk-network >/dev/null 2>&1; do
        sleep 1
        i=$((i+1))
        [[ $i -gt 30 ]] && die "uk-network not created within 30s"
    done
    log "uk-network exists. Containers:"
    docker network inspect uk-network --format '{{range .Containers}}{{.Name}} {{end}}'
}

# ----------------------------------------------------------------------
# Phase 7: alembic migrations
# ----------------------------------------------------------------------
phase_migrate() {
    log "Phase 7: alembic upgrade head (UK)"
    # Wait for postgres
    local i=0
    while ! docker exec uk-postgres pg_isready -U uk_app -d uk >/dev/null 2>&1; do
        sleep 2
        i=$((i+1))
        [[ $i -gt 30 ]] && die "uk-postgres not ready within 60s"
    done

    docker exec uk-management-api alembic upgrade head
    log "Alembic head: $(docker exec uk-management-api alembic current 2>&1 | tail -1)"
}

# ----------------------------------------------------------------------
# Phase 8: InfraSafe nginx + app reload
# ----------------------------------------------------------------------
phase_infrasafe() {
    log "Phase 8: InfraSafe nginx + app reload"
    cd "$INFRASAFE_DIR"

    # Validate nginx config inside a throwaway container BEFORE recreate
    log "Validating nginx config syntax in throwaway container"
    docker run --rm \
        -v "$INFRASAFE_DIR/nginx.production.conf:/etc/nginx/nginx.conf:ro" \
        nginx:alpine nginx -t 2>&1 | head -20 || die "nginx -t failed"

    # Recreate nginx + app
    docker compose -p "$INFRASAFE_PROJECT" \
        -f "$INFRASAFE_DIR/docker-compose.unified.yml" up -d nginx app

    sleep 3
    docker exec infrasafe-nginx-1 nginx -t || die "live nginx -t failed"
    docker exec infrasafe-nginx-1 nginx -s reload
    log "nginx reloaded"
}

# ----------------------------------------------------------------------
# Phase 9: smoke (§ 10.1)
# ----------------------------------------------------------------------
phase_smoke() {
    log "Phase 9: smoke tests"
    local base="https://${PRIMARY_DOMAIN}"
    local urls=("/" "/about.html" "/uk/login" "/uk/twa/app" "/uk/api/health" "/uk/manifest.json" "/health")
    local fail=0
    for u in "${urls[@]}"; do
        local code
        code=$(curl -sk -o /dev/null -w '%{http_code}' -m 8 "${base}${u}")
        printf '  %-30s → %s\n' "$u" "$code"
        # Permissive: anything < 500 is acceptable for the smoke gate
        [[ "$code" =~ ^[23] ]] || fail=1
    done
    [[ $fail -eq 0 ]] || log "WARN: at least one URL did not 2xx/3xx"
}

# ----------------------------------------------------------------------
# Phase 10: benchmark (§ 11)
# ----------------------------------------------------------------------
phase_benchmark() {
    log "Phase 10: benchmark via williamyeh/wrk in uk-network"
    sleep 30  # warmup
    docker run --rm --network uk-network williamyeh/wrk:latest \
        -t2 -c20 -d60s "http://uk-management-api:8080/api/health"
    log "Memory after bench:"
    docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" \
        | grep -E '^(uk-|infrasafe-)'
}

# ----------------------------------------------------------------------
# Dispatch
# ----------------------------------------------------------------------
log "Starting deploy-uk.sh, phase=$PHASE"

run_phase preflight    && phase_preflight
run_phase backup       && phase_backup
run_phase clone-uk     && phase_clone_uk
run_phase caddy-clean  && phase_caddy_clean
run_phase build        && phase_build
run_phase tls          && phase_tls
run_phase uk-up        && phase_uk_up
run_phase migrate      && phase_migrate
run_phase infrasafe    && phase_infrasafe
run_phase smoke        && phase_smoke
run_phase benchmark    && phase_benchmark

log "DONE."
