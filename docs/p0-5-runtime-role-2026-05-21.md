# [P0-5] DB role separation — operator runbook (2026-05-21)

> Goal: stop running the InfraSafe app as a superuser-equivalent role.
> Migration `database/migrations/017_runtime_role.sql` creates the new
> `infrasafe_runtime` role. This document covers the operator steps:
> set the password, swap the app's env, restart, verify.

## What ships in the PR

| File | Purpose |
| --- | --- |
| `database/migrations/017_runtime_role.sql` | Idempotent migration: CREATE ROLE + GRANTs + SECURITY DEFINER on refresh function |
| `database/init/09_runtime_role.sql` | Mirror of the migration for the documented fresh-init flow (does NOT replace the prod-mounted `database.sql` — see § Carry-over) |
| `docs/migrations/README.md` (updated) | Adds migration 017 to the table |
| **No changes** to `docker-compose.unified.yml` | Keeping `DB_USER=infrasafe_app` until the runtime password is set in prod — operator-toggled |

## Pre-flight

1. **Confirm there is a fresh off-host backup** (P0-7 — should be by now).
   ```bash
   aws s3 ls s3://infrasafe-backups/ | tail -3   # newest dump < 24h old
   ```
2. **Maintenance window.** Step 5 below restarts the API container.
   For the demo box this is ~10s downtime — for production schedule a
   3-minute window so you can rollback cleanly.

## Generate the runtime password

```bash
openssl rand -base64 32 | tr -d '+/=' | head -c 32
# → e.g.  Z9hDk7nFp2qWvxLm3RsTuYbAc1eQ4XGi
```

Save into your password manager. **Do not** copy via Slack/email.

## Apply the migration

```bash
ssh infrasafe@95.46.96.105 -p 32323
cd ~/infrasafe
git pull --ff-only origin main          # PR with migration 017 merged

# Run migration AS infrasafe_app (still the superuser bootstrap role):
docker exec -i infrasafe-postgres-1 \
    psql -U infrasafe_app -d infrasafe \
    -v ON_ERROR_STOP=1 \
    < database/migrations/017_runtime_role.sql
```

Expected output: `DO`, `GRANT`, `GRANT`, `ALTER DEFAULT PRIVILEGES` × 3, `DO`, `REVOKE`.

Verify the role landed:

```bash
docker exec infrasafe-postgres-1 \
    psql -U infrasafe_app -d infrasafe \
    -c "\du infrasafe_runtime"

# Should show:
#  Role name         | Attributes        | Member of
#  ------------------+-------------------+-----------
#  infrasafe_runtime | (none — LOGIN)    | {}
```

## Set the runtime password

```bash
NEW_PASSWORD='Z9hDk7nFp2qWvxLm3RsTuYbAc1eQ4XGi'   # from the openssl step

docker exec -i infrasafe-postgres-1 \
    psql -U infrasafe_app -d infrasafe \
    -c "ALTER ROLE infrasafe_runtime PASSWORD '${NEW_PASSWORD}';"
```

> The migration set a known-rejected placeholder; pg_hba uses scram/md5
> so connections fail until the ALTER ROLE above runs.

Spot-check the connection BEFORE swapping the app's env:

```bash
docker exec -e PGPASSWORD="${NEW_PASSWORD}" infrasafe-postgres-1 \
    psql -h localhost -U infrasafe_runtime -d infrasafe \
    -c "SELECT current_user, session_user, current_database();"

# Expect:
#  current_user      | session_user      | current_database
# -------------------+-------------------+-------------------
#  infrasafe_runtime | infrasafe_runtime | infrasafe

# Also sanity-check the privilege fence:
docker exec -e PGPASSWORD="${NEW_PASSWORD}" infrasafe-postgres-1 \
    psql -h localhost -U infrasafe_runtime -d infrasafe \
    -c "DROP TABLE buildings;"
# Expect: ERROR: must be owner of table buildings
```

## Swap the app's env

```bash
cd ~/infrasafe
cp .env.prod .env.prod.bak.p0-5-$(date +%Y%m%d%H%M%S)

# Edit .env.prod — change DB_USER and DB_PASSWORD:
$EDITOR .env.prod
# DB_USER=infrasafe_runtime          # was: infrasafe_app
# DB_PASSWORD=Z9hDk7nFp2qWvxLm3RsTuYbAc1eQ4XGi   # was: @ppl1c@ti0n
```

If you also use `docker-compose.unified.yml`'s inline env (it currently
has `DB_USER=infrasafe_app` / `DB_PASSWORD=@ppl1c@ti0n` hardcoded at
lines 35–36), update those too — or better, switch them to read from
`.env.prod` via `env_file: .env.prod`. (That env-file migration is
[P1-V13] / [P1-V6] follow-up; for this rollout, hardcoded inline still
works as long as you edit it.)

## Restart and verify

```bash
docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate app
docker logs --tail 80 infrasafe-app-1
```

Acceptance checks:

- [ ] `docker logs infrasafe-app-1` shows no `password authentication failed`
- [ ] `curl -sf https://infrasafe.uz/health` → `{"status":"healthy"}`
- [ ] Login as admin/admin123 → 2FA challenge (existing behavior)
- [ ] Open `/admin.html` → table data loads (this exercises SELECT)
- [ ] Create a test alert from the admin UI → DB write succeeds (INSERT/UPDATE)
- [ ] `POST /api/power-analytics/refresh` as admin → 200 OK
      (this is the SECURITY DEFINER path; verifies MV refresh still works)
- [ ] Tail the app log for 5 min: 0 "permission denied" errors

If anything red:

```bash
# Restore the env immediately — this is the rollback
cp .env.prod.bak.p0-5-* .env.prod
docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate app
```

…then triage from the logs.

## After 24h of clean operation

- Delete the `.env.prod.bak.p0-5-*` file: `shred -u .env.prod.bak.p0-5-*`
- Note in your ops log that runtime separation is live
- The migration is harmless to re-run (idempotent), but normally won't be

## Carry-over (NOT this PR)

- **`database.sql` divergence** — the file actually mounted by
  `docker-compose.unified.yml` at line 61 is `./database.sql` (414 lines),
  not the `database/init/*.sql` series documented in the migrations
  README. Fresh prod-style containers therefore do NOT pick up
  `database/init/09_runtime_role.sql` today. This is a separate cleanup
  ([P1-V13] adjacent) — for now the runtime role on prod is installed
  exclusively via the migration runbook above.
- **`infrasafe_app` superuser status** — kept superuser for migrations
  and pg_dump. A future Sprint could split further:
  `infrasafe_migrate` (CREATE/ALTER table privileges only) +
  `infrasafe_backup` (pg_dump-needed read privileges) so even
  `infrasafe_app` doesn't have CREATEROLE/CREATEDB.
- **2FA encryption key rotation [P0-4]** — still on the operator
  todo from Sprint 0. Now that you have a fresh backup AND a working
  rollback path for env-edits, this is a good follow-up window.
