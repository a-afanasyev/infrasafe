-- Migration 018: FK constraint on alert_request_map.infrasafe_alert_id
-- Sprint 5 / P1-8
--
-- alert_request_map.infrasafe_alert_id has always pointed at
-- infrastructure_alerts.alert_id by convention, but no FK enforced
-- referential integrity. Orphans accumulate when an alert is deleted
-- without the mapping being cleaned up.
--
-- Two-step adjustment:
--   1. Widen the column from INTEGER to BIGINT — infrastructure_alerts.alert_id
--      is `bigserial` (BIGINT). Without this step the FK would refuse the
--      type mismatch.
--   2. Add FK with ON DELETE CASCADE — when an alert is deleted, its mapping
--      becomes meaningless, so cascading is correct here.
--
-- Idempotent: ALTER COLUMN TYPE is a no-op if already BIGINT; the FK is
-- guarded by `IF NOT EXISTS` via the pg_constraint check.

BEGIN;

-- Step 1: widen infrasafe_alert_id to match infrastructure_alerts.alert_id (BIGINT)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'alert_request_map'
          AND column_name = 'infrasafe_alert_id'
          AND data_type = 'integer'
    ) THEN
        ALTER TABLE alert_request_map
            ALTER COLUMN infrasafe_alert_id TYPE BIGINT;
    END IF;
END$$;

-- Step 2: clean up orphan rows so the FK can be added without NOT VALID
DELETE FROM alert_request_map
 WHERE infrasafe_alert_id IS NOT NULL
   AND infrasafe_alert_id NOT IN (
       SELECT alert_id FROM infrastructure_alerts
   );

-- Step 3: add FK if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_arm_infrasafe_alert'
          AND conrelid = 'public.alert_request_map'::regclass
    ) THEN
        ALTER TABLE alert_request_map
            ADD CONSTRAINT fk_arm_infrasafe_alert
            FOREIGN KEY (infrasafe_alert_id)
            REFERENCES infrastructure_alerts(alert_id)
            ON DELETE CASCADE;
    END IF;
END$$;

COMMIT;
