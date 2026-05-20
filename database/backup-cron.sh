#!/usr/bin/env bash
# InfraSafe production database backup — designed for cron / systemd-timer.
#
# Quiet-by-default (no colors, no progress chatter) so cron mail stays
# signal-only. Exits 0 on success, non-zero with a stderr message on
# failure — so the cron MAILTO / OnFailure handler fires.
#
# Behaviors:
#   1. pg_dump --clean --if-exists --no-owner the InfraSafe DB.
#   2. gzip -9 the dump.
#   3. (optional) Upload to off-host destination (S3 via aws-cli, or scp).
#   4. Apply retention — delete local dumps older than RETENTION_DAYS.
#
# Required env (or use defaults shown):
#   DB_HOST           default: postgres (Docker DNS name)
#   DB_PORT           default: 5432
#   DB_NAME           default: infrasafe
#   DB_USER           required — do NOT hardcode (was the [P1-V5] regression)
#   PGPASSWORD        required — exported, never echoed
#
# Optional:
#   BACKUP_LOCAL_DIR  default: /var/backups/infrasafe (created on each run)
#   RETENTION_DAYS    default: 30
#   S3_BUCKET         e.g. "s3://infrasafe-backups". If set → uploads
#                     via `aws s3 cp` (requires aws-cli pre-configured).
#   SCP_TARGET        e.g. "backup-host:/var/backups/infrasafe". Alt
#                     to S3; uses `scp` (requires key-based ssh).
#   POSTGRES_CONTAINER  If set → run pg_dump via `docker exec` instead
#                       of a direct connection (use when DB is in
#                       Docker and host has no pg_dump binary).
#
# Exit codes:
#   0  success
#   1  config error (missing required env)
#   2  pg_dump failure
#   3  gzip failure
#   4  off-host upload failure (local dump is preserved)
#   5  retention sweep failure (non-fatal — logged, exit 0 still)

set -euo pipefail

# ---- Config ----------------------------------------------------------------

: "${DB_HOST:=postgres}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=infrasafe}"
: "${DB_USER:?DB_USER is required — refusing to fall back to a hardcoded value}"
: "${PGPASSWORD:?PGPASSWORD is required — pass via env, not on the command line}"

: "${BACKUP_LOCAL_DIR:=/var/backups/infrasafe}"
: "${RETENTION_DAYS:=30}"
: "${S3_BUCKET:=}"
: "${SCP_TARGET:=}"
: "${POSTGRES_CONTAINER:=}"

# Logging — single canonical sink so cron MAILTO captures everything.
log() {
    printf '%s backup-cron[%d]: %s\n' "$(date -Iseconds)" "$$" "$*" >&2
}

# ---- Backup ----------------------------------------------------------------

mkdir -p "$BACKUP_LOCAL_DIR"
chmod 700 "$BACKUP_LOCAL_DIR"

timestamp=$(date +%Y%m%dT%H%M%SZ -u)
out="$BACKUP_LOCAL_DIR/infrasafe_${timestamp}.sql.gz"
tmp="$out.partial"

log "Starting pg_dump → ${out}"

dump_cmd=(
    pg_dump
    --host="$DB_HOST"
    --port="$DB_PORT"
    --username="$DB_USER"
    --dbname="$DB_NAME"
    --clean --if-exists --no-owner --no-privileges
)

if [[ -n "$POSTGRES_CONTAINER" ]]; then
    # Pipe via docker exec — PGPASSWORD inherits via -e.
    if ! docker exec -e PGPASSWORD="$PGPASSWORD" "$POSTGRES_CONTAINER" \
            pg_dump --username="$DB_USER" --dbname="$DB_NAME" \
            --clean --if-exists --no-owner --no-privileges \
         | gzip -9 > "$tmp"; then
        log "ERROR: pg_dump (docker exec) failed"
        rm -f "$tmp"
        exit 2
    fi
else
    if ! "${dump_cmd[@]}" | gzip -9 > "$tmp"; then
        log "ERROR: pg_dump (direct) failed"
        rm -f "$tmp"
        exit 2
    fi
fi

# Sanity check — empty gzipped dumps are ~20 bytes, healthy ones are KBs+.
if [[ $(wc -c < "$tmp") -lt 1024 ]]; then
    log "ERROR: dump suspiciously small ($(wc -c < "$tmp") bytes) — refusing to finalize"
    rm -f "$tmp"
    exit 2
fi

mv "$tmp" "$out"
log "Local dump finalized: $(du -h "$out" | cut -f1)"

# ---- Off-host upload -------------------------------------------------------

uploaded=false

if [[ -n "$S3_BUCKET" ]]; then
    log "Uploading to ${S3_BUCKET}"
    if aws s3 cp "$out" "${S3_BUCKET}/" --only-show-errors; then
        uploaded=true
        log "S3 upload OK"
    else
        log "ERROR: S3 upload failed — local copy retained at ${out}"
        exit 4
    fi
fi

if [[ -n "$SCP_TARGET" ]]; then
    log "Uploading via scp to ${SCP_TARGET}"
    if scp -q -o BatchMode=yes "$out" "${SCP_TARGET}/"; then
        uploaded=true
        log "scp upload OK"
    else
        log "ERROR: scp upload failed — local copy retained at ${out}"
        exit 4
    fi
fi

if ! $uploaded; then
    log "WARNING: no off-host destination configured (set S3_BUCKET or SCP_TARGET) — backup is local-only"
fi

# ---- Retention -------------------------------------------------------------

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && [[ "$RETENTION_DAYS" -gt 0 ]]; then
    log "Pruning local backups older than ${RETENTION_DAYS} days"
    if ! find "$BACKUP_LOCAL_DIR" -maxdepth 1 -name 'infrasafe_*.sql.gz' \
            -type f -mtime "+${RETENTION_DAYS}" -delete; then
        log "WARNING: retention sweep returned non-zero — review manually"
        # Don't fail the run on retention errors; the backup itself is fine.
    fi
fi

log "Backup complete"
exit 0
