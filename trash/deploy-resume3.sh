#!/usr/bin/env bash
# Continue: Dockerfile already patched, just rebuild + up + frontend bundle.
set -euo pipefail

PROJ=/home/infrasafe/infrasafe
COMPOSE_FILE="docker-compose.unified.yml"
LOG=/var/log/infrasafe-deploy.log

if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root"
    exit 1
fi

exec > >(tee -a "$LOG") 2>&1

echo ""
echo "============================================================"
echo "DEPLOY RESUME 3 — $(date)"
echo "============================================================"

trap 'echo "[FAIL] error at line $LINENO (exit $?)"; exit 1' ERR

# Verify patch is in place
echo ""
echo "=== Verify Dockerfile patch ==="
grep -E "^FROM node:|^RUN npm install" "$PROJ/Dockerfile.unified" | sed 's/^/  /'

# ============================================================
# Build
# ============================================================
echo ""
echo "=== Rebuild app + frontend (no-cache) ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE build --no-cache --pull app frontend
EOSU

# ============================================================
# Up
# ============================================================
echo ""
echo "=== docker compose up -d --force-recreate ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE up -d --force-recreate
EOSU

echo "  waiting 10s for app container..."
sleep 10

# ============================================================
# Build frontend bundle inside running container (writes to host via bind mount)
# ============================================================
echo ""
echo "=== Build frontend bundle inside container ==="
sudo -u infrasafe -H mkdir -p "$PROJ/public/dist"
docker exec infrasafe-app-1 sh -lc 'cd /app && npm run build:frontend' 2>&1 | sed 's/^/    /'

echo ""
echo "  Bundle files on host:"
ls -la "$PROJ/public/dist" 2>&1 | head -15 | sed 's/^/    /'

# ============================================================
# Smoke tests
# ============================================================
echo ""
echo "=== Smoke tests ==="

echo ""
echo "  containers:"
docker ps --format "table {{.Names}}\t{{.Status}}" | sed 's/^/    /'

echo ""
echo "  app /health (direct):"
curl -sf -m 5 http://127.0.0.1:3000/health 2>&1 | sed 's/^/    /' || echo "    FAILED"

echo ""
echo "  API root via nginx:"
curl -sk -m 5 https://localhost/api/ -H 'Host: infrasafe.aisolutions.uz' 2>&1 | head -c 400 | sed 's/^/    /'

echo ""
echo "  HTTPS / status + size:"
curl -sk -m 5 -o /dev/null -w "    HTTP %{http_code}, size %{size_download}\n" https://localhost/ -H 'Host: infrasafe.aisolutions.uz'

echo ""
echo "  Login endpoint:"
curl -sk -o /dev/null -w "    HTTP %{http_code}\n" -m 5 -X POST https://localhost/api/auth/login -H 'Host: infrasafe.aisolutions.uz'

echo ""
echo "  app log tail:"
docker logs infrasafe-app-1 --tail 25 2>&1 | sed 's/^/    /'

echo ""
echo "============================================================"
echo "DONE — $(date)"
echo "============================================================"
echo ""
echo "‼ Open https://infrasafe.aisolutions.uz/ → login admin → 2FA QR setup"
echo ""
