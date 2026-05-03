# Password Change for Admin (Phase 13)

**Status:** Draft (brainstormed 2026-05-03)
**Owner:** Andrey Afanasyev
**Scope:** Phase 13 — single feature, ~1 day of work

## Summary

Add a password change flow for the `admin` role through the legacy admin panel (`admin.html`). Surfaces and fixes a latent backend bug (`password_changed_at` column referenced by service code but never declared in schema), adds the missing rate-limiter on the existing endpoint, and revokes all refresh tokens on success so password change forces re-authentication on every device.

## Goals

- Admin can change their own password from `admin.html` without leaving the panel.
- Successful change immediately invalidates all sessions (refresh tokens) for the user — admin is redirected to `/login.html` and must re-authenticate.
- Strong client-side feedback on password rules (live checklist) — no round-trip required for the obvious failures.
- Fix the broken `password_changed_at` column so the existing endpoint actually works.
- Rate-limit `/api/auth/change-password` to match every other auth endpoint.

## Non-goals

- **Operator/user roles.** They do not have a UI on `main` (only `admin.html` and the public map). Their access path will land in the future `frontend-design/` profile page once that branch merges. The endpoint already accepts any authenticated JWT, so API-level support is unblocked.
- **Forgot-password / email reset flow.** Out of scope — admin has direct DB access for recovery.
- **Force-change-on-first-login** flag.
- **2FA re-verification at password change.** Login already requires TOTP; current-password is sufficient to authorize a change once a session exists.
- **Password history (prevent reuse of last N).** YAGNI for demo.
- **Strength-meter beyond the 4-rule checklist.**

## Architecture

```
admin.html [header]
  ├─ existing #logout-btn
  └─ NEW button "🔑 Сменить пароль"
       └─ click → <dialog id="change-password-modal">
            └─ submit → POST /api/auth/change-password
                 ├─ 200 → green banner "Перенаправление…" 1.5s → location.replace('/login.html')
                 ├─ 400 INVALID_CURRENT_PASSWORD → inline under "Текущий пароль"
                 ├─ 400 weak new password    → inline under "Новый пароль"
                 ├─ 401                       → existing 401-handler in admin-auth.js
                 ├─ 429                       → toast + 30s cooldown on submit
                 └─ 500/network               → toast "Не удалось…"
```

## Decisions (from brainstorming)

| Question | Decision | Rationale |
|---|---|---|
| Scope | Admin only, in `admin.html` | Demo audience is admin; operator/user UI lives in unmerged `frontend-design/`. |
| Session handling on success | Revoke ALL refresh tokens, redirect to `/login.html` | Security: kills any stolen refresh; standard pattern (GitHub, Google). |
| 2FA at change time | Not required (current password only) | Stronger defense already provided by mandatory 2FA at login + bcrypt verify. |
| Placement in UI | Single button in header (not dropdown, not new tab) | Minimal diff to existing layout. |

## Backend changes

### 1. Migration 016 — `password_changed_at` column

**`database/migrations/016_password_changed_at.sql`** (new):

```sql
-- Migration 016 — password change audit timestamp
-- Fixes a latent bug: src/services/authService.js#changePassword
-- writes to users.password_changed_at, but the column was never declared.
-- The endpoint has been broken since it was added. Phase 13 surfaces
-- this through the new UI and fixes it.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.password_changed_at IS
    'Timestamp of last password change. NULL for accounts that never changed password.';
```

**Mirror → `database/init/08_password_changed_at.sql`** (verbatim copy, follows the init/03–07 convention established in commit 04967f7).

### 2. Service — atomic UPDATE + token revocation

**`src/services/authService.js#changePassword()`** — wrap UPDATE password and DELETE refresh_tokens in one transaction so a failure in either rolls back both:

```js
// Inside changePassword(), replace the standalone UPDATE with:
await db.transaction(async (client) => {
    await client.query(
        'UPDATE users SET password_hash = $1, password_changed_at = NOW() WHERE user_id = $2',
        [hashedNewPassword, userId]
    );
    // SEC: revoke all refresh tokens — force re-login on every device.
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
});
```

**Note (verified 2026-05-03):** project's db module is `src/config/database.js` and exports `{ init, query, getPool, close }` with **no** `transaction()` helper. Implementation goes straight to the manual `BEGIN/COMMIT/ROLLBACK` pattern via `getPool().connect()` — see `src/models/Building.js:264-266` (`deleteCascade`) for the established convention.

### 3. Route — apply rate limiter

**`src/routes/authRoutes.js:276`**:

```js
// Before:
router.post('/change-password', authController.changePassword);

// After:
router.post('/change-password', authLimiter.middleware(), authController.changePassword);
```

`authLimiter` is already imported and applied to every other auth endpoint — this was a single missed line.

### 4. Token blacklist — explicitly NOT done

The current access token (≤15 min lifetime) is not blacklisted. Rationale: revoking refresh_tokens prevents new access tokens; the existing one expires in minutes and the user is being redirected to /login anyway. Adding blacklist machinery here is not justified for the demo.

## Frontend changes

### 5. `admin.html` — header button + dialog

In the `.admin-header` block, add **between** the panel title and `#logout-btn` (which is created at runtime by `admin-auth.js`):

```html
<button id="btn-change-password" class="btn btn-secondary" type="button">
    🔑 Сменить пароль
</button>
```

Append a `<dialog>` element near the bottom of `<body>` (before `</body>`):

```html
<dialog id="change-password-modal" class="modal-dialog">
    <form method="dialog" id="change-password-form">
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
            <button type="button" id="cp-cancel" class="btn btn-secondary">Отмена</button>
            <button type="submit" id="cp-submit" class="btn btn-primary" disabled>Сменить пароль</button>
        </div>
    </form>
</dialog>
```

Inline `<style>` (in `admin.html` for now, matching how other admin styles are structured) for `.modal-dialog`, `.password-rules`, `.error-text`, `.warning-text`. Tokens reused from existing CSS variables (`--color-primary`, `--space-md`, etc.).

### 6. `public/admin-auth.js` — wire up the modal

Extend `AdminAuth` class (or as standalone `setupChangePassword()` method) with:

- `openModal()` — bind to `#btn-change-password` click; `dialog.showModal()`; focus on `#cp-current`
- `validateLive(event)` — bound to `input` events on all 3 fields:
  - Update `<li>` checklist classes (`.rule-met` / `.rule-missing`) based on regex match
  - Compute submit-disabled: all fields filled, new differs from current, new matches confirm, all 4 rules met
- `submit(event)` — bound to form submit:
  - `preventDefault()`, disable button, show spinner-state «Меняем…»
  - `fetch('/api/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }, body: JSON.stringify({ currentPassword, newPassword }), signal: AbortSignal.timeout(10000) })`
  - On 200: replace form with green «Перенаправление…» banner; `setTimeout(() => location.replace('/login.html'), 1500)`
  - On 400 with `error: 'Неверный текущий пароль'` (or matching `error.code` if backend returns it): show `#cp-current-error`, clear field, focus
  - On 400 weak password: show `#cp-server-error` with the message text
  - On 429: toast «Слишком много попыток. Попробуйте через минуту.»; disable submit for 30s
  - On any other error / abort: toast «Не удалось изменить пароль. Попробуйте ещё раз.»

Bundle is rebuilt automatically by `npm run build:frontend` (postinstall and dev watch covered).

## Validation rules

| Field | Client rule | Server rule | Mismatch behaviour |
|---|---|---|---|
| Current password | non-empty | bcrypt verify | Server-only signal (we cannot pre-check). |
| New password length | ≥ 8 | ≥ 8 (`validatePassword`) | Both required for defense-in-depth. |
| New password classes | lower + upper + digit | `(?=.*[a-z])(?=.*[A-Z])(?=.*\d)` | Identical regex on both sides. |
| New ≠ Current | client check | not enforced server-side | Optional UX only — bcrypt would happily accept same-as-current; we choose to forbid client-side as a hint. |
| Confirm == New | client only | n/a (server doesn't see confirm) | Inline error on confirm field. |

## Error handling matrix

| HTTP | Cause | UI |
|---|---|---|
| 200 | success | Green banner + redirect 1.5s later |
| 400 | wrong current | Inline under «Текущий пароль», field cleared, focus returned |
| 400 | weak new | Inline under server-error placeholder |
| 401 | token expired | Existing `admin-auth.js` 401 interceptor → redirect to /login.html |
| 429 | rate limit | Toast + 30s submit cooldown |
| 500 / network | unexpected | Toast «Не удалось изменить пароль. Попробуйте ещё раз.» |
| Abort (10s timeout) | hung request | Toast «Превышено время ожидания» |

## Testing

### Unit tests — `tests/jest/unit/authService.test.js`

Add `describe('changePassword')` block:

- rejects with INVALID_CURRENT_PASSWORD when current is wrong
- rejects with USER_NOT_FOUND when user is missing
- rejects with weak-password error when new < 8 chars
- rejects when new password lacks upper/lower/digit
- updates password_hash and password_changed_at on success
- **deletes ALL refresh tokens for user on success** (new)
- **rolls back password update if refresh token revocation fails** (new — verifies transaction atomicity)

Mocks `src/utils/db` (or its transaction helper).

### Integration tests — `tests/jest/integration/auth.test.js`

New `describe('POST /api/auth/change-password')`:

```
1. login(admin/admin123)         → { accessToken, refreshToken }
2. change-password(accessToken, "admin123", "NewPass123")
                                 → 200 success
3. refresh(old refreshToken)     → 401 (refresh tokens were revoked)
4. login(admin/admin123)         → 401 (old password no longer works)
5. login(admin/NewPass123)       → 200 (new password works)
```

Plus dedicated cases:
- 6 rapid POSTs → last returns 429
- weak new password → 400
- wrong current → 400

### Manual smoke (chrome-devtools MCP)

7-step manual test before commit (see "5.3 Frontend-тесты" of brainstorming notes — folded into this spec). Result documented in commit message.

### Coverage target

≥ 80% line coverage on `authService.changePassword` (project default).

## Files modified / created

| Type | Path | Action |
|---|---|---|
| 🆕 | `database/migrations/016_password_changed_at.sql` | New |
| 🆕 | `database/init/08_password_changed_at.sql` | New (mirror) |
| ✏️ | `src/services/authService.js` | Wrap in transaction + DELETE refresh_tokens |
| ✏️ | `src/routes/authRoutes.js` | Add `authLimiter.middleware()` to /change-password |
| ✏️ | `admin.html` | Header button + `<dialog>` modal + inline styles |
| ✏️ | `public/admin-auth.js` | `setupChangePassword()` method/wiring |
| ✏️ | `database/migrations/README.md` | Append 016 row, append init/08 row |
| 🆕 | `tests/jest/unit/authService.test.js` (already exists; extend) | + 7 tests |
| 🆕 | `tests/jest/integration/auth.test.js` (new — only `api.test.js` and `default-deny.test.js` exist today) | + change-password describe block |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Transaction atomicity | Atomic UPDATE+DELETE required | Confirmed there is **no** `db.transaction()` helper in `src/config/database.js`. Implementation uses manual `BEGIN/COMMIT/ROLLBACK` via `getPool().connect()` — pattern matches `src/models/Building.js:264-266` (`deleteCascade`). |
| Migration 016 ordering — if a long-lived prod DB never ran it, Phase 13 service code crashes | 500 on every change-password call | Both `migrations/016` (apply manually on long-lived DBs per migrations/README.md) and `init/08` (auto-apply on fresh installs) — covers both deployment topologies. |
| Browser native `<dialog>` not supported in older Safari | Modal won't open | Project README already targets evergreen browsers; admin panel is internal tool. Verified Safari 15+ support. |
| Live validation regex differs from server | UX shows green but server rejects | Identical regex copy-pasted into both files; integration test catches drift. |
| Rate limiter triggers during demo | Admin can't change password during live demo | `authLimiter` is 5/15min by current config — fine for demo. Toast message tells admin to wait. |
| Token revoke deletes mid-session of OTHER admin | Two admins logged in, one changes password — but it's their OWN session, not other admin's | DELETE is scoped to `WHERE user_id = $1` — only affects the user who changed their password. Other admins' sessions unaffected. |

## Estimated effort

- Migration 016 + init/08: 5 min
- Service + route patch: 15 min
- Unit tests (7): 30 min
- Integration tests: 30 min
- Frontend (HTML + JS + styles): 60 min
- Manual smoke + bundle rebuild: 15 min
- Commit + verification: 10 min
- **Total: ~3 hours**

## Out of scope (explicit)

- Operator/user role UI (deferred until `frontend-design/` merge)
- Forgot password flow
- Email notification on password change
- Password history / reuse prevention
- Step-up auth on critical operations (would be a broader feature)
- Audit log entry to `integration_log` or new `auth_audit` table — `password_changed_at` column already gives us the most-recent timestamp per user

## Acceptance criteria

- [ ] Admin can open modal from `admin.html` header
- [ ] Live validation reflects all 4 password rules
- [ ] Submit disabled until form valid
- [ ] Successful change → all refresh tokens for that user deleted (verified in DB)
- [ ] Successful change → admin redirected to /login.html within 2s
- [ ] Old password no longer accepted at login
- [ ] New password accepted at login
- [ ] 429 returned after 6th rapid attempt
- [ ] Bundle rebuilt — `public/dist/admin-auth.js` reflects new code
- [ ] All new tests pass; no existing tests regress
- [ ] `password_changed_at` column populated after change (verified via SQL)
