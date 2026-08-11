#!/usr/bin/env bash
# InfraSafe demo — deploy current main on top of the existing stack.
#
# Plan (variant 2A + C1 + U1):
#   - in-place upgrade of /home/infrasafe/infrasafe
#   - keep using docker-compose.unified.yml
#   - UK integration stays disabled (no UK_* secrets needed)
#   - new TOTP_ENCRYPTION_KEY generated; admin re-sets up 2FA on next login
#
# Run as root: sudo bash deploy.sh
set -euo pipefail

# ============================================================
# Configuration
# ============================================================
PROJ=/home/infrasafe/infrasafe
COMPOSE_FILE="docker-compose.unified.yml"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/home/infrasafe/deploy-backups/$TS"
LOG=/var/log/infrasafe-deploy.log
DB_USER=infrasafe_app
DB_NAME=infrasafe
PG_CONTAINER=infrasafe-postgres-1

# ============================================================
# Setup
# ============================================================
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: must run as root: sudo bash deploy.sh"
    exit 1
fi

mkdir -p "$BACKUP_DIR"
chown infrasafe:infrasafe "$BACKUP_DIR"
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "============================================================"
echo "InfraSafe deploy — start at $(date)"
echo "Backup dir: $BACKUP_DIR"
echo "Log:        $LOG"
echo "============================================================"

trap 'echo "[FAIL] error at line $LINENO (exit $?). Backups in $BACKUP_DIR. Rollback: see end of script."; exit 1' ERR

# ============================================================
# Phase A: pre-flight
# ============================================================
echo ""
echo "=== Phase A: pre-flight checks ==="
docker ps --format "{{.Names}}" | grep -q "^${PG_CONTAINER}$" || { echo "ERROR: $PG_CONTAINER not running"; exit 2; }
docker ps --format "{{.Names}}" | grep -q "^infrasafe-app-1$"  || { echo "ERROR: infrasafe-app-1 not running"; exit 2; }
[ -d "$PROJ/.git" ] || { echo "ERROR: $PROJ is not a git repo"; exit 2; }
df -h "$PROJ" | tail -1
free -h
echo "  pre-flight OK."

# ============================================================
# Phase B: swap (build needs RAM, host has 1.9G + swap=0)
# ============================================================
echo ""
echo "=== Phase B: ensure swap (for npm/esbuild build) ==="
if [ "$(swapon --show=NAME --noheadings | wc -l)" -eq 0 ]; then
    echo "  no swap configured — creating 2G /swapfile"
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    if ! grep -qF '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    swapon --show
else
    echo "  swap already configured:"
    swapon --show
fi

# ============================================================
# Phase C: backups
# ============================================================
echo ""
echo "=== Phase C: backup DB and config ==="

echo "  pg_dump -> $BACKUP_DIR/db.dump (custom format)"
docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f /tmp/db.dump
docker cp "$PG_CONTAINER:/tmp/db.dump" "$BACKUP_DIR/db.dump"
docker exec "$PG_CONTAINER" rm -f /tmp/db.dump
ls -lh "$BACKUP_DIR/db.dump"

echo "  git state"
sudo -u infrasafe -H git -C "$PROJ" rev-parse HEAD     > "$BACKUP_DIR/git-head" || true
sudo -u infrasafe -H git -C "$PROJ" branch --show-current > "$BACKUP_DIR/git-branch" || true
sudo -u infrasafe -H git -C "$PROJ" status -sb         > "$BACKUP_DIR/git-status" || true

echo "  config files"
cp -p "$PROJ/$COMPOSE_FILE" "$BACKUP_DIR/$COMPOSE_FILE.bak"
[ -f "$PROJ/.env" ]      && cp -p "$PROJ/.env"      "$BACKUP_DIR/env.bak"      || true
[ -f "$PROJ/.env.prod" ] && cp -p "$PROJ/.env.prod" "$BACKUP_DIR/env.prod.bak" || true

echo "  current image IDs (for rollback)"
docker images --filter "reference=infrasafe-*" --format "{{.Repository}}:{{.Tag}} {{.ID}}" > "$BACKUP_DIR/images-before.txt"
cat "$BACKUP_DIR/images-before.txt"

chown -R infrasafe:infrasafe "$BACKUP_DIR"

# ============================================================
# Phase D: stop app/frontend/nginx (postgres stays for migrations)
# ============================================================
echo ""
echo "=== Phase D: stop app+frontend+nginx ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE stop app frontend nginx
EOSU

# ============================================================
# Phase E: git pull
# ============================================================
echo ""
echo "=== Phase E: git pull origin main ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
echo "  before: \$(git rev-parse --short HEAD) on \$(git branch --show-current)"
git fetch origin
git checkout main 2>&1 || git checkout -b main origin/main
git pull --ff-only origin main
echo "  after:  \$(git rev-parse --short HEAD)"
echo "  changed file count: \$(git diff --name-only \$(cat $BACKUP_DIR/git-head) HEAD 2>/dev/null | wc -l)"
EOSU

# ============================================================
# Phase F: generate TOTP_ENCRYPTION_KEY and update compose env
# ============================================================
echo ""
echo "=== Phase F: TOTP_ENCRYPTION_KEY into unified compose ==="

if grep -q '^      - TOTP_ENCRYPTION_KEY=' "$PROJ/$COMPOSE_FILE"; then
    echo "  TOTP_ENCRYPTION_KEY already present in compose — keeping existing value"
else
    NEW_TOTP_KEY=$(openssl rand -base64 32)
    # Insert after JWT_REFRESH_SECRET line in the app service env block
    sed -i "/JWT_REFRESH_SECRET=/a\\      - TOTP_ENCRYPTION_KEY=$NEW_TOTP_KEY" "$PROJ/$COMPOSE_FILE"
    echo "  TOTP_ENCRYPTION_KEY: <generated, 44 chars>"
    echo "$NEW_TOTP_KEY" > "$BACKUP_DIR/totp-encryption-key.txt"
    chmod 600 "$BACKUP_DIR/totp-encryption-key.txt"
fi

# Verify the line is inside app env block (sanity check)
echo "  resulting env block (app service):"
awk '/^  app:/,/^  postgres:/' "$PROJ/$COMPOSE_FILE" | grep -E '^\s+- ' | sed 's/^/    /'

# ============================================================
# Phase G: apply migrations
# ============================================================
echo ""
echo "=== Phase G: apply migrations 011–016 ==="

run_migration() {
    local mig="$1"
    local f="$PROJ/database/migrations/${mig}.sql"
    if [ ! -f "$f" ]; then
        echo "  SKIP $mig (file not found)"
        return 0
    fi
    echo "  applying: $mig"
    if docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
           -v ON_ERROR_STOP=1 --quiet < "$f" 2>&1 | sed 's/^/      /'; then
        echo "    OK"
    else
        echo "    ERROR — see log above"
        return 1
    fi
}

run_migration 011_uk_integration
run_migration 012_totp_2fa
run_migration 012_fix_materialized_view
run_migration 013_account_lockout
run_migration 014_performance_indexes
run_migration 015_alert_dedup_constraint
run_migration 016_password_changed_at

echo ""
echo "  Schema check after migrations:"
docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c "
SELECT 'tables' AS kind, COUNT(*) FROM information_schema.tables WHERE table_schema='public'
UNION ALL SELECT 'integration_config', COUNT(*) FROM integration_config WHERE 1=0 OR EXISTS (SELECT 1)
UNION ALL SELECT 'alert_rules', COUNT(*) FROM alert_rules WHERE 1=0 OR EXISTS (SELECT 1)
UNION ALL SELECT 'alert_request_map', COUNT(*) FROM alert_request_map WHERE 1=0 OR EXISTS (SELECT 1)
UNION ALL SELECT 'account_lockout', COUNT(*) FROM account_lockout WHERE 1=0 OR EXISTS (SELECT 1)
" 2>&1 | sed 's/^/    /' || echo "    (some queries may be expected to fail if tables empty)"

echo "  Verifying users.totp_secret column:"
docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('totp_secret','totp_enabled','password_changed_at','recovery_codes')" \
  | sed 's/^/    /'

# ============================================================
# Phase H: rebuild app and frontend images
# ============================================================
echo ""
echo "=== Phase H: rebuild app + frontend images (no-cache, 5–10 min) ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE build --no-cache --pull app frontend
EOSU

# ============================================================
# Phase I: up new stack
# ============================================================
echo ""
echo "=== Phase I: docker compose up -d --force-recreate ==="
sudo -u infrasafe -H bash <<EOSU
set -e
cd $PROJ
docker compose -f $COMPOSE_FILE up -d --force-recreate
EOSU

echo "  waiting 15s for app to come online..."
sleep 15

# ============================================================
# Phase J: verification
# ============================================================
echo ""
echo "=== Phase J: smoke tests ==="

echo "  container status:"
docker ps --format "table {{.Names}}\t{{.Status}}" | sed 's/^/    /'
echo ""

echo "  app /health (direct):"
curl -sf -m 5 http://127.0.0.1:3000/health 2>&1 | sed 's/^/    /' || echo "    FAILED"
echo ""

echo "  API root via nginx:"
curl -sk -m 5 https://localhost/api/ -H 'Host: infrasafe.aisolutions.uz' 2>&1 | head -c 400 | sed 's/^/    /'
echo ""

echo "  app version (from API):"
curl -sk -m 5 https://localhost/api/ -H 'Host: infrasafe.aisolutions.uz' 2>/dev/null | grep -oE '"version":"[^"]*"' | sed 's/^/    /' || echo "    (n/a)"
echo ""

echo "  login endpoint reachable (expects 400/401, not 5xx):"
curl -sk -o /dev/null -w "    HTTP %{http_code}\n" -m 5 -X POST https://localhost/api/auth/login -H 'Host: infrasafe.aisolutions.uz'
echo ""

echo "  app log tail (last 15 lines):"
docker logs infrasafe-app-1 --tail 15 2>&1 | sed 's/^/    /'

# ============================================================
# Final summary
# ============================================================
echo ""
echo "============================================================"
echo "DEPLOY DONE at $(date)"
echo "============================================================"
echo ""
echo "Backups:    $BACKUP_DIR"
echo "Log:        $LOG"
echo ""
echo "‼ FIRST ADMIN LOGIN AFTER 2FA MIGRATION:"
echo "  - open https://infrasafe.aisolutions.uz/"
echo "  - login as admin (password unchanged)"
echo "  - server returns 'requires2FASetup' → frontend shows QR"
echo "  - scan with Google Authenticator / 1Password / Authy"
echo "  - confirm 6-digit code → access granted"
echo ""
echo "Admin services (still on 127.0.0.1 from hardening):"
echo "  ssh -p 32323 -N -L 3001:127.0.0.1:3001 infrasafe@95.46.96.105"
echo "  Then http://localhost:3001 (Grafana), :1880 (Node-RED), etc."
echo ""
echo "‼ PASSWORD CHANGE STILL PENDING (was in bash_history):"
echo "  sudo passwd infrasafe"
echo ""
echo "Rollback (if needed):"
echo "  1. Restore DB:        docker exec -i $PG_CONTAINER pg_restore -U $DB_USER -d $DB_NAME --clean < $BACKUP_DIR/db.dump"
echo "  2. Restore code:      cd $PROJ && git reset --hard \$(cat $BACKUP_DIR/git-head)"
echo "  3. Restore compose:   cp $BACKUP_DIR/$COMPOSE_FILE.bak $PROJ/$COMPOSE_FILE"
echo "  4. Restart:           cd $PROJ && docker compose -f $COMPOSE_FILE up -d --force-recreate"
echo ""
