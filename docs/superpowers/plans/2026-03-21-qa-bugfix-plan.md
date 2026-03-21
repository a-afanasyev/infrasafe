# QA Bugfix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all P0-P2 bugs found during the QA code review and security audit of InfraSafe.

**Architecture:** Fixes grouped by subsystem and ordered by severity. Each task is atomic and independently testable. Security fixes first, then correctness bugs, then quality improvements. npm audit fix runs first as it's zero-risk.

**Tech Stack:** Node.js 20+, Express.js, PostgreSQL 15+, pg driver, Jest

---

## File Structure

### Files to modify

- `src/services/authService.js` — strip password_hash from cache (P0), fix TTL units
- `src/services/powerAnalyticsService.js` — fix HAVING→WHERE in SQL (P0)
- `src/controllers/analyticsController.js` — stop leaking error.message (P1), 16 occurrences
- `src/controllers/alertController.js` — stop leaking error.message (P1), fix 500→404 status, 10 occurrences
- `docker-compose.dev.yml` — replace hardcoded JWT secrets with env vars (P1)
- `src/server.js` — morgan log format, graceful shutdown (P2)
- `src/services/cacheService.js` — standardize TTL contract to seconds (P1)
- `src/services/adminService.js` — rename `pool` to `db` (P1)
- `src/services/analyticsService.js` — update TTL values after cacheService fix
- `src/services/buildingService.js` — update TTL get() values after cacheService fix
- `src/services/controllerService.js` — update TTL get() values after cacheService fix
- `src/services/metricService.js` — update TTL get() values after cacheService fix

### Files to create

- `tests/jest/unit/authService.test.js` — test password_hash exclusion from cache
- `tests/jest/unit/powerAnalyticsService.test.js` — update existing test for WHERE fix (file already exists)

---

## Task 1: npm audit fix (P2, zero-risk baseline)

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Run npm audit fix (non-breaking)**

```bash
npm audit fix
```

This fixes 11 of 16 vulnerabilities automatically (axios, dompurify, flatted, jws, ajv, js-yaml, lodash, minimatch, qs, validator, express-validator).

- [ ] **Step 2: Verify tests still pass**

```bash
npm test
```

Expected: 175 passed, 16 suites

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): npm audit fix — resolve 11 vulnerabilities"
```

---

## Task 2: Strip password_hash from user cache (P0)

**Files:**
- Modify: `src/services/authService.js:319-325`
- Create: `tests/jest/unit/authService.test.js`

- [ ] **Step 1: Write failing test**

Create `tests/jest/unit/authService.test.js`:

**Note:** Uses the standard mock pattern from existing tests (e.g. `adminService.test.js`). `createDbMock` does NOT exist — mock database inline.

```javascript
jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

const cacheService = require('../../../src/services/cacheService');

describe('AuthService.findUserById', () => {
    const authService = require('../../../src/services/authService');
    const db = require('../../../src/config/database');

    beforeEach(() => {
        jest.clearAllMocks();
        cacheService.get.mockResolvedValue(null);
    });

    test('should NOT cache password_hash', async () => {
        db.query.mockResolvedValueOnce({
            rows: [{
                user_id: 1,
                username: 'admin',
                email: 'admin@test.com',
                role: 'admin',
                password_hash: '$2b$12$secrethash',
                is_active: true
            }],
            rowCount: 1
        });

        await authService.findUserById(1);

        // Verify cacheService.set was called without password_hash
        expect(cacheService.set).toHaveBeenCalled();
        const cachedUser = cacheService.set.mock.calls[0][1];
        expect(cachedUser).not.toHaveProperty('password_hash');
        expect(cachedUser.username).toBe('admin');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=authService
```

Expected: FAIL — `cachedUser` still has `password_hash`

- [ ] **Step 3: Fix authService.findUserById**

In `src/services/authService.js`, replace lines 319-325:

```javascript
            const query = 'SELECT user_id, username, email, role, is_active, is_locked, created_at, updated_at FROM users WHERE user_id = $1';
            const result = await db.query(query, [userId]);

            if (result.rows.length > 0) {
                const user = result.rows[0];
                await cacheService.set(cacheKey, user, { ttl: 300 });
                return user;
            }
```

This replaces `SELECT *` with explicit columns, excluding `password_hash`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=authService
```

Expected: PASS

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: 176+ passed

- [ ] **Step 6: Commit**

```bash
git add src/services/authService.js tests/jest/unit/authService.test.js
git commit -m "fix(security): exclude password_hash from user cache — SELECT explicit columns"
```

---

## Task 3: Fix HAVING→WHERE in power analytics SQL (P0)

**Files:**
- Modify: `src/services/powerAnalyticsService.js:70-74,159-163`
- Modify: `tests/jest/unit/powerAnalyticsService.test.js`

- [ ] **Step 1: Update test to verify correct SQL**

In `tests/jest/unit/powerAnalyticsService.test.js`, add a test that checks the query uses WHERE, not HAVING:

```javascript
test('getBuildingPower should use WHERE not HAVING', async () => {
    db.query.mockResolvedValueOnce({
        rows: [{
            building_id: 1, name: 'Test',
            total_power_ph1: '100', total_power_ph2: '100', total_power_ph3: '100',
            total_amperage_ph1: '10', total_amperage_ph2: '10', total_amperage_ph3: '10',
            controllers_count: '2', last_measurement_time: new Date()
        }],
        rowCount: 1
    });

    await powerAnalyticsService.getBuildingPower(1);

    const calledQuery = db.query.mock.calls[0][0];
    expect(calledQuery).not.toContain('HAVING');
    expect(calledQuery).toContain('WHERE b.building_id = $1');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=powerAnalytics
```

Expected: FAIL — query contains HAVING

- [ ] **Step 3: Fix getBuildingPower**

In `src/services/powerAnalyticsService.js`, replace lines 70-74:

```javascript
const getBuildingPower = async (buildingId) => {
    const result = await db.query(
        BUILDINGS_POWER_QUERY + ' WHERE b.building_id = $1',
        [buildingId]
    );
```

Note: `WHERE` works here because `BUILDINGS_POWER_QUERY` ends with `GROUP BY b.building_id, b.name`. Adding `WHERE` before GROUP BY would be ideal, but since this is a CTE-based query, we wrap with a subquery approach. Actually, looking at the query structure — the query has `GROUP BY` at the end (line 62). PostgreSQL allows `WHERE` after `GROUP BY` only as part of a new query. The correct fix is to wrap the whole CTE:

```javascript
const getBuildingPower = async (buildingId) => {
    const wrappedQuery = `SELECT * FROM (${BUILDINGS_POWER_QUERY}) AS buildings_power WHERE building_id = $1`;
    const result = await db.query(wrappedQuery, [buildingId]);
```

- [ ] **Step 4: Fix getTransformerPower**

Same pattern for lines 159-163:

```javascript
const getTransformerPower = async (transformerId) => {
    const wrappedQuery = `SELECT * FROM (${TRANSFORMERS_POWER_QUERY}) AS transformers_power WHERE transformer_id = $1`;
    const result = await db.query(wrappedQuery, [transformerId]);
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=powerAnalytics
```

Expected: PASS

- [ ] **Step 6: Run all tests**

```bash
npm test
```

- [ ] **Step 7: Commit**

```bash
git add src/services/powerAnalyticsService.js tests/jest/unit/powerAnalyticsService.test.js
git commit -m "fix(sql): replace HAVING with WHERE subquery in power analytics — correct SQL semantics"
```

---

## Task 4: Stop leaking error.message in analyticsController + alertController (P1)

**Files:**
- Modify: `src/controllers/analyticsController.js` — 16 occurrences of `error.message`
- Modify: `src/controllers/alertController.js` — 10 occurrences, plus fix 500→404

- [ ] **Step 1: Fix analyticsController — replace all error.message with generic message**

In `src/controllers/analyticsController.js`, find all catch blocks like:

```javascript
        } catch (error) {
            logger.error('...:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
```

Replace each with:

```javascript
        } catch (error) {
            logger.error('...:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
```

Apply to all 16 occurrences. Use replace-all for the pattern `message: error.message` within this file.

- [ ] **Step 2: Fix alertController — replace error.message AND fix 500→404**

In `src/controllers/alertController.js`, update each catch block. For `acknowledgeAlert` (line 55) and `resolveAlert` (line 85), add 404 handling:

```javascript
        } catch (error) {
            logger.error('Ошибка подтверждения алерта:', error);
            if (error.message && error.message.includes('не найден')) {
                return res.status(404).json({
                    success: false,
                    message: 'Алерт не найден или уже обработан'
                });
            }
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
```

For all other catch blocks in alertController, replace `message: error.message` with `message: 'Внутренняя ошибка сервера'`.

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: 176+ passed (security tests may check for error format — verify)

- [ ] **Step 4: Commit**

```bash
git add src/controllers/analyticsController.js src/controllers/alertController.js
git commit -m "fix(security): stop leaking error.message in analytics/alert controllers, fix 500→404 for missing alerts"
```

---

## Task 5: Replace hardcoded JWT secrets in docker-compose.dev.yml (P1)

**Files:**
- Modify: `docker-compose.dev.yml:73-74`

- [ ] **Step 1: Replace hardcoded secrets with env var references**

In `docker-compose.dev.yml`, replace lines 73-74:

```yaml
      - JWT_SECRET=${JWT_SECRET:-dev-secret-key-change-in-production}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-dev-refresh-secret-key-change-in-production}
```

This uses env vars with fallback to dev values. The hardcoded strings remain as defaults for local dev, but production will use real secrets via environment.

- [ ] **Step 2: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "fix(security): use env var references for JWT secrets in docker-compose.dev.yml"
```

---

## Task 6: Standardize cacheService TTL contract (P1, Medium risk)

**Files:**
- Modify: `src/services/cacheService.js:170-211`
- Modify: `src/services/authService.js:314`
- Modify: `src/services/analyticsService.js` (7 `get()` calls)
- Modify: `src/services/buildingService.js` (4 `get()` calls — `this.defaultCacheTTL * 1000`)
- Modify: `src/services/controllerService.js` (6 `get()` calls — `this.defaultCacheTTL * 1000` + `60000`)
- Modify: `src/services/metricService.js` (5 `get()` calls — `this.defaultCacheTTL * 1000` / `this.realtimeCacheTTL * 1000`)

**The problem:** `get()` accepts TTL in milliseconds, `set()` accepts TTL in seconds. This inconsistency works by coincidence. If only some callers are updated, cache entries will live drastically longer or shorter than expected.

**Blast radius:** 6 services, ~23 `get()` calls total. ALL must be updated atomically.

- [ ] **Step 1: Fix cacheService.get() to accept seconds, like set()**

In `src/services/cacheService.js`, change line 171:

```javascript
    async get(key, options = {}) {
        const ttl = options.ttl ? options.ttl * 1000 : this.memoryTTL; // convert seconds to ms for comparison
```

Line 176 stays the same — it compares against `cached.ttl` (already in ms) or `ttl` (now also in ms).

- [ ] **Step 2: Update ALL get() callers — every service file**

**`src/services/authService.js`** line 314:
```javascript
const cached = await cacheService.get(cacheKey, { ttl: 300 }); // 5 min in seconds
```

**`src/services/analyticsService.js`** — replace all `get()` TTL values:
- `{ ttl: 120000 }` → `{ ttl: 120 }` (2 min)
- `{ ttl: 30000 }` → `{ ttl: 30 }` (30 sec)
- `{ ttl: 300000 }` → `{ ttl: 300 }` (5 min)
- `{ ttl: 600000 }` → `{ ttl: 600 }` (10 min)
- `{ ttl: 1800000 }` → `{ ttl: 1800 }` (30 min)

**`src/services/buildingService.js`** — replace all `{ ttl: this.defaultCacheTTL * 1000 }` with `{ ttl: this.defaultCacheTTL }` (4 occurrences, lines 18, 44, 153, 197).

**`src/services/controllerService.js`** — replace all `{ ttl: this.defaultCacheTTL * 1000 }` with `{ ttl: this.defaultCacheTTL }` (5 occurrences) and `{ ttl: 60000 }` with `{ ttl: 60 }` (line 107).

**`src/services/metricService.js`** — replace all `{ ttl: this.defaultCacheTTL * 1000 }` with `{ ttl: this.defaultCacheTTL }` (4 occurrences) and `{ ttl: this.realtimeCacheTTL * 1000 }` with `{ ttl: this.realtimeCacheTTL }` (line 79).

- [ ] **Step 3: Verify no get() callers still pass milliseconds**

```bash
grep -rn 'cacheService.get.*ttl.*000' src/services/
# Expected: zero results
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/services/cacheService.js src/services/authService.js src/services/analyticsService.js src/services/buildingService.js src/services/controllerService.js src/services/metricService.js
git commit -m "fix: standardize cacheService TTL contract — all get()/set() values in seconds"
```

---

## Task 7: Fix adminService.js import naming (P1)

**Files:**
- Modify: `src/services/adminService.js:1`

- [ ] **Step 1: Rename pool to db**

In `src/services/adminService.js`, replace line 1:

```javascript
const db = require('../config/database');
```

Replace `pool.query` with `db.query` on lines 18 and 34.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/services/adminService.js
git commit -m "fix: rename pool→db in adminService to match project convention"
```

---

## Task 8: Investigate fetch interceptor cleanup on logout (P2-investigate, unconfirmed)

**Files:**
- Modify: `public/admin-auth.js:71-77`

**Note:** This may not be a real bug. The current wrapper holds a reference to `this` (the AdminAuth instance), and the token is updated on the same object. A re-login calls `setupAuthHeaders()` which checks `this.fetchIntercepted` and skips if already wrapped. The wrapper reads `this.token` dynamically, so it should pick up the new token. **Reproduce first before fixing.**

- [ ] **Step 1: Reproduce the bug**

Open admin panel → login → logout → login again. Check Network tab: do API requests include the correct `Authorization: Bearer <new-token>` header? If yes, this is not a bug — skip the fix and close this task.

- [ ] **Step 2: If confirmed — fix logout() to restore original fetch**

In `public/admin-auth.js`, replace the `logout()` method (lines 71-77):

```javascript
    logout() {
        this.token = null;
        this.isAuthenticated = false;
        // Restore original fetch and reset interceptor flag
        if (window._originalFetch) {
            window.fetch = window._originalFetch;
        }
        this.fetchIntercepted = false;
        localStorage.removeItem('admin_token');
        this.showLoginForm();
        this.hideAdminPanel();
    }
```

- [ ] **Step 2: Verify manually**

Open admin panel, login, logout, login again. Check that API requests include Authorization header after re-login.

- [ ] **Step 3: Commit**

```bash
git add public/admin-auth.js
git commit -m "fix(admin): restore original fetch on logout, prevent stale interceptor"
```

---

## Task 9: Fix graceful shutdown — await server.close() (P2)

**Files:**
- Modify: `src/server.js:131-144`

- [ ] **Step 1: Fix gracefulShutdown**

Replace `src/server.js` lines 131-144:

```javascript
// Graceful shutdown
const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    const forceExit = setTimeout(() => {
        logger.error('Forced exit after timeout');
        process.exit(1);
    }, 10000);
    forceExit.unref();

    if (server) {
        await new Promise(resolve => server.close(resolve));
        logger.info('HTTP server closed');
    }
    try {
        await db.close();
        logger.info('Database connection closed');
    } catch (e) {
        logger.error('DB close error:', e);
    }
    process.exit(0);
};
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "fix: await server.close() in graceful shutdown before process.exit"
```

---

## Task 10: Fix Morgan log format (P2) — CSP deferred

**Files:**
- Modify: `src/server.js:51`

**CSP styleSrc `'unsafe-inline'` — DEFERRED (High risk, NOT a quick fix):**

Removing `'unsafe-inline'` will break the frontend. These files inject inline styles at runtime:
- `public/admin.js:2945` — `createElement('style')`
- `public/script.js:1058-1326` — injected `<style>` block (covered by frontend plan Task 5)
- `public/admin-coordinate-editor.js:460` — inline style injection
- `public/admin-auth.js:240` — `addLoginStyles()` injects CSS via JS
- `admin.html` — inline `<style>` block (covered by frontend plan Task 8)
- Various `style=` attributes across HTML files

CSP styleSrc hardening should be a **separate plan** after frontend CSS extraction tasks (frontend plan Tasks 5, 8) are complete and remaining inline styles are audited.

- [ ] **Step 1: Use custom morgan format to strip query strings**

Replace line 51 in `src/server.js`:

```javascript
morgan.token('safepath', (req) => req.path); // path without query string
app.use(morgan(':method :safepath :status :response-time ms', { stream: { write: message => logger.info(message.trim()) } }));
```

This replaces `combined` format which logs full URL with query strings (potential token leakage via `?token=...`) plus Referer and User-Agent.

- [ ] **Step 2: Run all tests**

```bash
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "fix(security): strip query strings from access logs — use safepath morgan token"
```

---

## Summary

| # | Task | Priority | Risk | Files |
| --- | --- | --- | --- | --- |
| 1 | npm audit fix | P2 | Low | package.json |
| 2 | Strip password_hash from cache | P0 | Low | authService.js + test |
| 3 | Fix HAVING→WHERE in SQL | P0 | Medium | powerAnalyticsService.js + test |
| 4 | Stop leaking error.message | P1 | Low | analyticsController.js, alertController.js |
| 5 | JWT secrets in docker-compose | P1 | Low | docker-compose.dev.yml |
| 6 | Standardize cacheService TTL | P1 | Medium | 6 service files + cacheService.js |
| 7 | Fix adminService import naming | P1 | Low | adminService.js |
| 8 | Investigate fetch interceptor | P2 | Low | admin-auth.js (unconfirmed bug) |
| 9 | Fix graceful shutdown | P2 | Low | server.js |
| 10 | Fix Morgan logs (CSP deferred) | P2 | Low | server.js |

**Total: 10 tasks, ~90 min estimated**

### Not included in this plan (deferred)

These issues require deeper architectural changes and should be separate plans:

- **JWT in localStorage → HttpOnly cookie** (P1-S2) — requires backend cookie handling, CSRF middleware, frontend refactor
- **Server-side CSRF protection** (P1-S3) — requires csurf middleware or double-submit cookie pattern
- **Account lockout persistence to DB** (P2-S10) — requires new DB table/column, migration
- **PostGIS geo queries** (P2-C8) — requires testing with PostGIS, migration for spatial index
- **SQL aggregation for statistics** (P2-C9) — requires new model methods
- **Alert cooldown persistence** (P1-C3) — requires cacheService integration
- **Double refresh token verification** (P1-C4) — requires auth flow redesign
- **API response standardization** (P2-C7) — requires alertController + analyticsController refactor to use apiResponse.js
- **CSP styleSrc hardening** (P2) — remove `'unsafe-inline'` after frontend CSS extraction (frontend plan Tasks 5, 8) is complete; requires full inline style audit
