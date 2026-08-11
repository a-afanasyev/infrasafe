#!/usr/bin/env bash
# Resume deploy from Phase G (after 015 migration failed on seed duplicates).
# Run: sudo bash deploy-resume.sh
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
echo "DEPLOY RESUME — $(date)"
echo "============================================================"

trap 'echo "[FAIL] error at line $LINENO (exit $?). Backups in $BACKUP_DIR."; exit 1' ERR

# ============================================================
# Phase G': cleanup seed duplicates + apply 015 + apply 016
# ============================================================
echo ""
echo "=== Phase G': cleanup duplicates, apply 015 + 016 ==="

# Run cleanup version of 015 (resolves duplicates first, then creates index)
echo "  applying 07_alert_dedup.sql (with pre-cleanup)"
if [ -f "$PROJ/database/init/07_alert_dedup.sql" ]; then
    docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 < "$PROJ/database/init/07_alert_dedup.sql" 2>&1 | sed 's/^/      /'
    echo "    OK (015 done with cleanup)"
else
    echo "  ERROR: 07_alert_dedup.sql not found"
    exit 2
fi

echo "  applying 016_password_changed_at"
docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 < "$PROJ/database/migrations/016_password_changed_at.sql" 2>&1 | sed 's/^/      /'
echo "    OK"

echo ""
echo "  Verify schema after migrations:"
docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c \
  "SELECT 'col:users.' || column_name FROM information_schema.columns
   WHERE table_name='users' AND column_name IN ('totp_secret','totp_enabled','password_changed_at','recovery_codes')
   UNION ALL
   SELECT 'tbl:' || table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN
         ('integration_config','integration_log','alert_rules','alert_request_map','account_lockout')
   UNION ALL
   SELECT 'idx:idx_active_alert_dedup' FROM pg_indexes
   WHERE indexname='idx_active_alert_dedup'" \
  | sort -u | sed 's/^/    /'

# ============================================================
# Phase H: rebuild app + frontend
# ============================================================
echo ""
echo "=== Phase H: rebuild app + frontend (no-cache) ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE build --no-cache --pull app frontend
EOSU

# ============================================================
# Phase I: up
# ============================================================
echo ""
echo "=== Phase I: docker compose up -d --force-recreate ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE up -d --force-recreate
EOSU

echo "  waiting 15s..."
sleep 15

# ============================================================
# Phase J: smoke tests
# ============================================================
echo ""
echo "=== Phase J: smoke tests ==="
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

echo "  login endpoint reachable (expects 400/401, not 5xx):"
curl -sk -o /dev/null -w "    HTTP %{http_code}\n" -m 5 -X POST https://localhost/api/auth/login -H 'Host: infrasafe.aisolutions.uz'
echo ""

echo "  app log tail (last 20 lines):"
docker logs infrasafe-app-1 --tail 20 2>&1 | sed 's/^/    /'

echo ""
echo "============================================================"
echo "DEPLOY DONE at $(date)"
echo "============================================================"
echo ""
echo "‼ FIRST ADMIN LOGIN AFTER 2FA MIGRATION:"
echo "  - open https://infrasafe.aisolutions.uz/"
echo "  - login as admin"
echo "  - server returns 'requires2FASetup' → frontend shows QR"
echo "  - scan with Authenticator app, enter 6-digit code → done"
echo ""
echo "Still pending:"
echo "  1. Rotate GitHub PAT in ~/infrasafe/.git/config (it was leaked)"
echo "  2. Switch git remote to SSH key auth"
echo ""
