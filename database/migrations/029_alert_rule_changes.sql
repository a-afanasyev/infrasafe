-- Migration 029: alert_rule_changes audit log (Sprint 10 PR-5)
--
-- Every operator edit of alert_rules (PATCH or toggle) writes one row per
-- changed field — gives admin UI a clear "who/what/when" timeline and
-- enables rollback ("revert to value from 3 days ago"). Critical for
-- compliance + debugging "почему правило сейчас такое".
--
-- Schema design:
--   - rule_id FK with CASCADE delete (if rule is removed, history goes too;
--     no point keeping orphan audit for non-existent rules)
--   - changed_by FK to users.user_id (nullable for system / migration writes)
--   - field_name varchar(50) — matches alert_rules column names
--   - old_value / new_value stored as TEXT (boolean/int/varchar all coerce
--     to string for uniform display)
--   - reason TEXT for optional operator note ("раз в неделю слишком много
--     ложных тикетов по VOLTAGE, поднимаю persistence до 120с")
--
-- Indexes:
--   - rule_id + changed_at DESC: primary access path (admin UI history modal)

BEGIN;

CREATE TABLE IF NOT EXISTS alert_rule_changes (
    id         SERIAL PRIMARY KEY,
    rule_id    INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    changed_by INTEGER REFERENCES users(user_id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    field_name VARCHAR(50) NOT NULL,
    old_value  TEXT,
    new_value  TEXT,
    reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_rule_changes_rule_time
    ON alert_rule_changes (rule_id, changed_at DESC);

-- Conditional GRANT block (mirrors 022/025/026 pattern)
DO $grant_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'GRANT SELECT, INSERT ON alert_rule_changes TO infrasafe_runtime';
        EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE alert_rule_changes_id_seq TO infrasafe_runtime';
    END IF;
END
$grant_runtime$;

COMMIT;
