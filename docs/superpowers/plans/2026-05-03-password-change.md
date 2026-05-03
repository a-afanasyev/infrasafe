# Phase 13 — Admin Password Change Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a working password-change flow for admin in `admin.html`, fix the latent `password_changed_at` bug, and wire global JWT invalidation through that column.

**Architecture:** Single `UPDATE users SET password_hash, password_changed_at = NOW()` invalidates every previously-issued JWT for that user via a cutoff-check in `src/middleware/auth.js` (`authenticateJWT` + `authenticateRefresh`) that compares `decoded.iat * 1000` against `password_changed_at - 5s`. Frontend reuses existing `adminAuth.logout()` to clear `localStorage` so the redirect to `/login.html` actually forces re-authentication (login.html otherwise bounces back when stale tokens linger).

**Tech Stack:** Node.js / Express / pg / bcrypt / jsonwebtoken / Jest / vanilla JS / esbuild

**Spec:** `docs/superpowers/specs/2026-05-03-password-change-design.md`

**Branch:** Implement on `main` directly (small scope, ~14 commits). The team is mid-demo prep, so atomic per-task commits give the same revertability as a worktree without the merge overhead.

## Prerequisites

- **Stack:** the prod-demo stack started in earlier work is running via `docker compose -f docker-compose.prod.yml`. Frontend on **`http://localhost:8080`**, postgres reachable via `docker exec infrasafe-postgres-1 ...`. (Dev-stack uses port 8088 — if you switched back to dev for any reason, replace 8080 with 8088 in smoke commands.)
- **E2E base URL:** the e2e suite (`tests/jest/e2e/`) hits the API **directly on port 3000** via `BASE_URL` env (default `http://localhost:3000`). It does **not** go through nginx. The `infrasafe-app-1` container exposes 3000 on the host in dev compose; for prod compose, app is `expose:`-only — you may need `docker compose -f docker-compose.prod.yml port app 3000` or temporarily start dev compose to run e2e. Easiest: keep dev compose running for e2e, prod compose for the manual smoke at 8080.
- **Bundle path:** `public/dist/` is **gitignored**. Never `git add` files under that directory. The bundle is rebuilt automatically on `npm ci` (postinstall) and on demand via `npm run build:frontend`.

---

## File Map

| Path | Action | Responsibility |
| --- | --- | --- |
| `database/migrations/016_password_changed_at.sql` | Create | Add column to live prod DBs |
| `database/init/08_password_changed_at.sql` | Create | Same DDL for fresh installs |
| `database/migrations/README.md` | Modify | Document 016 + init/08 |
| `src/services/authService.js` | Modify | (a) `_isIssuedBeforeCutoff` helper + `JWT_CUTOFF_SKEW_MS` const, (b) `findUserById` SELECT extend, (c) `changePassword` patch (INVALID_PASSWORD code, password_changed_at, cache invalidate), (d) `refreshToken` cutoff repeat |
| `src/middleware/auth.js` | Modify | Cutoff check in `authenticateJWT` + `authenticateRefresh` |
| `src/controllers/authController.js` | Modify | Add `INVALID_PASSWORD` → 400 branch |
| `src/middleware/rateLimiter.js` | Modify | New `passwordChangeLimiter` + register with aggregate helpers + export |
| `src/routes/authRoutes.js` | Modify | Apply `passwordChangeLimiter` to `/change-password` |
| `admin.html` | Modify | Header button + `<dialog>` modal markup |
| `public/css/admin.css` | Modify | Modal + password-rules styles |
| `public/admin-auth.js` | Modify | `setupChangePassword()` wiring (uses safe DOM API, never innerHTML) |
| `tests/jest/unit/authServiceTest.test.js` | Modify | Extend `describe('changePassword')` + new cutoff describes |
| `tests/jest/unit/authControllerTest.test.js` | Modify | Add `INVALID_PASSWORD → 400` test |
| `tests/jest/unit/authMiddleware.test.js` | Modify | Add cutoff cases for both middlewares |
| `tests/jest/e2e/auth.e2e.test.js` | Modify | New `describe('POST /api/auth/change-password')` |

---

## Task 1: Migration 016 + init/08 — `password_changed_at` column

**Files:**
- Create: `database/migrations/016_password_changed_at.sql`
- Create: `database/init/08_password_changed_at.sql`
- Modify: `database/migrations/README.md`

- [ ] **Step 1: Create the migration**

Write to `database/migrations/016_password_changed_at.sql`:

```sql
-- Migration 016 — password change audit timestamp + JWT invalidation cutoff
-- Fixes a latent bug: src/services/authService.js#changePassword writes to
-- users.password_changed_at, but the column was never declared. Phase 13
-- additionally repurposes the column as a per-user JWT-cutoff (auth
-- middleware / refresh flow reject tokens whose iat precedes this
-- timestamp), which is how we bulk-invalidate every access and refresh
-- token for a user when their password changes.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.password_changed_at IS
    'Timestamp of last password change. Used as JWT-cutoff: tokens with iat earlier than this value are rejected as expired. NULL means no cutoff (column unset for legacy users).';
```

- [ ] **Step 2: Create the verbatim init/08 mirror**

```bash
cp database/migrations/016_password_changed_at.sql database/init/08_password_changed_at.sql
```

- [ ] **Step 3: Verify against a clean postgres**

```bash
docker run --rm -d --name pgtest \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=infrasafe \
  -p 5499:5432 \
  -v "$(pwd)/database/init:/docker-entrypoint-initdb.d:ro" \
  postgis/postgis:15-3.3
sleep 25
docker exec pgtest psql -U postgres -d infrasafe -c "\d users" | grep password_changed_at
docker stop pgtest
```

Expected: `password_changed_at | timestamp with time zone |` line printed.

- [ ] **Step 4: Apply to running prod stack**

```bash
docker cp database/migrations/016_password_changed_at.sql infrasafe-postgres-1:/tmp/016.sql
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -f /tmp/016.sql

docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='password_changed_at'"
```

Expected: `password_changed_at`

- [ ] **Step 5: Update `database/migrations/README.md`**

In the "Список миграций" table, append a row after 015:

```markdown
| 016 | `016_password_changed_at.sql` | 2026-05-03 | Phase 13 — `users.password_changed_at` column (fixes latent service bug + enables JWT-cutoff for bulk session invalidation) |
```

In the init-files table at the top of the file, append a row:

```markdown
| `08_password_changed_at.sql` | копия `016_password_changed_at.sql` | колонка для аудита смены пароля и JWT-cutoff |
```

- [ ] **Step 6: Commit**

```bash
git add database/migrations/016_password_changed_at.sql \
        database/init/08_password_changed_at.sql \
        database/migrations/README.md
git commit -m "feat(db): migration 016 — users.password_changed_at column"
```

---

## Task 2: Service — tag `validatePassword` error with `INVALID_PASSWORD`

**Files:**
- Modify: `src/services/authService.js` (around line 326 inside `changePassword`)
- Test: `tests/jest/unit/authServiceTest.test.js` (extend `describe('changePassword')` at line 434)

- [ ] **Step 1: Write the failing test**

In `tests/jest/unit/authServiceTest.test.js`, inside `describe('changePassword', ...)` (around line 482, before the closing `});`), add:

```js
test('tags weak-password error with code=INVALID_PASSWORD so controller maps to 400', async () => {
    const oldHash = bcrypt.hashSync('OldPass123', 4);
    cacheService.get.mockResolvedValue(null);
    db.query
        .mockResolvedValueOnce({ rows: [{ user_id: 1, username: 'u', is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ password_hash: oldHash }] });

    await expect(
        authService.changePassword(1, 'OldPass123', 'short')
    ).rejects.toMatchObject({ code: 'INVALID_PASSWORD' });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "tags weak-password error" 2>&1 | tail -20
```

Expected: FAIL with mismatch on `code` (current code: `undefined` because `validatePassword` throws plain Error).

- [ ] **Step 3: Patch `src/services/authService.js`**

Find the `changePassword` method (line 326). Locate the line `this.validatePassword(newPassword);` (around line 352) and replace with:

```js
            // Phase 13: tag validatePassword failures so controller maps them to 400
            try {
                this.validatePassword(newPassword);
            } catch (err) {
                err.code = 'INVALID_PASSWORD';
                throw err;
            }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "tags weak-password" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Run the rest of authService tests to confirm no regression**

```bash
npx jest tests/jest/unit/authServiceTest.test.js 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/authService.js tests/jest/unit/authServiceTest.test.js
git commit -m "feat(auth): tag validatePassword failures with INVALID_PASSWORD code"
```

---

## Task 3: Controller — handle `INVALID_PASSWORD` → 400

**Files:**
- Modify: `src/controllers/authController.js` (line 208 area, inside `changePassword`'s catch)
- Test: `tests/jest/unit/authControllerTest.test.js` (extend `describe('changePassword')` at line 391)

- [ ] **Step 1: Write the failing test**

In `tests/jest/unit/authControllerTest.test.js`, inside `describe('changePassword', ...)`:

```js
test('responds 400 when service throws INVALID_PASSWORD', async () => {
    const req = {
        user: { user_id: 1 },
        body: { currentPassword: 'OldPass123', newPassword: 'short' }
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    const err = new Error('Пароль должен содержать минимум 8 символов');
    err.code = 'INVALID_PASSWORD';
    authService.changePassword.mockRejectedValueOnce(err);

    await authController.changePassword(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Пароль должен содержать минимум 8 символов' });
    expect(next).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/jest/unit/authControllerTest.test.js -t "INVALID_PASSWORD" 2>&1 | tail -15
```

Expected: FAIL — currently the error falls through to `next(error)` because no branch handles `INVALID_PASSWORD`.

- [ ] **Step 3: Patch `src/controllers/authController.js`**

In `changePassword` function (line 190), inside the catch block (around line 209), AFTER the `INVALID_CURRENT_PASSWORD` branch, add:

```js
        if (error.code === 'INVALID_PASSWORD') {
            return res.status(400).json({ error: error.message });
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/jest/unit/authControllerTest.test.js -t "INVALID_PASSWORD" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Re-run the whole controller suite**

```bash
npx jest tests/jest/unit/authControllerTest.test.js 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/authController.js tests/jest/unit/authControllerTest.test.js
git commit -m "feat(auth): map INVALID_PASSWORD service error to 400 in controller"
```

---

## Task 4: Service — extend `findUserById` SELECT with `password_changed_at`

**Files:**
- Modify: `src/services/authService.js:393`
- Test: `tests/jest/unit/authServiceTest.test.js`

- [ ] **Step 1: Write the failing test**

Inside the existing `describe('AuthService', ...)` block in `authServiceTest.test.js`, add a new `describe`:

```js
describe('findUserById — password_changed_at', () => {
    test('returns password_changed_at field from DB row', async () => {
        const pca = '2026-05-03T12:00:00.000Z';
        cacheService.get.mockResolvedValue(null);
        db.query.mockResolvedValueOnce({ rows: [{
            user_id: 1, username: 'u', email: 'u@b.com', role: 'admin',
            is_active: true, account_locked_until: null,
            created_at: '2026-01-01', updated_at: '2026-01-01',
            password_changed_at: pca
        }] });

        const user = await authService.findUserById(1);
        expect(user.password_changed_at).toBe(pca);
    });

    test('SELECT statement includes password_changed_at column', async () => {
        cacheService.get.mockResolvedValue(null);
        db.query.mockResolvedValueOnce({ rows: [] });

        await authService.findUserById(999);
        const sql = db.query.mock.calls[0][0];
        expect(sql).toMatch(/password_changed_at/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "findUserById — password_changed_at" 2>&1 | tail -15
```

Expected: FAIL on the SELECT match (current SELECT does not include the column).

- [ ] **Step 3: Patch `src/services/authService.js:393`**

Replace:

```js
            const query = 'SELECT user_id, username, email, role, is_active, account_locked_until, created_at, updated_at FROM users WHERE user_id = $1';
```

With:

```js
            const query = 'SELECT user_id, username, email, role, is_active, account_locked_until, created_at, updated_at, password_changed_at FROM users WHERE user_id = $1';
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/jest/unit/authServiceTest.test.js 2>&1 | tail -10
```

Expected: all PASS (existing tests still work because mocked rows just gain an unused field).

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.js tests/jest/unit/authServiceTest.test.js
git commit -m "feat(auth): include password_changed_at in findUserById SELECT"
```

---

## Task 5: Service — `changePassword` UPDATE both columns + invalidate cache

**Files:**
- Modify: `src/services/authService.js` (around line 358 inside `changePassword`)
- Test: `tests/jest/unit/authServiceTest.test.js`

> Note: the SQL already writes `password_changed_at = NOW()` (line 360). Task 1 created the column. This task verifies via tests, adds the explicit `cacheService.invalidate` call, and asserts the SQL.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('changePassword', ...)`:

```js
test('UPDATE statement writes both password_hash and password_changed_at', async () => {
    const oldHash = bcrypt.hashSync('OldPass123', 4);
    cacheService.get.mockResolvedValue(null);
    db.query
        .mockResolvedValueOnce({ rows: [{ user_id: 1, username: 'u', is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ password_hash: oldHash }] })
        .mockResolvedValueOnce({ rowCount: 1 });

    await authService.changePassword(1, 'OldPass123', 'NewPass123');

    const updateCall = db.query.mock.calls[2];
    expect(updateCall[0]).toMatch(/password_hash/);
    expect(updateCall[0]).toMatch(/password_changed_at\s*=\s*NOW\(\)/);
    expect(updateCall[1]).toEqual([expect.any(String), 1]);  // [hash, userId]
});

test('invalidates user cache after successful change', async () => {
    const oldHash = bcrypt.hashSync('OldPass123', 4);
    cacheService.get.mockResolvedValue(null);
    db.query
        .mockResolvedValueOnce({ rows: [{ user_id: 1, username: 'u', is_active: true }] })
        .mockResolvedValueOnce({ rows: [{ password_hash: oldHash }] })
        .mockResolvedValueOnce({ rowCount: 1 });

    await authService.changePassword(1, 'OldPass123', 'NewPass123');

    expect(cacheService.invalidate).toHaveBeenCalledWith('auth:user:1');
});
```

- [ ] **Step 2: Run tests**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "changePassword" 2>&1 | tail -20
```

Expected: First test passes (SQL is already correct); second test FAILS (no cache invalidate call yet).

- [ ] **Step 3: Patch `src/services/authService.js`**

In `changePassword` (line 326), AFTER the `await db.query(query, [hashedNewPassword, userId]);` line (around line 363) and BEFORE the `logger.info` line, add:

```js
            // Phase 13: invalidate the cached user object so the next auth
            // check sees the fresh password_changed_at (cutoff-comparison).
            await cacheService.invalidate(`${this.cachePrefix}:user:${userId}`);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "changePassword" 2>&1 | tail -10
```

Expected: All tests in the block PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.js tests/jest/unit/authServiceTest.test.js
git commit -m "feat(auth): invalidate user cache after password change"
```

---

## Task 6: Service — cutoff helper `_isIssuedBeforeCutoff`

**Files:**
- Modify: `src/services/authService.js` (top of class)
- Test: `tests/jest/unit/authServiceTest.test.js`

- [ ] **Step 1: Write the failing tests**

Add a new top-level `describe` near the bottom of `authServiceTest.test.js`, inside the existing main `describe('AuthService', ...)`:

```js
describe('_isIssuedBeforeCutoff', () => {
    const NOW = 1700000000000;  // arbitrary fixed ms
    const IAT_AFTER  = Math.floor(NOW / 1000);
    const IAT_BEFORE = Math.floor((NOW - 60_000) / 1000);

    test('returns false when password_changed_at is null (legacy user)', () => {
        const user = { password_changed_at: null };
        const decoded = { iat: IAT_AFTER };
        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(false);
    });

    test('returns false when iat is after password_changed_at', () => {
        const user = { password_changed_at: new Date(NOW - 60_000).toISOString() };
        const decoded = { iat: IAT_AFTER };
        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(false);
    });

    test('returns true when iat is before password_changed_at minus skew', () => {
        const user = { password_changed_at: new Date(NOW).toISOString() };
        const decoded = { iat: IAT_BEFORE };
        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(true);
    });

    test('returns false when iat is within 5s skew of cutoff (boundary)', () => {
        // iat exactly 5s before cutoff: cutoffMs = NOW - 5000 → iatMs = NOW - 5000 → not before
        const user = { password_changed_at: new Date(NOW).toISOString() };
        const decoded = { iat: Math.floor((NOW - 5000) / 1000) };
        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(false);
    });

    test('returns true when iat is missing (malformed token)', () => {
        const user = { password_changed_at: new Date(NOW).toISOString() };
        const decoded = {};
        expect(authService._isIssuedBeforeCutoff(decoded, user)).toBe(true);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "_isIssuedBeforeCutoff" 2>&1 | tail -10
```

Expected: FAIL — `authService._isIssuedBeforeCutoff is not a function`.

- [ ] **Step 3: Patch `src/services/authService.js`**

At the top of the file, after `const cacheService = require(...)` imports (around line 9-10), add:

```js
// Phase 13: clock-skew tolerance for JWT-cutoff comparison
const JWT_CUTOFF_SKEW_MS = 5000;
```

Inside the `AuthService` class (find any method, e.g. `verifyPassword` at line 379, and add this BEFORE it):

```js
    /**
     * Returns true if the given token was issued strictly before the user's
     * password_changed_at (with 5 s clock-skew tolerance). Used by auth
     * middleware and refreshToken to bulk-invalidate every JWT after a
     * password change without per-token blacklisting.
     */
    _isIssuedBeforeCutoff(decoded, user) {
        if (!user.password_changed_at) return false;
        if (typeof decoded.iat !== 'number') return true;
        const issuedAtMs = decoded.iat * 1000;
        const cutoffMs = new Date(user.password_changed_at).getTime() - JWT_CUTOFF_SKEW_MS;
        return issuedAtMs < cutoffMs;
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "_isIssuedBeforeCutoff" 2>&1 | tail -10
```

Expected: all 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.js tests/jest/unit/authServiceTest.test.js
git commit -m "feat(auth): _isIssuedBeforeCutoff helper for JWT-cutoff check"
```

---

## Task 7: Middleware — cutoff check in `authenticateJWT` + `authenticateRefresh`

**Files:**
- Modify: `src/middleware/auth.js` (lines 64-77 for JWT, 144-157 for refresh)
- Test: `tests/jest/unit/authMiddleware.test.js`

- [ ] **Step 1: Read the existing test file structure**

```bash
head -40 tests/jest/unit/authMiddleware.test.js
```

Note the mock pattern (likely `jest.mock` for authService) so we can extend it consistently.

- [ ] **Step 2: Write the failing tests**

Append to `tests/jest/unit/authMiddleware.test.js` (inside existing main `describe`):

```js
describe('authenticateJWT — password_changed_at cutoff', () => {
    const NOW = Math.floor(Date.now() / 1000);

    function makeReq(token = 'eyJraW...stub.token') {
        return { headers: { authorization: `Bearer ${token}` } };
    }
    function makeRes() {
        return { status: jest.fn().mockReturnThis(), json: jest.fn() };
    }

    beforeEach(() => {
        authService.isTokenBlacklisted.mockResolvedValue(false);
        process.env.JWT_SECRET = 'test-secret';
    });

    test('rejects token whose iat is before password_changed_at', async () => {
        const userPca = new Date().toISOString();
        const decoded = { user_id: 1, iat: NOW - 3600 };  // 1h ago
        jest.spyOn(require('jsonwebtoken'), 'verify').mockImplementation((tok, sec, opts, cb) => cb(null, decoded));
        authService.findUserById.mockResolvedValue({
            user_id: 1, username: 'admin', role: 'admin',
            email: 'a@b.com', is_active: true, password_changed_at: userPca
        });
        authService._isIssuedBeforeCutoff = jest.fn().mockReturnValue(true);

        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();
        await authenticateJWT(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid or expired token' });
        expect(next).not.toHaveBeenCalled();
    });

    test('passes when password_changed_at is null (legacy user)', async () => {
        const decoded = { user_id: 1, iat: NOW };
        jest.spyOn(require('jsonwebtoken'), 'verify').mockImplementation((tok, sec, opts, cb) => cb(null, decoded));
        authService.findUserById.mockResolvedValue({
            user_id: 1, username: 'admin', role: 'admin',
            email: 'a@b.com', is_active: true, password_changed_at: null
        });
        authService._isIssuedBeforeCutoff = jest.fn().mockReturnValue(false);

        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();
        await authenticateJWT(req, res, next);

        expect(next).toHaveBeenCalled();
    });
});

describe('authenticateRefresh — password_changed_at cutoff', () => {
    test('rejects refresh token whose iat is before password_changed_at', async () => {
        authService.isTokenBlacklisted.mockResolvedValue(false);
        process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

        const decoded = { user_id: 1, iat: Math.floor(Date.now() / 1000) - 3600 };
        jest.spyOn(require('jsonwebtoken'), 'verify').mockImplementation((tok, sec, opts, cb) => cb(null, decoded));
        authService.findUserById.mockResolvedValue({
            user_id: 1, username: 'admin', role: 'admin', email: 'a@b.com',
            is_active: true, password_changed_at: new Date().toISOString()
        });
        authService._isIssuedBeforeCutoff = jest.fn().mockReturnValue(true);

        const req = { body: { refreshToken: 'stub.refresh.token' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();
        await authenticateRefresh(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid or expired refresh token' });
        expect(next).not.toHaveBeenCalled();
    });
});
```

> Adjust the import line at top of the file if needed: `const { authenticateJWT, authenticateRefresh } = require('../../../src/middleware/auth')`. If the existing file already imports them, skip.

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest tests/jest/unit/authMiddleware.test.js -t "cutoff" 2>&1 | tail -15
```

Expected: FAIL — middleware does not currently call `_isIssuedBeforeCutoff`.

- [ ] **Step 4: Patch `src/middleware/auth.js`**

In `authenticateJWT` (line 21), AFTER the existing `if (!user)` block (line 65-70), and BEFORE the `account_locked_until` check (line 72), insert:

```js
        // Phase 13: reject tokens issued before the user's most recent password change
        if (authService._isIssuedBeforeCutoff(decoded, user)) {
            logger.warn(`Stale token rejected for user ${user.user_id} — issued before password change`);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
```

In `authenticateRefresh` (line 111), apply the SAME pattern: after `if (!user)` (line 145-150), before `account_locked_until` (line 152), insert:

```js
        // Phase 13: reject refresh tokens issued before the user's password change
        if (authService._isIssuedBeforeCutoff(decoded, user)) {
            logger.warn(`Stale refresh token rejected for user ${user.user_id}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired refresh token'
            });
        }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest tests/jest/unit/authMiddleware.test.js 2>&1 | tail -15
```

Expected: all PASS, including pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/middleware/auth.js tests/jest/unit/authMiddleware.test.js
git commit -m "feat(auth): cutoff check in authenticateJWT + authenticateRefresh"
```

---

## Task 8: Service — repeat cutoff in `refreshToken` (defense in depth)

**Files:**
- Modify: `src/services/authService.js` (around line 265 inside `refreshToken`)
- Test: `tests/jest/unit/authServiceTest.test.js`

- [ ] **Step 1: Write the failing test**

Append to `authServiceTest.test.js` inside main describe:

```js
describe('refreshToken — password_changed_at cutoff', () => {
    test('throws INVALID_REFRESH_TOKEN when iat precedes password_changed_at', async () => {
        const userId = 1;
        const oldIat = Math.floor((Date.now() - 60_000) / 1000);

        // Sign a refresh token with old iat
        const refreshToken = jwt.sign(
            { user_id: userId, type: 'refresh', iat: oldIat },
            process.env.JWT_REFRESH_SECRET,
            { issuer: 'infrasafe-api', audience: 'infrasafe-client', expiresIn: '7d' }
        );

        cacheService.get.mockResolvedValue(null);
        // Order of db.query calls in refreshToken (verified against authService.js:265+):
        //   1. INSERT INTO token_blacklist (atomic consume)
        //   2. SELECT ... FROM users (findUserById)
        db.query
            .mockResolvedValueOnce({ rowCount: 1 })  // INSERT (atomic consume succeeds)
            .mockResolvedValueOnce({ rows: [{
                user_id: userId, username: 'admin', email: 'a@b.com', role: 'admin',
                is_active: true, account_locked_until: null,
                created_at: '2026-01-01', updated_at: '2026-01-01',
                password_changed_at: new Date().toISOString()
            }] });

        await expect(
            authService.refreshToken(refreshToken)
        ).rejects.toMatchObject({ code: expect.stringMatching(/REFRESH|EXPIRED/) });
    });
});
```

- [ ] **Step 2: Run test**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "refreshToken — password_changed_at" 2>&1 | tail -15
```

Expected: FAIL — refreshToken does not currently look up user/check cutoff.

- [ ] **Step 3: Patch `src/services/authService.js`**

Find `async refreshToken(refreshToken)` (around line 265). After the existing `jwt.verify` block + token-type check + atomic blacklist consume (whatever is currently there), and BEFORE generating new tokens, add:

```js
            // Phase 13: defense-in-depth cutoff check (middleware also enforces).
            const user = await this.findUserById(decoded.user_id);
            if (!user) {
                const error = new Error('Пользователь не найден');
                error.code = 'USER_NOT_FOUND';
                throw error;
            }
            if (this._isIssuedBeforeCutoff(decoded, user)) {
                const error = new Error('Refresh token issued before password change');
                error.code = 'INVALID_REFRESH_TOKEN';
                throw error;
            }
```

> Read the existing `refreshToken` body first (lines ~265-330) to find the right insertion point — between the atomic-consume and `generateTokens()` call.

- [ ] **Step 4: Run test**

```bash
npx jest tests/jest/unit/authServiceTest.test.js -t "refreshToken" 2>&1 | tail -15
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.js tests/jest/unit/authServiceTest.test.js
git commit -m "feat(auth): refreshToken repeats cutoff check (defense in depth)"
```

---

## Task 9: Rate limiter — `passwordChangeLimiter`

**Files:**
- Modify: `src/middleware/rateLimiter.js`

- [ ] **Step 1: Add the limiter**

Open `src/middleware/rateLimiter.js`. After `const registerLimiter = ...` (line 286-291), add:

```js
// Phase 13: dedicated limiter for password-change attempts so they
// don't exhaust the login-limiter budget (separate key prefix).
const passwordChangeLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Слишком много попыток смены пароля. Попробуйте через 15 минут.',
    keyGenerator: (req) => {
        const ip = req.ip || req.connection.remoteAddress;
        const userId = req.user ? req.user.user_id : 'anonymous';
        return `auth:change-password:${ip}:${userId}`;
    }
});
```

- [ ] **Step 2: Register with aggregate helpers**

In `getAllRateLimitStats()` (line 330-344), inside the returned object, add:

```js
        password_change: passwordChangeLimiter.getStats(),
```

In `resetAllRateLimits()` (line 347-356), add:

```js
    passwordChangeLimiter.reset();
```

In `destroyAllLimiters()` (line 359-368), add:

```js
    passwordChangeLimiter.destroy();
```

- [ ] **Step 3: Export it**

In `module.exports = { ... }` (line 370+), add `passwordChangeLimiter,` to the exported names. (Find the existing `authLimiter,` line and add the new export beside it.)

- [ ] **Step 4: Sanity-test with a quick require**

```bash
node -e "const r = require('./src/middleware/rateLimiter'); console.log(Object.keys(r).filter(k => k.includes('Limit')));"
```

Expected output includes `passwordChangeLimiter`.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/rateLimiter.js
git commit -m "feat(auth): add dedicated passwordChangeLimiter (5/15min)"
```

---

## Task 10: Route — apply `passwordChangeLimiter`

**Files:**
- Modify: `src/routes/authRoutes.js` (line 4 + line 276)

- [ ] **Step 1: Update the import**

Line 4 currently:

```js
const { authLimiter, registerLimiter } = require('../middleware/rateLimiter');
```

Replace with:

```js
const { authLimiter, registerLimiter, passwordChangeLimiter } = require('../middleware/rateLimiter');
```

- [ ] **Step 2: Apply the middleware to the route**

Line 276 currently:

```js
router.post('/change-password', authController.changePassword);
```

Replace with:

```js
router.post('/change-password', passwordChangeLimiter.middleware(), authController.changePassword);
```

- [ ] **Step 3: Smoke test against the running prod stack**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('accessToken','--no-token--'))")

for i in 1 2 3 4 5 6; do
    echo -n "Attempt $i: "
    curl -s -o /dev/null -w "HTTP %{http_code}\n" \
      -X POST http://localhost:8080/api/auth/change-password \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d '{"currentPassword":"wrong","newPassword":"NewPass123"}'
done
```

Expected: attempts 1-5 return HTTP 400 (or 401 if token rejected), attempt 6 returns HTTP 429.

> Note: admin may have 2FA enabled and need to go through `/setup-2fa` flow first; if so, complete the 2FA setup or use a fresh user without 2FA. The smoke is just to confirm the limiter triggers — adjust as needed.

- [ ] **Step 4: Commit**

```bash
git add src/routes/authRoutes.js
git commit -m "feat(auth): apply passwordChangeLimiter to /change-password route"
```

---

## Task 11: `admin.html` + `public/css/admin.css` — markup and styles

**Files:**
- Modify: `admin.html`
- Modify: `public/css/admin.css`

- [ ] **Step 1: Add the header button**

Open `admin.html` and find the admin-panel header. Look for the `<h1>` element (search: `grep -n "<h1" admin.html`). Immediately AFTER the `<h1>` closing tag, add:

```html
                <button id="btn-change-password" class="btn-secondary" type="button">
                    🔑 Сменить пароль
                </button>
```

(Indentation should match the surrounding markup.)

- [ ] **Step 2: Append the modal dialog before `</body>`**

Find the closing `</body>` tag. Just BEFORE it, add:

```html
<dialog id="change-password-modal" class="modal-dialog">
    <form id="change-password-form">
        <h3>Сменить пароль</h3>

        <label for="cp-current">Текущий пароль</label>
        <input type="password" id="cp-current" autocomplete="current-password" required>
        <p class="error-text" id="cp-current-error" hidden></p>

        <label for="cp-new">Новый пароль</label>
        <div class="input-with-toggle">
            <input type="password" id="cp-new" autocomplete="new-password" required minlength="8">
            <button type="button" id="cp-toggle-visibility" aria-label="Показать пароль">👁</button>
        </div>
        <ul class="password-rules" id="cp-rules">
            <li data-rule="length" class="rule-missing">≥ 8 символов</li>
            <li data-rule="lower" class="rule-missing">есть строчная буква</li>
            <li data-rule="upper" class="rule-missing">есть заглавная буква</li>
            <li data-rule="digit" class="rule-missing">есть цифра</li>
        </ul>

        <label for="cp-confirm">Подтвердите новый пароль</label>
        <input type="password" id="cp-confirm" autocomplete="new-password" required>
        <p class="error-text" id="cp-confirm-error" hidden></p>

        <p class="warning-text">
            ⚠ После смены пароля все сессии будут завершены — войдите заново.
        </p>

        <p class="error-text" id="cp-server-error" hidden></p>

        <div class="modal-actions">
            <button type="button" id="cp-cancel" class="btn-secondary">Отмена</button>
            <button type="submit" id="cp-submit" class="btn-primary" disabled>Сменить пароль</button>
        </div>

        <div id="cp-success-banner" class="cp-success-banner" hidden>
            ✓ Пароль изменён. Перенаправление…
        </div>
    </form>
</dialog>
```

> Note: success banner is a sibling that toggles via `hidden` attribute, NOT replaced via innerHTML. This avoids any DOM-injection bad pattern.

- [ ] **Step 3: Add styles to `public/css/admin.css`**

Append to the bottom of `public/css/admin.css`:

```css
/* ============================================
   Phase 13 — Password change modal
   ============================================ */

#btn-change-password {
    margin-left: 1rem;
}

.modal-dialog {
    border: none;
    border-radius: 8px;
    padding: 0;
    max-width: 480px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-dialog::backdrop {
    background: rgba(0, 0, 0, 0.5);
}

.modal-dialog form {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.modal-dialog h3 {
    margin: 0 0 0.5rem 0;
}

.modal-dialog label {
    font-weight: 500;
    margin-top: 0.5rem;
}

.modal-dialog input[type="password"] {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
}

.input-with-toggle {
    display: flex;
    gap: 0.25rem;
    align-items: center;
}

.input-with-toggle input {
    flex: 1;
}

#cp-toggle-visibility {
    background: none;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
}

.password-rules {
    list-style: none;
    padding: 0.5rem 0.75rem;
    margin: 0;
    background: #f7f7f7;
    border-radius: 4px;
    font-size: 0.85em;
}

.password-rules li {
    padding: 0.15rem 0;
}

.password-rules li.rule-met {
    color: #2e7d32;
}

.password-rules li.rule-met::before {
    content: '✓ ';
    font-weight: bold;
}

.password-rules li.rule-missing {
    color: #888;
}

.password-rules li.rule-missing::before {
    content: '○ ';
}

.error-text {
    color: #c62828;
    font-size: 0.85em;
    margin: 0.25rem 0 0 0;
}

.warning-text {
    background: #fff3cd;
    border-left: 3px solid #ffc107;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-size: 0.85em;
    margin: 0.5rem 0;
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
}

.cp-success-banner {
    background: #c8e6c9;
    color: #1b5e20;
    padding: 1rem;
    border-radius: 4px;
    text-align: center;
    font-weight: 500;
    margin-top: 1rem;
}
```

- [ ] **Step 4: Visual smoke**

Reload `http://localhost:8080/admin.html` (after rebuilding bundle in Task 12). For now just visually confirm the button appears in the header.

```bash
docker exec infrasafe-frontend-1 cat /usr/share/nginx/html/admin.html | grep btn-change-password
```

Expected: at least one match showing the button is in the served file. (Frontend container needs restart if bind-mount lost the file — `docker restart infrasafe-frontend-1`.)

- [ ] **Step 5: Commit**

```bash
git add admin.html public/css/admin.css
git commit -m "feat(admin): password-change modal markup + styles"
```

---

## Task 12: `public/admin-auth.js` — wire up the modal (safe-DOM only)

**Files:**
- Modify: `public/admin-auth.js`

> **Important:** never use `innerHTML` or string-template DOM. Toggle visibility via the existing `hidden` attribute and use `textContent` for any dynamic strings. The success banner already lives in markup (Task 11) — we just unhide it.

- [ ] **Step 1: Add `setupChangePassword()` method**

Open `public/admin-auth.js`. After the `addLogoutButton()` method, add:

```js
    setupChangePassword() {
        const btn = document.getElementById('btn-change-password');
        const modal = document.getElementById('change-password-modal');
        if (!btn || !modal) return;

        const form = document.getElementById('change-password-form');
        const current = document.getElementById('cp-current');
        const newPwd = document.getElementById('cp-new');
        const confirm = document.getElementById('cp-confirm');
        const submit = document.getElementById('cp-submit');
        const cancel = document.getElementById('cp-cancel');
        const toggle = document.getElementById('cp-toggle-visibility');
        const currentError = document.getElementById('cp-current-error');
        const confirmError = document.getElementById('cp-confirm-error');
        const serverError = document.getElementById('cp-server-error');
        const successBanner = document.getElementById('cp-success-banner');
        const actionsBlock = form.querySelector('.modal-actions');
        const rules = {
            length: form.querySelector('li[data-rule="length"]'),
            lower:  form.querySelector('li[data-rule="lower"]'),
            upper:  form.querySelector('li[data-rule="upper"]'),
            digit:  form.querySelector('li[data-rule="digit"]')
        };

        const setRule = (el, met) => {
            el.classList.toggle('rule-met', met);
            el.classList.toggle('rule-missing', !met);
        };

        const showError = (el, message) => {
            el.textContent = message;
            el.hidden = false;
        };
        const hideError = (el) => {
            el.textContent = '';
            el.hidden = true;
        };

        const validateLive = () => {
            const v = newPwd.value;
            const lengthOk = v.length >= 8;
            const lowerOk  = /[a-z]/.test(v);
            const upperOk  = /[A-Z]/.test(v);
            const digitOk  = /\d/.test(v);
            setRule(rules.length, lengthOk);
            setRule(rules.lower,  lowerOk);
            setRule(rules.upper,  upperOk);
            setRule(rules.digit,  digitOk);

            const allRulesMet = lengthOk && lowerOk && upperOk && digitOk;
            const filled = current.value && newPwd.value && confirm.value;
            const matches = newPwd.value === confirm.value;
            const different = newPwd.value !== current.value;

            if (filled && newPwd.value && !matches) {
                showError(confirmError, 'Пароли не совпадают');
            } else {
                hideError(confirmError);
            }

            submit.disabled = !(filled && allRulesMet && matches && different);
        };

        const reset = () => {
            form.reset();
            hideError(currentError);
            hideError(confirmError);
            hideError(serverError);
            successBanner.hidden = true;
            actionsBlock.hidden = false;
            submit.disabled = true;
            submit.textContent = 'Сменить пароль';
            Object.values(rules).forEach(el => setRule(el, false));
        };

        btn.addEventListener('click', () => {
            reset();
            modal.showModal();
            current.focus();
        });

        cancel.addEventListener('click', () => modal.close());

        toggle.addEventListener('click', () => {
            const isPwd = newPwd.type === 'password';
            newPwd.type = isPwd ? 'text' : 'password';
            toggle.textContent = isPwd ? '🙈' : '👁';
        });

        [current, newPwd, confirm].forEach(el => el.addEventListener('input', validateLive));

        const showSuccessAndLogout = () => {
            // Hide all transient inputs/errors, reveal the success banner, then logout.
            [current, newPwd, confirm].forEach(el => { el.disabled = true; });
            actionsBlock.hidden = true;
            hideError(currentError);
            hideError(confirmError);
            hideError(serverError);
            successBanner.hidden = false;
            setTimeout(() => this.logout(), 1500);
        };

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submit.disabled = true;
            submit.textContent = 'Меняем…';
            hideError(currentError);
            hideError(serverError);

            try {
                const response = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + this.token
                    },
                    body: JSON.stringify({
                        currentPassword: current.value,
                        newPassword: newPwd.value
                    }),
                    signal: AbortSignal.timeout(10000)
                });

                if (response.status === 200) {
                    showSuccessAndLogout();
                    return;
                }

                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
                    showError(serverError, `Слишком много попыток. Повторите через ${retryAfter} с.`);
                    submit.disabled = true;
                    setTimeout(() => {
                        submit.disabled = false;
                        submit.textContent = 'Сменить пароль';
                    }, retryAfter * 1000);
                    return;
                }

                let body;
                try { body = await response.json(); } catch { body = {}; }
                const message = body.error || body.message || 'Не удалось изменить пароль';

                if (response.status === 400 && /текущий|current/i.test(message)) {
                    showError(currentError, message);
                    current.value = '';
                    current.focus();
                } else if (response.status === 400) {
                    showError(serverError, message);
                } else if (response.status === 401) {
                    showError(serverError, 'Сессия истекла. Перенаправление…');
                } else {
                    showError(serverError, message);
                }
                submit.disabled = false;
                submit.textContent = 'Сменить пароль';
            } catch (error) {
                if (error.name === 'TimeoutError') {
                    showError(serverError, 'Превышено время ожидания');
                } else {
                    showError(serverError, 'Не удалось изменить пароль. Попробуйте ещё раз.');
                }
                submit.disabled = false;
                submit.textContent = 'Сменить пароль';
            }
        });
    }
```

- [ ] **Step 2: Call `setupChangePassword()` from init**

Find the init/constructor flow (look for `new AdminAuth()` or where `addLogoutButton()` is called). Add a call to `this.setupChangePassword()` after `addLogoutButton()`. If `addLogoutButton()` is called inside `validateToken()` success handler (around `window.dispatchEvent(new CustomEvent('admin-auth-ready'))` line 40), add:

```js
this.setupChangePassword();
```

…right after `this.addLogoutButton();` (or wherever the existing UI wiring runs).

- [ ] **Step 3: Rebuild the bundle**

```bash
npm run build:frontend 2>&1 | tail -5
```

Expected output: `[esbuild] done → public/dist (11 files)` (count may differ slightly).

- [ ] **Step 4: Verify the bundled file contains the new code**

```bash
grep -c "setupChangePassword" public/dist/admin-auth.js
```

Expected: `1` or higher (esbuild may inline; substring should still be present from the source identifier).

- [ ] **Step 5: Restart frontend container so bind-mounted dist is picked up**

```bash
docker restart infrasafe-frontend-1
sleep 3
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8080/public/dist/admin-auth.js
```

Expected: HTTP 200.

- [ ] **Step 6: Commit**

> `public/dist/` is gitignored — only the source file goes into the commit.

```bash
git add public/admin-auth.js
git commit -m "feat(admin): wire up password-change modal in admin-auth.js"
```

---

## Task 13: E2E test — full happy path + edge cases

**Files:**
- Modify: `tests/jest/e2e/auth.e2e.test.js`

- [ ] **Step 1: Confirm helper shapes**

The existing e2e suite uses **supertest** (NOT axios). Verified helpers in `tests/jest/e2e/helpers/e2eHelper.js`:

```js
const { login, loginFresh, authed, anon, BASE_URL } = require('./helpers/e2eHelper');
const request = require('supertest');

// Patterns:
//   request(BASE_URL).post('/api/...').send({...})       // anon
//   authed(token).post('/api/...').send({...})            // bearer
//   const { accessToken } = await login();                // cached admin (avoids rate-limiter)
//   const { accessToken } = await loginFresh('user', 'p') // fresh login, rate-limited
```

Read the file once before writing tests:

```bash
cat tests/jest/e2e/helpers/e2eHelper.js | head -80
```

- [ ] **Step 2: Write the failing tests using supertest**

Append to `tests/jest/e2e/auth.e2e.test.js` (the file already imports the helpers at the top):

```js
describe('E2E: POST /api/auth/change-password', () => {
    let testUser;
    const ORIG_PWD = 'TestPass123';
    const NEW_PWD = 'NewPass456';

    beforeAll(async () => {
        // Use a dedicated registered user — admin has 2FA mandatory which complicates flow
        const username = `pwtest_${Date.now()}`;
        const email = `${username}@test.local`;
        const reg = await request(BASE_URL)
            .post('/api/auth/register')
            .send({ username, email, password: ORIG_PWD, full_name: 'PW Test' });
        if (reg.status !== 201 && reg.status !== 200) {
            throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        }
        testUser = { username, email };
    });

    afterAll(async () => {
        const { resetAllRateLimits } = require('../../../src/middleware/rateLimiter');
        if (typeof resetAllRateLimits === 'function') resetAllRateLimits();
    });

    test('changes password and invalidates old tokens', async () => {
        const login1 = await loginFresh(testUser.username, ORIG_PWD);
        const access1 = login1.accessToken;
        const refresh1 = login1.refreshToken;
        expect(access1).toBeTruthy();

        const change = await authed(access1)
            .post('/api/auth/change-password')
            .send({ currentPassword: ORIG_PWD, newPassword: NEW_PWD });
        expect(change.status).toBe(200);
        expect(change.body.success).toBe(true);

        // Allow cache invalidation to propagate
        await new Promise(r => setTimeout(r, 200));

        // Old access token now rejected
        const profileResp = await authed(access1).get('/api/auth/profile');
        expect(profileResp.status).toBe(401);

        // Old refresh token now rejected
        const refreshResp = await request(BASE_URL)
            .post('/api/auth/refresh')
            .send({ refreshToken: refresh1 });
        expect(refreshResp.status).toBe(401);

        // Old password rejected
        const oldLogin = await request(BASE_URL)
            .post('/api/auth/login')
            .send({ username: testUser.username, password: ORIG_PWD });
        expect(oldLogin.status).toBe(401);

        // New password works
        const newLoginResp = await request(BASE_URL)
            .post('/api/auth/login')
            .send({ username: testUser.username, password: NEW_PWD });
        expect(newLoginResp.status).toBe(200);
        expect(newLoginResp.body.accessToken).toBeTruthy();
    });

    test('returns 400 for wrong current password', async () => {
        const { accessToken } = await loginFresh(testUser.username, NEW_PWD);
        const resp = await authed(accessToken)
            .post('/api/auth/change-password')
            .send({ currentPassword: 'wrong', newPassword: 'AnotherNew123' });
        expect(resp.status).toBe(400);
    });

    test('returns 400 for weak new password (INVALID_PASSWORD branch)', async () => {
        const { accessToken } = await loginFresh(testUser.username, NEW_PWD);
        const resp = await authed(accessToken)
            .post('/api/auth/change-password')
            .send({ currentPassword: NEW_PWD, newPassword: 'short' });
        expect(resp.status).toBe(400);
        expect(resp.body.error).toMatch(/минимум 8|строчные|заглавн/);
    });

    test('rate-limits after 5 attempts within 15 min', async () => {
        const { resetAllRateLimits } = require('../../../src/middleware/rateLimiter');
        if (typeof resetAllRateLimits === 'function') resetAllRateLimits();

        const { accessToken } = await loginFresh(testUser.username, NEW_PWD);

        const codes = [];
        for (let i = 0; i < 6; i++) {
            const r = await authed(accessToken)
                .post('/api/auth/change-password')
                .send({ currentPassword: 'wrong', newPassword: 'AnotherNew123' });
            codes.push(r.status);
        }
        expect(codes.slice(0, 5).every(c => c === 400)).toBe(true);
        expect(codes[5]).toBe(429);
    });
});
```

> **Note 1:** `BASE_URL` defaults to `http://localhost:3000` (direct app, not via nginx). Make sure `infrasafe-app-1` exposes port 3000 to host — true in dev compose, may need port-forward in prod compose.
>
> **Note 2:** the e2e file already has `const { login, loginFresh, authed, anon, BASE_URL } = require('./helpers/e2eHelper');` and `const request = require('supertest');` at the top — reuse them, don't re-import.

- [ ] **Step 3: Run the e2e suite to verify it works**

```bash
docker compose -f docker-compose.prod.yml ps | grep healthy

npx jest --config tests/jest/e2e/jest.e2e.config.js tests/jest/e2e/auth.e2e.test.js -t "change-password" 2>&1 | tail -30
```

Expected: all 4 new tests PASS. If a test runner harness exists for e2e (check `package.json` scripts for `test:e2e`), use that instead.

- [ ] **Step 4: Commit**

```bash
git add tests/jest/e2e/auth.e2e.test.js
git commit -m "test(auth): e2e — password change happy path + edge cases"
```

---

## Task 14: Manual smoke + final verification

**Files:**
- None (verification only)

- [ ] **Step 1: Verify all unit + integration tests pass**

```bash
npm test 2>&1 | tail -20
```

Expected: 1804+ pass (the prior baseline) plus all new tests, no failures.

- [ ] **Step 2: Verify lint clean**

```bash
npm run lint 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Manual smoke via chrome-devtools MCP (admin without 2FA preferred)**

If admin has 2FA, log in once first to make TOTP work, then:

| Step | Expected |
| --- | --- |
| Open `http://localhost:8080/admin.html` | Header shows «🔑 Сменить пароль» button |
| Click button | Modal opens, focus on «Текущий пароль» |
| Type wrong current → submit | 400 inline under «Текущий пароль», field cleared |
| Type «short» as new password | Rules list shows red ○; submit disabled |
| Type valid new + non-matching confirm | «Пароли не совпадают»; submit disabled |
| Type matching valid new + confirm | All rules ✓; submit enabled |
| Submit | Spinner «Меняем…» → green «✓ Пароль изменён…» → redirect to `/login.html` after ≈1.5 s |
| Check `localStorage` in DevTools | `admin_token` and `refresh_token` removed |
| Login with old password | 401 |
| Login with new password | 200, lands on admin |

- [ ] **Step 4: Verify SQL state**

```bash
docker exec infrasafe-postgres-1 psql -U postgres -d infrasafe -c \
  "SELECT username, password_changed_at FROM users ORDER BY user_id DESC LIMIT 3;"
```

Expected: the test user's `password_changed_at` is a recent timestamp (≈ minutes ago).

- [ ] **Step 5: Final review of commit chain**

```bash
git log --oneline -15
```

Expected chain (top to bottom):

```
<sha> test(auth): e2e — password change happy path + edge cases
<sha> feat(admin): wire up password-change modal in admin-auth.js
<sha> feat(admin): password-change modal markup + styles
<sha> feat(auth): apply passwordChangeLimiter to /change-password route
<sha> feat(auth): add dedicated passwordChangeLimiter (5/15min)
<sha> feat(auth): refreshToken repeats cutoff check (defense in depth)
<sha> feat(auth): cutoff check in authenticateJWT + authenticateRefresh
<sha> feat(auth): _isIssuedBeforeCutoff helper for JWT-cutoff check
<sha> feat(auth): invalidate user cache after password change
<sha> feat(auth): include password_changed_at in findUserById SELECT
<sha> feat(auth): map INVALID_PASSWORD service error to 400 in controller
<sha> feat(auth): tag validatePassword failures with INVALID_PASSWORD code
<sha> feat(db): migration 016 — users.password_changed_at column
```

13 atomic commits, each independently testable and revertible.

---

## Acceptance Criteria (from spec)

- [ ] `users.password_changed_at` column present after migration 016 / init/08 applied
- [ ] Admin can open modal from `admin.html` header
- [ ] Live validation reflects all 4 password rules
- [ ] Submit disabled until form valid
- [ ] On success: `users.password_changed_at` ≈ NOW() (verified via SQL)
- [ ] On success: `localStorage.admin_token` and `refresh_token` are cleared (verified in DevTools)
- [ ] On success: admin redirected to `/login.html` within 2 s
- [ ] After redirect: visiting `/admin.html` does NOT bypass login (because token is gone)
- [ ] Old access token (issued before change) → 401 on any authenticated route
- [ ] Old refresh token (issued before change) → 401 on `/refresh`
- [ ] Old password → 401 at login
- [ ] New password → 200 at login
- [ ] 6th rapid POST → 429
- [ ] Weak new password → 400 (not 500)
- [ ] Bundle rebuilt — `public/dist/admin-auth.js` reflects new code
- [ ] All new tests pass; no existing tests regress
