-- Migration 034: alert_verifications dispatch/lease/sweep columns (Sprint 11, AUD-001 PR-C)
--
-- PR-B reconnected the VERIFY_* path with a SINGLE dispatch per verification
-- (the `attempts>0 → return null` guard prevented re-emit, so there were never
-- parallel checkers and no lease was needed). PR-C makes delivery durable and
-- crash-recoverable, which requires re-dispatch — and once re-dispatch exists,
-- four new pieces of per-row state:
--
--   next_dispatch_at         — fair re-dispatch schedule. markDispatched sets it
--                              to NOW()+REDISPATCH_INTERVAL (60s). pickDue orders
--                              by COALESCE(next_dispatch_at, run_at) so fresh rows
--                              (run_at) and retries (next_dispatch_at) interleave
--                              oldest-due-first — no fresh- or retry-starvation.
--
--   dispatch_lease_until     — markDispatched sets it to NOW()+DISPATCH_LEASE_SECONDS
--                              (240s, an operational bound on the checker chain,
--                              NOT a proven max). While the lease is live, the
--                              window-expired branch must NOT terminalise the row
--                              (passed/skipped) — a slow checker may still create a
--                              reopen whose ALERT_REOPENED only binds to a 'pending'
--                              row. Active lease → defer (next_dispatch_at = lease)
--                              and re-check after it expires.
--
--   uk_notified_at           — engineer-escalation durable ack. The sweep
--                              (re)emits ALERT_ENGINEER_REQUIRED for every
--                              engineer_required row with uk_notified_at IS NULL;
--                              the forwarder stamps it via markUkNotified once UK
--                              delivery succeeds, so the sweep self-terminates and
--                              a lost emit between COMMIT and listener is recovered.
--
--   uk_notify_next_attempt_at — fair-rotation cursor for the sweep. Each picked row
--                              is pushed 300s into the tail BEFORE emit, so 5
--                              permanently-undeliverable rows (no rule / no
--                              external_id) can't forever shadow a 6th deliverable
--                              one under LIMIT 5.
--
-- Idempotency contract (mirrors migration 031):
--   - The three plain columns use ADD COLUMN IF NOT EXISTS (safe re-apply).
--   - uk_notified_at is added inside a column-existence DO guard so its HISTORICAL
--     backfill (mark pre-existing engineer_required rows already-notified, so the
--     new sweep does NOT re-ship tickets for escalations delivered before this
--     migration — e.g. the manual prod synthetic 260524-004) runs ONLY on first
--     add. A bare `UPDATE ... WHERE uk_notified_at IS NULL` re-run would wrongly
--     mark POST-deploy undelivered escalations as notified and the sweep would
--     lose them — hence the guard, not a naive backfill.
--   - The partial index uses CREATE INDEX IF NOT EXISTS.
--
-- Pre-deploy audit (run BEFORE applying; see PR-C deploy runbook):
--   SELECT id, original_alert_id, processed_at FROM alert_verifications
--   WHERE status='engineer_required';
-- These rows get uk_notified_at = NOW() by the backfill so the sweep skips them.

BEGIN;

-- Plain additive columns — safe to re-apply.
ALTER TABLE alert_verifications
    ADD COLUMN IF NOT EXISTS next_dispatch_at TIMESTAMPTZ NULL;
ALTER TABLE alert_verifications
    ADD COLUMN IF NOT EXISTS dispatch_lease_until TIMESTAMPTZ NULL;
ALTER TABLE alert_verifications
    ADD COLUMN IF NOT EXISTS uk_notify_next_attempt_at TIMESTAMPTZ NULL;

-- uk_notified_at + ONE-TIME historical backfill, guarded so re-apply is a no-op
-- and post-deploy NULL escalations are never touched by a re-run.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'alert_verifications'
          AND column_name = 'uk_notified_at'
    ) THEN
        ALTER TABLE alert_verifications ADD COLUMN uk_notified_at TIMESTAMPTZ NULL;
        UPDATE alert_verifications SET uk_notified_at = NOW() WHERE status = 'engineer_required';
    END IF;
END
$$;

-- Engineer-sweep working set: engineer_required rows not yet acked, ordered by
-- their rotation cursor. Partial index keeps it tiny (only unnotified rows).
CREATE INDEX IF NOT EXISTS idx_engineer_unnotified
    ON alert_verifications (uk_notify_next_attempt_at, processed_at)
    WHERE status = 'engineer_required' AND uk_notified_at IS NULL;

COMMIT;
