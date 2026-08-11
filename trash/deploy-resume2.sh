#!/usr/bin/env bash
# Resume after Dockerfile build failure (Node 18 vs 20, postinstall context).
# Run: sudo bash deploy-resume2.sh
set -euo pipefail

PROJ=/home/infrasafe/infrasafe
COMPOSE_FILE="docker-compose.unified.yml"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/home/infrasafe/deploy-backups/$TS"
LOG=/var/log/infrasafe-deploy.log
DB_USER=infrasafe_app
DB_NAME=infrasafe
PG_CONTAINER=infrasafe-postgres-1

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root"
    exit 1
fi

mkdir -p "$BACKUP_DIR"
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "============================================================"
echo "DEPLOY RESUME 2 — $(date)"
echo "============================================================"

trap 'echo "[FAIL] error at line $LINENO (exit $?). Backups in $BACKUP_DIR"; exit 1' ERR

# ============================================================
# Phase A: patch Dockerfile.unified
# ============================================================
echo ""
echo "=== Patch Dockerfile.unified ==="
cp -p "$PROJ/Dockerfile.unified" "$BACKUP_DIR/Dockerfile.unified.bak"

# 1) Bump Node 18 -> 20
sed -i 's|FROM node:18-alpine|FROM node:20-alpine|g' "$PROJ/Dockerfile.unified"

# 2) Add --ignore-scripts to skip postinstall during install (postinstall needs full project tree)
#    Then we run build:frontend later (after `up`) inside the running container.
sed -i 's|^RUN npm install$|RUN npm install --ignore-scripts|' "$PROJ/Dockerfile.unified"

echo "  patched. Diff:"
diff "$BACKUP_DIR/Dockerfile.unified.bak" "$PROJ/Dockerfile.unified" | sed 's/^/    /'

# ============================================================
# Phase B: rebuild app + frontend
# ============================================================
echo ""
echo "=== Rebuild app + frontend (no-cache) ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE build --no-cache --pull app frontend
EOSU

# ============================================================
# Phase C: up
# ============================================================
echo ""
echo "=== docker compose up -d --force-recreate ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE up -d --force-recreate
EOSU

echo "  waiting 10s for app container to be healthy..."
sleep 10

# ============================================================
# Phase D: build frontend bundle inside running app container
# ============================================================
echo ""
echo "=== Build frontend bundle (via bind mount writes to host) ==="
echo "  Running 'npm run build:frontend' inside infrasafe-app-1..."

# Make sure host public/dist dir exists with right ownership for bind-mounted writes
sudo -u infrasafe -H bash -c "mkdir -p $PROJ/public/dist"

# Run build inside container; output goes to /app/public/dist which is bind-mount from host
docker exec infrasafe-app-1 sh -lc 'cd /app && npm run build:frontend' 2>&1 | sed 's/^/    /'

echo ""
echo "  Resulting public/dist files on host:"
sudo -u infrasafe -H ls -la "$PROJ/public/dist" 2>&1 | head -20 | sed 's/^/    /'

# ============================================================
# Phase E: smoke tests
# ============================================================
echo ""
echo "=== Smoke tests ==="
echo ""
echo "  container status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | sed 's/^/    /'
echo ""

echo "  app /health (direct):"
curl -sf -m 5 http://127.0.0.1:3000/health 2>&1 | sed 's/^/    /' || echo "    FAILED"
echo ""

echo "  API root via nginx:"
curl -sk -m 5 https://localhost/api/ -H 'Host: infrasafe.aisolutions.uz' 2>&1 | head -c 400 | sed 's/^/    /'
echo ""

echo "  app version:"
curl -sk -m 5 https://localhost/api/ -H 'Host: infrasafe.aisolutions.uz' 2>/dev/null | grep -oE '"version":"[^"]*"' | sed 's/^/    /' || echo "    (n/a)"
echo ""

echo "  HTTPS root (HTML):"
curl -sk -m 5 -o /dev/null -w "    HTTP %{http_code}, size %{size_download}\n" https://localhost/ -H 'Host: infrasafe.aisolutions.uz'
echo ""

echo "  Bundle file accessible:"
ls "$PROJ/public/dist/"*.js 2>/dev/null | head -5 | sed 's|.*/|    |'
echo ""

echo "  login endpoint reachable:"
curl -sk -o /dev/null -w "    HTTP %{http_code}\n" -m 5 -X POST https://localhost/api/auth/login -H 'Host: infrasafe.aisolutions.uz'
echo ""

echo "  app log tail (last 25 lines):"
docker logs infrasafe-app-1 --tail 25 2>&1 | sed 's/^/    /'

echo ""
echo "============================================================"
echo "DEPLOY DONE at $(date)"
echo "============================================================"
echo ""
echo "‼ FIRST ADMIN LOGIN — 2FA setup:"
echo "  open https://infrasafe.aisolutions.uz/, login as admin → QR setup"
echo ""
echo "Pending:"
echo "  1. Rotate GitHub PAT (still in ~/infrasafe/.git/config)"
echo "  2. Switch git remote to SSH key"
echo "  3. Local Dockerfile.unified has unstaged patches — keep, commit, or push fix upstream"
echo ""
