# Prod-ops runbook — security-audit deploy (2026-05-30)

> Companion to `docs/audit/2026-05-29-security-audit.md` and PR #69.
> Execute ONLY during the authorized deploy window, **one step at a time with operator confirmation**.
> Host: `infrasafe@95.46.96.105:32323`, `~/infrasafe`, compose `docker-compose.unified.yml`.

---

## 0. Pre-flight (read-only, safe)

```bash
ssh -p 32323 infrasafe@95.46.96.105
cd ~/infrasafe
git fetch origin && git log --oneline -1 origin/main           # confirm PR #69 merged
docker compose -f docker-compose.unified.yml ps                # all healthy
docker inspect infrasafe-app-1 --format '{{json .State.Health}}' | python3 -m json.tool
test -f .env.prod && echo ".env.prod present"                  # secrets source
```

---

## 1. Deploy code/compose fixes  (SEC-1,4,5,6,7,10,11,12 / P-PENTEST-2,3 / compose SEC-2,9 / P-PENTEST-1)

```bash
cd ~/infrasafe
git pull --ff-only origin main
# App + frontend recreate picks up: loopback port binds, env_file password, all code fixes.
docker compose -f docker-compose.unified.yml up -d --force-recreate --no-deps app frontend
```

⚠️ **Compose port change requires recreate, not just restart** — loopback binding (`127.0.0.1:3000`,
`127.0.0.1:8080`) only takes effect on container recreate. Existing containers keep `0.0.0.0` until then.

Post-deploy checks:
```bash
docker inspect infrasafe-app-1 --format '{{json .State.Health}}' | python3 -m json.tool | head -5
ss -tlnp | grep -E ':3000|:8080'        # MUST show 127.0.0.1, NOT 0.0.0.0
curl -sS -o /dev/null -w '%{http_code}\n' https://infrasafe.uz/api/health   # edge still serves
```

**Rollback:** `git revert HEAD --no-edit && docker compose -f docker-compose.unified.yml up -d --force-recreate --no-deps app frontend`

---

## 2. Host firewall  (P-PENTEST-1 — defense-in-depth on top of loopback bind)

After step 1 the ports are loopback-only, so this is belt-and-suspenders, but close them at the host edge too:

```bash
sudo ufw status                                 # check current rules first
sudo ufw deny 3000/tcp
sudo ufw deny 8080/tcp
sudo ufw status numbered
# Verify from OUTSIDE the host (not via SSH):
nc -z -w3 95.46.96.105 3000 && echo OPEN || echo BLOCKED     # expect BLOCKED
nc -z -w3 95.46.96.105 8080 && echo OPEN || echo BLOCKED     # expect BLOCKED
```

> If `ufw` is inactive, do NOT blanket-`enable` it mid-session without first allowing SSH `32323/tcp`
> (`sudo ufw allow 32323/tcp`) — otherwise you lock yourself out.

---

## 3. Secret rotation  (SEC-3 + SEC-2) — **HIGH RISK, read every caveat**

Secrets that were ever in `.env` git history. Rotate in `.env.prod`, then recreate `app` (+ `postgres` for the DB one).

| Secret | Effect of rotation | Safe to rotate now? |
|---|---|---|
| `JWT_SECRET` | **All active sessions invalidated** → everyone re-logs-in. | ✅ Yes — low blast radius, just forces re-login. |
| `JWT_REFRESH_SECRET` | Outstanding refresh tokens rejected → re-login. | ✅ Yes (rotate together with JWT_SECRET). |
| `POSTGRES_PASSWORD` / app `DB_PASSWORD` | Needs `ALTER USER` in PG **and** `.env.prod` update **and** app recreate, in lockstep. | ⚠️ Yes, but follow the exact order below or app→DB auth fails. |
| `INFRASAFE_WEBHOOK_SECRET` / `UK_WEBHOOK_SECRET` | UK↔InfraSafe HMAC both directions. | ⚠️ **Coordinate with UK team** — both sides must rotate together, or use the `UK_WEBHOOK_SECRET_NEXT` + `UK_USE_NEXT_SECRET` dual-secret window. Sender is gated off by default, so inbound (`INFRASAFE_WEBHOOK_SECRET`) is the live one. |
| `TOTP_ENCRYPTION_KEY` | 🔴 **DO NOT blind-rotate.** Existing admin 2FA secrets are encrypted with this key. Rotating it makes every enrolled TOTP secret undecryptable → **admins locked out of 2FA**. | 🔴 **No** — requires forcing 2FA re-enrollment for all admins (reset their TOTP), or a re-encryption migration. Treat as its own change. |

### 3a. JWT secrets (safe)
```bash
NEW_JWT=$(openssl rand -base64 48); NEW_REFRESH=$(openssl rand -base64 48)
# edit .env.prod: JWT_SECRET=$NEW_JWT ; JWT_REFRESH_SECRET=$NEW_REFRESH  (use an editor, do not echo into history)
docker compose -f docker-compose.unified.yml up -d --force-recreate --no-deps app
# Verify: re-login works, old token now 401.
```

### 3b. DB password (lockstep)
This rotates the **app's runtime DB credential** — role `infrasafe_runtime` (`DB_USER`),
whose password is `DB_PASSWORD`. NOT `infrasafe_app` (the bootstrap SUPERUSER) and NOT
`POSTGRES_PASSWORD` (the bootstrap-superuser secret, a separate credential — see B-023).
`infrasafe_runtime` is a LOGIN role and can change its own password (self-ALTER).
```bash
NEW_DBPW=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
# 1) change in Postgres (connect as the runtime role; it self-ALTERs):
docker exec -it infrasafe-postgres-1 psql -U infrasafe_runtime -d infrasafe \
  -c "ALTER USER infrasafe_runtime WITH PASSWORD '$NEW_DBPW';"
# 2) update .env.prod: DB_PASSWORD=$NEW_DBPW
# 3) recreate app (NOT postgres — password already changed live):
docker compose -f docker-compose.unified.yml up -d --force-recreate --no-deps app
# Verify: app logs show no auth-fail loop; /api/health 200 via edge.
docker logs infrasafe-app-1 --tail 30 | grep -i 'password\|auth\|ECONNREFUSED' || echo "clean"
```
> Keep `POSTGRES_PASSWORD` ONLY in `.env.prod` (gitignored). The compose literal was removed in PR #69.

### 3c. UK webhook secret — coordinate, do not solo-rotate.
### 3d. TOTP key — separate change; reset admins' 2FA first. Skip unless explicitly planned.

---

## 4. Post-deploy pentest + functional smoke  (the "finale")

Run from the workstation (non-destructive — no brute-force, no DoS, no data mutation, no synthetic UK tickets).

**Security re-checks (expect closed):**
```bash
# P-PENTEST-1: ports closed to internet
nc -z -w3 95.46.96.105 3000 && echo "FAIL: 3000 open" || echo "ok: 3000 blocked"
nc -z -w3 95.46.96.105 8080 && echo "FAIL: 8080 open" || echo "ok: 8080 blocked"
# Edge headers intact (HSTS, strict CSP, no x-powered-by)
curl -sSI https://infrasafe.uz/ | grep -iE 'strict-transport|content-security|x-powered-by'
# SEC-1: a 2FA temp-token must NOT work as an access token (capture tempToken from an admin login, replay it)
# → expect 401 'Invalid or expired token' on GET /api/buildings  (manual, with a real admin cred)
# Default-deny still enforced
curl -sS -o /dev/null -w '%{http_code}\n' https://infrasafe.uz/api/buildings       # 401
# P-PENTEST-2: telemetry bad body → 400 (was 500)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://infrasafe.uz/api/metrics/telemetry \
  -H 'content-type: application/json' -d '{}'                                       # 400
# P-PENTEST-3: anon map must NOT leak external_id
curl -sS https://infrasafe.uz/api/buildings-metrics | python3 -c \
  "import sys,json; d=json.load(sys.stdin); rows=d.get('data',d); assert not any('external_id' in (r or {}) for r in (rows if isinstance(rows,list) else [])), 'LEAK'; print('ok: no external_id')"
```

**Functionality (prove it still WORKS):**
```bash
curl -sS -o /dev/null -w 'health %{http_code}\n' https://infrasafe.uz/api/health        # 401 default-deny (expected) OR healthy if public
# login + 2FA round-trip with the real admin cred → expect requires2FA, then verify-2fa issues a session
# map page loads buildings; an authenticated /api/buildings returns full data incl external_id
# UK inbound webhook path: a correctly-signed test webhook → 2xx; bad signature → 401 (no_header rules apply)
```

Any FAIL → rollback step 1 and investigate before declaring done.

---

## Sign-off checklist
- [ ] Step 1 deployed, app+frontend healthy, ports loopback-bound
- [ ] Step 2 firewall denies 3000/8080 (verified from outside)
- [ ] Step 3a JWT rotated (re-login works, old token 401)
- [ ] Step 3b DB password rotated (no auth-fail loop)
- [ ] Step 3c UK secret — coordinated or deferred
- [ ] Step 3d TOTP key — deferred (needs re-enrollment plan)
- [ ] Step 4 pentest + smoke all green
- [ ] Audit doc + backlog updated with deploy timestamp

---

## Pre-flight / post-deploy: compose drift check [B-016]

Run on the **deploy host** before a deploy (baseline) and after (`docker compose up -d`) to confirm no
network or public-port drift crept in:

```bash
bash scripts/compose-drift-check.sh docker-compose.unified.yml
# exit 0 = clean; 1 = drift (review ✗ lines); 2 = usage/precondition error
```

What it catches:
- **Check A — network drift** (per declared service, real-name normalized): a service attached to a
  different network set than it declares (B-010/B-011 class). `?`/`·` lines are informational.
- **Check B — public-publish drift (HOST-WIDE)**: ANY container on the host publishing on `0.0.0.0`/`[::]`
  a port not in `ALLOWED_PUBLIC_PORTS` (default `80 443 51820`). Host-wide so it also covers the separate
  UK compose stack (the P-PENTEST-4 class). Override the whitelist via the env var if the public surface
  legitimately changes.

Expected clean prod output: app/frontend/postgres/redis on their declared real networks; only
`nginx 80/443` and `wireguard 51820` published publicly; everything else on `127.0.0.1`.

### Recorded baseline — prod host `95.46.96.105`, 2026-05-31 00:07 (UTC+5)

First run on the live host (working tree still at PR #69 `3c23225`; script + post-merge unified.yml
pulled read-only from `origin/main`, no working-tree change). Five core services + the optional stack
(nodered/mosquitto/grafana/influxdb/wireguard) and the UK stack all running.

| Run | Compose file | Check A | Check B | Exit |
|---|---|---|---|---|
| 1 | `docker-compose.unified.yml` **@3c23225 (pre-merge on disk)** | postgres ✗ (declared `leaflet-network`, runtime `infrasafe-network`); app/frontend/nginx/redis ✓; optional stack `?` | **clean** | 1 |
| 2 | `docker-compose.prod.yml` @3c23225 | postgres ✓; frontend ✗ (declares `infrasafe-network`+`leaflet-network`, runtime only `leaflet-network`); nginx/redis/optional `?` | **clean** | 1 |
| 3b | `unified.yml` **@origin/main (post-merge B-016 fix)** | **all 5 core ✓** incl. postgres `infrasafe_infrasafe-network`; optional stack `?` | **clean** | **0** |

Reading:
- **Check B clean on every run** — re-confirms P-PENTEST-1/-4: no infrasafe/UK container publishes a
  non-whitelisted port on a public interface (UK ports were closed at the host edge by the UK team).
- **The merged B-016 fix is verified against the live host** (Run 3b, exit 0): the postgres declaration
  now matches runtime, so a `docker compose up` will NOT try to recreate postgres. Run 1's postgres ✗ is
  the *pre-merge* on-disk state — it resolves the moment the deploy host does `git pull`.
- **`prod.yml` Run 2 frontend ✗** is a *separate, pre-existing* drift in the legacy prod-only file
  (frontend declares `infrasafe-network` it isn't actually on). Harmless today (frontend only needs
  `leaflet-network` for the nginx edge) and out of scope for B-016 — noted here for the record; clean it
  up if/when `prod.yml` is reconciled or retired in favour of `unified.yml`.
- **Canonical compose on prod is still `docker-compose.prod.yml`** (per the working tree); when the host
  migrates to `unified.yml`, the pre-flight command above is already correct.
