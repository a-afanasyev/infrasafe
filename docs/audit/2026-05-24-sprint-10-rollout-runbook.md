# Sprint 10 — Rollout runbook

> **Date**: 2026-05-24
> **Audience**: on-call operator + dev-on-duty
> **Scope**: migrations 024–029, code already in prod as of 2026-05-23, **flag flip from dormant → live** for the verification + reopen subsystem.
> **CR window**: workdays 10:00–16:00 Tashkent (UTC+5). Avoid weekends — УК dispatch capacity is reduced.

---

## 0. Pre-flight (do this BEFORE the CR window)

Run on the prod box (`infrasafe@95.46.96.105:32323`).

```bash
# 1. Verify code is on a9b3f2e (Sprint 10 PR-5) or later.
cd ~/infrasafe && git log --oneline -1

# 2. Verify all 6 Sprint 10 migrations are applied.
docker exec infrasafe-postgres-1 psql -U infrasafe_app -d infrasafe -c \
  "SELECT name FROM schema_migrations WHERE name LIKE '024%' OR name LIKE '025%' OR name LIKE '026%' OR name LIKE '027%' OR name LIKE '028%' OR name LIKE '029%' ORDER BY name"
# expect: 6 rows

# 3. Verify alert_rules has the new columns + sensible defaults.
docker exec infrasafe-postgres-1 psql -U infrasafe_app -d infrasafe -c \
  "SELECT id, alert_type, severity, enabled, min_persistence_seconds, max_reopens_per_24h FROM alert_rules ORDER BY id"

# 4. Verify the verification worker is dormant.
docker exec infrasafe-app-1 sh -c 'env | grep -E "ALERT_VERIFICATION_ENABLED|UK_USE_WEBHOOK_SENDER"'
# expect: ALERT_VERIFICATION_ENABLED=false (or unset)

# 5. Verify .env.prod has the secrets the new code needs.
ssh -p 32323 infrasafe@95.46.96.105 'grep -cE "^(UK_WEBHOOK_SECRET|INFRASAFE_WEBHOOK_SECRET)" ~/infrasafe/.env.prod'
# expect: 2

# 6. Confirm Sprint 9 outbox is still draining cleanly.
docker exec infrasafe-postgres-1 psql -U infrasafe_app -d infrasafe -c \
  "SELECT status, COUNT(*) FROM uk_outbox WHERE created_at >= NOW() - INTERVAL '24h' GROUP BY status"
# expect: mostly 'sent', no 'dead' growth.

# 7. УК side is reachable.
curl -sk -o /dev/null -w "UK base reachable: %{http_code}\n" "$UK_API_URL/health" || echo "UK health endpoint unreachable — check before flip"
```

If any of 1–6 fail, **do not flip**. Open an incident.

---

## 1. CR window — flag flip

Critical-path actions during the CR window. Total expected duration: ~5 minutes (everything else is monitoring).

### 1.1 Open a comms thread

Post in the on-call Slack channel: "Sprint 10 verification flip starting at HH:MM Tashkent. Pinging dispatcher and УК liaison."

### 1.2 Flip the flag

```bash
ssh -p 32323 infrasafe@95.46.96.105
cd ~/infrasafe

# Edit .env.prod — set ALERT_VERIFICATION_ENABLED=true.
# Backup first, in case the rollback section is needed.
cp .env.prod .env.prod.bak-sprint-10-flip-$(date +%Y%m%d-%H%M)
sed -i 's/^ALERT_VERIFICATION_ENABLED=.*/ALERT_VERIFICATION_ENABLED=true/' .env.prod
# Add it if it wasn't there:
grep -q '^ALERT_VERIFICATION_ENABLED=' .env.prod || echo 'ALERT_VERIFICATION_ENABLED=true' >> .env.prod

# Restart the app container so it picks up the env.
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app
```

### 1.3 Verify the worker started

```bash
docker logs infrasafe-app-1 --since 1m | grep -i 'alertVerificationService'
# expect: "alertVerificationService started (tick=15s, advisory_lock=849608648)"
```

If the line says `disabled via ALERT_VERIFICATION_ENABLED (dormant)`, the env did not take — re-check `.env.prod` and the `docker compose up -d --force-recreate` invocation.

### 1.4 Smoke trace

```bash
# Should appear at most ~15 s after flip — the worker's first tick logs.
docker logs infrasafe-app-1 --since 30s | grep -i 'verification tick'
```

---

## 2. Monitoring — first 48 hours

Save the queries below in a tmux window or paste them into the on-call dashboard.

### 2.1 Verification queue health

```sql
-- Pending verifications by infra type — should drain steadily, not grow unbounded.
SELECT infrastructure_type, status, COUNT(*) FROM alert_verifications
WHERE created_at >= NOW() - INTERVAL '48h'
GROUP BY 1, 2 ORDER BY 1, 2;

-- Stuck "pending" rows (past their run_at). Should be 0 most of the time.
SELECT id, original_alert_id, run_at, NOW() - run_at AS overdue
FROM alert_verifications
WHERE status = 'pending' AND run_at < NOW() - INTERVAL '60s'
ORDER BY run_at LIMIT 20;

-- attempts >1 means the worker retried — investigate any row with attempts >= 3.
SELECT id, original_alert_id, attempts, processed_at
FROM alert_verifications
WHERE attempts >= 3 ORDER BY id DESC LIMIT 20;
```

### 2.2 Reopen chains

```sql
-- Active reopen chains and how many rounds each has been through.
SELECT reopen_chain_id,
       MAX(reopen_sequence) AS rounds,
       MIN(created_at) AS first_seen,
       MAX(created_at) AS latest,
       BOOL_OR(status = 'engineer_required') AS hit_ceiling
FROM infrastructure_alerts
WHERE reopen_chain_id IS NOT NULL
  AND created_at >= NOW() - INTERVAL '48h'
GROUP BY reopen_chain_id
ORDER BY latest DESC LIMIT 20;

-- New engineer_required ticks — each is a chain that hit max_reopens.
-- Operator should be aware of these — they mean a real persistent fault.
SELECT alert_id, type, severity, infrastructure_type, infrastructure_id, created_at
FROM infrastructure_alerts
WHERE status = 'engineer_required'
  AND created_at >= NOW() - INTERVAL '48h'
ORDER BY created_at DESC;
```

### 2.3 Persistence gate — what we skipped vs what fired

There's no explicit "skipped by gate" table in v1, so we infer via the absence of an `alert_id` for telemetry that would have alerted under the old rules. The easiest proxy: compare alert counts before/after the flip.

```sql
-- Per-day alert counts split by rule. Compare last 7d (mostly pre-flip) to next 7d.
SELECT date_trunc('day', created_at) AS day, type, severity, COUNT(*)
FROM infrastructure_alerts
WHERE created_at >= NOW() - INTERVAL '14d'
GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3;
```

Expected: 20–40% drop in WARNING-level alerts (the persistence gate filters most transient flashes). If you see >70% drop, the gate may be too aggressive — tune via the admin UI.

### 2.4 Suppression activity

```sql
-- Active suppressions right now.
SELECT id, infrastructure_type, infrastructure_id, alert_type, reason,
       suppress_until, suppress_until - NOW() AS expires_in,
       suppressed_by
FROM alert_suppressions
WHERE cleared_at IS NULL AND suppress_until > NOW()
ORDER BY suppress_until;

-- Verifications that were suppression-skipped in the last 48h.
SELECT COUNT(*) FROM alert_verifications
WHERE status = 'skipped' AND created_at >= NOW() - INTERVAL '48h';
```

### 2.5 UK side — request churn

If the persistence gate is working, the УК team should observe **fewer false dispatches**. Ask the УК liaison to share their daily ticket counts before/after.

Also check our outbound side:

```sql
SELECT status, COUNT(*) FROM uk_outbox
WHERE created_at >= NOW() - INTERVAL '48h'
GROUP BY status;
```

`dead` should be 0; `retry` should drain to `sent` within a few minutes.

### 2.6 Admin UI usage

```sql
-- Who tuned what in the rules panel.
SELECT rc.changed_at, u.username, rc.rule_id, ar.alert_type, ar.severity,
       rc.field_name, rc.old_value, rc.new_value, rc.reason
FROM alert_rule_changes rc
LEFT JOIN users u ON u.user_id = rc.changed_by
JOIN alert_rules ar ON ar.id = rc.rule_id
WHERE rc.changed_at >= NOW() - INTERVAL '48h'
ORDER BY rc.changed_at DESC;
```

Sanity-check that no CRITICAL rules got disabled accidentally.

---

## 3. Rollback — if something is wrong

Symptoms that mean **rollback now**:

- УК liaison reports a surge of duplicate / phantom tickets.
- `alert_verifications.status = 'pending'` count growing unbounded (> 500).
- New `engineer_required` rows being created for clearly transient events.
- App container restarting repeatedly with `alertVerificationService` errors.

### 3.1 Disable the verification worker (fastest)

```bash
ssh -p 32323 infrasafe@95.46.96.105
cd ~/infrasafe
sed -i 's/^ALERT_VERIFICATION_ENABLED=.*/ALERT_VERIFICATION_ENABLED=false/' .env.prod
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app

# Verify it stopped.
docker logs infrasafe-app-1 --since 30s | grep -i 'alertVerification'
# expect: "alertVerificationService disabled via ALERT_VERIFICATION_ENABLED (dormant)"
```

In-flight verifications stay in the queue but the worker no longer picks them up. New `resolved_verifying` rows continue to be created from auto-resolve, but they sit forever as `pending`. To clean those up before re-flipping:

```sql
UPDATE alert_verifications SET status = 'skipped', processed_at = NOW()
WHERE status = 'pending';

UPDATE infrastructure_alerts SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW())
WHERE status = 'resolved_verifying';
```

### 3.2 Disable a specific rule via the admin UI

If only one rule is misbehaving (e.g. VOLTAGE_ANOMALY WARNING firing too aggressively), open the admin panel → Интеграция УК → Правила эскалации → toggle that single rule off. The audit log captures who/when/why.

### 3.3 Full revert — restore the pre-flip env

```bash
ssh -p 32323 infrasafe@95.46.96.105
cd ~/infrasafe
ls .env.prod.bak-sprint-10-flip-*  # find the backup from §1.2
cp .env.prod.bak-sprint-10-flip-YYYYMMDD-HHMM .env.prod
docker compose -f docker-compose.prod.yml up -d --force-recreate --no-deps app
```

The schema changes themselves do not need to be reverted — they were designed to be dormant when the flag is off. Migrations are forward-only.

---

## 4. Post-rollout — sign-off checklist

After 48 hours of monitoring with no rollback:

- [ ] `engineer_required` rate ≤ 3 per day (baseline expectation; tune in the runbook if reality differs).
- [ ] Average `resolved_verifying → resolved` transition time ≈ `verification_grace_seconds + verification_window_seconds` (default 15 min).
- [ ] УК liaison confirms ticket churn dropped vs the pre-flip week.
- [ ] No CRITICAL rule has been disabled without a written justification in `alert_rule_changes.reason`.
- [ ] `uk_outbox.status='dead'` count over the window = 0.

Once all five tick, close the Sprint 10 rollout: post sign-off in the on-call channel, mark task #105 done, archive this runbook in `docs/audit/`.

---

## 5. Related runbooks

- Sprint 9 secret rotation: `docs/audit/2026-05-22-secret-split-runbook.md`
- Sprint 9.2 cutover coordination: `docs/audit/2026-05-23-FIX-007-cutover-coordination.md`
- UK payload extension contract (Sprint 10 outbound payload format): `docs/audit/2026-05-24-sprint-10-uk-payload-extension.md`
