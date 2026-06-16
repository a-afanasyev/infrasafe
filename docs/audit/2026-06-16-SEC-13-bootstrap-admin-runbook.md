# SEC-13 — Bootstrap the first admin (DR runbook)

**Status:** READY · **Date:** 2026-06-16

## Problem

User registration hardcodes `role = 'user'` (`src/controllers/authController.js:94`),
and the production database bootstrap (`database.sql`) ships **no seed users**.
So on a fresh prod DB — or a disaster-recovery rebuild — there is **no
application path** to create the very first admin. This runbook closes that gap
using the bootstrap CLI `src/cli/create-admin.js` (SEC-13).

## Preconditions

- **Canonical / migrated schema only.** The CLI inserts `users.password_hash` +
  `users.is_active`. The raw `database.sql` legacy schema (`users.password` /
  `users.active`) is deliberately fail-close — **run migrations first**
  (`scripts/migrate.sh up`) so the canonical columns exist. Fresh-unified
  `database.sql` bootstrap is a separate follow-up.
- App image is deployed and the `app` container is running (the CLI ships
  inside the immutable image under `src/` — `scripts/` is not shipped).
- You can reach the host and run `docker compose ... exec`.

## Procedure

1. **Choose credentials.** Pick the admin username + email. Pick a strong
   password (≥8 chars, with upper + lower + digit — enforced by the CLI).

2. **Run the CLI inside the app container.** Pass the password via the
   `ADMIN_PASSWORD` env (NEVER as an argv — argv is visible in `ps`):

   ```bash
   docker compose -f docker-compose.unified.yml exec \
     -e ADMIN_PASSWORD='<strong-password>' \
     app node src/cli/create-admin.js <username> <email>
   ```

   Omit `-e ADMIN_PASSWORD=...` to be prompted interactively (echo is muted).

   Expected output:
   ```
   Admin created: <username> <<email>> (user_id=N). Log in, complete 2FA setup, then change the password.
   ```

   Outcomes & exit codes:
   - `0` — admin **created**.
   - `0` — **already exists** (same username AND email) → idempotent, no change.
   - `≠0` — error (a different admin exists / username taken by a non-admin /
     email in use / same username but different email = likely typo / weak
     password). The CLI runs under a transaction + advisory lock, so two
     concurrent runs cannot both insert.

3. **Verify login + complete mandatory 2FA.** Admin accounts require TOTP. Log
   in at `/login.html`; the first login returns `requires2FASetup` → scan the
   QR (`/auth/setup-2fa`) → confirm a code (`/auth/confirm-2fa`). 2FA is now
   active for the account.

4. **Rotate the bootstrap password.** Change the password from the one used
   here via the normal app flow. (The bootstrap password may have been typed on
   a shared shell / recorded in deploy notes.)

5. **Create any further admins via the app**, not this CLI — it refuses to run
   once any admin exists.

## Notes

- The CLI reuses `authService.hashPassword` (bcrypt cost 12) and
  `authService.validateUserData` — identical hashing/validation to normal
  registration. No password is logged.
- The dev/test seed admin (`admin`/`admin123`, `database/init/02_seed_data.sql`)
  is unrelated to prod — prod init does not execute the seed. It is kept only
  for the test suite + E2E `globalSetup`.

## Follow-up

- **B-item (not in this change):** fresh-unified DB bootstrap directly from
  `database.sql` (legacy `password`/`active`, currently fail-close — see
  `migrateBootstrapManifest.test.js`). Until then, migrate-then-bootstrap is
  the supported path.
