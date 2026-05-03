-- Migration 013 — persistent account lockout (SEC-NEW-004 / Phase 12B.3)
--
-- Rationale: account lockout counters were stored in cacheService (in-memory Map
-- with optional Redis). Without mandatory Redis, a process restart or scale-out
-- reset all counters — effectively unlimited brute-force attempts.
--
-- Persistent storage in PostgreSQL: survives restarts, shared across app
-- instances behind the same DB.
--
-- Keyed by `login` (not user_id) because lockout is enforced BEFORE user
-- lookup, which also prevents username-enumeration timing attacks.

CREATE TABLE IF NOT EXISTS account_lockout (
    login              VARCHAR(255) PRIMARY KEY,
    failed_attempts    INTEGER      NOT NULL DEFAULT 0,
    first_attempt_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_attempt_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    locked_until       TIMESTAMPTZ  NULL
);

-- Partial index: only locked accounts need fast scans (for future cleanup jobs).
CREATE INDEX IF NOT EXISTS idx_account_lockout_locked_until
    ON account_lockout(locked_until)
    WHERE locked_until IS NOT NULL;

-- Covers cleanup by age.
CREATE INDEX IF NOT EXISTS idx_account_lockout_last_attempt
    ON account_lockout(last_attempt_at);

COMMENT ON TABLE account_lockout IS
    'SEC-NEW-004: persistent brute-force protection; survives restart / scale-out.';
