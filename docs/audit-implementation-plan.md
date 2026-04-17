# Audit Implementation Plan — InfraSafe

**Date:** 2026-04-13
**Author:** Chief Architect (Claude Opus 4.6)
**Source:** `docs/archive/audit-report-2026-04-13.md` (v1, 94 findings) + `docs/archive/audit-report-2026-04-13-v2.md` (v2, 23 new findings) — архивированы 2026-04-17; актуальный снимок: `docs/audit-report-2026-04-17.md`
**Total findings:** 117 (0 critical, 28 high, 34 medium, 32 low, 23 info)
**Branch strategy:**
- **Phase 0:** Direct commits to `main` (3 minimal, urgent security fixes)
- **Phases 1-9:** Each phase = feature branch (`fix/phase-N-description`) → PR → code review → merge to `main`
- **Phase 10-11:** Same branch-per-phase strategy
- Large phases (5, 6, 7) may be split into sub-PRs per task for easier review

---

## Table of Contents

1. [Phase 0: Security Hotfixes (P0)](#phase-0-security-hotfixes-p0)
2. [Phase 1: 2FA Security Hardening (P1)](#phase-1-2fa-security-hardening-p1)
3. [Phase 2: Database & Performance (P1)](#phase-2-database--performance-p1)
4. [Phase 3: Auth Resilience & Concurrency (P1-P2)](#phase-3-auth-resilience--concurrency-p1-p2)
5. [Phase 4: Alert Pipeline Hardening (P2)](#phase-4-alert-pipeline-hardening-p2)
6. [Phase 5: DRY Extraction — Admin Controllers (P2)](#phase-5-dry-extraction--admin-controllers-p2)
7. [Phase 6: DRY Extraction — Models & CRUD (P2)](#phase-6-dry-extraction--models--crud-p2)
8. [Phase 7: Architecture — Circular Deps & Coupling (P2)](#phase-7-architecture--circular-deps--coupling-p2)
9. [Phase 8: Testing — totpService & Coverage Gaps (P2)](#phase-8-testing--totpservice--coverage-gaps-p2)
10. [Phase 9: Cleanup & YAGNI (P3)](#phase-9-cleanup--yagni-p3)
11. [Phase 10: Documentation & DX (P3)](#phase-10-documentation--dx-p3)
12. [Phase 11: Scalability Prep (P3)](#phase-11-scalability-prep-p3)
13. [Dependency Graph](#dependency-graph)
14. [Finding-to-Phase Index](#finding-to-phase-index)

---

## Phase 0: Security Hotfixes (P0)

**Goal:** Eliminate three immediate security risks that require minimal code changes and have zero regression risk.

**Findings addressed:** SEC-102, SEC-103, ARCH-104, SEC-001

**Dependencies:** None
**Estimated complexity:** S (small)

### Task 0.1: Add rate limiter to `/disable-2fa`

**Finding:** SEC-102 — No rate limiting on `POST /auth/disable-2fa`, enabling password brute-force and account lockout DoS.

**File:** `src/routes/authRoutes.js`

**Change:** Add `authLimiter.middleware()` to the disable-2fa route (line 284).

```javascript
// BEFORE (line 284):
router.post('/disable-2fa', authController.disable2FA);

// AFTER:
router.post('/disable-2fa', authLimiter.middleware(), authController.disable2FA);
```

**Verification:**
- [ ] `npm test` — all 620 tests pass (authRoutes tests still pass)
- [ ] Manual: send 11 requests to `/api/auth/disable-2fa` within 15 minutes; 11th should return 429
- [ ] E2E: `npm run test:e2e` passes (auth flow not affected)

**Regression risk:** None. Adding middleware to a single route. `authLimiter` is already imported and used on lines 279-281.

---

### Task 0.2: Add `TOTP_ENCRYPTION_KEY` to startup validation

**Finding:** SEC-103 / ARCH-104 — `TOTP_ENCRYPTION_KEY` not checked at startup. Missing key causes runtime 500 on first 2FA setup, potentially locking out admins.

**Files:**
1. `src/config/env.js` — add to `REQUIRED_VARS`
2. `.env.example` — add `TOTP_ENCRYPTION_KEY` entry

**Changes to `src/config/env.js`:**

```javascript
// BEFORE (lines 5-13):
const REQUIRED_VARS = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
];

// AFTER:
const REQUIRED_VARS = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'TOTP_ENCRYPTION_KEY',
];
```

**Changes to `.env.example` — add after JWT section:**

```bash
# ------------------------------------------
# 2FA (TOTP) Encryption
# ------------------------------------------
# Generate: openssl rand -base64 32
# Must be at least 32 characters of random data
TOTP_ENCRYPTION_KEY=CHANGE_ME_generate_with_openssl_rand_base64_32
```

**Changes to `.env` (local, untracked):**
- Ensure `TOTP_ENCRYPTION_KEY` is present. If missing, generate with `openssl rand -base64 32`.

**Verification:**
- [ ] Remove `TOTP_ENCRYPTION_KEY` from `.env`, run `npm run dev` — app should fail at startup with clear error
- [ ] Add it back — app starts normally
- [ ] `npm test` — tests use `NODE_ENV=test` which skips env validation (line 21 of env.js), so all pass
- [ ] E2E: Docker `.env` must include the key

**Regression risk:** Low. Tests skip env validation in test mode. Production deployments that already have the key are unaffected. Deployments missing the key will fail at startup instead of at runtime — this is the desired behavior.

---

### Task 0.3: Rotate UK_WEBHOOK_SECRET (+ optional git history cleanup)

**Finding:** SEC-001 — `UK_WEBHOOK_SECRET` was committed in git history (commit `7a685040`), then removed from tracking. The secret is exposed in git history.

**Go/No-Go decision for git history rewrite:**
The primary mitigation is **secret rotation** (steps 1-3). History rewrite is secondary and carries high operational risk:
- All developers must re-clone
- CI/CD pipelines need reconfiguration
- Open PRs and branches become orphaned
- GitHub references (issues, comments linking to commits) break

**Recommendation:** Rotate the secret first (sufficient mitigation). Schedule `git filter-repo` as a separate maintenance window ONLY if compliance/regulatory requirements demand it. Document the decision either way.

**Steps (mandatory — secret rotation):**
1. Generate a new secret: `openssl rand -hex 32`
2. Update `.env` with the new secret
3. Coordinate with UK bot team to update their side
4. Verify old secret no longer works, new secret works

**Steps (optional — git history rewrite, separate maintenance window):**
5. Announce to all team members: re-clone required after rewrite
6. Ensure all open PRs are merged or rebased
7. Run `git filter-repo --path .env --invert-paths`
8. Force-push all branches
9. All developers re-clone

**Verification (mandatory):**
- [ ] New webhook calls with old secret fail (401/403)
- [ ] New webhook calls with new secret succeed (200)
- [ ] `.env` is in `.gitignore` and NOT in `git ls-files` output
- [ ] Document rotation date and decision on history rewrite in team wiki/channel

**Verification (optional, only if history rewrite performed):**
- [ ] `git log --diff-filter=A -- ".env"` returns empty
- [ ] All developers confirmed re-clone complete

**Regression risk:** Low for rotation only. High for history rewrite (team coordination, CI disruption). Rotation alone eliminates the security exposure — the old secret becomes useless.

---

## Phase 1: 2FA Security Hardening (P1)

**Goal:** Fix all 4 HIGH security findings in the TOTP/2FA implementation and add anti-replay protection.

**Findings addressed:** SEC-101, SEC-104, SEC-105, SEC-106

**Dependencies:** Phase 0 (Task 0.2 must land first — TOTP_ENCRYPTION_KEY validated at startup)
**Estimated complexity:** M (medium)

### Task 1.1: Blacklist tempToken after successful 2FA verification

**Finding:** SEC-101 — `authenticateTempToken` does not invalidate the tempToken after use. A captured tempToken can be reused within its 5-minute TTL to obtain new accessTokens.

**Files:**
1. `src/controllers/authController.js` — add blacklist call after successful verify-2fa, setup-2fa, confirm-2fa
2. `src/middleware/auth.js` — add blacklist check in `authenticateTempToken` (lines 255-276)

**Changes to `src/middleware/auth.js` (`authenticateTempToken`, line 255):**

```javascript
const authenticateTempToken = async (req, res, next) => {
    try {
        const { tempToken } = req.body;

        if (!tempToken) {
            return res.status(400).json({
                success: false,
                message: 'Temporary token is required'
            });
        }

        // Check if tempToken has already been used
        const isBlacklisted = await authService.isTokenBlacklisted(tempToken);
        if (isBlacklisted) {
            return res.status(401).json({
                success: false,
                message: 'Temporary token has already been used'
            });
        }

        const decoded = authService.verifyTempToken(tempToken);
        req.tempUser = decoded;
        req.tempToken = tempToken; // Pass token to controller for blacklisting
        next();
    } catch (error) {
        logger.warn(`Invalid temp token: ${error.message}`);
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired temporary token'
        });
    }
};
```

**Changes to `src/controllers/authController.js`:**
In each of `verify2FA`, `setup2FA`, `confirm2FA` handlers — after successful operation, blacklist the tempToken:

```javascript
// After successful verify-2fa (inside the success branch):
await authService.blacklistToken(req.tempToken);

// Same pattern for setup-2fa and confirm-2fa
```

**Verification:**
- [ ] `npm test` — all existing auth tests pass
- [ ] New unit test: call verify-2fa twice with same tempToken; second call returns 401
- [ ] New unit test: call setup-2fa with a tempToken that was used for verify-2fa; returns 401
- [ ] E2E: normal 2FA login flow still works (tempToken used once, then blacklisted)

**Regression risk:** Low. The blacklist mechanism already exists and is battle-tested for access/refresh tokens. We're extending it to tempTokens.

---

### Task 1.2: Strengthen TOTP encryption key derivation

**Finding:** SEC-104 — `getEncryptionKey()` uses single-iteration SHA-256 without salt, making it vulnerable to dictionary attack if DB is leaked.

**File:** `src/services/totpService.js` (lines 15-21)

**Change:** Replace `crypto.createHash('sha256')` with `crypto.hkdfSync` for proper key derivation:

```javascript
// BEFORE (line 20):
return crypto.createHash('sha256').update(key).digest();

// AFTER:
return Buffer.from(
    crypto.hkdfSync('sha256', key, 'infrasafe-totp-v1', 'aes-encryption-key', 32)
);
```

**Migration note:** This changes the derived key, which means existing encrypted TOTP secrets become undecryptable with the new key.

**Go/No-Go prerequisite — check existing 2FA enrollments BEFORE deploying:**
```sql
SELECT user_id, username, role FROM users WHERE totp_enabled = true;
```
If this returns 0 rows → Option A. If rows exist → Option B is mandatory.

**Option A (no existing 2FA users — likely current state):**
- Change key derivation directly. No migration needed.
- If test/dev accounts have 2FA: disable 2FA before deploying, re-enable after.

**Option B (production users have 2FA enabled — mandatory if Go/No-Go query returns rows):**
- Add a version prefix to encrypted values (e.g., `v2:iv:authTag:ciphertext`)
- `decrypt` tries v2 (HKDF) first, falls back to v1 (raw SHA-256)
- `encrypt` always uses v2
- A migration script re-encrypts all existing secrets:
  ```sql
  -- Run AFTER code deploys with dual-mode decrypt:
  -- Application code handles v1→v2 re-encryption on next verify
  -- OR: one-time script decrypts with v1 key, re-encrypts with v2
  ```
- **Test on staging first** with a copy of production user data

**Verification:**
- [ ] Go/No-Go query executed: `SELECT count(*) FROM users WHERE totp_enabled = true`
- [ ] `npm test` — totpService tests (to be added in Phase 8) pass
- [ ] Manual: setup 2FA for a test user, verify TOTP code works
- [ ] If Option B: existing 2FA users can still authenticate after deploy
- [ ] `openssl rand -base64 32` generates a key that passes validation and produces correct encryption

**Rollback plan:**
- **Option A (no 2FA users):** `git revert` the HKDF commit. Old SHA-256 key derivation restored. No data impact.
- **Option B (2FA users exist):** If deployed with dual-mode decrypt (v1+v2), revert to v1-only code. All secrets remain v1-encrypted (v2 re-encryption only happens on next verify). Secrets encrypted with v2 will be unreadable — those users must re-setup 2FA. Communicate this before deploy.
- **Emergency:** Disable 2FA for affected users via SQL: `UPDATE users SET totp_enabled = false, totp_secret = NULL WHERE totp_enabled = true`

**Regression risk:** Medium. Changes crypto output. **Must execute Go/No-Go query before deploying.** If no production 2FA users — risk is low. If 2FA users exist — Option B with dual-mode decrypt eliminates risk but adds complexity.

---

### Task 1.3: Separate lockout counter for disable-2fa

**Finding:** SEC-105 — `disable2FA` calls `authenticateUser()` which increments the global lockout counter. An attacker can lock out any account by sending 5 bad password attempts to `/disable-2fa`.

**File:** `src/controllers/authController.js` (line 328)

**Change:** Replace `authenticateUser()` with a direct password comparison that does not increment the lockout counter:

```javascript
// BEFORE (line 328):
const dbUser = await authService.authenticateUser(user.username, password);

// AFTER:
const isPasswordValid = await authService.verifyPasswordOnly(user.user_id, password);
if (!isPasswordValid) {
    return res.status(401).json({ error: 'Invalid password' });
}
```

**New method in `src/services/authService.js`:**

```javascript
/**
 * Verify password without affecting lockout counters.
 * For use in secondary auth flows (disable-2fa, etc.)
 * @param {number} userId
 * @param {string} password
 * @returns {Promise<boolean>}
 */
async verifyPasswordOnly(userId, password) {
    const result = await db.query(
        'SELECT password_hash FROM users WHERE user_id = $1 AND is_active = true',
        [userId]
    );
    if (!result.rows.length) return false;
    return bcrypt.compare(password, result.rows[0].password_hash);
}
```

**Verification:**
- [ ] Unit test: 5 bad password attempts to `/disable-2fa` do NOT lock the account
- [ ] Unit test: correct password to `/disable-2fa` still works
- [ ] `npm test` — all existing tests pass
- [ ] Manual: attempt 5 bad passwords on disable-2fa, then login normally — account is not locked

**Regression risk:** Low. We're adding a new method, not modifying `authenticateUser`. The rate limiter (Task 0.1) provides the first line of defense.

---

### Task 1.4: TOTP code anti-replay (30-second window)

**Finding:** SEC-106 — TOTP code can be reused multiple times within the 30-second validity window.

**File:** `src/services/totpService.js` (around line 137)

**Change:** Track used TOTP codes in a short-lived cache to prevent replay:

```javascript
// At module level:
const usedCodes = new Map(); // { hash: expiresAt }

// Cleanup every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [hash, expiresAt] of usedCodes.entries()) {
        if (now > expiresAt) usedCodes.delete(hash);
    }
}, 60000).unref();

// Inside verifyCode, after successful TOTP verification:
function markCodeUsed(userId, code) {
    const hash = crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
    if (usedCodes.has(hash)) return false; // Already used
    usedCodes.set(hash, Date.now() + 60000); // 60s TTL (covers full TOTP window + skew)
    return true;
}
```

**In the `verifyCode` function, wrap the success path:**

```javascript
if (otplib.verifySync({ secret, token: code }).valid) {
    if (!markCodeUsed(userId, code)) {
        return { valid: false, reason: 'code_already_used' };
    }
    return { valid: true, method: 'totp' };
}
```

**Verification:**
- [ ] Unit test: verify same TOTP code twice within 30s; second returns `valid: false`
- [ ] Unit test: verify different codes succeed
- [ ] Unit test: after 60s, same code can be used (TTL expired — though TOTP itself would have expired)
- [ ] Recovery codes are unaffected (they already have single-use enforcement via DB deletion)

**Regression risk:** Low. Adding an in-memory check before returning success. Recovery codes bypass this check entirely.

---

## Phase 2: Database & Performance (P1)

**Goal:** Fix the N+1 query, add missing indexes, implement metrics retention, and fix the materialized view.

**Findings addressed:** PERF-001, PERF-002, ARCH-103, ARCH-108, ARCH-107, SEC-002, ARCH-120

**Dependencies:** None (independent of Phase 0-1)
**Estimated complexity:** M (medium)

### Task 2.1: Fix N+1 in `updateControllersStatusByActivity`

**Finding:** PERF-001 — Fetches up to 10,000 controllers, then runs 2 DB queries per controller in a loop. 100 controllers = 201 queries.

**File:** `src/services/controllerService.js` (lines 253-307)

**Change:** Replace the N+1 loop with a single SQL query using a CTE:

**IMPORTANT:** The CTE must exactly match the current code logic:
- `this.statusTimeout = 600000` (10 minutes) — single threshold, not two
- Only two transitions: `online` → `offline` (metric older than 10 min), `offline` → `online` (metric within 10 min)
- Controllers in `maintenance` status are NEVER changed (line 280: `controller.status !== 'maintenance'`)
- No `warning` or `active` status exists in the current flow

```sql
WITH latest_metrics AS (
    SELECT DISTINCT ON (controller_id)
        controller_id,
        timestamp
    FROM metrics
    ORDER BY controller_id, timestamp DESC
),
status_calc AS (
    SELECT
        c.controller_id,
        c.status AS current_status,
        CASE
            -- No metrics at all → offline (unless maintenance)
            WHEN lm.timestamp IS NULL AND c.status != 'maintenance' THEN 'offline'
            -- Metric older than 10 minutes → offline (unless already offline or maintenance)
            WHEN lm.timestamp < NOW() - INTERVAL '10 minutes'
                 AND c.status != 'offline' AND c.status != 'maintenance' THEN 'offline'
            -- Fresh metric and currently offline → online
            WHEN lm.timestamp >= NOW() - INTERVAL '10 minutes'
                 AND c.status = 'offline' THEN 'online'
            -- Otherwise — no change
            ELSE c.status
        END AS new_status
    FROM controllers c
    LEFT JOIN latest_metrics lm ON c.controller_id = lm.controller_id
)
UPDATE controllers c
SET status = sc.new_status, updated_at = NOW()
FROM status_calc sc
WHERE c.controller_id = sc.controller_id
  AND c.status IS DISTINCT FROM sc.new_status
  AND sc.new_status IS DISTINCT FROM sc.current_status
RETURNING c.controller_id, sc.new_status;
```

**Note:** The 10-minute threshold is currently hardcoded as `this.statusTimeout = 600000` in the constructor. Consider extracting it to `src/config/thresholds.js` (Task 4.2) and passing it as a query parameter or using a PostgreSQL function parameter.

**Wrap in a new method in `controllerService.js`:**

```javascript
async updateControllersStatusByActivity() {
    try {
        const result = await db.query(`... CTE above ...`);
        const updated = result.rowCount;
        logger.info(`Controller status sweep: ${updated} controllers updated`);
        return { updated };
    } catch (error) {
        logger.error(`Error in controller status sweep: ${error.message}`);
        throw error;
    }
}
```

**Also fix:** `Metric.findByControllerId` (SEC-002) — add `limit` parameter to the method signature:

**File:** `src/models/Metric.js` (line 94)

```javascript
// BEFORE:
static async findByControllerId(controllerId, startDate, endDate) {

// AFTER:
static async findByControllerId(controllerId, startDate, endDate, limit) {
    // ... existing code ...
    if (limit) {
        query += ` LIMIT $${params.length + 1}`;
        params.push(limit);
    }
```

**Verification:**
- [ ] Unit test: mock DB, verify single query is called (not N+1)
- [ ] E2E: trigger status sweep via admin API, verify controllers get correct statuses
- [ ] Performance: measure query time with test data — should be <100ms for 100 controllers
- [ ] `npm test` — all existing tests pass
- [ ] Verify `Metric.findByControllerId(id, null, null, 1)` now correctly returns at most 1 row

**Regression risk:** Medium. Replacing core business logic. Must verify status calculation matches existing behavior exactly (single 10-minute threshold, only online↔offline transitions, maintenance untouched). Run E2E suite with Docker containers.

---

### Task 2.2: Add missing compound index to init SQL

**Finding:** ARCH-108 — `idx_metrics_ctrl_ts(controller_id, timestamp DESC)` exists in migration 007 but not in init SQL. Fresh Docker setup misses it.

**File:** `database/init/01_init_database.sql`

**Change:** Add after the metrics table creation (after line 369):

```sql
-- Compound index for controller metrics lookups (N+1 fix, LATERAL joins)
CREATE INDEX IF NOT EXISTS idx_metrics_ctrl_ts ON metrics (controller_id, timestamp DESC);
```

**Also add missing UK integration indexes (ARCH-120):**

```sql
-- Missing indexes for alert_request_map performance
CREATE INDEX IF NOT EXISTS idx_arm_alert_id ON alert_request_map (infrasafe_alert_id);
CREATE INDEX IF NOT EXISTS idx_arm_request_number ON alert_request_map (uk_request_number);
```

**Note:** These indexes are also in migration 011, but should be in init SQL for fresh setups that may not run all migrations.

**Verification:**
- [ ] On a **dedicated test environment** (not developer's working DB), verify fresh DB has the indexes: `docker compose -p infrasafe-test -f docker-compose.dev.yml up --build -d postgres && sleep 5 && docker compose -p infrasafe-test exec postgres psql -U postgres -d infrasafe -c "\di idx_metrics_ctrl_ts"` — compound index exists
- [ ] `docker compose exec postgres psql -U postgres -d infrasafe -c "\di idx_arm_*"` — alert_request_map indexes exist
- [ ] `npm test` — all tests pass
- [ ] `npm run test:e2e` — E2E suite passes

**Regression risk:** None. Adding indexes is non-destructive. `IF NOT EXISTS` prevents errors on re-run.

---

### Task 2.3: Implement metrics retention (cleanupOldMetrics)

**Finding:** ARCH-103 — `metricService.cleanupOldMetrics()` is a stub. With IoT sensors sending metrics every minute, the table grows unbounded.

**Files:**
1. `src/models/Metric.js` — add `deleteOlderThan` static method
2. `src/services/metricService.js` (lines 288-307) — implement the stub

**Changes to `src/models/Metric.js`:**

```javascript
/**
 * Delete metrics older than cutoffDate in batches to avoid long locks.
 * @param {Date} cutoffDate
 * @param {number} batchSize - rows per DELETE (default 10000)
 * @returns {Promise<number>} - total rows deleted
 */
static async deleteOlderThan(cutoffDate, batchSize = 10000) {
    let totalDeleted = 0;
    let deleted;

    do {
        const result = await db.query(
            `DELETE FROM metrics
             WHERE metric_id IN (
                 SELECT metric_id FROM metrics
                 WHERE timestamp < $1
                 LIMIT $2
             )`,
            [cutoffDate.toISOString(), batchSize]
        );
        deleted = result.rowCount;
        totalDeleted += deleted;
    } while (deleted === batchSize);

    return totalDeleted;
}
```

**Changes to `src/services/metricService.js` (replace stub):**

```javascript
async cleanupOldMetrics(daysToKeep = 90) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const deletedCount = await Metric.deleteOlderThan(cutoffDate);

        logger.info(`Cleanup: deleted ${deletedCount} metrics older than ${daysToKeep} days (cutoff: ${cutoffDate.toISOString()})`);

        return {
            message: `Deleted ${deletedCount} metrics older than ${daysToKeep} days`,
            deletedCount,
            cutoffDate: cutoffDate.toISOString()
        };
    } catch (error) {
        logger.error(`Error cleaning up old metrics: ${error.message}`);
        throw error;
    }
}
```

**Future consideration:** Add range partitioning by month when metrics volume justifies it. For now, batched DELETE with a 90-day retention window is sufficient.

**Verification:**
- [ ] Unit test: mock DB, verify `DELETE ... LIMIT` query is called with correct cutoff date
- [ ] Unit test: verify batching behavior (call DELETE until rowCount < batchSize)
- [ ] E2E: insert metrics with old timestamps, call cleanup, verify deletion
- [ ] `npm test` — all tests pass

**Regression risk:** Low. New code, no existing callers affected. The stub was never calling actual DELETE.

---

### Task 2.4: Fix materialized view to use active `transformers` table

**Finding:** ARCH-107 — `mv_transformer_load_realtime` joins `power_transformers` but the active CRUD table is `transformers`.

**File:** `database/init/01_init_database.sql` (lines 828-858)

**Change:** Replace `power_transformers pt` with `transformers t` and update all column references:

**IMPORTANT — schema verification before implementation:**
- `transformers` table: PK = `transformer_id` (SERIAL), capacity column = `power_kva` (not `capacity_kva`)
- `buildings` table: FK to transformers = `primary_transformer_id` (INTEGER) and `backup_transformer_id` (INTEGER)
- The legacy MV used `power_transformers.id::VARCHAR = buildings.power_transformer_id::VARCHAR` (varchar cast)
- The correct join is `transformers.transformer_id = buildings.primary_transformer_id` (integer, no cast needed)
- Buildings may also reference `backup_transformer_id` — the MV should count buildings for BOTH primary AND backup

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_transformer_load_realtime AS
SELECT
    t.transformer_id AS id,   -- alias for backward compat with existing analyticsService queries
    t.name,
    t.power_kva AS capacity_kva,  -- alias for backward compat
    t.status,
    t.latitude,
    t.longitude,

    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.controller_id END) as active_controllers_count,

    AVG(COALESCE(m.electricity_ph1, 0) + COALESCE(m.electricity_ph2, 0) + COALESCE(m.electricity_ph3, 0)) as avg_total_voltage,
    AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) as avg_total_amperage,

    CASE
        WHEN t.power_kva > 0 THEN
            LEAST(100, AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) * 0.4 / t.power_kva * 100)
        ELSE 0
    END as load_percent,

    MAX(m.timestamp) as last_metric_time,
    COUNT(CASE WHEN m.timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count

FROM transformers t
LEFT JOIN buildings b ON (t.transformer_id = b.primary_transformer_id OR t.transformer_id = b.backup_transformer_id)
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN metrics m ON c.controller_id = m.controller_id AND m.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY t.transformer_id, t.name, t.power_kva, t.status, t.latitude, t.longitude;
```

**Note:** Column aliases (`id`, `capacity_kva`) maintain backward compatibility with `PowerTransformer.js` and `analyticsService.js` which reference these names. Verify with: `grep -rn "\.id\b\|capacity_kva\|load_percent" src/models/PowerTransformer.js src/services/analyticsService.js`

**Also create migration:** `database/migrations/012_fix_materialized_view.sql`

```sql
-- Fix: mv_transformer_load_realtime should use active 'transformers' table, not legacy 'power_transformers'
-- See init SQL for full view definition with correct JOIN and column aliases
DROP MATERIALIZED VIEW IF EXISTS mv_transformer_load_realtime;

CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS
-- (paste exact same SQL as updated in init — with transformer_id AS id, power_kva AS capacity_kva,
--  JOIN on primary_transformer_id OR backup_transformer_id)
SELECT
    t.transformer_id AS id,
    t.name,
    t.power_kva AS capacity_kva,
    t.status,
    t.latitude,
    t.longitude,
    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.controller_id END) as active_controllers_count,
    AVG(COALESCE(m.electricity_ph1, 0) + COALESCE(m.electricity_ph2, 0) + COALESCE(m.electricity_ph3, 0)) as avg_total_voltage,
    AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) as avg_total_amperage,
    CASE WHEN t.power_kva > 0 THEN
        LEAST(100, AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) * 0.4 / t.power_kva * 100)
    ELSE 0 END as load_percent,
    MAX(m.timestamp) as last_metric_time,
    COUNT(CASE WHEN m.timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count
FROM transformers t
LEFT JOIN buildings b ON (t.transformer_id = b.primary_transformer_id OR t.transformer_id = b.backup_transformer_id)
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN metrics m ON c.controller_id = m.controller_id AND m.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY t.transformer_id, t.name, t.power_kva, t.status, t.latitude, t.longitude;

CREATE UNIQUE INDEX idx_mv_transformer_load_id ON mv_transformer_load_realtime(id);
CREATE INDEX idx_mv_transformer_load_percent ON mv_transformer_load_realtime(load_percent DESC);
CREATE INDEX idx_mv_transformer_load_status ON mv_transformer_load_realtime(status);
```

**Verification:**
- [ ] Fresh Docker: materialized view references `transformers`
- [ ] Migration on existing DB: view is recreated
- [ ] `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime` succeeds
- [ ] Analytics API returns data for transformers added via admin UI
- [ ] `npm test` + `npm run test:e2e` — all pass

**Regression risk:** Medium. Changing the materialized view source table. Must verify that `transformers` has the same column schema as `power_transformers` (id, name, capacity_kva, status, latitude, longitude). Check `ARCH-001` — dual model confusion between `Transformer.js` and `PowerTransformer.js`.

---

### Task 2.5: Parallelize `checkAllTransformers` with bounded concurrency

**Finding:** PERF-002 — Sequential loop checking all transformers one by one.

**File:** `src/services/alertService.js` (lines 422-450)

**Change:** Use bounded concurrency (e.g., 5 at a time) instead of serial loop:

```javascript
async checkAllTransformers() {
    await this.ensureInitialized();

    try {
        const analyticsService = require('./analyticsService');
        const transformers = await analyticsService.getAllTransformersWithAnalytics();

        const CONCURRENCY = 5;
        const alerts = [];

        for (let i = 0; i < transformers.length; i += CONCURRENCY) {
            const batch = transformers.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(t => this.checkTransformerLoad(t.id))
            );
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    alerts.push(result.value);
                } else if (result.status === 'rejected') {
                    logger.error(`Transformer check failed: ${result.reason?.message}`);
                }
            }
        }

        logger.info(`Checked ${transformers.length} transformers, created ${alerts.length} alerts`);
        return { checked: transformers.length, alerts_created: alerts.length, alerts };
    } catch (error) {
        logger.error('Error checking all transformers:', error);
        throw error;
    }
}
```

**Verification:**
- [ ] Unit test: verify all transformers are checked (mock confirms each ID called)
- [ ] Unit test: verify concurrency limit (no more than 5 concurrent calls)
- [ ] Unit test: one failing transformer doesn't block others
- [ ] `npm test` — all existing alert service tests pass

**Regression risk:** Low. `Promise.allSettled` ensures failures are isolated. Bounded concurrency prevents DB connection pool exhaustion.

---

## Phase 3: Auth Resilience & Concurrency (P1-P2)

**Goal:** Add circuit breaker to auth path, fix token refresh race condition, and address auth middleware patterns.

**Findings addressed:** ARCH-102, ARCH-105, SEC-107, KISS-003

**Dependencies:** None (independent of Phase 0-2)
**Estimated complexity:** M (medium)

### Task 3.1: Circuit breaker on `isTokenBlacklisted` DB lookup

**Finding:** ARCH-102 — When PostgreSQL is down, every authenticated request waits 5 seconds for DB timeout. No fail-fast mechanism.

**Files:**
1. `src/services/authService.js` (lines 504-543) — wrap DB query in circuit breaker
2. Reuse `CircuitBreakerFactory` from `src/utils/circuitBreaker.js`

**Change:** Add a circuit breaker to the `isTokenBlacklisted` method. When circuit is open, skip blacklist check (fail-open for availability):

```javascript
// In constructor or initialization:
const { CircuitBreakerFactory } = require('../utils/circuitBreaker');
this.blacklistBreaker = CircuitBreakerFactory.createDatabaseBreaker('BlacklistDB');

// In isTokenBlacklisted, wrap the DB query:
async isTokenBlacklisted(token) {
    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const cacheKey = `${this.cachePrefix}:blacklist:${tokenHash}`;

        // L1: In-memory cache (fast path)
        const cached = await cacheService.get(cacheKey);
        if (cached !== null) return true;

        // L2: Database with circuit breaker
        try {
            const isBlacklisted = await this.blacklistBreaker.execute(async () => {
                const result = await db.query(
                    'SELECT 1 FROM token_blacklist WHERE token_hash = $1 AND expires_at > NOW()',
                    [tokenHash]
                );
                return result.rows.length > 0;
            });

            if (isBlacklisted) {
                // Populate L1 cache
                const decoded = jwt.decode(token);
                if (decoded && decoded.exp) {
                    const ttl = Math.max(0, (decoded.exp * 1000 - Date.now()) / 1000);
                    if (ttl > 0) await cacheService.set(cacheKey, true, { ttl });
                }
                return true;
            }
        } catch (breakerError) {
            // Circuit breaker open or DB error — fail-open: assume not blacklisted
            logger.warn(`Blacklist DB check unavailable (circuit breaker): ${breakerError.message}`);
        }

        return false;
    } catch (error) {
        logger.error(`Error checking token blacklist: ${error.message}`);
        return false;
    }
}
```

**Verification:**
- [ ] Unit test: DB down -> circuit opens -> requests pass through immediately (no 5s wait)
- [ ] Unit test: DB up -> blacklisted tokens are correctly rejected
- [ ] Unit test: cache hit -> DB never called
- [ ] `npm test` — all auth tests pass
- [ ] Manual: stop postgres container, verify API responds quickly (not 5s delay per request)

**Regression risk:** Low-Medium. Fail-open means a recently blacklisted token might work for a few requests during DB outage. This is an acceptable trade-off for availability. The in-memory cache provides protection for tokens blacklisted before the outage.

---

### Task 3.2: Atomic refresh token rotation

**Finding:** ARCH-105 — Refresh token can be reused in a race condition. Two concurrent requests with the same refresh token both succeed.

**File:** `src/services/authService.js` (lines 237-269)

**Change:** Use atomic INSERT into blacklist before generating new tokens. If the INSERT fails (token already blacklisted), reject the request:

```javascript
async refreshToken(refreshToken) {
    try {
        const decoded = jwt.verify(refreshToken, this.jwtRefreshSecret, {
            issuer: 'infrasafe-api',
            audience: 'infrasafe-client'
        });

        if (decoded.type !== 'refresh') {
            const error = new Error('Invalid refresh token');
            error.code = 'INVALID_REFRESH_TOKEN';
            throw error;
        }

        // Atomic consume: blacklist first, fail if already consumed
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        try {
            await db.query(
                `INSERT INTO token_blacklist (token_hash, expires_at, created_at)
                 VALUES ($1, to_timestamp($2), NOW())`,
                [tokenHash, decoded.exp]
            );
        } catch (dbError) {
            if (dbError.code === '23505') { // UNIQUE violation — already consumed
                const error = new Error('Refresh token already used');
                error.code = 'TOKEN_REUSE';
                throw error;
            }
            throw dbError;
        }

        const user = await this.findUserById(decoded.user_id);
        if (!user || !user.is_active) {
            const error = new Error('User not found or deactivated');
            error.code = 'USER_NOT_FOUND';
            throw error;
        }

        const tokens = this.generateTokens(user);
        logger.info(`Tokens refreshed for user ${user.username}`);
        return tokens;
    } catch (error) {
        logger.error(`Token refresh error: ${error.message}`);
        throw error;
    }
}
```

**Prerequisite:** `token_blacklist.token_hash` UNIQUE constraint — **VERIFIED: already exists** in `database/init/01_init_database.sql:55` (`token_hash varchar(255) NOT NULL UNIQUE`). No migration needed.

**Verification:**
- [ ] Unit test: two concurrent refresh calls with same token; only one succeeds
- [ ] Unit test: normal refresh flow works (blacklist + new tokens)
- [ ] `npm test` — all auth tests pass
- [ ] E2E: normal login/refresh cycle works

**Regression risk:** Low. The change makes the existing blacklist call atomic. Existing tests should pass since the behavior is the same for non-concurrent scenarios.

---

### Task 3.3: Convert jwt.verify callback to async/await

**Finding:** KISS-003 — `jwt.verify` is called with callback inside async function. Errors inside the callback are not caught by the outer try/catch.

**File:** `src/middleware/auth.js` (lines 44, 140, 223)

**Change:** Use `util.promisify(jwt.verify)` in all three middleware functions (`authenticateJWT`, `authenticateRefresh`, `optionalAuth`):

```javascript
const { promisify } = require('util');
const verifyJwt = promisify(jwt.verify);

// In authenticateJWT:
const authenticateJWT = async (req, res, next) => {
    try {
        // ... token extraction and blacklist check (unchanged) ...

        const decoded = await verifyJwt(token, process.env.JWT_SECRET);

        const user = await authService.findUserById(decoded.user_id);
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }

        if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
            return res.status(401).json({ success: false, message: 'Account is locked' });
        }

        // IMPORTANT: Only expose safe fields — NEVER include password_hash or totp_secret
        req.user = {
            user_id: user.user_id,
            id: user.user_id,       // backward compatibility
            username: user.username,
            role: user.role,
            email: user.email
        };
        req.token = token;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }
        logger.error(`Auth middleware error: ${error.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
```

Apply the same pattern to `authenticateRefresh` (line 140) and `optionalAuth` (line 223).

**Verification:**
- [ ] Unit test: expired token returns 401
- [ ] Unit test: invalid token returns 401
- [ ] Unit test: valid token sets req.user
- [ ] `npm test` — all 620+ tests pass (critical: authMiddleware.test.js)
- [ ] E2E: full login/logout/refresh cycle works

**Regression risk:** Medium. This changes the control flow of three middleware functions that every authenticated request passes through. Must run full test suite and E2E. The behavior should be identical, but the error handling path changes.

---

## Phase 4: Alert Pipeline Hardening (P2)

**Goal:** Add database-level deduplication, outbox pattern for UK forwarding, fix cooldown loss on restart, and notification error tracking.

**Findings addressed:** ARCH-106, ARCH-101, ARCH-109, ARCH-112, KISS-008

**Dependencies:** Phase 2 (Task 2.4 for materialized view fix)
**Estimated complexity:** L (large)

### Task 4.1: Add UNIQUE constraint for active alert deduplication

**Finding:** ARCH-106 — No DB-level dedup. Two concurrent requests can both pass in-memory `activeAlerts.has()` check and create duplicate alerts.

**File:** New migration `database/migrations/013_alert_dedup_constraint.sql`

```sql
-- Partial unique index: only one active alert per infrastructure+type
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_alert_dedup
ON infrastructure_alerts (infrastructure_type, infrastructure_id, type)
WHERE status = 'active';
```

**File:** `src/services/alertService.js` (line 198 `createAlert` method)

**Change:** Handle UNIQUE violation gracefully:

```javascript
// In createAlert, after db.query INSERT:
const result = await db.query(query, values).catch(err => {
    if (err.code === '23505') { // UNIQUE violation — duplicate active alert
        logger.info(`Duplicate alert suppressed: ${alertData.type} for ${alertData.infrastructure_type}:${alertData.infrastructure_id}`);
        return null;
    }
    throw err;
});

if (!result) return null; // Duplicate suppressed
```

**Verification:**
- [ ] Unit test: two concurrent createAlert calls for same infrastructure; only one succeeds
- [ ] Migration applies cleanly on existing DB
- [ ] `npm test` — alertService tests pass
- [ ] Existing duplicate alerts in DB: clean up before applying constraint, or use `WHERE status = 'active'` to avoid constraint violation on historical data

**Regression risk:** Low. The partial UNIQUE index only affects new INSERTs for active alerts. Resolved/acknowledged alerts are excluded.

---

### Task 4.2: Unify threshold source of truth

**Finding:** KISS-008 — `alertService.js` uses 85% for transformer overload, `analyticsService.js` uses 80%. Same concept, different values.

**Files:**
1. Create `src/config/thresholds.js` — single source of truth
2. Update `src/services/alertService.js` (line 12)
3. Update `src/services/analyticsService.js` (line 15 area)
4. Update `src/services/metricService.js` (line 13 area)
5. Update `src/controllers/analyticsController.js` (line 57)

**New file `src/config/thresholds.js`:**

```javascript
/**
 * Infrastructure monitoring thresholds — single source of truth.
 * All services must use these values instead of local constants.
 */
module.exports = {
    transformer: {
        overload: 85,       // % load — WARNING alert
        critical: 95,       // % load — CRITICAL alert
    },
    water: {
        pressure_low: 2.0,      // bar — WARNING
        pressure_critical: 1.5, // bar — CRITICAL
    },
    heating: {
        temp_delta_low: 15,     // C delta — WARNING
        temp_delta_critical: 10, // C delta — CRITICAL
    }
};
```

**Verification:**
- [ ] `grep -r "transformer_overload\|overload.*85\|overload.*80" src/` — only `thresholds.js` defines values
- [ ] Unit tests: services reference thresholds from config
- [ ] `npm test` — all pass

**Regression risk:** Low. Extracting constants to a shared config. No logic changes.

---

### Task 4.3: Restore cooldowns on restart

**Finding:** ARCH-109 — `lastChecks` Map is lost on restart, causing alert burst. `loadActiveAlerts()` restores active alerts but not cooldown timestamps.

**File:** `src/services/alertService.js` (method `loadActiveAlerts`, around line 83)

**Change:** When loading active alerts from DB on startup, also populate `lastChecks` from the alert `created_at` timestamps:

```javascript
async loadActiveAlerts() {
    // ... existing code to populate this.activeAlerts ...

    // Restore cooldowns from active alert timestamps to prevent burst
    for (const [key, alertInfo] of this.activeAlerts.entries()) {
        // Extract infrastructure check key from alert key
        // Alert key format: "transformer:123:TRANSFORMER_OVERLOAD"
        // Check key format: "transformer:123"
        const parts = key.split(':');
        if (parts.length >= 2) {
            const checkKey = `${parts[0]}:${parts[1]}`;
            const alertTime = new Date(alertInfo.created_at).getTime();
            const existingCheck = this.lastChecks.get(checkKey);
            // Keep the most recent timestamp
            if (!existingCheck || alertTime > existingCheck) {
                this.lastChecks.set(checkKey, alertTime);
            }
        }
    }

    logger.info(`Restored ${this.lastChecks.size} cooldown timestamps from active alerts`);
}
```

**Verification:**
- [ ] Unit test: after `loadActiveAlerts()`, `lastChecks` is populated
- [ ] Unit test: transformer with recent active alert is not re-checked within cooldown
- [ ] `npm test` — all alert service tests pass

**Regression risk:** Low. Adding data restoration on startup. Does not change alert creation logic.

---

### Task 4.4: Track notification failures

**Finding:** ARCH-112 — `sendNotifications` silently swallows all errors. Critical alerts may be created without any operator notification.

**File:** `src/services/alertService.js` (line 244, `sendNotifications` method)

**Change:** Log notification failures at ERROR level and track in alert metadata:

```javascript
async sendNotifications(alertData, alertId) {
    const failures = [];

    // Critical alerts — immediate notification
    if (alertData.severity === 'CRITICAL') {
        try {
            await this.sendImmediateNotification(alertData, alertId);
        } catch (notifError) {
            logger.error(`CRITICAL alert ${alertId} notification failed: ${notifError.message}`);
            failures.push({ channel: 'immediate', error: notifError.message });
        }
    }

    // WebSocket broadcast (fire-and-forget, non-critical)
    try {
        this.broadcastAlert(alertData, alertId);
    } catch (wsError) {
        logger.warn(`Alert ${alertId} WebSocket broadcast failed: ${wsError.message}`);
    }

    // UK Integration
    try {
        const ukIntegrationService = require('./ukIntegrationService');
        if (await ukIntegrationService.isEnabled()) {
            await ukIntegrationService.sendAlertToUK({ ...alertData, alert_id: alertId });
        }
    } catch (ukError) {
        logger.error(`Alert ${alertId} UK forwarding failed: ${ukError.message}`);
        failures.push({ channel: 'uk_integration', error: ukError.message });
    }

    // Record failures in alert data for retry/monitoring
    if (failures.length > 0) {
        try {
            await db.query(
                `UPDATE infrastructure_alerts
                 SET data = jsonb_set(COALESCE(data::jsonb, '{}'::jsonb), '{notification_failures}', $1::jsonb)
                 WHERE alert_id = $2`,
                [JSON.stringify(failures), alertId]
            );
        } catch (updateError) {
            logger.error(`Failed to record notification failures for alert ${alertId}: ${updateError.message}`);
        }
    }
}
```

**Verification:**
- [ ] Unit test: UK integration failure is logged and recorded in alert data
- [ ] Unit test: immediate notification failure is logged and recorded
- [ ] Unit test: alert is still created even when all notifications fail
- [ ] `npm test` — all alert tests pass

**Regression risk:** Low. Adding error tracking to existing fire-and-forget pattern. Alert creation is not affected.

---

### Task 4.5: Outbox pattern for UK forwarding — DEFERRED

**Finding:** ARCH-101 — Alert creation + UK forwarding is not atomic. Process crash between INSERT and UK API call loses the forwarding.

**Decision: DEFERRED to Phase 11 (Task 11.10).** This is the single implementation location — Phase 11 contains the full design.

**Rationale:** System runs as a single instance. Task 4.4 (notification failure tracking) provides interim monitoring sufficient for current scale. Full outbox pattern is recommended only when:
- Moving to multi-replica deployment
- UK forwarding reliability is contractually required
- Monitoring from Task 4.4 shows significant failure rate

**Action now:** Document this as accepted tech debt. Monitor via Task 4.4 failure logs.

---

## Phase 5: DRY Extraction — Admin Controllers (P2)

**Goal:** Extract the repeated `getOptimized*` pattern from 7 admin controllers into a shared utility.

**Findings addressed:** DRY-003, DRY-004, KISS-004

**Dependencies:** None
**Estimated complexity:** M (medium)

### Task 5.1: Create `adminQueryBuilder.js` utility

**Finding:** DRY-003 — ~490 lines of copy-paste across 7 admin controllers for pagination + filtering + dual query.

**New file:** `src/utils/adminQueryBuilder.js`

```javascript
/**
 * Generic admin query builder for paginated, filtered, sorted list endpoints.
 * Replaces copy-paste getOptimized* in 7 admin controllers.
 */

/**
 * Build and execute a paginated admin query with dynamic WHERE clauses.
 *
 * SECURITY: `table`, `idColumn`, `additionalJoins`, and filter keys
 * are interpolated directly into SQL. They MUST be hardcoded string
 * literals from the calling controller — NEVER from req.query/req.body.
 * Only `params` values go through parameterized placeholders ($1, $2...).
 *
 * @param {object} db - Database pool instance
 * @param {object} options
 * @param {string} options.table - SQL table name (must be in ALLOWED_TABLES)
 * @param {string} options.idColumn - Primary key column name
 * @param {object} options.filters - { columnName: value } for WHERE conditions
 * @param {object} options.search - { columns: [...], term: string } for ILIKE search
 * @param {string} options.sortBy - Column to sort by (validated against allowedSortColumns)
 * @param {string} options.sortOrder - 'ASC' or 'DESC'
 * @param {string[]} options.allowedSortColumns - Whitelist of valid sort columns
 * @param {number} options.page - Page number (1-based)
 * @param {number} options.limit - Items per page
 * @param {string} options.additionalJoins - Optional JOIN clause (hardcoded only)
 * @returns {Promise<{ data: Array, pagination: object }>}
 */
const ALLOWED_TABLES = [
    'buildings', 'controllers', 'transformers', 'lines',
    'water_lines', 'cold_water_sources', 'heat_sources', 'metrics'
];

async function buildPaginatedQuery(db, options) {
    const {
        table, idColumn, filters = {}, search,
        sortBy, sortOrder = 'ASC', allowedSortColumns = [],
        page = 1, limit = 20, additionalJoins = ''
    } = options;

    // Guard against SQL injection via table/column names
    if (!ALLOWED_TABLES.includes(table)) {
        throw new Error(`buildPaginatedQuery: invalid table name '${table}'`);
    }
    if (!/^[a-z_]+$/i.test(idColumn)) {
        throw new Error(`buildPaginatedQuery: invalid idColumn '${idColumn}'`);
    }

    // Validate sort column
    const validatedSort = allowedSortColumns.includes(sortBy) ? sortBy : idColumn;
    const validatedOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

    const whereConditions = [];
    const params = [];

    // Dynamic filters
    for (const [column, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== '') {
            params.push(value);
            whereConditions.push(`${column} = $${params.length}`);
        }
    }

    // Search
    if (search && search.term && search.columns?.length > 0) {
        params.push(`%${search.term}%`);
        const searchClauses = search.columns.map(col => `${col} ILIKE $${params.length}`);
        whereConditions.push(`(${searchClauses.join(' OR ')})`);
    }

    const whereClause = whereConditions.length > 0
        ? `WHERE ${whereConditions.join(' AND ')}`
        : '';

    // Count query
    const countQuery = `SELECT COUNT(*) FROM ${table} ${additionalJoins} ${whereClause}`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    // Data query
    const offset = (page - 1) * limit;
    const dataQuery = `
        SELECT * FROM ${table} ${additionalJoins}
        ${whereClause}
        ORDER BY ${validatedSort} ${validatedOrder}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataResult = await db.query(dataQuery, [...params, limit, offset]);

    return {
        data: dataResult.rows,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
}

module.exports = { buildPaginatedQuery };
```

### Task 5.2: Refactor admin controllers to use shared builder

**Files to modify (7):**
1. `src/controllers/admin/adminBuildingController.js`
2. `src/controllers/admin/adminControllerController.js`
3. `src/controllers/admin/adminTransformerController.js`
4. `src/controllers/admin/adminLineController.js`
5. `src/controllers/admin/adminWaterLineController.js`
6. `src/controllers/admin/adminColdWaterSourceController.js`
7. `src/controllers/admin/adminHeatSourceController.js`

**Pattern for each controller — replace `getOptimized*` with:**

```javascript
const { buildPaginatedQuery } = require('../../utils/adminQueryBuilder');
const db = require('../../config/database');

async function getOptimizedBuildings(req, res, next) {
    try {
        const { page = 1, limit = 20, sortBy = 'building_id', sortOrder = 'ASC',
                search, status } = req.query;

        const result = await buildPaginatedQuery(db, {
            table: 'buildings',
            idColumn: 'building_id',
            filters: { status },
            search: search ? { columns: ['name', 'address'], term: search } : undefined,
            sortBy, sortOrder,
            allowedSortColumns: ['building_id', 'name', 'address', 'status', 'created_at'],
            page: parseInt(page, 10),
            limit: parseInt(limit, 10)
        });

        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
}
```

### Task 5.3: Extract dynamic update SQL builder

**Finding:** DRY-004 — Dynamic `update*` SQL builder is copy-pasted across 8 files.

**New file:** `src/utils/dynamicUpdateBuilder.js`

```javascript
/**
 * Build a dynamic UPDATE query from a partial object.
 *
 * SECURITY: `table` and `idColumn` are interpolated into SQL.
 * They MUST be hardcoded string literals — NEVER from user input.
 * `allowedFields` whitelist ensures only safe column names are used in SET clause.
 *
 * @param {string} table - SQL table name (must be in ALLOWED_UPDATE_TABLES)
 * @param {string} idColumn - Primary key column name
 * @param {*} id - Row ID value
 * @param {object} fields - { columnName: value } — only non-undefined values are included
 * @param {string[]} allowedFields - Whitelist of updatable columns
 * @returns {{ query: string, params: Array }}
 */
const ALLOWED_UPDATE_TABLES = [
    'buildings', 'controllers', 'transformers', 'lines',
    'water_lines', 'cold_water_sources', 'heat_sources',
    'water_suppliers', 'metrics'
];

function buildUpdateQuery(table, idColumn, id, fields, allowedFields) {
    if (!ALLOWED_UPDATE_TABLES.includes(table)) {
        throw new Error(`buildUpdateQuery: invalid table name '${table}'`);
    }
    if (!/^[a-z_]+$/i.test(idColumn)) {
        throw new Error(`buildUpdateQuery: invalid idColumn '${idColumn}'`);
    }

    const setClauses = [];
    const params = [];

    for (const [column, value] of Object.entries(fields)) {
        if (value !== undefined && allowedFields.includes(column)) {
            params.push(value);
            setClauses.push(`${column} = $${params.length}`);
        }
    }

    if (setClauses.length === 0) {
        throw new Error('No valid fields to update');
    }

    params.push(id);
    const query = `
        UPDATE ${table}
        SET ${setClauses.join(', ')}, updated_at = NOW()
        WHERE ${idColumn} = $${params.length}
        RETURNING *
    `;

    return { query, params };
}

module.exports = { buildUpdateQuery };
```

**Verification:**
- [ ] Unit test for `buildPaginatedQuery`: correct SQL generation, parameter ordering, sort validation
- [ ] Unit test for `buildUpdateQuery`: correct SQL generation, field filtering
- [ ] `npm test` — all 620+ tests pass (each admin controller test still works)
- [ ] E2E: admin CRUD operations still work through the API
- [ ] Manual: compare API responses before/after for each admin entity

**Regression risk:** Medium. Replacing 490+ lines of working copy-paste with shared abstraction. Must verify each controller's specific behavior is preserved. Run admin-related tests carefully. Refactor one controller first as a pilot, verify, then proceed with remaining six.

---

## Phase 6: DRY Extraction — Models & CRUD (P2)

**Goal:** Reduce duplication in water/heat models and controllers by creating factory patterns.

**Findings addressed:** DRY-001, DRY-002, DRY-005, DRY-007, DRY-008

**Dependencies:** Phase 5 (shared utilities ready)
**Estimated complexity:** M (medium)

### Task 6.1: Create generic CRUD model factory

**Finding:** DRY-001/002 — `ColdWaterSource.js` and `HeatSource.js` are 152 lines each, byte-for-byte identical except entity/table name.

**New file:** `src/models/factories/createCrudModel.js`

```javascript
/**
 * Factory for generating standard CRUD model classes.
 * Eliminates copy-paste across ColdWaterSource, HeatSource, and similar models.
 *
 * @param {object} config
 * @param {string} config.tableName
 * @param {string} config.idColumn
 * @param {string} config.entityName - For error messages
 * @param {string[]} config.searchColumns - Columns for ILIKE search
 * @returns {class} - Model class with findAll, findById, create, update, delete
 */
// All requires at module level — no deferred require() inside methods (see ARCH-007)
const db = require('../../config/database');
const logger = require('../../utils/logger');
const { validateSortOrder, validatePagination } = require('../../utils/queryValidation');
const { buildUpdateQuery } = require('../../utils/dynamicUpdateBuilder');

function createCrudModel({ tableName, idColumn, entityName, searchColumns = [], createColumns = [], updateColumns = [] }) {
    return class {
        static async findAll(page = 1, limit = 20, sortBy = idColumn, sortOrder = 'asc') {
            const { validSort, validOrder } = validateSortOrder(sortBy, sortOrder, [idColumn, 'name', 'status', 'created_at']);
            const { validPage, validLimit, offset } = validatePagination(page, limit);

            const countResult = await db.query(`SELECT COUNT(*) FROM ${tableName}`);
            const total = parseInt(countResult.rows[0].count, 10);

            const dataResult = await db.query(
                `SELECT * FROM ${tableName} ORDER BY ${validSort} ${validOrder} LIMIT $1 OFFSET $2`,
                [validLimit, offset]
            );

            return {
                data: dataResult.rows,
                pagination: { total, page: validPage, limit: validLimit, totalPages: Math.ceil(total / validLimit) }
            };
        }

        static async findById(id) {
            const { rows } = await db.query(`SELECT * FROM ${tableName} WHERE ${idColumn} = $1`, [id]);
            return rows[0] || null;
        }

        static async create(data) {
            const cols = createColumns.filter(c => data[c] !== undefined);
            const vals = cols.map(c => data[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`);
            const { rows } = await db.query(
                `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
                vals
            );
            return rows[0];
        }

        static async update(id, data) {
            const { query, params } = buildUpdateQuery(tableName, idColumn, id, data, updateColumns);
            const { rows } = await db.query(query, params);
            return rows[0] || null;
        }

        static async delete(id) {
            const result = await db.query(`DELETE FROM ${tableName} WHERE ${idColumn} = $1 RETURNING *`, [id]);
            return result.rowCount > 0;
        }
    };
}

module.exports = { createCrudModel };
```

### Task 6.2: Refactor ColdWaterSource and HeatSource models

**Files:**
- `src/models/ColdWaterSource.js` — replace with factory call + entity-specific overrides
- `src/models/HeatSource.js` — same

### Task 6.3: Create generic CRUD controller factory

**Finding:** DRY-001 — coldWaterSourceController and heatSourceController are 71 lines each, structurally identical.

**New file:** `src/controllers/factories/createCrudController.js`

### Task 6.4: Standardize pagination response shape

**Finding:** DRY-007 — Inconsistent pagination keys (`pages` vs `totalPages`) across 6 models.

**Action:** Audit all models returning pagination, standardize to `{ total, page, limit, totalPages }`.

**Files to check:**
- `src/models/ColdWaterSource.js`
- `src/models/HeatSource.js`
- `src/models/Transformer.js`
- `src/models/WaterLine.js`
- `src/models/WaterSupplier.js`
- `src/models/Line.js`

**Verification:**
- [ ] Unit tests for factory functions
- [ ] All model tests pass after refactoring
- [ ] All controller tests pass
- [ ] E2E: CRUD operations for water/heat entities work
- [ ] API response shapes are consistent

**Regression risk:** Medium. Replacing working models with factory-generated ones. Must verify exact SQL query equivalence. Approach: keep original files as `*.backup`, refactor, compare behavior, then delete backups.

---

## Phase 7: Architecture — Circular Deps & Coupling (P2)

**Goal:** Break circular dependency between alertService and ukIntegrationService using EventEmitter. Reduce model-layer bypass.

**Findings addressed:** ARCH-007, SOLID-010, ARCH-008, ARCH-113

**Dependencies:** Phase 4 (alert pipeline must be stable first)
**Estimated complexity:** M (medium)

### Task 7.1: Introduce AlertEventBus

**Finding:** ARCH-007 / SOLID-010 — Circular dependency between alertService and ukIntegrationService via 8+ deferred `require()` calls.

**New file:** `src/events/alertEvents.js`

```javascript
const EventEmitter = require('events');

class AlertEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(20);
    }
}

const alertEvents = new AlertEventBus();
module.exports = alertEvents;
```

**Changes to `src/services/alertService.js`:**
- Replace `require('./ukIntegrationService')` with `alertEvents.emit('alert.created', { ...alertData, alert_id: alertId })`
- Remove deferred `require()` for ukIntegrationService

**Changes to `src/services/ukIntegrationService.js`:**
- On initialization, subscribe to `alertEvents.on('alert.created', handler)`
- Remove deferred `require()` for alertService

**Changes to `src/services/analyticsService.js`:**
- Replace `require('./alertService')` in `setImmediate` with `alertEvents.emit('transformer.check', transformerId)`

**Wire up in `src/server.js`:**
```javascript
// Ensure event listeners are registered after service initialization
require('./events/alertEvents'); // loads the bus
require('./services/ukIntegrationService'); // registers listener
```

**Verification:**
- [ ] `npm test` — all tests pass
- [ ] E2E: create alert, verify UK forwarding still works
- [ ] Static analysis: `grep -r "require.*alertService\|require.*ukIntegration" src/services/` — no more circular requires
- [ ] No `require()` inside function bodies for alertService/ukIntegrationService

**Regression risk:** Medium. Changing the communication pattern between two core services. Must verify that:
1. Events are emitted synchronously (alertService fires, ukIntegrationService catches)
2. Error in listener does not crash the emitter
3. Event ordering is preserved

---

### Task 7.2: Document model-layer bypass (defer full fix)

**Finding:** ARCH-113 — 4 services bypass model layer for direct SQL (authService, buildingMetricsService, powerAnalyticsService, totpService).

**Decision (Complexity Audit):** Full extraction of User model from authService is a large refactoring effort (557 lines, 5 responsibilities). The current pattern works correctly and is well-tested. The main risk is totpService mutating `users` table without invalidating authService's user cache.

**Immediate action:** Add cache invalidation in totpService after user mutations:

**File:** `src/services/totpService.js` — after any `UPDATE users` query, invalidate the user cache:

```javascript
// After UPDATE users SET totp_enabled = ... (lines 87, 111, 151, 179):
const cacheService = require('./cacheService');
await cacheService.delete(`auth:user:${userId}`);
```

**Long-term:** Create `src/models/User.js` in a future phase when authService is refactored.

**Verification:**
- [ ] Enable 2FA for user A, verify cache is invalidated
- [ ] Disable 2FA for user A, verify authService sees the change immediately
- [ ] `npm test` — all tests pass

**Regression risk:** Low. Adding cache invalidation calls. No existing behavior changes.

---

## Phase 8: Testing — totpService & Coverage Gaps (P2)

**Goal:** Add comprehensive unit tests for the most security-critical untested component.

**Findings addressed:** TEST-001, TEST-003

**Dependencies:** Split into two sub-phases to break circular dependency with Phase 1.
**Estimated complexity:** M (medium)

### Task 8.0: Create baseline totpService unit tests (BEFORE Phase 1)

**Rationale:** Phase 1 verification items say "totpService tests pass" but Phase 8 depends on Phase 1. Break the cycle: write baseline tests against CURRENT code first. After Phase 1 lands, update tests for HKDF + anti-replay.

**This task has NO dependencies — can run in parallel with Phase 0.**

**New file:** `tests/jest/unit/totpService.test.js`

**Baseline test coverage (against current SHA-256 code):**
1. `getEncryptionKey()` — validates key length, returns 32-byte Buffer
2. `encrypt()` / `decrypt()` — round-trip, correct AES-256-GCM output format (iv:authTag:ciphertext)
3. `generateRecoveryCodes()` — generates 8 codes, XXXX-XXXX format
4. `generateSetup()` — returns QR code, secret is encrypted in DB
5. `confirmSetup()` — valid code enables 2FA, invalid code rejects, already enabled rejects
6. `verifyCode()` — valid TOTP code, invalid code, recovery code (single-use)
7. `disable()` — admin cannot disable (throws), non-admin can
8. Error paths — missing TOTP_ENCRYPTION_KEY, invalid encrypted data, user not found

**Minimum: 12-15 test cases** covering all public methods and error paths.

### Task 8.1: Update totpService tests after Phase 1 hardening

**Dependencies:** Phase 1 (all 4 tasks must land first)

**Additional tests for hardened code:**
1. `getEncryptionKey()` — HKDF derivation produces different key than raw SHA-256 (regression guard)
2. `verifyCode()` anti-replay — same code rejected on second use within 60s (Task 1.4)
3. TempToken blacklisting — verify integration with auth middleware (Task 1.1)

**Mocking strategy:**
- Mock `../config/database` (db.query)
- Mock `otplib` for deterministic TOTP generation
- Set `process.env.TOTP_ENCRYPTION_KEY` in test setup
- Real `crypto` (no mock — testing actual encryption)

**Minimum: 15-20 test cases** covering all public methods and error paths.

### Task 8.2: Fill test.todo gaps

**Finding:** TEST-003 — 4 `test.todo` in active test files.

**Files:**
1. `tests/jest/unit/adminMetricControllerTest.test.js:183` — `batchMetricsOperation`
2. `tests/jest/unit/powerAnalyticsController.test.js:115` — `getLinesPower`
3. `tests/jest/unit/powerAnalyticsController.test.js:119` — `getLinePower`
4. `tests/jest/unit/powerAnalyticsController.test.js:197` — `getPhaseImbalanceAnalysis`

**Action:** Implement these test cases or remove the TODOs if the functionality is not yet implemented.

**Verification:**
- [ ] `npm test` — all tests pass, no test.todo remains (or documented why)
- [ ] `npm run test:coverage` — totpService coverage > 80%
- [ ] Total test count increases from 620 to ~640+

**Regression risk:** None. Adding tests only.

---

## Phase 9: Cleanup & YAGNI (P3)

**Goal:** Remove dead code, orphaned scripts, and stub functions. Clean and focused codebase.

**Findings addressed:** YAGNI-001 through YAGNI-012, SEC-004

**Dependencies:** None (can be done anytime)
**Estimated complexity:** S (small)

### Task 9.1: Delete orphaned root-level scripts

**Finding:** YAGNI-001/002/003

**Files to delete:**
1. `swagger_init_debug.js` (60 lines) — orphaned browser script
2. `swagger_update.js` (49 lines) — dead one-shot script
3. `alerts_endpoints.js` (42 lines) — orphaned Swagger path definition

**Verification:** `grep -r "swagger_init_debug\|swagger_update\|alerts_endpoints" .` — zero imports.

### Task 9.2: Remove dead exported functions

**Files to modify:**
1. `src/utils/queryValidation.js:242-267` — delete `buildSecureQuery` (broken, zero callers) (YAGNI-004)
2. `src/utils/helpers.js:18-20` — un-export `formatDateForDB` (test-only) (YAGNI-005)
3. `src/utils/helpers.js:37-63` — un-export `calculateBuildingStatus` (no production caller) (YAGNI-006)
4. `src/utils/queryValidation.js:269-277` — un-export `allowedSortColumns`, `allowedOrderDirections`, `defaultSortParams` (internal only) (YAGNI-012)

### Task 9.3: Remove stub functions and routes

**Files to modify:**
1. `src/controllers/admin/adminGeneralController.js:4-17` — remove `globalSearch` stub (YAGNI-007)
2. `src/controllers/admin/adminGeneralController.js:39-47` — remove `exportData` stub (YAGNI-008)
3. `src/routes/adminRoutes.js` — remove routes for `globalSearch` and `exportData`
4. `src/services/alertService.js:293-297` — remove `broadcastAlert` WebSocket stub (YAGNI-010) **AND** remove the call site at line 253 (`this.broadcastAlert(alertData, alertId)`) inside `sendNotifications()` — otherwise `TypeError: this.broadcastAlert is not a function`
5. `src/services/alertService.js` — remove `getCriticalAlertRecipients` (hardcoded array) **AND** remove the call site at line 273 (`await this.getCriticalAlertRecipients()`) inside `sendImmediateNotification()`

### Task 9.4: Clean up `src/index.js`

**Finding:** YAGNI-011 — 2-line re-export of `./server`.

**Action:** Update `package.json` `"main"` to point to `src/server.js` directly. Delete `src/index.js`.

**Pre-deletion checklist (verified — all clear):**
- [ ] `grep -r "src/index" Dockerfile* docker-compose* jest.config* nodemon*` — **zero matches** (verified: Dockerfiles and compose files do not reference `src/index.js`)
- [ ] `package.json` `"start"` script: currently `"node src/index.js"` — update to `"node src/server.js"`
- [ ] `package.json` `"dev"` script: currently `"nodemon src/index.js"` — update to `"nodemon src/server.js"`
- [ ] `package.json` `"main"`: currently `"src/index.js"` — update to `"src/server.js"`

### Task 9.5: Remove emoji from logger calls

**Finding:** SEC-004 — Emoji in `logger.warn()` can cause encoding issues in log aggregators.

**File:** `src/services/alertService.js:287` (and any other occurrences)

**Action:** Replace emoji characters in logger calls with text descriptions.

**Verification:**
- [ ] `npm test` — all tests pass (some tests may reference deleted functions/routes — update those)
- [ ] `npm run lint` — no lint errors
- [ ] `grep -r "buildSecureQuery\|formatDateForDB\|calculateBuildingStatus\|globalSearch\|exportData\|broadcastAlert\|getCriticalAlertRecipients" src/` — zero results (except comments)
- [ ] Application starts successfully

**Regression risk:** Low. Removing dead code. Must update any tests that reference removed functions. `YAGNI-009` (batch operation stubs in 3 admin controllers) is deferred — those stubs may be implemented later.

---

## Phase 10: Documentation & DX (P3)

**Goal:** Update stale documentation, add missing Swagger annotations, standardize response envelopes.

**Findings addressed:** DOC-001 through DOC-009, DOC-015 through DOC-017, DRY-006, DRY-009

**Dependencies:** Phases 0-9 (document final state)
**Estimated complexity:** S-M

### Task 10.1: Update README.md

**Finding:** DOC-001/002/003 — README says 175 tests (real: 677+), port 8080 (real: 8088), migrations 003-010 (real: 003-012+).

**File:** `README.md`

**Changes:**
- Update test count
- Update port to 8088
- Update migration range to include 011+
- Add `cp .env.example .env` to Quick Start (DOC-009)
- Add `TOTP_ENCRYPTION_KEY` to env vars section

### Task 10.2: Add Swagger annotations for UK integration routes

**Finding:** DOC-005 — Zero Swagger annotations for UK integration API.

**Files:**
1. `src/routes/integrationRoutes.js` — add JSDoc/Swagger for: config, logs, rules, request-counts, building-requests
2. `src/routes/webhookRoutes.js` — add JSDoc/Swagger for: building webhook, request webhook

### Task 10.3: Fix Swagger password length discrepancy

**Finding:** DOC-008 — Swagger says `minLength: 6`, authService checks `< 8`.

**File:** `src/routes/authRoutes.js:86` — update Swagger annotation to `minLength: 8`.

### Task 10.4: Standardize response envelope usage

**Finding:** DRY-006 — 3 different response styles across controllers.

**Action:** Audit controllers not using `apiResponse.js`. Add `sendSuccess`, `sendCreated`, `sendError` usage to:
- `src/controllers/coldWaterSourceController.js`
- `src/controllers/heatSourceController.js`
- `src/routes/waterLineRoutes.js` (inline handlers)
- `src/routes/waterSupplierRoutes.js` (inline handlers)

### Task 10.5: Fix locale-dependent date formatting

**Finding:** DOC-015 — `toLocaleString()` without locale produces server-dependent output.

**File:** `src/controllers/authController.js:59-67`

**Change:** Use explicit locale or ISO format:
```javascript
// BEFORE:
new Date(user.account_locked_until).toLocaleString()
// AFTER:
new Date(user.account_locked_until).toISOString()
```

**Verification:**
- [ ] README reflects current reality
- [ ] Swagger UI shows integration endpoints
- [ ] `npm test` — all tests pass
- [ ] `npm run lint` — passes

**Regression risk:** None (documentation only) / Low (response envelope changes may affect frontend expectations — verify with E2E tests).

---

## Phase 11: Scalability Prep (P3)

**Goal:** Prepare architecture for multi-replica deployment. Wire Redis for shared state, add outbox pattern.

**Findings addressed:** ARCH-009, ARCH-010, ARCH-011, ARCH-012, ARCH-101, ARCH-110, ARCH-111, ARCH-116, ARCH-117, ARCH-014, ARCH-118, ARCH-119

**Dependencies:** All previous phases
**Estimated complexity:** L (large)

**Note:** These are "prepare for scale" changes. Currently running as a single instance behind Nginx. Implement when horizontal scaling is needed or during a dedicated infrastructure sprint.

### Task 11.1: Wire rate limiter to Redis

**Finding:** ARCH-010 — In-memory rate limiter. With 2 replicas, effective limit doubles.

**File:** `src/middleware/rateLimiter.js`

**Change:** Add Redis backend option to `SimpleRateLimiter`. When `REDIS_URL` is set, use Redis INCR + EXPIRE instead of in-memory Map. Fall back to in-memory when Redis is unavailable.

### Task 11.2: Wire activeAlerts to Redis/DB

**Finding:** ARCH-009 — In-memory `activeAlerts` Map. With DB-level UNIQUE constraint (Phase 4 Task 4.1), this becomes a performance optimization rather than correctness requirement.

**Change:** With partial UNIQUE index in place, the in-memory Map is now a cache. On startup, populate from DB (already done). For multi-replica, add Redis pub/sub for cache invalidation between replicas.

### Task 11.3: Add LRU eviction to cacheService

**Finding:** ARCH-116 — Cache entries have no per-entry size limit, no LRU.

**File:** `src/services/cacheService.js`

**Change:** Implement LRU eviction when `maxMemoryItems` is exceeded.

### Task 11.4: UK API token refresh deduplication

**Finding:** ARCH-110 — Concurrent requests both refresh the UK API token.

**File:** `src/clients/ukApiClient.js`

```javascript
async authenticate() {
    if (this._token && Date.now() < this._tokenExpiresAt) {
        return this._token;
    }

    // Deduplicate concurrent auth requests
    if (this._authPromise) {
        return this._authPromise;
    }

    this._authPromise = this._doAuthenticate().finally(() => {
        this._authPromise = null;
    });

    return this._authPromise;
}
```

### Task 11.5: Cache IntegrationConfig queries

**Finding:** ARCH-111 — DB query on every webhook for `isEnabled()` check.

**File:** `src/models/IntegrationConfig.js`

**Change:** Add 60-second in-memory cache:

```javascript
const configCache = new Map(); // { key: { value, expiresAt } }
const CACHE_TTL_MS = 60000;

static async get(key, defaultValue = null) {
    const cached = configCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
    }

    // ... existing DB query ...
    const value = rows.length ? rows[0].value : defaultValue;
    configCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
}

static async set(key, value) {
    configCache.delete(key); // Invalidate on write
    // ... existing DB upsert ...
}
```

### Task 11.6: Fix config string comparison for `uk_integration_enabled`

**Finding:** ARCH-119 — `"True"` (capital T) is treated as disabled because `value === 'true'` is case-sensitive.

**File:** `src/models/IntegrationConfig.js` (line 71)

```javascript
// BEFORE:
return value === 'true';
// AFTER:
return String(value).toLowerCase() === 'true';
```

### Task 11.7: Graceful shutdown with deadline for in-flight requests

**Finding:** ARCH-117 — No deadline for in-flight requests during shutdown.

**File:** `src/server.js` (lines 148-171)

**Change:** Already has a 10-second force exit timeout. Document that this is the in-flight request deadline. Optionally, add connection draining by setting `Connection: close` header during shutdown.

### Task 11.8: Fix `setImmediate(async)` crash risk

**Finding:** ARCH-118 — `setImmediate(async () => {...})` in analyticsService. If the async function throws synchronously before the first await, it becomes an unhandled rejection.

**File:** `src/services/analyticsService.js:86-97`

**Change:** Wrap in error handler:

```javascript
setImmediate(() => {
    this.checkForAlerts(transformerId, loadData).catch(error => {
        logger.error(`Background alert check failed: ${error.message}`);
    });
});
```

### Task 11.9: Database connection pool configuration

**Finding:** ARCH-014 — Pool size not configured. Default 10 connections may be insufficient under load.

**File:** `src/config/database.js`

**Change:** Add configurable pool parameters:

```javascript
const pool = new Pool({
    // ... existing config ...
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECT_TIMEOUT || '5000', 10),
});
```

### Task 11.10: Outbox pattern for UK forwarding

**Finding:** ARCH-101 — Deferred from Phase 4 Task 4.5. Implement when UK forwarding reliability is critical.

**Verification for all Phase 11 tasks:**
- [ ] `npm test` — all tests pass
- [ ] E2E with Docker — all flows work
- [ ] Load test: verify rate limiter works correctly with Redis
- [ ] Restart test: alert cooldowns restored, no burst

**Regression risk:** Medium-High. Phase 11 changes infrastructure patterns. Each task should be merged and tested independently.

---

## Dependency Graph

```
Phase 0 (P0 Security) ─────┐
                            ├──> Phase 1 (2FA Hardening) ──> Phase 8b (update tests)
                            │
Phase 2 (DB/Performance) ───┼──> Phase 4 (Alert Pipeline) ──> Phase 7 (Architecture)
                            │
Phase 3 (Auth Resilience) ──┘
                            
Phase 5 (DRY Admin) ──────────> Phase 6 (DRY Models)

Phase 8a (baseline tests) ──── independent (no deps, run early)
Phase 9 (Cleanup) ──────────── independent, any time

Phase 10 (Docs) ────────────── after all code phases
Phase 11 (Scale) ───────────── after all previous phases
```

**Parallelizable groups:**
- **Group A (independent, start immediately):** Phase 0, Phase 2, Phase 3, Phase 5, Phase 8a, Phase 9
- **Group B (after Phase 0):** Phase 1
- **Group C (after Phase 1):** Phase 8b (update tests for HKDF + anti-replay)
- **Group D (after Phase 2):** Phase 4 (alert pipeline depends on MV fix from Task 2.4)
- **Group E (after Phase 5):** Phase 6
- **Group F (after Phase 4):** Phase 7 (EventEmitter refactor needs stable alert pipeline)
- **Group G (after all code):** Phase 10, Phase 11

---

## Finding-to-Phase Index

| Finding ID | Phase | Task |
|-----------|-------|------|
| SEC-001 | 0 | 0.3 |
| SEC-002 | 2 | 2.1 |
| SEC-003 | 9 | note (small tables, add LIMIT when scaling) |
| SEC-004 | 9 | 9.5 |
| SEC-005 | 11 | note (dev-only, acceptable) |
| SEC-006 | 0 | 0.2 (length check) + Phase 1 Task 1.2 (HKDF) |
| SEC-101 | 1 | 1.1 |
| SEC-102 | 0 | 0.1 |
| SEC-103 | 0 | 0.2 |
| SEC-104 | 1 | 1.2 |
| SEC-105 | 1 | 1.3 |
| SEC-106 | 1 | 1.4 |
| SEC-107 | 3 | 3.3 (fixed by jwt.verify promisify) |
| ARCH-001 | 6 | note (dual model — addressed by DRY-008/ARCH-107) |
| ARCH-002 | 10 | note (Swagger bloat — acceptable) |
| ARCH-003 | 7 | 7.2 (defer User model, add cache invalidation) |
| ARCH-004 | 7 | 7.1 (EventEmitter partially addresses SRP) |
| ARCH-005 | 9 | 9.3 |
| ARCH-006 | 10 | note (URL convention — low priority) |
| ARCH-007 | 7 | 7.1 |
| ARCH-008 | 7 | 7.1 |
| ARCH-009 | 11 | 11.2 |
| ARCH-010 | 11 | 11.1 |
| ARCH-011 | 11 | note (covered by ARCH-010 Redis work) |
| ARCH-012 | 11 | 11.4 |
| ARCH-013 | 11 | note (startup delay — acceptable for init) |
| ARCH-014 | 11 | 11.9 |
| ARCH-101 | 4 | 4.5 (deferred to 11.10) |
| ARCH-102 | 3 | 3.1 |
| ARCH-103 | 2 | 2.3 |
| ARCH-104 | 0 | 0.2 |
| ARCH-105 | 3 | 3.2 |
| ARCH-106 | 4 | 4.1 |
| ARCH-107 | 2 | 2.4 |
| ARCH-108 | 2 | 2.2 |
| ARCH-109 | 4 | 4.3 |
| ARCH-110 | 11 | 11.4 |
| ARCH-111 | 11 | 11.5 |
| ARCH-112 | 4 | 4.4 |
| ARCH-113 | 7 | 7.2 |
| ARCH-114 | 9 | note (redundant check — low priority) |
| ARCH-115 | 2 | note (covered by migration 011) |
| ARCH-116 | 11 | 11.3 |
| ARCH-117 | 11 | 11.7 |
| ARCH-118 | 11 | 11.8 |
| ARCH-119 | 11 | 11.6 |
| ARCH-120 | 2 | 2.2 |
| PERF-001 | 2 | 2.1 |
| PERF-002 | 2 | 2.5 |
| PERF-003 | 10 | note (add pagination to map query when needed) |
| PERF-004 | 2 | note (2min cache mitigates; add LIMIT later) |
| PERF-006 | 11 | 11.1 |
| PERF-007 | 11 | note (token cleanup backoff) |
| PERF-008 | 11 | note (60s cleanup interval acceptable) |
| KISS-001 | 7 | note (extract inner function — part of EventEmitter refactor) |
| KISS-002 | 4 | note (refactored during threshold unification) |
| KISS-003 | 3 | 3.3 |
| KISS-004 | 5 | 5.1 |
| KISS-005 | 9 | note (move constants to module level) |
| KISS-006 | 9 | note (barrel file — low priority) |
| KISS-007 | 11 | note (double circuit breaker — defer) |
| KISS-008 | 4 | 4.2 |
| KISS-009 | 11 | 11.5 (cached IntegrationConfig) |
| KISS-010 | 9 | note (redundant duplicate check — ARCH-114) |
| KISS-011 | 9 | note (admin proxy wrappers — low priority) |
| DRY-001 | 6 | 6.1, 6.2 |
| DRY-002 | 6 | 6.1, 6.2 |
| DRY-003 | 5 | 5.1, 5.2 |
| DRY-004 | 5 | 5.3 |
| DRY-005 | 6 | note (water routes — addressed by CRUD factory) |
| DRY-006 | 10 | 10.4 |
| DRY-007 | 6 | 6.4 |
| DRY-008 | 6 | note (addressed by ARCH-107 MV fix + model factory) |
| DRY-009 | 10 | note (env var documentation — low priority) |
| SOLID-001 | 7 | 7.2 (partial — cache invalidation) |
| SOLID-002 | 7 | 7.1 (EventEmitter partially addresses) |
| SOLID-003 | 10 | note (route bloat — Swagger JSDoc) |
| SOLID-005 | 11 | note (switch to Map — low priority) |
| SOLID-006 | 5 | note (command-map pattern — part of admin DRY) |
| SOLID-007 | 4 | 4.2 (unified thresholds) |
| SOLID-009 | — | note (acceptable for vanilla JS) |
| SOLID-010 | 7 | 7.1 |
| SOLID-011 | 7 | 7.1 |
| YAGNI-001 | 9 | 9.1 |
| YAGNI-002 | 9 | 9.1 |
| YAGNI-003 | 9 | 9.1 |
| YAGNI-004 | 9 | 9.2 |
| YAGNI-005 | 9 | 9.2 |
| YAGNI-006 | 9 | 9.2 |
| YAGNI-007 | 9 | 9.3 |
| YAGNI-008 | 9 | 9.3 |
| YAGNI-009 | — | deferred — batch stubs (buildings/controllers/metrics) stay until admin UI batch operations are designed. **Trigger to revisit:** if no design/spec exists by Phase 11, delete the stubs and routes |
| YAGNI-010 | 9 | 9.3 |
| YAGNI-011 | 9 | 9.4 |
| YAGNI-012 | 9 | 9.2 |
| TEST-001 | 8 | 8.1 |
| TEST-003 | 8 | 8.2 |
| TEST-004 | 8 | note (baseline ratchet acceptable) |
| DOC-001 | 10 | 10.1 |
| DOC-002 | 10 | 10.1 |
| DOC-003 | 10 | 10.1 |
| DOC-005 | 10 | 10.2 |
| DOC-006 | 10 | note (Swagger from routes only — acceptable) |
| DOC-007 | 10 | note (static swagger.json — nice to have) |
| DOC-008 | 10 | 10.3 |
| DOC-009 | 10 | 10.1 |
| DOC-010 | — | positive (no action) |
| DOC-015 | 10 | 10.5 |
| DOC-016 | 10 | 10.4 |
| DOC-017 | 10 | note (package.json scripts — low priority) |

---

## Estimated Timeline

| Phase | Complexity | Estimated Effort | Can Parallelize With |
|-------|-----------|-----------------|---------------------|
| Phase 0 | S | 1-2 hours | — |
| Phase 1 | M | 4-6 hours | Phase 2, 3, 5 |
| Phase 2 | M | 6-8 hours | Phase 1, 3, 5 |
| Phase 3 | M | 4-6 hours | Phase 1, 2, 5 |
| Phase 4 | L | 6-8 hours | — (after Phase 2) |
| Phase 5 | M | 4-6 hours | Phase 1, 2, 3 |
| Phase 6 | M | 4-6 hours | — (after Phase 5) |
| Phase 7 | M | 4-6 hours | — (after Phase 4) |
| Phase 8 | M | 4-6 hours | — (after Phase 1) |
| Phase 9 | S | 2-3 hours | anytime |
| Phase 10 | S-M | 3-4 hours | — (after all code) |
| Phase 11 | L | 8-12 hours | — (after all) |
| **Total** | | **~55-75 hours** | *(includes ~5-10h for cross-phase code review and integration testing)* |

---

## Acceptance Criteria (Overall)

- [ ] All 677+ existing tests pass (`npm test`)
- [ ] All 57 E2E tests pass (`npm run test:e2e`)
- [ ] Zero HIGH security findings remain
- [ ] Code health score improves from 5.6 to 7.0+
- [ ] Test count increases by 30+ (totpService + new coverage)
- [ ] `npm run lint` passes with 0 warnings
- [ ] Docker build works: `docker compose -f docker-compose.dev.yml up --build` (do NOT use `-v` flag — it destroys database volumes with working data; for fresh-DB testing use a separate test environment or a temporary compose project name: `docker compose -p infrasafe-test -f docker-compose.dev.yml up --build`)
- [ ] All API endpoints respond correctly (smoke test via unified-test-runner)

---

# ADDENDUM — Phase 12: Post-Verification Hotfixes (2026-04-17 Audit)

**Date:** 2026-04-17
**Source:** `docs/audit-report-2026-04-17.md` — 62 findings (57 [x] confirmed, 5 [~] partial, 0 [ ] rejected; 186 votes by 3 independent agents)
**Focus:** Новые находки, не покрытые Phases 0–11, обнаруженные при переоценке проекта после Phase 3 merge.

**Severity breakdown (new findings only):**
- CRITICAL: 2 (SEC-NEW-001, PERF-001)
- HIGH: 4 (SEC-NEW-002, SEC-NEW-003, SEC-NEW-004, PERF-003)
- MEDIUM: 5 (SEC-NEW-005, SEC-NEW-006, SEC-NEW-007, PERF-004, PERF-010)
- LOW: 3 (SEC-NEW-008, SEC-NEW-009, PERF-007)

Phase 12 разделён на 3 sub-phase по уровню срочности:
- **12A**: CRITICAL hotfixes (немедленно, прямо в main)
- **12B**: HIGH findings (feature branch → PR)
- **12C**: MEDIUM/LOW — интегрируются в Phase 9/11 или в новые задачи

---

## Phase 12A: Critical Hotfixes (P0, немедленно)

**Goal:** Устранить 2 CRITICAL уязвимости/performance-проблемы, не требующих архитектурного редизайна.

**Findings:** SEC-NEW-001, PERF-001
**Branch strategy:** каждая задача — отдельный минимальный коммит в `main` (согласовать с пользователем перед каждым шагом)
**Estimated complexity:** S (2–4 часа)

### Task 12A.1: Ротация JWT_SECRET и JWT_REFRESH_SECRET + scrubbing git history

**Finding:** SEC-NEW-001 — Реальные JWT секреты (88-символьные base64) в git-commit `623a059` (файл `.env.prod`). Permanent token-forge для любого пользователя, включая admin. Связанное: SEC-NEW-006 (`.env` с `DB_PASSWORD=postgres` в commit `7a685040`) — чистится той же операцией.

**⚠ ТРЕБУЕТ ЯВНОГО ПОДТВЕРЖДЕНИЯ ПОЛЬЗОВАТЕЛЯ** — destructive git operations (filter-repo, force-push).

**Pre-requisite check:**
```bash
git show 623a059:.env.prod | grep -E "JWT_SECRET|JWT_REFRESH_SECRET"
git show 7a685040:.env | grep -E "DB_PASSWORD"
```

**Steps:**
1. **Rotation (production infrastructure):**
   ```bash
   NEW_JWT_SECRET=$(openssl rand -base64 64)
   NEW_JWT_REFRESH_SECRET=$(openssl rand -base64 64)
   # Update production .env (via secret manager / CI variables)
   # Restart application instances — ALL existing tokens invalidated
   ```
2. **Invalidate existing tokens:**
   ```sql
   TRUNCATE token_blacklist;
   ```
3. **Scrub git history (coordinate with all team members):**
   ```bash
   git clone --mirror ./Infrasafe ./Infrasafe-backup.git
   pip install git-filter-repo
   git filter-repo --invert-paths --path .env.prod --path .env
   git push --force --all
   git push --force --tags
   ```
4. **Prevent recurrence:** `git-secrets` pre-commit + `trufflehog` в CI; `.gitignore` включает `.env*` (кроме `.env.example`).

**Verification:**
- [ ] Old JWT tokens rejected (401)
- [ ] New login работает
- [ ] `git log --all --full-history -- .env.prod .env` пусто
- [ ] `trufflehog filesystem .` — 0 findings
- [ ] 677+ тестов проходят с новыми секретами

**Regression risk:** HIGH — все существующие сессии инвалидируются; force-push требует re-clone всех рабочих копий.

**Rollback:** `Infrasafe-backup.git` содержит полную историю.

---

### Task 12A.2: Add LIMIT + bbox to buildings-metrics endpoint

**Finding:** PERF-001 — `src/services/buildingMetricsService.js:89` без LIMIT/bbox. Весь датасет возвращается на каждый map-запрос.

**File:** `src/services/buildingMetricsService.js` + `src/controllers/buildingMetricsController.js`

**Changes:**
1. Добавить опциональный bbox (`?bbox=lat_min,lng_min,lat_max,lng_max`)
2. Hard LIMIT 5000 как safety net
3. Валидация bbox (numeric, lat ∈ [-90,90], lng ∈ [-180,180])

```javascript
// После:
const BUILDINGS_METRICS_QUERY = `
  SELECT ... FROM buildings b
  LEFT JOIN LATERAL (...) m ON TRUE
  WHERE ($1::float IS NULL OR b.latitude BETWEEN $1 AND $2)
    AND ($3::float IS NULL OR b.longitude BETWEEN $3 AND $4)
  ORDER BY b.building_id
  LIMIT $5
`;
```

**Frontend (опционально):** отправлять bbox из `map.getBounds()` при debounced `moveend`/`zoomend`.

**Verification:**
- [ ] Без bbox — ≤5000 зданий
- [ ] `?bbox=...` фильтрует по viewport
- [ ] E2E: карта рендерит здания на разных zoom
- [ ] `tests/jest/unit/buildingMetricsService.test.js` обновлён

**Regression risk:** Low — bbox опциональный, default поведение с LIMIT 5000 безопасно для текущих 17 зданий.

---

## Phase 12B: High-Priority Fixes (P1)

**Goal:** 4 HIGH findings.

**Findings:** SEC-NEW-002, SEC-NEW-003, SEC-NEW-004, PERF-003
**Branch:** `fix/phase-12b-security-perf-hotfixes`
**Estimated complexity:** M (6–10 часов)

### Task 12B.1: Rate limiter on `/auth/refresh`

**Finding:** SEC-NEW-002.

**File:** `src/routes/authRoutes.js`

```javascript
// BEFORE:
router.post('/refresh', authenticateRefresh, authController.refreshToken);
// AFTER:
router.post('/refresh', authLimiter.middleware(), authenticateRefresh, authController.refreshToken);
```

**Verification:**
- [ ] 11 requests/15min на `/auth/refresh` → 11-й возвращает 429
- [ ] Normal legitimate flow не аффектится
- [ ] `tests/jest/integration/api.test.js` + e2e auth проходят

**Regression risk:** None (идентично Task 0.1).

---

### Task 12B.2: Align `CORS_ORIGINS` env var

**Finding:** SEC-NEW-003.

**Files:** `env.example`, `.env.example`, `src/config/env.js`, `README.md`, `CLAUDE.md`.

```diff
# env.example + .env.example
-# CORS_ORIGIN=http://localhost:8080
+CORS_ORIGINS=http://localhost:8088,https://your-production-domain.com
```

```javascript
// src/config/env.js
const REQUIRED_VARS = [...existing, ...(isProduction ? ['CORS_ORIGINS'] : [])];
```

**Verification:**
- [ ] Dev: startup работает с `CORS_ORIGINS=http://localhost:8088`
- [ ] Prod без `CORS_ORIGINS` → fail-fast с чёткой ошибкой
- [ ] OPTIONS preflight корректно отражает origins

**Regression risk:** Low.

---

### Task 12B.3: Persistent account lockout (accelerate from Phase 11)

**Finding:** SEC-NEW-004.

**Option A (recommended now):** Persistent lockout в PostgreSQL. Option B — Redis в Phase 11.

**Migration `013_account_lockout_persistent.sql`:**
```sql
CREATE TABLE IF NOT EXISTS account_lockout (
    user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_account_lockout_locked_until ON account_lockout(locked_until)
  WHERE locked_until IS NOT NULL;
```

**Files:**
- `src/models/AccountLockout.js` (новый)
- `src/services/authService.js` — заменить `cacheService` на `AccountLockout` в `checkAccountLockout`, `recordFailedAttempt`, `clearFailedAttempts`
- `tests/jest/unit/authServiceTest.test.js` обновить

**Verification:**
- [ ] Lockout переживает restart
- [ ] Expires через 15 мин автоматически
- [ ] Tests: все auth-тесты проходят

**Regression risk:** Medium — migration + model changes.

---

### Task 12B.4: Frontend bundler

**Finding:** PERF-003 — ~9700 LoC без minification.

**Approach:** `esbuild` (zero-config) или `vite`.

**Files:**
- `build/esbuild.config.mjs`
- `package.json` scripts: `build:frontend`, `dev:frontend`
- `public/dist/*` в `.gitignore`

```js
// build/esbuild.config.mjs
import { build } from 'esbuild';
await build({
  entryPoints: ['public/script.js', 'public/admin.js', 'public/map-layers-control.js'],
  bundle: true, minify: true, sourcemap: true,
  target: ['es2020'], outdir: 'public/dist', format: 'iife',
});
```

**nginx.conf:** gzip для `public/dist/*.js` + `Cache-Control: public, max-age=31536000, immutable`.

**HTML:** заменить `<script src="/script.js">` на `<script src="/dist/script.js">`.

**Verification:**
- [ ] Bundle size ≥ 60% сокращение
- [ ] Source maps валидны в DevTools
- [ ] Gzip negotiation работает

**Regression risk:** Medium — менять production HTML; browser smoke-test обязателен.

---

## Phase 12C: Medium/Low Fixes

**Findings:** SEC-NEW-005, SEC-NEW-007, SEC-NEW-008, SEC-NEW-009, PERF-004..PERF-007, PERF-010

Интегрируются в существующие фазы:

| Finding | Integrate into | Rationale |
|---------|----------------|-----------|
| SEC-NEW-005 (CSP dev-guard warning) | Phase 10 | DX improvement |
| SEC-NEW-006 | 12A.1 (same scrub) | — |
| SEC-NEW-007 (rateLimiter per-process) | Phase 11 (Redis) | Planned |
| SEC-NEW-008 (npm audit) | 12C.1 (immediate) | 15-min fix |
| SEC-NEW-009 (blacklistToken null guard) | Phase 9 | 1-line fix |
| PERF-004 (rateLimiter unbounded) | Phase 11 Redis | Auto-solved |
| PERF-005 (totpService usedCodes) | Phase 11 Redis | Auto-solved |
| PERF-006 (alertService lastChecks) | Phase 7 | Add cleanup-interval |
| PERF-007 (cacheService Array.sort) | Phase 11 LRU | Replace with `lru-cache` |
| PERF-010 (missing indexes) | 12C.2 | EXPLAIN ANALYZE first |

### Task 12C.1: `npm audit fix` (immediate)

```bash
npm audit
npm audit fix
npm test
```

**Verification:** `npm audit` → 0 moderate+.

### Task 12C.2: Migration 013 — performance indexes

**Prerequisite:** EXPLAIN ANALYZE реальных запросов. Не добавлять индексы "just in case".

```sql
-- database/migrations/013_performance_indexes.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_power_transformer_timestamp
  ON metrics(power_transformer_id, timestamp DESC)
  WHERE power_transformer_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_infrastructure_alerts_infra_status
  ON infrastructure_alerts(infrastructure_type, infrastructure_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_town
  ON buildings(town)
  WHERE town IS NOT NULL;
```

**Verification:** EXPLAIN ANALYZE — index usage на соответствующих запросах, query time reduction ≥30%.

---

## Phase 12 — Dependency Graph

```
12A.1 (JWT scrub + rotation) ──┐
12A.2 (buildings-metrics LIMIT) ──┤ (parallel)
                                  │
            ┌─────────────────────┘
            ▼
12B.1 (refresh rate limit) ─── 12B.2 (CORS) ─── 12B.3 (lockout) ─── 12B.4 (bundler)
            │                   (parallel)       │                     │
            └───────────────────────────┴────────┴─────────────────────┘
                                        ▼
                                12C.1 (npm audit)
                                        ▼
                                12C.2 (migration 013)
```

## Phase 12 — Acceptance Criteria

- [ ] 12A.1: JWT секреты ротированы, git-история чистая, secret-scanner — 0 findings
- [ ] 12A.2: `/buildings-metrics` возвращает ≤5000; bbox работает
- [ ] 12B.1: `/auth/refresh` защищён rate limiter
- [ ] 12B.2: `CORS_ORIGINS` единообразно; prod startup fail-fast
- [ ] 12B.3: account lockout переживает restart; integration test с БД
- [ ] 12B.4: bundle < 50% от raw; page load < 2s
- [ ] 12C.1: `npm audit` → 0 moderate+
- [ ] 12C.2: EXPLAIN ANALYZE показывает index usage
- [ ] 677+ Jest + 57 E2E проходят
- [ ] `npm run lint` — 0 warnings

## Phase 12 — Estimated Timeline

| Sub-phase | Complexity | Effort | Блокер |
|-----------|-----------|--------|--------|
| 12A.1 (JWT rotation + scrub) | M | 2–4h | User confirmation + team coord |
| 12A.2 (buildings-metrics LIMIT) | S | 1h | — |
| 12B.1 (refresh rate limiter) | S | 15min | — |
| 12B.2 (CORS alignment) | S | 30min | — |
| 12B.3 (persistent lockout) | M | 3–4h | Migration + tests |
| 12B.4 (frontend bundler) | M | 4–6h | Browser smoke-test |
| 12C.1 (npm audit fix) | S | 15min | — |
| 12C.2 (migration 013) | S-M | 1–2h | EXPLAIN ANALYZE first |
| **Total Phase 12** | | **12–18h** | |

**Integrated total (Phases 0–12):** ~67–93 часов.
