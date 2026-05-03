-- Init step 07 — partial UNIQUE index for active alert deduplication
-- Mirrors database/migrations/015_alert_dedup_constraint.sql with an
-- idempotent pre-cleanup so fresh-install seed data cannot block index creation.
--
-- Phase 4.1 (ARCH-106).
--
-- Problem: alertService.createAlert checks an in-memory activeAlerts Map
-- before inserting. Two concurrent requests can both pass that check and
-- insert duplicate active alerts for the same (infrastructure_type,
-- infrastructure_id, type). Under horizontal scale-out the Map isn't even
-- shared between instances, so the dedup is effectively absent.
--
-- Fix: a PARTIAL UNIQUE INDEX scoped to WHERE status = 'active'. Only one
-- active alert per (type, infra_type, infra_id) can exist at a time;
-- resolved/acknowledged history is unaffected (and unbounded, as intended).
--
-- The service layer catches the PostgreSQL error 23505 and returns null
-- so the callers treat it as a suppressed duplicate rather than an error.
--
-- ─── Pre-cleanup ────────────────────────────────────────────────────
-- 02_seed_data.sql contains two active alerts for
-- (controller, TEST-INFRA-001, TEMPERATURE_HIGH). Without cleanup the
-- UNIQUE index would fail to build on a fresh install.
-- We keep the most recent row per group and resolve the rest.
-- This block is a no-op when no duplicates exist (e.g. existing prod DBs).

UPDATE infrastructure_alerts
   SET status      = 'resolved',
       resolved_at = COALESCE(resolved_at, NOW())
 WHERE alert_id IN (
       SELECT alert_id
         FROM (
            SELECT alert_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY infrastructure_type, infrastructure_id, type
                       ORDER BY created_at DESC, alert_id DESC
                   ) AS rn
              FROM infrastructure_alerts
             WHERE status = 'active'
         ) ranked
        WHERE rn > 1
 );

-- ─── Constraint ─────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_alert_dedup
    ON infrastructure_alerts (infrastructure_type, infrastructure_id, type)
    WHERE status = 'active';

COMMENT ON INDEX idx_active_alert_dedup IS
    'Phase 4.1 / ARCH-106: DB-level dedup for active alerts (partial UNIQUE).';
