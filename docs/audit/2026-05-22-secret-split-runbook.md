# Operator runbook: UK webhook secret split & rotation

> **Audience.** Operator deploying Sprint 9 (FIX-007 sender) to production.
> **When to read.** Before merging Sprint 9 PR; before flipping
> `UK_USE_WEBHOOK_SENDER=true`.

## Background

Pre-Sprint 9, InfraSafe used a **single** env var `UK_WEBHOOK_SECRET` for
the only direction of HMAC verification (UK → InfraSafe inbound).
Sprint 9 introduces a second direction (InfraSafe → UK outbound webhook).
UK confirmed (FIX-007 O5) the symmetric naming scheme — same env name
on both sides for each direction:

| Direction | Sender signs | Receiver verifies | Env var name (both sides) |
|---|---|---|---|
| InfraSafe → UK (`alert.created`) | InfraSafe | UK | `UK_WEBHOOK_SECRET` |
| UK → InfraSafe (`request.*`, `building.*`) | UK | InfraSafe | `INFRASAFE_WEBHOOK_SECRET` |

The two values are **different**. The existing `UK_WEBHOOK_SECRET` in
prod `.env` semantically plays the role of `INFRASAFE_WEBHOOK_SECRET`
(it verifies UK → InfraSafe), so it must be renamed.

The verifier supports both env names during the rename window — it reads
`INFRASAFE_WEBHOOK_SECRET ?? UK_WEBHOOK_SECRET` (see
`src/services/uk/webhookVerifier.js:58`).

## Migration plan

### Step 1 — Deploy Sprint 9 PR

After merge to `main`, prod app picks up the dual-read verifier code
plus all the new modules (sender, outbox, drain worker). The feature
flag `UK_USE_WEBHOOK_SENDER=false` (default) keeps the outbound sender
dormant — no behavior change yet.

```bash
# On prod
cd /opt/infrasafe
git pull origin main
docker compose -f docker-compose.unified.yml build app
docker compose -f docker-compose.unified.yml up -d --force-recreate app
docker compose logs --tail=50 app | grep -E 'ukOutboxService|MV refresh'
```

Expected log lines after restart:
- `MV refresh scheduler starting (interval=60s)`
- `ukOutboxService disabled via UK_USE_WEBHOOK_SENDER (dormant)`

### Step 2 — Apply migrations 022 & 023

```bash
docker cp database/migrations/022_uk_outbox.sql infrasafe-postgres-1:/tmp/m022.sql
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -f /tmp/m022.sql

docker cp database/migrations/023_alert_request_map_counter_idx.sql infrasafe-postgres-1:/tmp/m023.sql
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -f /tmp/m023.sql

# Verify
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "\d uk_outbox"
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "\d alert_request_map" | grep idx_arm_building_status_partial
```

### Step 3 — Rename inbound secret env var

Goal: prod `.env` now has both `UK_WEBHOOK_SECRET` (legacy, will be
repurposed in Step 5) and `INFRASAFE_WEBHOOK_SECRET` (new) — pointing
to the **same value**. The verifier picks `INFRASAFE_WEBHOOK_SECRET`
first.

```bash
# On prod
# 1. Open .env
sudoedit /opt/infrasafe/.env

# 2. ADD a new line (do not delete UK_WEBHOOK_SECRET yet):
INFRASAFE_WEBHOOK_SECRET=<exact same value as current UK_WEBHOOK_SECRET>

# 3. Restart app
docker compose -f docker-compose.unified.yml up -d --force-recreate app

# 4. Verify inbound still works — UK should be able to deliver
#    request.* and building.* webhooks. Check app logs:
docker compose logs --tail=100 app | grep -iE 'webhook|handleRequest|handleBuilding'
```

If inbound regressions appear in this step, roll back by reverting
`.env` (remove the new line) and restarting.

### Step 4 — Generate `age` keypair (operator)

InfraSafe needs to receive the new outbound `UK_WEBHOOK_SECRET` from UK
via an encrypted channel (see FIX-007 P3). We use `age`.

```bash
# Install age locally (operator machine)
brew install age            # macOS
# or
apt install age             # Debian/Ubuntu

# Generate keypair
mkdir -p /opt/infrasafe/secrets
chmod 700 /opt/infrasafe/secrets
age-keygen -o /opt/infrasafe/secrets/.age-key

# Extract public key — send THIS to UK operator
grep '^# public key:' /opt/infrasafe/secrets/.age-key
# Example output:
# # public key: age1xy7uwpqvfap5kpglq...
```

**Send only the public key to UK.** Never send `.age-key` (private).
Optionally back it up (encrypted) in a password manager.

### Step 5 — Receive UK's outbound secret + flip values

UK runs `openssl rand -hex 32` to mint a new secret value, then
`age -R is-pubkey -o uk_webhook_secret.age` to encrypt it under your
public key. They send `uk_webhook_secret.age` (any channel — already
encrypted).

```bash
# On operator machine — decrypt
age -d -i /opt/infrasafe/secrets/.age-key uk_webhook_secret.age
# → prints the new outbound UK_WEBHOOK_SECRET value to stdout

# Copy the value, then update prod .env:
sudoedit /opt/infrasafe/.env

# Change:
#   UK_WEBHOOK_SECRET=<old legacy value, same as INFRASAFE_WEBHOOK_SECRET>
# to:
#   UK_WEBHOOK_SECRET=<new value from UK>

# Restart
docker compose -f docker-compose.unified.yml up -d --force-recreate app
```

After Step 5, prod has:
- `INFRASAFE_WEBHOOK_SECRET` = the original inbound value (UK signs with this)
- `UK_WEBHOOK_SECRET` = the new outbound value (we sign with this)

UK side configures the same two values symmetrically.

### Step 6 — Smoke test sender (UK Phase 1 endpoint live)

```bash
# Enable sender for a single tick smoke
sudoedit /opt/infrasafe/.env
# Add:
UK_USE_WEBHOOK_SENDER=true

docker compose -f docker-compose.unified.yml up -d --force-recreate app
docker compose logs -f app | grep -iE 'ukOutboxService|ukWebhookClient'
```

Expected behavior:
- On startup: `ukOutboxService starting (interval=2000ms, ≈30/мин)`
- If queue has rows: per-tick log lines `ukOutboxService: sent event_id=<uuid> (202)` or `(409)`.
- If queue empty: silent (debug-level only).

Force a test alert via test fixture or wait for natural traffic. After a
few minutes verify:

```bash
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c "
  SELECT status, COUNT(*) FROM uk_outbox GROUP BY status;
"
```

Expected: rows transition `pending → sent`. If anything stays `pending`
beyond ~10s or appears `dead`, check logs for the error.

### Step 7 — Rotation procedure (future)

When rotating either secret in the future:

1. UK generates `OLD_NEXT` value, encrypts under InfraSafe pubkey, sends.
2. InfraSafe operator decrypts, adds `UK_WEBHOOK_SECRET_NEXT=<new>` to `.env`, restart.
   At this point both sides accept OLD‖NEW for the relevant direction.
3. Wait ≥24h for stable operation.
4. InfraSafe sets `UK_USE_NEXT_SECRET=true` in `.env`, restart.
   Sender now signs with the NEW value; UK still accepts either.
5. Wait ≥24h.
6. UK retires the OLD value on their side (drops `UK_WEBHOOK_SECRET_OLD`).
7. InfraSafe operator promotes:
   ```
   UK_WEBHOOK_SECRET=<NEW value>   # was UK_WEBHOOK_SECRET_NEXT
   # delete UK_WEBHOOK_SECRET_NEXT
   # delete UK_USE_NEXT_SECRET
   ```
   Restart.

The same procedure mirrored for `INFRASAFE_WEBHOOK_SECRET` rotation (with
`INFRASAFE_WEBHOOK_SECRET_NEXT` if/when that gets added — currently
single-secret only since UK is the verifier and InfraSafe is the signer
of the outbound side; rotation handled symmetrically on UK side).

## Rollback

If sender misbehaves after Step 6, flip the flag back without
re-deploying:

```bash
# Edit .env
UK_USE_WEBHOOK_SENDER=false

docker compose -f docker-compose.unified.yml up -d --force-recreate app
```

Queued rows stay in `uk_outbox` at `status='pending'`. They will be
drained when the flag is flipped back on.

To inspect dead-lettered rows:

```sql
SELECT id, event_id, attempt_count, last_response_code, last_error, created_at
FROM uk_outbox
WHERE status = 'dead'
ORDER BY created_at DESC;
```

To manually re-drive a dead row (after fixing the underlying issue):

```sql
UPDATE uk_outbox
SET status = 'pending',
    attempt_count = 0,
    next_attempt_at = NOW()
WHERE id = <ID>;
```

## Caveats

- **Multi-replica**: `ukOutboxService` uses `pg_try_advisory_lock` so
  only one replica drains at a time. Drain rate stays ≤30/мин even
  with N replicas. No additional coordination needed.
- **Sender + UK Phase 2**: Phase 1 of UK accepts events (202) but
  doesn't create requests. Until UK Phase 2 lands, sent events are
  acked but not actioned. This is fine — when Phase 2 deploys, the
  next round of alerts will land normally.
- **ARCH-113 dependency**: local request counters
  (`/api/integration/request-counts`) are under-counted until UK fixes
  ARCH-113 (bot-originated requests don't emit `request.*` webhooks).
  Surface a "β" badge in UI consumers until that lands.
