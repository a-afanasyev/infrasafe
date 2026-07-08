# Staging VM setup (R2-15 Phase 2)

Dedicated staging environment (`staging.infrasafe.uz`) that runs the **same GHCR image** as prod
(Phase 1) before it's promoted. This doc tracks what's delivered vs. what the operator does on the VM.

## Delivered in-repo (verified)

- **`docker-compose.staging.yml`** — override layered on the prod base:
  ```
  docker compose -f docker-compose.unified.yml -f docker-compose.staging.yml ...
  ```
  Merge behavior verified with `docker compose config` (2026-07-05):
  - top-level `infrasafe-network` / `uk-network` → `external: false` (fresh VM creates its **own**
    local bridges — **no `docker network create` prereq**; `uk-network` is an empty bridge, `/uk/*`
    just 502s, which is fine with UK integration off on staging);
  - `nginx` `command` + `healthcheck.test` → `nginx.staging.conf`;
  - `nginx` TLS certs → `staging.infrasafe.uz` (same `/etc/nginx/ssl/*.pem` targets replace the source);
  - `postgres` bootstraps from **`database/init/`** (fresh seed incl. `99_schema_migrations_baseline.sql`)
    and **neutralizes** the base `database.sql` via `database/staging-initdb-noop.sql` (same target →
    source replaced) so the manifest-less legacy snapshot never runs;
  - `app` + `postgres` append **`.env.staging`** last → it wins over any stray `.env.prod`.
- **`database/staging-initdb-noop.sql`** — the empty no-op mounted over `database.sql`.
- Structural guard: `tests/jest/unit/stagingComposeOverride.test.js`.

## Operator steps on the VM (you provision)

1. **VM + DNS + Docker.** Small VM (2 vCPU / 2–4G / ≥20G), Docker + Compose v2. DNS `A`
   `staging.infrasafe.uz` → VM IP.
2. **GHCR pull auth** (same as prod, Phase 1): a `read:packages` token, then
   `docker login ghcr.io -u a-afanasyev --password-stdin < ~/.infrasafe/ghcr-token`.
3. **TLS cert** (own certbot on the VM):
   ```
   certbot certonly --webroot -w ./certbot-webroot -d staging.infrasafe.uz
   ```
   (matches the cert paths the override mounts).
4. **`.env.staging`** on the VM (gitignored). `NODE_ENV=production` (env.js only accepts
   development|production|test — run staging as production for the strict security posture),
   `CORS_ORIGINS=https://staging.infrasafe.uz`, distinct `JWT_SECRET`/`JWT_REFRESH_SECRET`/
   `JWT_2FA_SECRET` (≠ JWT_SECRET) / `TOTP_ENCRYPTION_KEY`, its own DB creds, and **`UK_USE_WEBHOOK_SENDER=false`**
   (staging never talks to the real UK). Do **NOT** put a `.env.prod` on the staging host — the override
   loads `.env.staging` last so it wins, but keeping `.env.prod` off staging avoids any confusion.
5. **`nginx.staging.conf`** in `nginx-config/` — fork of `nginx.production.conf` with:
   - `server_name staging.infrasafe.uz;` (drop the prod SAN alias);
   - the CORS `map` + CSP `connect-src`/allowed origins set to `https://staging.infrasafe.uz`;
   - cert paths unchanged (`/etc/nginx/ssl/*.pem` — the override already points those at the staging cert).
   Not generated in-repo because it can only be validated against the running VM (`nginx -t`).
6. **First-run bootstrap** — `update-production.sh` is an UPDATE tool, NOT a bootstrap: it never
   does `up -d postgres`, and its `migrate status/up` step talks to an **already-running** postgres via
   `docker compose exec`. So an empty VM must be brought up manually first (fresh init runs
   automatically from `database/init/`; the base `database.sql` is neutralized by the noop):
   ```
   export COMPOSE_PROJECT_NAME=infrasafe
   CF="-f docker-compose.unified.yml -f docker-compose.staging.yml"
   docker compose $CF up -d postgres                       # fresh DB: init 01-09 + 99 baseline (003-017)
   docker pull ghcr.io/a-afanasyev/infrasafe-app:sha-<target>   # target = origin/main tip you deploy
   docker tag  ghcr.io/a-afanasyev/infrasafe-app:sha-<target> infrasafe-app:latest
   # apply 018+ with the SAME -f set as the deploy (both files, not base-only), node from the pulled image:
   MIGRATE_COMPOSE_FILE="docker-compose.unified.yml docker-compose.staging.yml" \
     MIGRATE_PG_USER=infrasafe_app MIGRATE_NODE_IMAGE=infrasafe-app:latest MIGRATE_NODE_MODE=image \
     MIGRATE_TARGET_COMMIT=<target> bash scripts/migrate.sh up
   # runtime role LOGIN password (infrasafe_runtime is created NOLOGIN by 017):
   PW=$(grep '^DB_PASSWORD=' .env.staging | cut -d= -f2-)
   docker exec infrasafe-postgres-1 psql -U infrasafe_app -d infrasafe \
     -c "ALTER ROLE infrasafe_runtime LOGIN PASSWORD '$PW'"; unset PW
   docker compose $CF up -d redis app                      # then the edge after the cert is in place:
   VERIFY_URL_BASE=https://staging.infrasafe.uz bash scripts/rebuild-frontend.sh prepare
   VERIFY_URL_BASE=https://staging.infrasafe.uz bash scripts/rebuild-frontend.sh publish
   docker compose $CF up -d nginx
   docker exec -it infrasafe-app-1 node src/cli/create-admin.js <user> <email>   # real admin
   ```
   *(A `scripts/bootstrap-staging.sh` wrapping these steps is the tracked follow-up below.)*
7. **Subsequent updates** — once bootstrapped, every deploy is one command:
   ```
   DEPLOY_ENV=staging DEPLOY_BRANCH=main ./update-production.sh
   ```
   It pulls `sha-<origin/main>`, retags, migrates (same `-f` set), `--no-build` switches, extracts +
   byte-verifies dist against `staging.infrasafe.uz`, reloads the edge if `nginx-config/` changed.

## Done (R2-15 Phase A — landed)

- **Deploy-script `DEPLOY_ENV=prod|staging`** in `update-production.sh`: `DEPLOY_ENV` defaults to
  `prod` (= profk), `staging` selects the staging `-f` set / `.env.staging` / `staging.infrasafe.uz`
  edge+verify URLs, `DEPLOY_BRANCH` for cron, exported `VERIFY_URL_BASE`, per-env SEC-15 (staging
  fails closed on a stray `.env.prod`), and an edge-reload step. Guard: `deployWiring.test.js`.
- **`migrate.sh` compose-file set**: `MIGRATE_COMPOSE_FILE` accepts a whitespace-separated LIST →
  split into `-f a -f b` (backward-compatible with a single file). Guard: `migrateComposeFiles.test.js`
  + `npm run migrate:test`.

## Follow-up (Phase B — needs the VM)

- **`scripts/bootstrap-staging.sh`** wrapping step 6 (idempotent first-run).
- **`nginx.staging.conf`** (step 5) — only validatable on the VM (`nginx -t`).
- **Auto-deploy on merge**: cron/webhook that `git fetch`es, checks out `main`, resolves `origin/main`
  → full `sha-<...>`, and runs `DEPLOY_TARGET_COMMIT=<sha> DEPLOY_ENV=staging DEPLOY_BRANCH=main
  ./update-production.sh` (never the moving `:main` tag). Prod stays manual/promoted.

See the `r2-15-ghcr-deploy-by-pull` memory for the verified merge findings and the Phase-1 pull model.
