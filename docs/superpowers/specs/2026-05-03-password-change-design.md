# Password Change for Admin (Phase 13)

**Status:** Draft v2 (revised after code-review 2026-05-03)
**Owner:** Andrey Afanasyev
**Scope:** Phase 13 — single feature, ~1 day of work

## Summary

Add a password change flow for the `admin` role through the legacy admin panel (`admin.html`). Surfaces and fixes a latent backend bug (`password_changed_at` column referenced by service code but never declared in schema), wires global JWT invalidation to the new column (so a single `UPDATE` kills every previously-issued access and refresh token for that user), adds a dedicated rate limiter for the endpoint, and converts the bare `Error` from `validatePassword` into a proper 400 response.

## Goals

- Admin can change their own password from `admin.html` without leaving the panel.
- Successful change immediately invalidates **all** JWTs (access **and** refresh) issued before the change — admin is forced to re-login on every device.
- The current device, where the change happened, also re-authenticates: `localStorage` is cleared and admin lands on `/login.html`.
- Strong client-side feedback on password rules — no round-trip required for obvious failures.
- Fix the broken `password_changed_at` column so the existing service code actually persists.
- Use a dedicated `passwordChangeLimiter` (separate from login-limiter) so password-change attempts cannot exhaust the login-attempt budget.
- Weak-password errors return 400, not 500.

## Non-goals

- **Operator/user roles.** They have no UI on `main` (only `admin.html` and the public map). Future work after `frontend-design/` merges. Endpoint already accepts any authenticated JWT, so API-level support is unblocked.
- **Forgot-password / email reset flow.** Out of scope.
- **Force-change-on-first-login** flag.
- **2FA re-verification at password change.** Login already requires TOTP; current password is sufficient inside an authenticated session.
- **Password history (prevent reuse of last N).**
- **Strength-meter beyond the 4-rule checklist.**
- **Per-token blacklist** approach. Rejected: refresh tokens are stateless JWTs not stored in `refresh_tokens` (verified in authService.js#refreshToken); per-token blacklist would require iterating an unknown set of tokens. Replaced by `password_changed_at`-cutoff check.

## Architecture

```text
admin.html [header]
  ├─ existing fixed #logout-btn
  └─ NEW button "🔑 Сменить пароль"
       └─ click → <dialog id="change-password-modal">
            └─ submit → POST /api/auth/change-password
                 ├─ 200 → green banner "Перенаправление…" 1.5s
                 │         → window.adminAuth.logout()
                 │              → localStorage.removeItem('admin_token')
                 │              → localStorage.removeItem('refresh_token')
                 │              → restore window.fetch
                 │              → window.location.replace('/login.html')
                 ├─ 400 INVALID_CURRENT_PASSWORD → inline under "Текущий пароль"
                 ├─ 400 INVALID_PASSWORD          → inline under "Новый пароль"
                 ├─ 401                            → existing 401-handler in admin-auth.js
                 ├─ 429                            → toast + cooldown from Retry-After
                 └─ 500/network                    → toast "Не удалось…"
```

### JWT invalidation strategy: `password_changed_at`-cutoff

Refresh tokens in InfraSafe are **stateless JWTs** signed with `JWT_REFRESH_SECRET` (verified `authService.js:202–210`). They are not persisted to a server-side table for verification — `refresh_tokens` exists in schema but is unused in the auth flow. There is therefore no "list of tokens to delete" we could `DELETE FROM`. Per-token blacklist would require knowing every outstanding refresh hash, which we do not.

The standard pattern for stateless JWT bulk invalidation is a per-user epoch: store a timestamp in the user row and reject any token whose `iat` (issued-at) precedes it. Since `password_changed_at` already needs to exist (Phase 13 fixes the latent bug), it becomes our cutoff:

- On `changePassword`: `UPDATE users SET password_hash=$1, password_changed_at=NOW() WHERE user_id=$2`
- In JWT auth middleware and refresh flow: if `decoded.iat * 1000 < user.password_changed_at - CLOCK_SKEW_MS` → reject the token as stale

This is one UPDATE, no transaction needed, invalidates every access and refresh token for that user atomically. Access tokens remain valid for their natural lifetime (1h default) only when issued AFTER the password change.

Clock skew tolerance: 5 seconds (constant `JWT_CUTOFF_SKEW_MS = 5000`). Generous enough for replica clock drift, short enough that a stolen token can't be replayed long after revocation.

## Decisions (from brainstorming)

| Question | Decision | Rationale |
| --- | --- | --- |
| Scope | Admin only, in `admin.html` | Demo audience is admin; operator/user UI lives in unmerged `frontend-design/`. |
| Session handling on success | Invalidate ALL JWTs via `password_changed_at` cutoff + force `logout()` on this device | Stateless JWTs cannot be deleted; cutoff-check is the standard pattern. |
| 2FA at change time | Not required (current password only) | TOTP at login is the gate; bcrypt verify suffices for in-session step-up. |
| Placement in UI | Single button in header (not dropdown, not new tab) | Minimal diff to existing layout. |

## Backend changes

### 1. Migration 016 — `password_changed_at` column

**`database/migrations/016_password_changed_at.sql`** (new):

```sql
-- Migration 016 — password change audit timestamp + JWT invalidation cutoff
-- Fixes a latent bug: src/services/authService.js#changePassword writes to
-- users.password_changed_at, but the column was never declared. Phase 13
-- additionally repurposes the column as a per-user JWT-cutoff (auth
-- middleware / refresh flow reject tokens whose iat precedes this
-- timestamp), which is how we bulk-
-- invalidate every access and refresh token for a user when their password
-- changes.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.password_changed_at IS
    'Timestamp of last password change. Used as JWT-cutoff: tokens with iat earlier than this value are rejected as expired. NULL means no cutoff (column unset for legacy users).';
```

**Mirror → `database/init/08_password_changed_at.sql`** (verbatim copy, follows the init/03–07 convention from commit 04967f7).

### 2. Service — `changePassword` simplification

**`src/services/authService.js#changePassword()`** — remove the (intended) DELETE FROM refresh_tokens. Single UPDATE is sufficient because invalidation now happens through the cutoff-check. Make sure validatePassword failure carries a `code` for the controller:

```js
// Inside the existing try/catch, after verifying current password:

// Validate the new one and tag the error so the controller knows it's a 400
try {
    this.validatePassword(newPassword);
} catch (err) {
    err.code = 'INVALID_PASSWORD';
    throw err;
}

const hashedNewPassword = await this.hashPassword(newPassword);
await db.query(
    'UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE user_id = $2',
    [hashedNewPassword, userId]
);
```

No transaction needed — single UPDATE.

**Note (verified 2026-05-03):** the project's db module is `src/config/database.js` and exports `{ init, query, getPool, close }` with no `transaction()` helper. The previous draft of this spec called for a transaction; that requirement is dropped because the bulk-invalidation no longer requires DELETE FROM.

### 3. Auth middleware + refresh flow — cutoff check

The actual request gate on `main` is `src/middleware/auth.js` (`authenticateJWT` for access tokens, `authenticateRefresh` for refresh), so the cutoff check must live there. `authService.refreshToken()` should repeat the same check after user lookup as defense in depth.

**`src/middleware/auth.js`** and **`src/services/authService.js`** — add a shared cutoff helper:

```js
// Constant near top of file
const JWT_CUTOFF_SKEW_MS = 5000;

// Helper, used by authenticateJWT/authenticateRefresh/refreshToken
_isIssuedBeforeCutoff(decoded, user) {
    if (!user.password_changed_at) return false;          // legacy users with no cutoff
    if (typeof decoded.iat !== 'number') return true;      // malformed token, reject
    const issuedAtMs = decoded.iat * 1000;
    const cutoffMs = new Date(user.password_changed_at).getTime() - JWT_CUTOFF_SKEW_MS;
    return issuedAtMs < cutoffMs;
}
```

**Step 0 — extend `findUserById` SQL** (around line 393):
The current SELECT excludes `password_changed_at`. Add it to the column list so the cached user object carries the cutoff timestamp. Cache TTL=300s, so combined with the post-UPDATE invalidate from §2 the new column is guaranteed fresh on the very next auth check.

In `authenticateJWT` (middleware), after `findUserById`:

```js
const user = await authService.findUserById(decoded.user_id);
if (!user || !user.is_active) { /* existing throw */ }

if (authService._isIssuedBeforeCutoff(decoded, user)) {
    return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
    });
}
```

In `authenticateRefresh` (middleware) — same check, return 401 before the controller runs.

In `refreshToken` (service) — repeat the same check after JWT signature verification but before issuing new tokens. Lookup user by `decoded.user_id` (single SELECT), apply `_isIssuedBeforeCutoff`, throw `INVALID_REFRESH_TOKEN` if before cutoff.

**Caveat about `findUserById` cache:** the service caches user objects for 300 seconds. After `changePassword`, we MUST invalidate that cache so the next verify sees the fresh `password_changed_at`. Add at the end of `changePassword`:

```js
await cacheService.invalidate(`${this.cachePrefix}:user:${userId}`);
```

### 4. Controller — handle `INVALID_PASSWORD`

**`src/controllers/authController.js#changePassword`** (around line 209) — add the missing branch:

```js
// Existing branches:
if (error.code === 'USER_NOT_FOUND')         return res.status(404).json({ error: error.message });
if (error.code === 'INVALID_CURRENT_PASSWORD') return res.status(400).json({ error: error.message });
// New:
if (error.code === 'INVALID_PASSWORD')        return res.status(400).json({ error: error.message });
```

Without this branch, weak-password errors fall through to `next(error)` → `errorHandler` → 500 (verified `errorHandler.js:15`: `err.statusCode || 500`).

### 5. Route — dedicated `passwordChangeLimiter`

**`src/middleware/rateLimiter.js`** — add a new limiter scoped to the change-password endpoint, to avoid exhausting the login budget:

```js
const passwordChangeLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Слишком много попыток смены пароля. Попробуйте через 15 минут.',
    // Per-IP + per-user so two admins on the same NAT don't lock each other out
    keyGenerator: (req) => {
        const ip = req.ip || req.connection.remoteAddress;
        const userId = req.user ? req.user.user_id : 'anonymous';
        return `auth:change-password:${ip}:${userId}`;
    }
});
```

Export it from `module.exports` (line 370+) AND register it with the existing aggregate helpers for consistency with the other limiters: `getAllRateLimitStats()` (line ≈330), `resetAllRateLimits()` (line ≈347), `destroyAllLimiters()` (line ≈359).

**`src/routes/authRoutes.js`** — apply the new limiter:

```js
const { authLimiter, registerLimiter, passwordChangeLimiter } = require('../middleware/rateLimiter');
// ...
router.post('/change-password', passwordChangeLimiter.middleware(), authController.changePassword);
```

(Note: `req.user` is set by the authenticate middleware that runs before per-route middleware; the keyGenerator runs at request time, not router-build time, so this works.)

### 6. Token blacklist — explicitly NOT used

`token_blacklist` table exists for `refreshToken` rotation (one-shot consume). We do **not** populate it on password change — the cutoff check covers all tokens uniformly without needing per-token bookkeeping.

## Frontend changes

### 7. `admin.html` — header button + dialog

In the `.admin-header` block, add the button **after** the `<h1>`. Do not describe it as “between title and logout”: `#logout-btn` is injected later by `admin-auth.js` and positioned `fixed`.

```html
<button id="btn-change-password" class="btn-secondary" type="button">
    🔑 Сменить пароль
</button>
```

Append a `<dialog>` element near the bottom of `<body>` (before `</body>`):

```html
<dialog id="change-password-modal" class="modal-dialog">
    <form id="change-password-form">
        <h3>Сменить пароль</h3>
        <label>Текущий пароль
            <input type="password" id="cp-current" autocomplete="current-password" required>
        </label>
        <p class="error-text" id="cp-current-error" hidden></p>

        <label>Новый пароль
            <input type="password" id="cp-new" autocomplete="new-password" required minlength="8">
            <button type="button" id="cp-toggle-visibility" aria-label="Показать пароль">👁</button>
        </label>
        <ul class="password-rules" id="cp-rules">
            <li data-rule="length">≥ 8 символов</li>
            <li data-rule="lower">есть строчная буква</li>
            <li data-rule="upper">есть заглавная буква</li>
            <li data-rule="digit">есть цифра</li>
        </ul>

        <label>Подтвердите новый пароль
            <input type="password" id="cp-confirm" autocomplete="new-password" required>
        </label>
        <p class="error-text" id="cp-confirm-error" hidden></p>

        <p class="warning-text">
            ⚠ После смены пароля все сессии будут завершены — войдите заново.
        </p>

        <p class="error-text" id="cp-server-error" hidden></p>

        <div class="modal-actions">
            <button type="button" id="cp-cancel" class="btn-secondary">Отмена</button>
            <button type="submit" id="cp-submit" class="btn-primary" disabled>Сменить пароль</button>
        </div>
    </form>
</dialog>
```

Add the supporting styles to `public/css/admin.css`, not inline in `admin.html`. The current admin panel already keeps button/toast/form styling there.

### 8. `public/admin-auth.js` — wire up the modal and reuse `logout()`

Extend the existing class with `setupChangePassword()`:

- `openModal()` — bind to `#btn-change-password` click; `dialog.showModal()`; focus on `#cp-current`
- `validateLive(event)` — bound to `input` events on all 3 fields:
  - Update `<li>` checklist classes (`.rule-met` / `.rule-missing`) based on regex match
  - Compute submit-disabled
- `submit(event)` — bound to form submit:
  - `preventDefault()`, disable button, show «Меняем…»
  - `fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }, body: JSON.stringify({ currentPassword, newPassword }), signal: AbortSignal.timeout(10000) })`
  - On 200: replace form with green «Перенаправление…» banner; `setTimeout(() => this.logout(), 1500)`
    - **`this.logout()` (already exists at line 50) clears `admin_token` and `refresh_token` from localStorage, restores `window.fetch`, then redirects.** This is what closes the gap that login.html re-redirects back to admin.html when the stale token is still in localStorage.
  - On 400 with body containing «Неверный текущий пароль» (Russian) or matching `error: ...`: show `#cp-current-error`, clear field, focus
  - On 400 with body containing password-rule message: show `#cp-server-error`
  - On 429: toast + disable submit for `retry_after_seconds` / `Retry-After` returned by the limiter
  - On other errors / abort: toast «Не удалось изменить пароль…»

Bundle is rebuilt automatically by `npm run build:frontend`.

## Validation rules

| Field | Client rule | Server rule | Source of truth on mismatch |
| --- | --- | --- | --- |
| Current password | non-empty | bcrypt verify | Server-only (we cannot pre-check). |
| New password length | ≥ 8 | ≥ 8 (`validatePassword`) | Both required for defense-in-depth. |
| New password classes | lower + upper + digit | `(?=.*[a-z])(?=.*[A-Z])(?=.*\d)` | Identical regex on both sides. |
| New ≠ Current | client check | not enforced server-side | Client-only UX hint. |
| Confirm == New | client only | n/a (server doesn't see confirm) | Inline error on confirm field. |

## Error handling matrix

| HTTP | Cause | UI |
| --- | --- | --- |
| 200 | success | Green banner → `adminAuth.logout()` 1.5s later |
| 400 | wrong current (`INVALID_CURRENT_PASSWORD`) | Inline under «Текущий пароль», field cleared, focus returned |
| 400 | weak new (`INVALID_PASSWORD`) | Inline under server-error placeholder |
| 401 | token expired / stale after password change | Existing `admin-auth.js` 401 interceptor → `redirectToLogin()` |
| 429 | rate limit | Toast + disable submit for server-provided retry window |
| 500 / network | unexpected | Toast «Не удалось изменить пароль. Попробуйте ещё раз.» |
| Abort (10s timeout) | hung request | Toast «Превышено время ожидания» |

## Testing

### 9.1 Unit — extend existing files (verified paths)

**`tests/jest/unit/authServiceTest.test.js`** (existing — already has `describe('changePassword')` at line 434 and `describe('changePassword - password_hash row not found')` at line 754; mocks `src/config/database` at line 5):

Add to existing `describe('changePassword')`:

- `tags weak-password error with code='INVALID_PASSWORD'` (new) — verify `err.code` is set so the controller can map to 400
- `updates password_changed_at to NOW() in the UPDATE` (extend existing happy-path assertion)
- `invalidates the user cache after success` — assert `cacheService.invalidate` called with `auth:user:${userId}`

Add a new `describe('refreshToken — password_changed_at cutoff')`:

- accepts refresh token whose `iat` is after `password_changed_at`
- rejects refresh token whose `iat` is before `password_changed_at − 5s skew`
- accepts refresh token when `password_changed_at` is `NULL` (legacy user)
- rejects refresh token with missing/invalid `iat`

**`tests/jest/unit/authMiddleware.test.js`**:

- `authenticateJWT` accepts token whose `iat` is after `password_changed_at`
- `authenticateJWT` rejects token whose `iat` is before `password_changed_at − 5s skew`
- `authenticateJWT` accepts token when `password_changed_at` is `NULL` (legacy user)
- `authenticateRefresh` rejects stale refresh token before controller execution

**`tests/jest/unit/authControllerTest.test.js`** (existing — `describe('changePassword')` at line 391):

Add:

- `responds 400 when service throws INVALID_PASSWORD` (new branch)
- Update existing happy-path assertion if response shape changes (it doesn't — still `{ success: true, message: 'Password changed successfully' }`)

### 9.2 E2E — extend `tests/jest/e2e/auth.e2e.test.js`

Existing file already covers login/profile/refresh/logout against the real running stack. Extend it with:

```js
describe('POST /api/auth/change-password', () => {
    test('changes password and invalidates old tokens', async () => {
        // 1. login → access1, refresh1
        // 2. POST /change-password (Bearer access1) { currentPassword, newPassword }
        //    → 200 success
        // 3. GET /api/auth/profile (Bearer access1) → 401 (cutoff invalidated)
        // 4. POST /refresh (refresh1) → 401
        // 5. login(old password) → 401
        // 6. login(new password) → 200
        // 7. cleanup: restore the original password for the shared admin account
    });

    test('returns 400 for wrong current password', async () => { ... });
    test('returns 400 for weak new password', async () => { ... });
    test('returns 429 after 6 rapid attempts (limit=5/15min)', async () => { ... });
});
```

### 9.3 Manual smoke (chrome-devtools MCP)

Before merge, walk through the following steps on the demo stack:

| Step | Expected |
| --- | --- |
| Login admin/admin123 → click «Сменить пароль» | Modal opens, focus on «Текущий пароль» |
| Wrong current → submit | Inline error, field cleared, focus returned |
| Weak new («short») | Checklist red, button disabled |
| Mismatched confirm | Inline «Пароли не совпадают» |
| Valid input → submit | Spinner → green «Перенаправление…» → `/login.html` after ≈1.5s |
| `localStorage` after redirect | Empty (`admin_token` and `refresh_token` removed) |
| Login with old password | 401 |
| Login with new password | Success |

Document result in the implementation commit.

### 9.4 Coverage target

≥ 80 % line coverage on `authService.changePassword`, `authService.refreshToken`, and the new stale-token branches in `authMiddleware` (project default).

## Files modified / created

| Type | Path | Action |
| --- | --- | --- |
| 🆕 | `database/migrations/016_password_changed_at.sql` | New |
| 🆕 | `database/init/08_password_changed_at.sql` | New (mirror) |
| ✏️ | `src/services/authService.js` | (a) tag validatePassword error with code, (b) UPDATE password_changed_at, (c) invalidate user cache, (d) cutoff-check helper, (e) wire helper into refreshToken + findUserById select list |
| ✏️ | `src/controllers/authController.js` | Add `INVALID_PASSWORD` → 400 branch |
| ✏️ | `src/middleware/auth.js` | Reject stale access/refresh tokens after password change |
| ✏️ | `src/middleware/rateLimiter.js` | New `passwordChangeLimiter` + export |
| ✏️ | `src/routes/authRoutes.js` | Apply `passwordChangeLimiter` to `/change-password` |
| ✏️ | `admin.html` | Header button + `<dialog>` modal |
| ✏️ | `public/css/admin.css` | Header/modal/password-rule styles |
| ✏️ | `public/admin-auth.js` | `setupChangePassword()` method/wiring |
| ✏️ | `database/migrations/README.md` | Append 016 row, append init/08 row |
| ✏️ | `tests/jest/unit/authServiceTest.test.js` | Extend describe('changePassword') + new describe blocks for cutoff |
| ✏️ | `tests/jest/unit/authControllerTest.test.js` | New `INVALID_PASSWORD → 400` test |
| ✏️ | `tests/jest/unit/authMiddleware.test.js` | New stale-token cases |
| ✏️ | `tests/jest/e2e/auth.e2e.test.js` | New `describe('POST /api/auth/change-password')` |

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Cutoff timestamp + cache returns stale `password_changed_at` | Old tokens still pass after change | `cacheService.invalidate` after UPDATE; cache TTL is short anyway. E2E test verifies token rejection. |
| Clock skew between app replicas | Legitimate fresh tokens rejected | 5 s skew tolerance in helper. Unit boundary case included. |
| Token rotation race during password change | User sees a brief 401 spam | Acceptable — UI immediately redirects to login after success. |
| `findUserById` not updated to select `password_changed_at` | Cutoff logic silently never triggers | Make the select-list change explicit in implementation and cover it with unit tests. |
| `passwordChangeLimiter` per-user blocks legitimate retries | Admin who fat-fingers can lock self out for 15 min | Limit is 5 attempts/15 min — generous; toast tells admin how long to wait. |
| `<dialog>` not supported in Safari < 15 | Modal won't open | Admin panel is internal; targets evergreen browsers (matches existing CLAUDE.md). |
| Live-validation regex drifts from server | Green client, 400 from server | Same regex copy-pasted; E2E test case for weak password catches drift. |

## Estimated effort

- Migration 016 + init/08: 5 min
- Service patch (`changePassword` + cutoff helper + refreshToken wiring + cache invalidate + findUserById select): 60 min
- Controller patch: 5 min
- Auth middleware patch: 20 min
- Rate limiter (new export + apply): 10 min
- Unit tests (cutoff cases + new INVALID_PASSWORD branch): 60 min
- E2E tests: 45 min
- Frontend (HTML + JS + styles): 60 min
- Manual smoke + bundle rebuild: 15 min
- Commit + verification: 10 min
- **Total: ~5 hours**

## Out of scope (explicit)

- Operator/user role UI (deferred until `frontend-design/` merge)
- Forgot password flow
- Email notification on password change
- Password history / reuse prevention
- Step-up auth for other critical operations
- Per-token blacklist on password change (architecturally redundant once cutoff-check is in place)

## Acceptance criteria

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
