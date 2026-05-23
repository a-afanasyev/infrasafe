-- Migration 024: alert_rules extensions for Sprint 10
-- Adds persistence + reopen-policy columns to support trigger-gate and
-- verification cycle (post-resolve sensor re-check + auto-reopen).
--
-- Context: Sprint 9 made the UK integration bidirectional but every WARNING+
-- alert escalates to a УК request, including transient flashes. Sprint 10
-- introduces per-rule gates:
--   - min_persistence_seconds: how long the condition must persist before we
--     create an alert (and thus escalate to UK).
--   - min_affected_buildings: don't escalate single-building blips on shared
--     infrastructure.
--   - verification_*: after UK closes the ticket, re-check the sensor after
--     grace_seconds, look for fault within window_seconds, reopen if found.
--   - max_reopens_per_24h + reopen_cooldown_min: protect against reopen floods
--     from stuck sensors → escalate to engineer_required category instead.
--   - reopen_urgency_bump: re-opened tickets get +1 urgency tier (capped at
--     Критическая) so УК dispatcher sees this is a repeat issue.
--
-- All columns NOT NULL with conservative defaults so existing rules continue
-- to work unchanged. Per-rule tuning via Sprint 10 PR-5 admin UI.

BEGIN;

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS min_persistence_seconds INT NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS min_affected_buildings INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS verification_grace_seconds INT NOT NULL DEFAULT 300,
    ADD COLUMN IF NOT EXISTS verification_window_seconds INT NOT NULL DEFAULT 600,
    ADD COLUMN IF NOT EXISTS max_reopens_per_24h INT NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS reopen_cooldown_min INT NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS reopen_urgency_bump BOOLEAN NOT NULL DEFAULT true;

-- Business-aligned per-severity / per-type tuning (from Sprint 10 biz-analyst
-- decision matrix). CRITICAL alerts need fast escalation; WARNING absorbs
-- typical flap. LEAK_DETECTED gets shorter persistence even at WARNING because
-- water damage compounds with time.
UPDATE alert_rules SET min_persistence_seconds = 10 WHERE severity = 'CRITICAL';
UPDATE alert_rules SET min_persistence_seconds = 60 WHERE severity = 'WARNING';
UPDATE alert_rules SET min_persistence_seconds = 15 WHERE alert_type = 'LEAK_DETECTED' AND severity = 'WARNING';

-- Sanity check: all existing rules now have sensible defaults
DO $$
DECLARE
    bad_count INT;
BEGIN
    SELECT COUNT(*) INTO bad_count
    FROM alert_rules
    WHERE min_persistence_seconds NOT BETWEEN 1 AND 3600
       OR verification_grace_seconds NOT BETWEEN 60 AND 1800
       OR verification_window_seconds NOT BETWEEN 60 AND 3600
       OR max_reopens_per_24h NOT BETWEEN 0 AND 20;
    IF bad_count > 0 THEN
        RAISE EXCEPTION 'Migration 024 sanity check failed: % rules have out-of-range values', bad_count;
    END IF;
END $$;

COMMIT;
