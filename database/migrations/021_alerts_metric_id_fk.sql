-- Migration 021: FK constraint on alerts.metric_id
-- Sprint 7 / P1-V14
--
-- The legacy `alerts` table has always had `metric_id BIGINT` referencing
-- `metrics.metric_id` by convention, but no FK enforced referential
-- integrity. Orphans accumulate when a metric row is deleted without the
-- alert being cleaned up, and the column is actively read by the
-- application.
--
-- ON DELETE CASCADE: an alert tied to a deleted metric is meaningless, so
-- cascading the delete is correct here. No new index is needed —
-- `idx_alerts_metric` already covers `alerts(metric_id)`.
--
-- Idempotent: orphan cleanup is a no-op when clean; the FK is guarded by a
-- pg_constraint existence check. Same pattern as
-- 018_alert_request_map_fk.sql.

BEGIN;

-- Step 1: clean up orphan rows so the FK can be added without NOT VALID
DELETE FROM alerts
 WHERE metric_id IS NOT NULL
   AND metric_id NOT IN (
       SELECT metric_id FROM metrics
   );

-- Step 2: add FK if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_alerts_metric'
          AND conrelid = 'public.alerts'::regclass
    ) THEN
        ALTER TABLE alerts
            ADD CONSTRAINT fk_alerts_metric
            FOREIGN KEY (metric_id)
            REFERENCES metrics(metric_id)
            ON DELETE CASCADE;
    END IF;
END$$;

COMMIT;
