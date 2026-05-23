-- Migration 025: alert_verifications queue for Sprint 10 PR-2
--
-- Sprint 10 introduces a post-resolve verification cycle: when УК closes a
-- ticket and InfraSafe auto-resolves the alert, we schedule a re-check N
-- seconds later (per-rule grace_seconds). The verifier looks at the sensor
-- state within window_seconds; if the fault is still observed, we reopen
-- the alert (new alert_id) and a new УК ticket goes out — physical reality
-- wins over administrative state.
--
-- The queue is processed by `src/services/alertVerificationService.js`
-- (singleton drain worker, advisory_lock, 15s tick). PR-3 wires the
-- enqueue from alertService.resolveAlert; PR-2 ships only scaffolding.
--
-- Schema design choices:
--   - status enum covers all terminal outcomes so operators can audit
--     why a particular reopen-attempt didn't fire
--   - partial UNIQUE index on `original_alert_id WHERE pending` lets
--     enqueue be idempotent via ON CONFLICT DO NOTHING (no double-queue
--     even if alert is somehow resolved twice in a race)
--   - run_at + window_until both set at enqueue time → drain worker just
--     checks `NOW() BETWEEN run_at AND window_until`
--   - reopen_chain_id is a UUID shared across all reopens of the same
--     underlying issue — lets the UI show "Повторное обращение №3"

BEGIN;

CREATE TABLE IF NOT EXISTS alert_verifications (
    id                  SERIAL PRIMARY KEY,
    original_alert_id   INTEGER NOT NULL REFERENCES infrastructure_alerts(alert_id) ON DELETE CASCADE,
    reopen_chain_id     UUID NOT NULL,
    reopen_sequence     INT NOT NULL DEFAULT 1,
    infrastructure_type VARCHAR(50) NOT NULL,
    infrastructure_id   INTEGER NOT NULL,
    alert_type          VARCHAR(50) NOT NULL,
    run_at              TIMESTAMPTZ NOT NULL,
    window_until        TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                            'pending',
                            'passed',
                            'reopened',
                            'suppressed',
                            'engineer_required',
                            'skipped'
                        )),
    attempts            SMALLINT NOT NULL DEFAULT 0,
    processed_at        TIMESTAMPTZ,
    new_alert_id        INTEGER REFERENCES infrastructure_alerts(alert_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drain worker picks rows where run_at <= NOW() AND status='pending'.
-- Partial index keeps it lean (only pending rows indexed).
CREATE INDEX IF NOT EXISTS idx_verification_due
    ON alert_verifications (run_at)
    WHERE status = 'pending';

-- Idempotent enqueue: at most one pending row per original_alert_id.
-- If resolveAlert somehow fires twice for the same alert (e.g. duplicate
-- UK_REQUEST_RESOLVED event), the second INSERT becomes a no-op via
-- ON CONFLICT DO NOTHING. Once the pending row is processed (status
-- transitions to terminal), the partial index releases the slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_per_alert
    ON alert_verifications (original_alert_id)
    WHERE status = 'pending';

-- Operator audit: lookup verification history by reopen chain
CREATE INDEX IF NOT EXISTS idx_verification_chain
    ON alert_verifications (reopen_chain_id, reopen_sequence);

-- Conditional GRANT — `infrasafe_runtime` is a P0-5 runtime role created in
-- migration 017. On fresh local dev DBs that role may not exist; skip GRANTs
-- to keep the migration portable. Mirrors the pattern from migration 022.
DO $grant_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON alert_verifications TO infrasafe_runtime';
        EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE alert_verifications_id_seq TO infrasafe_runtime';
    END IF;
END
$grant_runtime$;

COMMIT;
