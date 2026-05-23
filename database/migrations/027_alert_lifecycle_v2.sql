-- Migration 027: infrastructure_alerts lifecycle v2 (Sprint 10 PR-2)
--
-- Extends `infrastructure_alerts` with reopen-chain tracking + two new
-- status values + an updated partial dedup index that excludes the new
-- transient state `resolved_verifying` from the active-alert dedup
-- constraint.
--
-- New status values:
--   - resolved_verifying: УК closed the ticket, we're checking if sensor
--     still shows the fault. Short-lived: created by alertService.resolveAlert
--     (system path), expires after grace+window seconds.
--   - engineer_required: max_reopens_per_24h exceeded. Auto-reopen halted;
--     alert needs human engineer intervention. УК gets a separate
--     "инженерный разбор" ticket.
--
-- Why the dedup index change:
--   Old:  WHERE status = 'active'
--   New:  WHERE status IN ('active', 'acknowledged')
--   Plus: resolved_verifying is NOT in the active set → during the
--         verification window, a fresh reopen INSERT with same {infra, type}
--         can succeed because the partial UNIQUE index doesn't cover the
--         resolved_verifying row. This is the exact mechanism that makes
--         reopens "just work" without schema gymnastics.

BEGIN;

-- Add reopen-chain tracking columns. Default reopen_sequence=1 for all
-- existing rows is correct (first occurrence in their own chain).
ALTER TABLE infrastructure_alerts
    ADD COLUMN IF NOT EXISTS reopen_chain_id UUID,
    ADD COLUMN IF NOT EXISTS reopen_sequence INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS previous_alert_id INTEGER REFERENCES infrastructure_alerts(alert_id),
    ADD COLUMN IF NOT EXISTS previous_uk_request_number VARCHAR(20);

-- Status enum expansion. The existing CHECK constraint (if any) is
-- dropped and replaced. Existing 'active' / 'acknowledged' / 'resolved'
-- values stay valid.
ALTER TABLE infrastructure_alerts DROP CONSTRAINT IF EXISTS infrastructure_alerts_status_check;
ALTER TABLE infrastructure_alerts ADD CONSTRAINT infrastructure_alerts_status_check
    CHECK (status IN (
        'active',
        'acknowledged',
        'resolved',
        'resolved_verifying',
        'engineer_required'
    ));

-- Partial dedup index update — see header comment for rationale.
DROP INDEX IF EXISTS idx_active_alert_dedup;
CREATE UNIQUE INDEX idx_active_alert_dedup
    ON infrastructure_alerts (infrastructure_type, infrastructure_id, type)
    WHERE status IN ('active', 'acknowledged');

-- Index for reopen-chain lookup (operator UI shows full chain history)
CREATE INDEX IF NOT EXISTS idx_reopen_chain
    ON infrastructure_alerts (reopen_chain_id)
    WHERE reopen_chain_id IS NOT NULL;

COMMIT;
