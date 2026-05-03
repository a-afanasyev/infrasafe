-- Migration 012: TOTP Two-Factor Authentication
-- Adds 2FA support fields to users table

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255),
    ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS recovery_codes JSONB;

-- Index for quick lookup of 2FA-enabled users
CREATE INDEX IF NOT EXISTS idx_users_totp_enabled ON users (totp_enabled) WHERE totp_enabled = true;

COMMENT ON COLUMN users.totp_secret IS 'AES-256-GCM encrypted TOTP secret';
COMMENT ON COLUMN users.totp_enabled IS 'Whether 2FA is active for this user';
COMMENT ON COLUMN users.recovery_codes IS 'Array of bcrypt-hashed one-time recovery codes';
