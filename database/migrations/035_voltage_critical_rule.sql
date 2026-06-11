-- 035 [AUD-006] CRITICAL VOLTAGE_ANOMALY alert rule — voltage escalate-in-place.
--
-- Escalate-in-place (alertService._escalateAlert) requires a policy row for the
-- TARGET severity; with only the WARNING rule (seeded in 011), a WARNING voltage
-- alert worsening to CRITICAL had no CRITICAL policy → escalation fail-closed.
-- This adds the CRITICAL rule so the upgrade can run (gates + UK urgency).
--
-- Forward-policy (roll-forward-only, see migrations/README): this migration is
-- TRANSACTIONAL (its own BEGIN/COMMIT — partial failure rolls back, re-apply is
-- clean) and BACKWARD-COMPATIBLE (additive INSERT only; the old app tolerates an
-- extra alert_rules row). Applied by scripts/migrate.sh (PR-1a runner), not by a
-- manual psql накат.
--
-- min_persistence_seconds = 10 is set EXPLICITLY: a new row would otherwise inherit
-- the column DEFAULT 60 (migration 024), but 024 lowered CRITICAL rules to 10s, so
-- we match that intent for the new row. Other policy columns use their 024 defaults
-- spelled out for clarity. `enabled` defaults true.
--
-- Idempotent via ON CONFLICT (alert_type, severity) DO NOTHING — re-running (or a
-- fresh DB that already seeded it) is a no-op.

BEGIN;

INSERT INTO alert_rules
    (alert_type, severity, uk_category, uk_urgency, description,
     min_persistence_seconds, min_affected_buildings, verification_grace_seconds,
     verification_window_seconds, max_reopens_per_24h, reopen_cooldown_min, reopen_urgency_bump)
VALUES
    ('VOLTAGE_ANOMALY', 'CRITICAL', 'Электрика', 'critical', 'Критическая аномалия напряжения',
     10, 1, 300, 600, 3, 30, true)
ON CONFLICT (alert_type, severity) DO NOTHING;

COMMIT;
