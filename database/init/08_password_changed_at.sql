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
