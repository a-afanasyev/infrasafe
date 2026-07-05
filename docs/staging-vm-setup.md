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
6. **First bring-up** (fresh init runs automatically from `database/init/`):
   ```
   COMPOSE_PROJECT_NAME=infrasafe \
     docker compose -f docker-compose.unified.yml -f docker-compose.staging.yml up -d
   ```
7. **Migrations** — apply pending (018+) after the baseline seed. Until the deploy-script wiring
   below lands, run the runner against the **same `-f` set**:
   ```
   MIGRATE_COMPOSE_FILE=... # see the follow-up — migrate.sh must see both -f files on staging,
                            # not base-only (the base external-network model won't match the VM).
   ```

## Follow-up (not yet implemented — tracked)

- **Deploy-script `DEPLOY_ENV=prod|staging`** in `update-production.sh`: select `.env.<env>`, a
  `COMPOSE_ARGS` array (base [+ staging override]), `EDGE_HEALTH_URL`, exported `VERIFY_URL_BASE`
  (else staging `verify` byte-checks the prod domain — `scripts/rebuild-frontend.sh:35`),
  `COMPOSE_PROJECT_NAME`, and the SEC-15 `.env` check per env. Prod path must stay byte-identical
  (DEPLOY_ENV defaults to prod).
- **`migrate.sh` compose-file set** on staging: the runner must `exec`/`psql` with the same `-f` set as
  the deploy, or base-only will validate against the prod external-network model that the override
  removes. Needs a small runner enhancement (accept a file set) — has its own `npm run migrate:test`
  harness; verify there + on the VM.
- **Auto-deploy on merge** (chosen cadence): a cron/webhook that resolves `origin/main` → full
  `sha-<...>` and runs the staging deploy (`DEPLOY_TARGET_COMMIT`-style), never the moving `:main` tag.
  Prod stays manual/promoted.

See the `r2-15-ghcr-deploy-by-pull` memory for the verified merge findings and the Phase-1 pull model.
