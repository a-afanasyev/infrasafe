-- Migration 031: B-020 backfill — finalize orphaned `resolved_verifying` alerts
--
-- Bug (B-020, found 2026-05-29): `infrastructure_alerts.status =
-- 'resolved_verifying'` is a transient state set by alertService.resolveAlert
-- when a system-resolve enters the verification cycle. The verification worker
-- (alertVerificationService) reaches a terminal outcome on the
-- alert_verifications row (passed/reopened/suppressed/skipped/engineer_required)
-- but — until the code fix in this same PR — never wrote that outcome back to
-- the parent infrastructure_alerts.status. Result: every verified alert
-- orphaned in 'resolved_verifying' forever.
--
-- Prod evidence (2026-05-29): alerts 25 (since 05-24) and 26 (since 05-28) sat
-- in 'resolved_verifying' while their verifications (id 2, 3) were 'passed'.
--
-- This migration is a one-off data fix for alerts that orphaned BEFORE the
-- code fix shipped. The code fix prevents new orphans; this cleans up the
-- backlog. Mapping mirrors the runtime finalize logic:
--   verification terminal status engineer_required → alert engineer_required
--   any other terminal status (passed/reopened/suppressed/skipped) → resolved
--
-- Idempotent: the `ia.status = 'resolved_verifying'` guard means re-running
-- this migration matches zero rows once the backfill has run. Safe to apply
-- to a fresh DB too (no orphans → no-op).

UPDATE infrastructure_alerts ia
SET status = CASE
        WHEN av.status = 'engineer_required' THEN 'engineer_required'
        ELSE 'resolved'
    END
FROM (
    -- Latest terminal verification per alert (a chain can have several;
    -- the most recently processed one decides the alert's final state).
    SELECT DISTINCT ON (original_alert_id)
        original_alert_id,
        status
    FROM alert_verifications
    WHERE status IN ('passed', 'reopened', 'suppressed', 'skipped', 'engineer_required')
    ORDER BY original_alert_id, processed_at DESC NULLS LAST
) av
WHERE ia.alert_id = av.original_alert_id
  AND ia.status = 'resolved_verifying';
