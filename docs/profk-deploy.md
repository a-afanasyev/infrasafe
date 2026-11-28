# profk.uz — deploy runbook (dedicated prod, first client)

`profk.uz` (`95.46.96.224`) is a **from-scratch dedicated prod** for the first client, with the
**UK stack co-located** on the same host (their containers in `uk-network`, "variant A"). This doc
captures the profk-specific config committed here plus the operator steps that are NOT in git
(secrets stay on the host).

Deployed 2026-07-07 from `main`. Initial bring-up was host-build; **GHCR pull-mode via
`update-production.sh` (`DEPLOY_ENV=prod`) is the target flow** — see "Future updates to profk"
below for the one-time cutover (host-build remains the break-glass path).

## In-git artifacts (this repo)
- **`docker-compose.profk.yml`** — override layered on the prod base:
  ```
  docker compose -f docker-compose.unified.yml -f docker-compose.profk.yml <cmd>
  ```
  - `postgres`: replaces the legacy `database.sql` mount with the concatenated **canonical init**
    (`./.deploy/profk-initdb.sql`, generated — see below) so a fresh DB bootstraps the
    `database/init/` path (01-09 bake migrations 003-017, 99 self-declares them in
    `schema_migrations`); `migrate up` then applies 018+.
  - `nginx`: points `command` + `healthcheck` at `nginx.profk.conf` and mounts the host
    `/etc/letsencrypt/{live,archive}` **directories** at the same paths; `nginx.profk.conf` reads
    `/etc/letsencrypt/live/profk.uz/*.pem` (Q-12 — see "Certificate renewal" below).
- **`nginx-config/nginx.profk.conf`** — fork of `nginx.production.conf`: `server_name` + CORS map +
  CSP → `profk.uz` (dropped the `aisolutions` SAN alias); `/uk/*` routing + HMAC unchanged. The
  **root `location = /` returns a 302 to `https://profk.uz/uk/home`** (client sees the UK home
  page — was `/uk/resident-board` until 2026-10-12; `/uk`, `/api`, `/admin.html` still work directly). Revert = restore the root block
  to `root /srv/frontend-html; try_files /index.html =404;` + `nginx -s reload`.

## Operator steps (NOT in git — secrets / host-only)
1. **VM**: Debian 12, Docker CE + Compose v2, SSH hardened (key-only, port 32323, root/password off,
   ufw 32323/80/443, fail2ban with the office IP in `ignoreip`).
2. **DNS**: `A profk.uz → 95.46.96.224`.
3. **Repo**: cloned to `/opt/infrasafe` (owned by `infrasafe`).
4. **`.env.prod`** (gitignored): copied from the current prod, then domain fields retargeted —
   `CORS_ORIGINS=https://profk.uz`, `UK_API_URL=https://profk.uz/uk`, `UK_API_ALLOWED_HOSTS=profk.uz`.
   `.env → .env.prod` symlink (SEC-15).
4a. **`.env.db`** (gitignored, audit #12 A12-17): `cp .env.db.example .env.db && chmod 600 .env.db`,
   set `POSTGRES_PASSWORD` (bootstrap superuser `infrasafe_app`). Only the postgres container reads
   this file; `.env.prod` must NOT contain `POSTGRES_PASSWORD` — the app runs as `infrasafe_runtime`.
5. **`redis-config/redis.conf`** (gitignored): `cp redis.conf.example redis.conf` + `requirepass` =
   the password already in `REDIS_URL` (see `redis-config/README.md`).
6. **Generate the init bundle** (gitignored, `.deploy/`):
   ```
   mkdir -p .deploy
   cat database/init/01_*.sql database/init/02_*.sql database/init/03_*.sql \
       database/init/04_*.sql database/init/05_*.sql database/init/06_*.sql \
       database/init/07_*.sql database/init/08_*.sql database/init/09_*.sql \
       database/init/99_*.sql > .deploy/profk-initdb.sql
   ```
   *(Note: `02_seed_data.sql` is the demo Tashkent dataset only — it creates NO users (audit #12,
   A12-16). The first admin is created after bootstrap with `src/cli/create-admin.js`, see step 9a.
   Omit `02_*.sql` here for a genuinely clean bootstrap; the demo data was purged on profk after
   go-live — step 11. The dev-only admin lives in `database/dev-seed/` and must never be added to
   this bundle.)*
7. **External networks** (base declares them `external: true`):
   ```
   docker network create infrasafe_infrasafe-network
   docker network create uk-network
   ```
8. **Bootstrap the DB**:
   ```
   docker compose -f docker-compose.unified.yml -f docker-compose.profk.yml up -d postgres
   ```
   then apply pending migrations (host has no node → node image = the app image):
   ```
   MIGRATE_TARGET_COMMIT=$(git rev-parse HEAD) MIGRATE_COMPOSE_FILE=docker-compose.unified.yml \
   MIGRATE_PG_USER=infrasafe_app MIGRATE_NODE_IMAGE=infrasafe-app:latest MIGRATE_NODE_MODE=image \
     bash scripts/migrate.sh up
   ```
   (build the app image first: `docker compose -f docker-compose.unified.yml -f docker-compose.profk.yml build app`)
9. **Runtime role LOGIN password** (`09_runtime_role.sql` creates `infrasafe_runtime` NOLOGIN) —
   set it to the `.env` `DB_PASSWORD` (operator, reads from `.env`, value never typed):
   ```
   PW=$(grep '^DB_PASSWORD=' .env.prod | cut -d= -f2-)
   docker exec infrasafe-postgres-1 psql -U infrasafe_app -d infrasafe \
     -c "ALTER ROLE infrasafe_runtime LOGIN PASSWORD '$PW'"; unset PW
   ```
9a. **First admin** (the init bundle creates no users):
   ```
   docker compose -f docker-compose.unified.yml -f docker-compose.profk.yml exec \
     -e ADMIN_PASSWORD='<strong password>' app node src/cli/create-admin.js <username> <email>
   ```
   Run it after step 10 has started `app`. Log in, complete 2FA setup, change the password.
10. **App + edge**: `up -d redis app`; extract dist (`scripts/rebuild-frontend.sh prepare && publish`);
    `certbot certonly --standalone -d profk.uz` (then switch renewal to **webroot** — authenticator +
    `webroot_path=/opt/infrasafe/certbot-webroot`, which nginx serves at `/.well-known/acme-challenge/`);
    `up -d nginx`. Verify: `https://profk.uz/health`, byte-verify bundles
    (`VERIFY_URL_BASE=https://profk.uz bash scripts/rebuild-frontend.sh verify`).
11. **Post-go-live**: purge demo data (`TRUNCATE buildings, controllers, metrics,
    infrastructure_alerts, transformers, cold_water_sources, heat_sources, users, logs,
    token_blacklist RESTART IDENTITY CASCADE;` + `REFRESH MATERIALIZED VIEW mv_transformer_load_realtime;`
    — keeps `alert_rules`/`integration_config`), then create the real admin:
    `docker exec -it infrasafe-app-1 node src/cli/create-admin.js <user> <email>` (muted password prompt).

## Certificate renewal (Q-12, 2026-11-28)
Until 2026-11-28 the overlay bind-mounted the three `live/profk.uz/*.pem` symlinks as single files.
Docker resolves a file mount once, at container start, and pins `archive/profk.uz/…N.pem`; after
`certbot renew` writes `…N+1.pem` and repoints the symlink, `nginx -s reload` keeps serving the OLD
certificate until the container is recreated. Now the directories are mounted, so a reload is enough.

**One-time switch (needs the nginx container RECREATED — a few seconds of downtime for profk.uz,
assets.profk.uz AND the UK panel `/uk/*`):**
```
cd /opt/infrasafe
git pull --ff-only                       # nginx.profk.conf now points at /etc/letsencrypt/...
docker compose -f docker-compose.unified.yml -f docker-compose.profk.yml up -d --no-deps nginx
docker exec infrasafe-nginx-1 nginx -t -c /etc/nginx/custom/nginx.profk.conf
curl -fsS https://profk.uz/health >/dev/null && echo OK
```
Recreate right after the pull: the RUNNING container has no `/etc/letsencrypt`, so between the two
commands its healthcheck fails, and a `docker restart` (instead of `up -d`) would not start nginx at
all. For the same reason do NOT roll this change out with `update-production.sh` — its Step 6b runs
`nginx -t` inside the old container and aborts. If `main` carries other changes too, do the two
commands above first, then run `update-production.sh` as usual.

**Renewal hook** (host, once): `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`, mode 0755 —
certbot runs it only after a certificate was actually renewed:
```
#!/bin/sh
set -e
docker exec infrasafe-nginx-1 nginx -t -c /etc/nginx/custom/nginx.profk.conf
docker exec infrasafe-nginx-1 nginx -c /etc/nginx/custom/nginx.profk.conf -s reload
```
Run it once by hand to check it. After a renewal `notBefore` of the served certificate must move:
`echo | openssl s_client -connect profk.uz:443 -servername profk.uz 2>/dev/null | openssl x509 -noout -dates`.

## DB-stored config toggles (in `integration_config`, not env)
UK integration is DB-gated — on a fresh DB it seeds **off**, so inbound webhooks 503 until enabled:
```
UPDATE integration_config SET value='true'                 WHERE key='uk_integration_enabled';
UPDATE integration_config SET value='https://profk.uz/uk'  WHERE key IN ('uk_api_url','uk_frontend_url');
```
Restart the app afterwards (`up -d --force-recreate app`) to drop the config cache.

## UK stack (variant A)
The UK team deploys their own stack on this host, attached to the existing `uk-network`, keeping the
edge contract (`uk-management-api:8080`, `uk-access-api:8080`, `uk-frontend:80`). See
`docs/audit/2026-07-06-R2-15-uk-adoption-spec.md` for the full contract. Their webhook secrets must
match our `INFRASAFE_WEBHOOK_SECRET` / `UK_WEBHOOK_SECRET`.

## Future updates to profk

### Target flow — `update-production.sh` (GHCR pull, R2-15)
`update-production.sh` is now env-parameterized: `DEPLOY_ENV` defaults to `prod` = **profk**
(it selects `-f docker-compose.unified.yml -f docker-compose.profk.yml`, `.env.prod`, the
`profk.uz` edge/verify URLs, and the migrate `-f` set automatically). One command does the whole
safe deploy — pull-preflight (before any schema change) → `migrate status/up` → retag → `--no-build`
switch → dist-extract → health → verify → edge smoke → bounded image retention, with the ERR-trap
rollback:
```
cd /opt/infrasafe
./update-production.sh                 # DEPLOY_ENV=prod is the default (profk)
# promotion (ship exactly the SHA validated on staging):
DEPLOY_TARGET_COMMIT=<qa'd-sha> ./update-production.sh
```
It reloads the edge automatically when `nginx-config/` changed this release (Step 6b: `nginx -t`
then `-s reload`); a compose-level nginx `command`/mount change still needs a manual
`docker compose -f docker-compose.unified.yml -f docker-compose.profk.yml up -d --force-recreate nginx`.

**One-time cutover to pull-mode** (until done, profk still host-builds):
1. Land the R2-15 Phase-A change on `main`; wait for the CI merge run to push
   `ghcr.io/a-afanasyev/infrasafe-app:sha-<merge>` + `:main`; confirm the package exists.
2. On profk, one-time GHCR login (token OUTSIDE the repo tree):
   `docker login ghcr.io -u a-afanasyev --password-stdin < ~/.infrasafe/ghcr-token` (PAT with
   `read:packages`, chmod 600). Dry-run `docker pull ghcr.io/a-afanasyev/infrasafe-app:main`.
3. **Deploy #1** — one last host-build via the break-glass below (it also `git pull`s the new script);
   run `docker builder prune -af` + check `df -h` first.
4. **Deploy #2** — `./update-production.sh` (registry mode) is the first real pull deploy.

### Break-glass — legacy host build (GHCR/CI down)
```
APP_IMAGE_SOURCE=build ./update-production.sh   # host-builds the merged worktree (OPS-001 disk risk;
                                                # NOT pre-migrate-safe — schema is already applied)
```
**Pull gotcha:** `docker-compose.profk.yml` + `nginx-config/nginx.profk.conf` existed on the host as
UNTRACKED before this commit. After merging this, on profk run once
`git rm --cached` is NOT needed — instead remove/stash the untracked copies (they are byte-identical
to what's committed) so `git pull` fast-forwards cleanly, e.g. `git checkout -- docker-compose.profk.yml
nginx-config/nginx.profk.conf` after verifying `git status` shows them as the same content.
