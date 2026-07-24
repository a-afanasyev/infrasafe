-- Migration 039: alert_request_map — widen uk_request_number + archived_at
-- Two follow-ups from the request.reconcile review + UK convergence closure
-- (2026-07-24):
--
-- 1. WIDEN uk_request_number VARCHAR(20) → VARCHAR(50).
--    Pre-existing latent bug (flagged in the PR #145 review): the webhook
--    validator accepts request numbers up to 50 chars for ALL request.*
--    events, and requestProcessor writes them into this column via
--    AlertRequestMap.markSent — a 21-50 char number would throw
--    "value too long for type character varying(20)", 500 the webhook, and
--    leave the mapping numberless (later mis-classified as UK-originated).
--    Widening VARCHAR is metadata-only in PostgreSQL (no table rewrite).
--    uk_requests (migration 038) is already VARCHAR(50) — this aligns the
--    two homes of the same logical field.
--
-- 2. ADD archived_at + archive the 7 UK-confirmed orphans (infrasafe only).
--    UK's reconcile diff runs both directions; 7 numbers from the May-June
--    2026 joint synthetic/demo era exist in our ARM but were deleted from
--    UK's requests table — permanent noise in their orphan branch (and the
--    reason their convergence heartbeat never fired "in sync" on infrasafe).
--    UK confirmed the exact list 2026-07-24 and asked us to clean up.
--    Archived rows disappear from the reconciliation inventory and the map
--    counters (all ARM-branch queries filter archived_at IS NULL) but keep
--    their audit history. Note: 260528-002 is still status='active' — the
--    archive filter, not a status rewrite, is what removes it from counters.
--    areAllTerminal deliberately NOT changed: it drives alert auto-resolve
--    and its alerts (ids 21-51) are long-dead history.
--    Idempotent + a no-op on profk and fresh bootstraps (numbers absent).
--
-- Expand-only (AUD-043): type widening + nullable column + data update.

BEGIN;

ALTER TABLE alert_request_map
    ALTER COLUMN uk_request_number TYPE VARCHAR(50);

ALTER TABLE alert_request_map
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN alert_request_map.archived_at IS
    'Set when the row is retired from reconciliation (e.g. UK deleted the request — old synthetics). Archived rows are hidden from /uk-requests-metrics and the map counters but kept for audit. NULL = live.';

-- The 7 orphans UK confirmed on 2026-07-24 (joint synthetic/demo era).
UPDATE alert_request_map
SET archived_at = NOW()
WHERE uk_request_number IN (
    '260523-004', '260524-001', '260524-005', '260526-001',
    '260528-002', '260531-001', '260613-005'
)
  AND archived_at IS NULL;

COMMIT;
