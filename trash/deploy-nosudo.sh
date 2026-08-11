#!/usr/bin/env bash
# InfraSafe demo — deploy current main WITHOUT sudo.
# Runs entirely as `infrasafe` user (member of docker group).
#
# Tradeoffs vs deploy.sh:
#   - No swap creation -> compensate by stopping ALL containers before build
#   - No /var/log/ writes -> log to ~/deploy-log
#   - No system package installs (assumes deploy.sh's prereqs already done)
#
# Run: bash ~/deploy-nosudo.sh
set -euo pipefail

# ============================================================
# Configuration
# ============================================================
PROJ=$HOME/infrasafe
COMPOSE_FILE="docker-compose.unified.yml"
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$HOME/deploy-backups/$TS"
LOG="$HOME/deploy-log-$TS.log"
DB_USER=infrasafe_app
DB_NAME=infrasafe
PG_CONTAINER=infrasafe-postgres-1

# ============================================================
# Setup
# ============================================================
mkdir -p "$BACKUP_DIR"
exec > >(tee -a "$LOG") 2>&1

echo ""
echo "============================================================"
echo "InfraSafe deploy (no-sudo) — start at $(date)"
echo "Backup dir: $BACKUP_DIR"
echo "Log:        $LOG"
echo "============================================================"

trap 'echo "[FAIL] error at line $LINENO (exit $?). Backups in $BACKUP_DIR. Rollback: see end of script."; exit 1' ERR

# ============================================================
# Phase A: pre-flight
# ============================================================
echo ""
echo "=== Phase A: pre-flight ==="
docker info >/dev/null 2>&1 || { echo "ERROR: cannot run docker as $(whoami)"; exit 2; }
docker ps --format "{{.Names}}" | grep -q "^${PG_CONTAINER}$" || { echo "ERROR: $PG_CONTAINER not running"; exit 2; }
[ -d "$PROJ/.git" ] || { echo "ERROR: $PROJ is not a git repo"; exit 2; }
echo "  docker accessible as $(whoami): OK"
echo "  $PG_CONTAINER is running: OK"
echo ""
echo "  Resources:"
df -h "$PROJ" | tail -1 | sed 's/^/    /'
free -h | sed 's/^/    /'

# ============================================================
# Phase B: backups
# ============================================================
echo ""
echo "=== Phase B: backup DB and config ==="

echo "  pg_dump -> $BACKUP_DIR/db.dump (custom format, gzipped automatically by -Fc)"
docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f /tmp/db.dump
docker cp "$PG_CONTAINER:/tmp/db.dump" "$BACKUP_DIR/db.dump"
docker exec "$PG_CONTAINER" rm -f /tmp/db.dump
ls -lh "$BACKUP_DIR/db.dump"

echo "  git state"
git -C "$PROJ" rev-parse HEAD          > "$BACKUP_DIR/git-head"
git -C "$PROJ" branch --show-current   > "$BACKUP_DIR/git-branch"
git -C "$PROJ" status -sb              > "$BACKUP_DIR/git-status"

echo "  config files"
cp -p "$PROJ/$COMPOSE_FILE" "$BACKUP_DIR/$COMPOSE_FILE.bak"
[ -f "$PROJ/.env" ]      && cp -p "$PROJ/.env"      "$BACKUP_DIR/env.bak"      || true
[ -f "$PROJ/.env.prod" ] && cp -p "$PROJ/.env.prod" "$BACKUP_DIR/env.prod.bak" || true

echo "  current image IDs (for rollback)"
docker images --filter "reference=infrasafe-*" --format "{{.Repository}}:{{.Tag}} {{.ID}}" > "$BACKUP_DIR/images-before.txt"
cat "$BACKUP_DIR/images-before.txt" | sed 's/^/    /'

# ============================================================
# Phase C: stop app/frontend/nginx (postgres still up for migrations)
# ============================================================
echo ""
echo "=== Phase C: stop app+frontend+nginx ==="
cd "$PROJ"
docker compose -f "$COMPOSE_FILE" stop app frontend nginx

# ============================================================
# Phase D: git pull
# ============================================================
echo ""
echo "=== Phase D: git pull origin main ==="
echo "  before: $(git -C "$PROJ" rev-parse --short HEAD) on $(git -C "$PROJ" branch --show-current)"
git -C "$PROJ" fetch origin
git -C "$PROJ" checkout main 2>&1 || git -C "$PROJ" checkout -b main origin/main
git -C "$PROJ" pull --ff-only origin main
echo "  after:  $(git -C "$PROJ" rev-parse --short HEAD)"
echo "  changed file count: $(git -C "$PROJ" diff --name-only $(cat "$BACKUP_DIR/git-head") HEAD 2>/dev/null | wc -l)"

# ============================================================
# Phase E: TOTP_ENCRYPTION_KEY into compose env
# ============================================================
echo ""
echo "=== Phase E: TOTP_ENCRYPTION_KEY into unified compose ==="
if grep -q '^      - TOTP_ENCRYPTION_KEY=' "$PROJ/$COMPOSE_FILE"; then
    echo "  TOTP_ENCRYPTION_KEY already present — keeping existing value"
else
    NEW_TOTP_KEY=$(openssl rand -base64 32)
    sed -i "/JWT_REFRESH_SECRET=/a\\      - TOTP_ENCRYPTION_KEY=$NEW_TOTP_KEY" "$PROJ/$COMPOSE_FILE"
    echo "  TOTP_ENCRYPTION_KEY: <generated, 44 chars>"
    echo "$NEW_TOTP_KEY" > "$BACKUP_DIR/totp-encryption-key.txt"
    chmod 600 "$BACKUP_DIR/totp-encryption-key.txt"
fi

echo "  resulting env block (app service):"
awk '/^  app:/,/^  postgres:/' "$PROJ/$COMPOSE_FILE" | grep -E '^\s+- ' | sed 's/^/    /'

# ============================================================
# Phase F: apply migrations 011–016
# ============================================================
echo ""
echo "=== Phase F: apply migrations 011–016 ==="

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
echo "  Schema sanity (new columns/tables):"
docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -At -c \
  "SELECT 'users.' || column_name FROM information_schema.columns
   WHERE table_name='users' AND column_name IN ('totp_secret','totp_enabled','password_changed_at','recovery_codes')
   UNION ALL
   SELECT 'table.' || table_name FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN
         ('integration_config','integration_log','alert_rules','alert_request_map','account_lockout')" \
  | sed 's/^/    /'

# ============================================================
# Phase G: stop ALL infrasafe containers to free RAM for build
# ============================================================
echo ""
echo "=== Phase G: stop all containers (free RAM for --no-cache build) ==="
echo "  Before:"
free -h | head -2 | sed 's/^/    /'

# Stop everything in the infrasafe project
docker compose -f "$COMPOSE_FILE" stop

# Also stop other heavy containers (grafana, influxdb, nodered) running from ~/docker-compose.yml
cd "$HOME"
docker compose stop grafana influxdb nodered mosquitto 2>&1 | sed 's/^/    /' || true
cd "$PROJ"

sleep 2
echo ""
echo "  After:"
free -h | head -2 | sed 's/^/    /'

# ============================================================
# Phase H: rebuild app and frontend images
# ============================================================
echo ""
echo "=== Phase H: rebuild app + frontend (no-cache, may take 5–10 min) ==="
DOCKER_BUILDKIT=1 docker compose -f "$COMPOSE_FILE" build --no-cache --pull app frontend

# ============================================================
# Phase I: up the whole infrasafe stack and bring back side stack
# ============================================================
echo ""
echo "=== Phase I: docker compose up -d --force-recreate ==="
cd "$PROJ"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate

echo ""
echo "  bringing back grafana/influxdb/nodered/mosquitto from ~/docker-compose.yml"
cd "$HOME"
docker compose up -d 2>&1 | sed 's/^/    /' || true
cd "$PROJ"

echo "  waiting 15s for containers to come online..."
sleep 15

# ============================================================
# Phase J: smoke tests
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

echo "  app version:"
curl -sk -m 5 https://localhost/api/ -H 'Host: infrasafe.aisolutions.uz' 2>/dev/null | grep -oE '"version":"[^"]*"' | sed 's/^/    /' || echo "    (n/a)"
echo ""

echo "  login endpoint reachable (expects 400/401, not 5xx):"
curl -sk -o /dev/null -w "    HTTP %{http_code}\n" -m 5 -X POST https://localhost/api/auth/login -H 'Host: infrasafe.aisolutions.uz'
echo ""

echo "  app log tail (last 20 lines):"
docker logs infrasafe-app-1 --tail 20 2>&1 | sed 's/^/    /'

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
echo "  - login as admin"
echo "  - server returns 'requires2FASetup' → frontend shows QR"
echo "  - scan with Authenticator app, enter 6-digit code → done"
echo ""
echo "‼ STILL PENDING:"
echo "  1. Recover sudo password via VPS panel (webspace.uz console -> rescue mode -> passwd infrasafe)"
echo "  2. Rotate GitHub PAT (token in ~/infrasafe/.git/config is leaked)"
echo "  3. Switch git remote to SSH key auth (no PAT in URL)"
echo ""
echo "Rollback (no sudo needed):"
echo "  1. cd $PROJ && git reset --hard \$(cat $BACKUP_DIR/git-head)"
echo "  2. cp $BACKUP_DIR/$COMPOSE_FILE.bak $PROJ/$COMPOSE_FILE"
echo "  3. docker exec -i $PG_CONTAINER pg_restore -U $DB_USER -d $DB_NAME --clean < $BACKUP_DIR/db.dump"
echo "  4. docker compose -f $COMPOSE_FILE up -d --force-recreate"
echo ""
