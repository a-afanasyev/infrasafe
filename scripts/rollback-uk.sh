#!/usr/bin/env bash
#
# rollback-uk.sh — emergency rollback to InfraSafe-only state
#
# Implements plan § 8.5. Triggered when:
#   - /health does not respond > 30s, OR
#   - /uk/api/health returns 5xx for > 60s, OR
#   - manual decision after failed deploy.
#
# Usage:
#   ./rollback-uk.sh <backup-timestamp>
#
# <backup-timestamp> is the directory name under ~/uk-deploy-backups/
# created by deploy-uk.sh phase 'backup'. E.g. 20260515-180000.
#
set -euo pipefail

INFRASAFE_DIR="${HOME}/infrasafe"
UK_DIR="${HOME}/uk"
BACKUP_ROOT="${HOME}/uk-deploy-backups"

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <backup-timestamp>" >&2
    echo "Available backups:" >&2
    ls -1 "$BACKUP_ROOT" 2>/dev/null | sed 's/^/  /' >&2
    exit 1
fi

TS="$1"
BACKUP="${BACKUP_ROOT}/${TS}"
[[ -d "$BACKUP" ]] || { echo "Backup not found: $BACKUP" >&2; exit 1; }

log() { printf '[rollback %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

# 1. UK alembic downgrade — if migrations were applied
if docker ps --format '{{.Names}}' | grep -q '^uk-management-api$'; then
    PREV_HEAD="$(cat "$BACKUP/uk-alembic-head.txt" 2>/dev/null || echo base)"
    log "alembic downgrade $PREV_HEAD (best-effort)"
    docker exec uk-management-api alembic downgrade "$PREV_HEAD" || \
        log "WARN: alembic downgrade failed — see plan § 8.5.1"
fi

# 2. Stop UK
log "Stopping UK stack"
docker compose -p uk -f "$UK_DIR/docker-compose.production.yml" down || true

# 3. Restore InfraSafe configs
log "Restoring InfraSafe configs from $BACKUP"
[[ -f "$BACKUP/nginx.production.conf" ]] && cp "$BACKUP/nginx.production.conf" "$INFRASAFE_DIR/"
[[ -f "$BACKUP/docker-compose.unified.yml" ]] && cp "$BACKUP/docker-compose.unified.yml" "$INFRASAFE_DIR/"
[[ -f "$BACKUP/env.prod.bak" ]] && cp "$BACKUP/env.prod.bak" "$INFRASAFE_DIR/.env.prod"

# 4. Disable integration flag in InfraSafe DB
log "Disabling uk_integration_enabled in DB"
docker exec infrasafe-postgres-1 psql -U infrasafe_app -d infrasafe -c \
    "UPDATE integration_config SET value='false' WHERE key='uk_integration_enabled';" || \
    log "WARN: could not flip integration flag"

# 5. Recreate InfraSafe nginx + app from restored configs
log "Recreating InfraSafe nginx + app"
docker compose -p infrasafe -f "$INFRASAFE_DIR/docker-compose.unified.yml" \
    up -d --force-recreate nginx app

sleep 5
docker exec infrasafe-nginx-1 nginx -t
docker exec infrasafe-nginx-1 nginx -s reload

# 6. Verify
log "Verifying InfraSafe health"
curl -sk https://infrasafe.uz/health | grep -q healthy && log "InfraSafe /health OK" || \
    log "WARN: /health did not return 'healthy'"

log "Rollback complete. InfraSafe back to InfraSafe-only mode."
