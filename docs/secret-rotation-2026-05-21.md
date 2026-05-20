# Secret rotation runbook — 2026-05-21

> Operator-driven half of [P0-4]. The Claude session sanitized the
> deploy scripts and verified no `git add -A` paths exist; this
> document covers the rotations that require live access to the prod
> host.

## What gets rotated

| Secret | Where it lives | Blast radius if leaked |
| --- | --- | --- |
| `UK_WEBHOOK_SECRET` | `.env.prod`, prod env | attacker can forge / replay UK webhooks (but [P0-2] now blocks replay) |
| `TOTP_ENCRYPTION_KEY` | `.env.prod`, prod env | attacker who reads DB can decrypt admin TOTP secrets and impersonate 2FA |
| `JWT_SECRET` | `.env.prod`, prod env | attacker can mint valid access tokens (any user) |
| `JWT_REFRESH_SECRET` | `.env.prod`, prod env | attacker can mint refresh tokens |
| `DB_PASSWORD` | `.env.prod`, prod env, `docker-compose.unified.yml` (inline) | attacker with network access can read/write DB |

**Recommendation:** rotate `UK_WEBHOOK_SECRET` and `TOTP_ENCRYPTION_KEY`
this session (per backlog Sprint 0 acceptance). Plan
`JWT_SECRET` / `JWT_REFRESH_SECRET` rotation for the *next* maintenance
window: that flow logs every user out (every existing token becomes
invalid because verify() can no longer match the secret) and you
likely want to schedule it.

## Pre-flight checks

1. **Backup exists and is restorable.** Do not proceed until [P0-7]
   delivers a fresh off-host dump. The rotation can be rolled back by
   restoring the previous `.env.prod` — but if the DB also corrupted
   for an unrelated reason mid-rotation, you need a known-good dump.
2. **Maintenance window.** UK webhook rotation requires coordinating
   with the UK Management Bot operator (they hold the same shared
   secret). 2FA rotation re-encrypts existing TOTP secrets with the
   new key — admins do **not** need to re-enroll, but the migration
   step must complete cleanly.

## Generate new secrets

```bash
# Strong, URL-safe, no padding — paste-friendly
echo "UK_WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "TOTP_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "JWT_SECRET=$(openssl rand -hex 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 48)"
echo "DB_PASSWORD=$(openssl rand -base64 24 | tr -d '+/=' | head -c 32)"
```

Capture each line. Hold them in your password manager, not in shell
history (`history -c` after).

## Rollout — UK_WEBHOOK_SECRET

1. **Coordinate** with the UK bot operator. Hand them the new secret
   via a confidential channel (1Password share, Signal disappearing
   message, etc — not Slack).
2. On prod (`95.46.96.105:32323`):
   ```bash
   cd ~/infrasafe
   cp .env.prod .env.prod.bak.$(date +%Y%m%d%H%M%S)
   # edit .env.prod — replace UK_WEBHOOK_SECRET value
   $EDITOR .env.prod
   ```
3. Restart the API container — `nginx` does NOT need to reload, only
   the Node app reads this env:
   ```bash
   docker compose -f docker-compose.unified.yml up -d --no-deps --force-recreate app
   ```
4. Smoke check:
   ```bash
   # Send a signed test webhook with the NEW secret → expect 200/204
   ./tests/smoke/webhook-smoke.sh   # if you have one; otherwise curl manually

   # Send a signed test webhook with the OLD secret → expect 401
   ```
5. Once the UK bot confirms the new secret works end-to-end, **wipe
   the backup file**: `shred -u .env.prod.bak.*`.

## Rollout — TOTP_ENCRYPTION_KEY

Rotating this key re-encrypts every row in `users.totp_secret`. If you
just swap the env var without a migration, **every admin loses their
2FA** (decryption fails → fall back to "set up 2FA again").

> **⚠️ Current state (Sprint 0.1 / M-1):** `src/services/totpService.js` does
> **NOT** support a `_NEW` dual-decrypt key. **Use Option B below as the
> default rotation path.** Option A is described at the bottom as the
> *target* design — it requires a code change tracked separately.

### ✅ Option B — force re-enrollment (USE THIS ONE TODAY)

Acceptable when admin count is small (≤ 5). Disruptive but executable
with current code.

1. Notify all admins ahead of time — they must be available to re-enroll.
2. Rotate `TOTP_ENCRYPTION_KEY` in `.env.prod`:
   ```bash
   cp .env.prod .env.prod.bak.$(date +%Y%m%d-%H%M%S)
   NEW_KEY=$(openssl rand -base64 32)
   sed -i "s|^TOTP_ENCRYPTION_KEY=.*|TOTP_ENCRYPTION_KEY=$NEW_KEY|" .env.prod
   ```
3. Run a SQL migration to clear all 2FA columns (admins only):
   ```sql
   UPDATE users
      SET totp_secret = NULL,
          totp_enabled = false,
          recovery_codes = NULL
    WHERE role = 'admin';
   ```
4. Restart app: `docker compose up -d --force-recreate app`.
5. Each admin logs in (password only), gets routed to TOTP setup, scans
   the new QR. Old authenticator entries can be deleted.
6. Verify with `curl /api/auth/verify-2fa` flow per the Verification
   section below.

### ⏸ Option A — re-encrypt in place (FUTURE DESIGN — not currently usable)

Target design after a code change adds `TOTP_ENCRYPTION_KEY_NEW`
dual-decrypt support to `src/services/totpService.js`.

1. Generate the new key and add as a *secondary*:
   ```
   TOTP_ENCRYPTION_KEY=<old key — keep>
   TOTP_ENCRYPTION_KEY_NEW=<new key>
   ```
2. Run a one-shot migration script that for each user decrypts with the
   old key and re-encrypts with the new.
3. Swap `TOTP_ENCRYPTION_KEY` to the new value, drop `_NEW`.
4. Restart app.

**Blocker:** code does not yet read `TOTP_ENCRYPTION_KEY_NEW` and there
is no dual-decrypt fallback in `totpService.encryptSecret/decryptSecret`.
Track the enablement work as its own issue before attempting this path.

## Verification

After any rotation:

- `curl -sf https://infrasafe.uz/health` → `{"status":"healthy"}`
- Try logging in as `admin / admin123` — get a 2FA challenge token
- Send a signed webhook from the UK bot (production smoke) — receive 200
- Tail `docker logs infrasafe-app-1 | grep -i "error\|warn" | head -50`

If anything is off, restore from `.env.prod.bak.*` and rerun
`docker compose up -d --force-recreate app`.

## After rotation, document

In `docs/`, add a short note (`secret-rotation-log.md`) recording:

- date / operator
- which secrets rotated
- which were skipped (and why)
- backup file path before deletion

This protects the next operator from re-rotating an already-fresh
secret, which has the same blast radius as a leak.
