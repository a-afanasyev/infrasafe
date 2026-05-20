# Database backup setup — 2026-05-21 (P0-7 / P1-V5)

> The Claude session delivers a production-grade cron-friendly backup
> script at `database/backup-cron.sh`. This document walks you through
> installing it on the prod host. The actual `crontab -e` step is for
> you to run.

## What the script does

`database/backup-cron.sh` is `set -euo pipefail` and quiet-by-default:

1. `pg_dump --clean --if-exists --no-owner --no-privileges` of the
   InfraSafe DB, piped through `gzip -9`.
2. Sanity-check: rejects dumps smaller than 1 KB.
3. (optional) Off-host upload via `aws s3 cp` or `scp` — pick one.
4. Retention sweep: deletes local dumps older than `RETENTION_DAYS`
   (default 30).

Exit codes are distinct so a wrapper / monitor can tell a
configuration error from a dump failure from an upload failure. See
the header of the script for the full table.

## Pre-flight on the prod host

```bash
ssh infrasafe@95.46.96.105 -p 32323
cd ~/infrasafe

# Pull the new script in (after you merge the fix/p0-7-backup-cron PR)
git pull --ff-only origin main

ls -la database/backup-cron.sh   # → executable, 644 or 755

# Stage the dest dir (root-owned by default; cron will run as a user)
sudo mkdir -p /var/backups/infrasafe
sudo chown infrasafe:infrasafe /var/backups/infrasafe
sudo chmod 700 /var/backups/infrasafe
```

If your prod host **does not** have `pg_dump` installed natively,
the script can pipe via `docker exec` — set `POSTGRES_CONTAINER` (see
section below).

## Environment

Create `/home/infrasafe/.backup-env` (mode 600, owner infrasafe):

```bash
DB_HOST=postgres                       # docker DNS name within compose
DB_PORT=5432
DB_NAME=infrasafe
DB_USER=infrasafe_app
PGPASSWORD=<the prod DB password>      # the SAME value as in .env.prod

BACKUP_LOCAL_DIR=/var/backups/infrasafe
RETENTION_DAYS=30

# Pick ONE off-host destination:
S3_BUCKET=s3://your-bucket/infrasafe   # leave empty if using scp
# SCP_TARGET=backup@offhost:/var/backups/infrasafe

# Uncomment ONLY if pg_dump is not installed on the host:
# POSTGRES_CONTAINER=infrasafe-postgres-1
```

> **Do NOT** commit this file. Its mode-600 is your only protection.

## Manual smoke test

```bash
sudo -u infrasafe bash -c 'set -a; . /home/infrasafe/.backup-env; set +a; /home/infrasafe/infrasafe/database/backup-cron.sh'
```

Expected output (stderr) — looks like:

```
2026-05-21T08:30:00+00:00 backup-cron[12345]: Starting pg_dump → /var/backups/infrasafe/infrasafe_20260521T083000Z.sql.gz
2026-05-21T08:30:04+00:00 backup-cron[12345]: Local dump finalized: 3.2M
2026-05-21T08:30:04+00:00 backup-cron[12345]: Uploading to s3://your-bucket/infrasafe
2026-05-21T08:30:06+00:00 backup-cron[12345]: S3 upload OK
2026-05-21T08:30:06+00:00 backup-cron[12345]: Pruning local backups older than 30 days
2026-05-21T08:30:06+00:00 backup-cron[12345]: Backup complete
```

Verify the dump round-trips:

```bash
# Restore into a throwaway DB (DO NOT do this on the live infrasafe DB)
zcat /var/backups/infrasafe/infrasafe_*.sql.gz \
  | psql -h postgres -U infrasafe_app -d infrasafe_restore_test
```

## Install the cron entry

As user `infrasafe`:

```bash
crontab -e
```

Add — daily 03:15 UTC, mail any output to ops:

```cron
MAILTO=ops@infrasafe.local
15 3 * * *  set -a; . /home/infrasafe/.backup-env; set +a; /home/infrasafe/infrasafe/database/backup-cron.sh
```

(Adjust the time and MAILTO to your ops contact.)

Verify:

```bash
crontab -l           # see the entry
sudo systemctl status cron   # confirm cron is running on the host
```

## Alternative — systemd timer

If you prefer systemd:

`/etc/systemd/system/infrasafe-backup.service`:
```ini
[Unit]
Description=InfraSafe DB backup
After=docker.service

[Service]
Type=oneshot
User=infrasafe
EnvironmentFile=/home/infrasafe/.backup-env
ExecStart=/home/infrasafe/infrasafe/database/backup-cron.sh
```

`/etc/systemd/system/infrasafe-backup.timer`:
```ini
[Unit]
Description=InfraSafe DB backup — daily

[Timer]
OnCalendar=daily
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now infrasafe-backup.timer
systemctl list-timers infrasafe-backup.timer
```

`OnFailure=` can be wired to a notifier service if you want pager alerts.

## Off-host destination — S3 setup

If you don't already have an S3 bucket for this purpose:

```bash
aws s3 mb s3://infrasafe-backups --region <your-region>
aws s3api put-bucket-versioning \
    --bucket infrasafe-backups \
    --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration \
    --bucket infrasafe-backups \
    --lifecycle-configuration file://lifecycle.json
```

`lifecycle.json` for 90-day off-host retention:
```json
{
  "Rules": [{
    "ID": "expire-old-backups",
    "Status": "Enabled",
    "Filter": { "Prefix": "" },
    "Expiration": { "Days": 90 }
  }]
}
```

Create a least-privilege IAM user with only
`s3:PutObject` + `s3:GetObject` + `s3:ListBucket` on this one bucket.
Put its keys in `~/.aws/credentials` for user `infrasafe`.

## Off-host destination — scp setup

If you don't have AWS:

1. Spin up any second host (different cloud, different rack, even a
   home NAS — anything that fails *independently* of prod).
2. On that host, create user `backup` with home `/var/backups/infrasafe`.
3. On prod, generate an ssh key with no passphrase:
   `sudo -u infrasafe ssh-keygen -t ed25519 -f /home/infrasafe/.ssh/backup_id -N ''`
4. Copy `backup_id.pub` to the off-host's `~backup/.ssh/authorized_keys`.
5. Lock that authorized_keys entry to the backup-only command:
   `command="rsync --server -e.iLsfxC . /var/backups/infrasafe/",no-pty,no-X11-forwarding,no-agent-forwarding ssh-ed25519 …`
   (use `rrsync` from the rsync package for an even tighter sandbox)

Then set `SCP_TARGET=backup@offhost.example.com:/var/backups/infrasafe`
in `.backup-env`, and the script will rsync the dump over.

## Acceptance check (P0-7)

After install, leave it running for 24 hours, then verify:

- [ ] At least one dump file is on the off-host destination
  (`aws s3 ls s3://infrasafe-backups/` or `ssh backup-host 'ls -la /var/backups/infrasafe'`)
- [ ] `crontab -l` shows the entry (or `systemctl list-timers`
  shows the active timer)
- [ ] A test dump restores successfully into a throwaway DB
- [ ] Retention simulation: `find /var/backups/infrasafe -name 'infrasafe_*.sql.gz' -mtime +30 -print` shows what *would* be deleted (use `-print` to dry-run before letting the script's `-delete` run).

Once all four are green, mark P0-7 as DONE in the backlog.

## Notes for the next iteration

- This is daily backup, not PITR. WAL archiving (`archive_mode=on` +
  `archive_command`) is still backlog ([P0-7] paragraph 2) — schedule
  separately when RPO < 24h becomes a real requirement.
- The script does NOT clean up the *remote* S3 / scp store — only
  local. If you want bounded remote retention, use the S3 lifecycle
  policy above or write a similar `find -mtime +90 -delete` on the
  scp host's cron.
