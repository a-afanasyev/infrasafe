-- Migration 028: drop unused alert_types catalog + legacy alerts table
--
-- Context: The `alert_types` table (POWER_FAILURE, WATER_LEAK, OVERHEATING,
-- LOW_PRESSURE, COMMUNICATION_LOST, VOLTAGE_ANOMALY, TEMPERATURE_ANOMALY) was
-- designed as a normalized catalog with FK from a legacy `alerts` table
-- (`alerts.alert_type_id REFERENCES alert_types`). The active codebase does
-- NOT use this normalized model — instead `infrastructure_alerts` carries a
-- free-form `type VARCHAR(50)` field with code-side string literals
-- (LEAK_DETECTED, TRANSFORMER_OVERLOAD, etc.) that don't even appear in the
-- catalog. The two systems were never reconciled.
--
-- Pre-flight verified (2026-05-23):
--   - `alerts` table: 0 rows in prod
--   - `alert_types` table: 7 seed rows, no active code consumers
--   - No `require('models/Alert')` or `require('models/AlertType')` anywhere
--     in src/ except dead model files themselves
--   - adminService.js whitelists both tables but no specific endpoint targets
--     them
--   - Building.js cascade DELETE FROM alerts touches legacy table during
--     building deletion — preserved as conditional cleanup, removed in PR-1.5
--
-- Replacement: enforce alert_type whitelist via CHECK constraint on
-- alert_rules.alert_type using the 5 actively-rule'd types.

BEGIN;

-- Drop FK + column from legacy alerts table first (if they exist)
ALTER TABLE IF EXISTS alerts DROP CONSTRAINT IF EXISTS alerts_alert_type_id_fkey;
ALTER TABLE IF EXISTS alerts DROP COLUMN IF EXISTS alert_type_id;

-- Drop the legacy alerts table (0 rows confirmed pre-migration)
DROP TABLE IF EXISTS alerts CASCADE;

-- Drop the unused catalog
DROP TABLE IF EXISTS alert_types CASCADE;

-- Enforce whitelist of actively-used alert types via CHECK constraint
-- (replaces the implicit "anything goes" behavior of the free-form column).
ALTER TABLE alert_rules
    DROP CONSTRAINT IF EXISTS alert_rules_alert_type_check;
ALTER TABLE alert_rules
    ADD CONSTRAINT alert_rules_alert_type_check
    CHECK (alert_type IN (
        'TRANSFORMER_OVERLOAD',
        'TRANSFORMER_CRITICAL_OVERLOAD',
        'LEAK_DETECTED',
        'VOLTAGE_ANOMALY',
        'HEATING_FAILURE'
    ));

-- Note: infrastructure_alerts.type stays free-form for now — operators may
-- create ad-hoc alert types via manual POST /api/alerts. If we want to
-- enforce the catalog there too, that's a separate migration with careful
-- backward-compat for any existing rows.

COMMIT;
