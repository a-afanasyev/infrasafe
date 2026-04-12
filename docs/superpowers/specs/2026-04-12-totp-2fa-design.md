# TOTP 2FA for InfraSafe — Design Spec

**Date:** 2026-04-12
**Status:** Approved

## Goal

Add TOTP-based two-factor authentication. Mandatory for admin users, optional for others.

## Flow

### Login with 2FA enabled
1. `POST /auth/login` (username+password) → `{ requires2FA: true, tempToken }`
2. `POST /auth/verify-2fa` (tempToken + code) → full JWT + refreshToken

### First admin login (2FA not yet set up)
1. `POST /auth/login` → `{ requires2FASetup: true, tempToken }`
2. `POST /auth/setup-2fa` (tempToken) → `{ qrCodeUrl, secret, recoveryCodes[8] }`
3. `POST /auth/confirm-2fa` (tempToken + code) → activates 2FA + full JWT

### Recovery code usage
- `POST /auth/verify-2fa` accepts recovery code instead of TOTP code
- Recovery code is single-use, removed after successful verification

## Database Changes

Migration `012_totp_2fa.sql` — add to `users` table:
- `totp_secret` VARCHAR(255) NULL — AES-256 encrypted TOTP secret
- `totp_enabled` BOOLEAN DEFAULT false
- `recovery_codes` JSONB NULL — array of bcrypt-hashed one-time codes

## New API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/verify-2fa` | tempToken | Verify TOTP code or recovery code |
| POST | `/auth/setup-2fa` | tempToken | Get QR code + secret + recovery codes |
| POST | `/auth/confirm-2fa` | tempToken | Confirm setup, activate 2FA |
| POST | `/auth/disable-2fa` | JWT + password | Disable 2FA (non-admin only) |

## Modified Files

- `src/services/authService.js` — login flow change, new TOTP methods
- `src/routes/authRoutes.js` — new routes
- `src/middleware/auth.js` — `authenticateTempToken` middleware
- `public/login.html` — 2FA code input step, QR setup screen
- `public/admin-auth.js` — handle 2FA flow in JS

## Security

- TOTP secret encrypted with AES-256-GCM (key from ENV `TOTP_ENCRYPTION_KEY`)
- Recovery codes stored as bcrypt hashes
- tempToken: 5-min TTL, scope='2fa', cannot access API
- Rate limit on verify-2fa: 5 attempts / 15 min
- Admin cannot disable their own 2FA via API

## Dependencies

- `otplib` — TOTP generation/verification
- `qrcode` — QR code generation (data URL)
