# redis-config — operator-managed Redis config (SEC-21)

The prod Redis runs with `requirepass`. The password lives **only** in
`redis-config/redis.conf`, which is **gitignored** (like `.env.prod`) and must
be created on the host by the operator. The compose service mounts this
directory read-only at `/usr/local/etc/redis` and starts
`redis-server /usr/local/etc/redis/redis.conf`.

Why a file and not `--requirepass ${REDIS_PASSWORD}` in compose:
- Compose `${VAR}` interpolation does **not** read `env_file` (see the B-023 note
  on the postgres service) — it would resolve to blank.
- A secret in `command:` is visible via `docker inspect` / `ps`.

## First-time setup (on the prod host)

```bash
cd ~/infrasafe

# 1. Generate a 64-char hex password (hex avoids URL-encoding in REDIS_URL).
PW=$(openssl rand -hex 32)

# 2. Create the gitignored conf from the template, with the real password.
cp redis-config/redis.conf.example redis-config/redis.conf
printf 'requirepass %s\n' "$PW" >> redis-config/redis.conf
# remove the commented placeholder line so exactly ONE requirepass remains:
sed -i '/^# requirepass <set-on-host/d' redis-config/redis.conf

# 3. Mirror the SAME password into REDIS_URL in .env.prod (the app authenticates
#    with it). Preserve the existing db-index suffix (e.g. /0). The app is
#    ALREADY using Redis on prod, so this step is MANDATORY and must precede the
#    redis recreate — otherwise the app drops to degraded in-memory mode.
#       REDIS_URL=redis://:<PW>@redis:6379/0
#
#    Edit .env.prod by hand (do not echo $PW to a log).

unset PW
```

## Preflight (run before recreate)

```bash
test -f redis-config/redis.conf || { echo "redis.conf missing"; exit 1; }
active=$(grep -cE '^[[:space:]]*requirepass[[:space:]]+'              redis-config/redis.conf || true)
valid=$( grep -cE '^[[:space:]]*requirepass[[:space:]]+[0-9a-f]{64}[[:space:]]*$' redis-config/redis.conf || true)
[ "$active" -eq 1 ] && [ "$valid" -eq 1 ] || { echo "need exactly one requirepass = 64-hex"; exit 1; }
```

Two counters: a stray second `requirepass` (e.g. a leftover placeholder) would
pass a `valid==1` check alone, but redis uses the **last** directive — `active==1`
catches that.

## Deploy / recreate

```bash
# redis first (now requires auth), then app to re-read the new REDIS_URL.
# force-recreate (NOT restart) — restart keeps the old container env.
docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate redis
docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate --no-build app
```

## Verify

```bash
docker inspect infrasafe-redis-1 --format '{{.State.Health.Status}}'        # healthy
docker exec infrasafe-redis-1 redis-cli ping                                # NOAUTH ... (auth enforced)
# authenticated PING WITHOUT leaking the password into argv (REDISCLI_AUTH):
docker exec infrasafe-redis-1 sh -c \
  'REDISCLI_AUTH=$(grep "^requirepass " /usr/local/etc/redis/redis.conf | cut -d" " -f2-) redis-cli --no-auth-warning ping'  # PONG
# app actually authenticates with its own REDIS_URL (decisive — login works in degraded mode too):
timeout 10 docker exec infrasafe-app-1 node -e 'const R=require("ioredis");
  const c=new R(process.env.REDIS_URL,{maxRetriesPerRequest:1,retryStrategy:()=>null,connectTimeout:3000,enableOfflineQueue:false});
  const t=setTimeout(()=>{console.error("timeout");process.exit(1)},6000);
  c.ping().then(r=>{clearTimeout(t);console.log(r);process.exit(r==="PONG"?0:1)}).catch(e=>{clearTimeout(t);console.error(e.message);process.exit(1)})'  # PONG
```

## Rollback (app can't authenticate / password mismatch)

Do **not** just delete `requirepass` — the NOAUTH-only healthcheck would then
mark a password-less redis unhealthy. Restore the previous compose (old `ping`
healthcheck) + previous `REDIS_URL`, then recreate:

```bash
git restore --source="$PREV" -- docker-compose.unified.yml
# revert REDIS_URL in .env.prod to its previous value (operator file)
docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate redis app
```
