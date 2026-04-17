# UK Integration Connectivity — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish working bidirectional connectivity between InfraSafe and UK Management Bot for local development.

**Architecture:** Infrastructure/config changes only — no application code changes needed. Use `host.docker.internal` for cross-compose connectivity (symmetric with UK bot's existing approach).

**Tech Stack:** Docker Compose, PostgreSQL, environment variables

---

## Current State

| Direction | Mechanism | Status |
|-----------|-----------|--------|
| **UK → InfraSafe** (webhooks) | `INFRASAFE_WEBHOOK_URL=http://host.docker.internal:3000` | Working — UK bot sends HMAC-signed webhooks to InfraSafe via host network |
| **InfraSafe → UK** (API calls) | `uk_api_url` in `integration_config` DB table | Broken — URL is placeholder `https://test-uk.example.com/api`, no network connectivity |

## Root Causes

1. **Different Docker networks**: InfraSafe in `infrasafe_infrasafe-dev` (172.25.0.0/16), UK API in `uk_uk-network` (172.18.0.0/16) — containers cannot resolve each other
2. **`uk_api_url` is placeholder**: points to `https://test-uk.example.com/api`, real UK API is at `http://localhost:8085` (host) / `http://uk-management-api:8080` (UK network)
3. **UK env vars not passed to container**: `.env` has `UK_WEBHOOK_SECRET` but `docker-compose.dev.yml` does not forward `UK_*` variables to the app service
4. **UK API credentials missing**: `UK_SERVICE_USER` and `UK_SERVICE_PASSWORD` not configured — needed for InfraSafe to authenticate with UK API

## Network Strategy: `host.docker.internal`

Use `host.docker.internal` for cross-compose connectivity. This is symmetric with what the UK bot already uses (`INFRASAFE_WEBHOOK_URL=http://host.docker.internal:3000`). Works on macOS Docker Desktop out of the box.

- InfraSafe → UK API: `http://host.docker.internal:8085/api`
- UK → InfraSafe: `http://host.docker.internal:3000` (already configured)

---

### Task 1: Forward UK env vars in docker-compose.dev.yml

**Why:** `.env` contains `UK_WEBHOOK_SECRET` but the app container doesn't receive it — `docker exec infrasafe-app-1 env | grep UK_` returns nothing. The `validateEnv` startup warning (Task 3 from previous plan) won't fire either since the vars are missing inside the container.
**Files:**
- Modify: `docker-compose.dev.yml:65-75` (app service environment section)

- [ ] **Step 1: Add UK env vars to app service**

In `docker-compose.dev.yml`, in the `app` service `environment` section (after line 75 `CORS_ORIGINS`), add:

```yaml
      - UK_WEBHOOK_SECRET=${UK_WEBHOOK_SECRET:-}
      - UK_SERVICE_USER=${UK_SERVICE_USER:-}
      - UK_SERVICE_PASSWORD=${UK_SERVICE_PASSWORD:-}
      - UK_API_ALLOWED_HOSTS=${UK_API_ALLOWED_HOSTS:-}
```

- [ ] **Step 2: Verify .env has UK_WEBHOOK_SECRET**

Run: `grep UK_ .env`
Expected: `UK_WEBHOOK_SECRET=ca3b1db0ee1359f7e40100cecb29f432422181ae1c1f1366f7adf84714718434`

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "fix(infra): forward UK integration env vars to app container"
```

---

### Task 2: Add UK API credentials to .env

**Why:** InfraSafe needs `UK_SERVICE_USER` and `UK_SERVICE_PASSWORD` to authenticate with UK API via `ukApiClient.authenticate()`. Without these, outbound API calls fail with "UK API credentials not configured".
**Files:**
- Modify: `.env` (gitignored — local only)

- [ ] **Step 1: Get or create UK service account credentials**

Check UK API for existing service accounts or create one. The UK API runs at `http://localhost:8085`.

Run: `curl -s http://localhost:8085/health` to verify UK API is reachable.

- [ ] **Step 2: Add credentials to .env**

Add to `/Users/andreyafanasyev/Code/Infrasafe/.env`:

```bash
UK_SERVICE_USER=<service_username>
UK_SERVICE_PASSWORD=<service_password>
```

**Note:** These credentials are for the UK API auth endpoint (`POST /auth/login`). They must match a valid user in the UK system.

- [ ] **Step 3: No commit needed** — `.env` is gitignored

---

### Task 3: Update uk_api_url in database

**Why:** The `integration_config` table has `uk_api_url = 'https://test-uk.example.com/api'` (placeholder). Must point to real UK API via `host.docker.internal`.
**Files:**
- Database change (no code files)

- [ ] **Step 1: Update uk_api_url**

Run:
```bash
psql postgresql://postgres:postgres@localhost:5435/infrasafe -c \
  "UPDATE integration_config SET value = 'http://host.docker.internal:8085/api', updated_at = NOW() WHERE key = 'uk_api_url';"
```

- [ ] **Step 2: Verify the update**

Run:
```bash
psql postgresql://postgres:postgres@localhost:5435/infrasafe -c \
  "SELECT key, value FROM integration_config WHERE key = 'uk_api_url';"
```

Expected: `http://host.docker.internal:8085/api`

---

### Task 4: Rebuild and verify connectivity

**Why:** Need to restart app container with new env vars and verify end-to-end connectivity in both directions.
**Files:**
- No code changes

- [ ] **Step 1: Rebuild InfraSafe containers**

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

- [ ] **Step 2: Wait for healthy status**

```bash
docker compose -f docker-compose.dev.yml ps
```
Expected: all 3 services healthy

- [ ] **Step 3: Verify UK env vars are inside container**

```bash
docker exec infrasafe-app-1 env | grep UK_
```
Expected: `UK_WEBHOOK_SECRET`, `UK_SERVICE_USER`, `UK_SERVICE_PASSWORD` all present

- [ ] **Step 4: Test InfraSafe → UK API connectivity**

```bash
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -s http://localhost:3000/api/integration/request-counts \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```
Expected: real data from UK API (not empty `{"buildings": {}}`)

- [ ] **Step 5: Test UK → InfraSafe webhook connectivity**

Send a test webhook with valid HMAC signature:
```bash
BODY='{"event":"building.created","event_id":"test-'$(date +%s)'","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","building":{"id":999,"name":"Connectivity Test","address":"Test Address","town":"Test"}}'
TIMESTAMP=$(date +%s)
SECRET="ca3b1db0ee1359f7e40100cecb29f432422181ae1c1f1366f7adf84714718434"
SIGNATURE="t=${TIMESTAMP},v1=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "${SECRET}" | awk '{print $2}')"

curl -s -X POST http://localhost:3000/api/webhooks/uk/building \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: ${SIGNATURE}" \
  -d "${BODY}" | python3 -m json.tool
```
Expected: `{"success": true, ...}` — building created or synced

- [ ] **Step 6: Check integration logs for new entries**

```bash
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl -s "http://localhost:3000/api/integration/logs?limit=3" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20
```
Expected: new log entry with `event_type: building.created` and `status: success`

---

## Blockers / Questions

| Item | Status | Notes |
|------|--------|-------|
| UK API credentials | **BLOCKED** | Need valid `UK_SERVICE_USER` / `UK_SERVICE_PASSWORD` from UK system |
| `host.docker.internal` on Linux | N/A for now | Works on macOS Docker Desktop; on Linux needs `extra_hosts` in compose |
| SSRF allowlist in production | Not needed for dev | `UK_API_ALLOWED_HOSTS` only enforced when `NODE_ENV=production` |

## Out of Scope

| Item | Reason |
|------|--------|
| Shared external Docker network | Overkill for local dev; `host.docker.internal` is simpler and symmetric |
| Production deployment connectivity | Different plan — production uses real DNS, not Docker networking |
| UK bot code changes | UK side already configured correctly (`INFRASAFE_WEBHOOK_URL`, `INFRASAFE_WEBHOOK_SECRET`) |
