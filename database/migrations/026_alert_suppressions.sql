-- Migration 026: alert_suppressions for Sprint 10 PR-4
--
-- Operator UX: "this leak sensor is broken, ignore alerts for 4 hours" or
-- "transformer under planned maintenance, suppress overload alerts till
-- tomorrow". Without this, a stuck sensor would create a reopen-loop:
-- alert → УК → close → verifier → fault still present → new alert → ...
-- until max_reopens_per_24h kicks in (which is itself a noisy escalation
-- to engineer_required).
--
-- Design:
--   - Keyed on the infrastructure tuple (infra_type, infra_id, alert_type),
--     NOT on a specific alert_id. This is critical because reopens create
--     new alert_ids — if suppression were per-alert it would leak through
--     a reopen. By keying on the underlying entity, suppression covers
--     the entire chain.
--   - `suppress_until` lets the suppression auto-expire without operator
--     action. Default cap 24h enforced in the model layer.
--   - `cleared_at` lets operators end suppression early ("sensor fixed").
--   - Active = `cleared_at IS NULL AND suppress_until > NOW()`. The
--     partial index covers exactly this slice for fast isActive lookups.
--   - `reason` is a small enum for operator analytics (which sensors
--     ОТКАЗЫВАЮТ чаще всего, etc.).
--
-- Consumers:
--   - alertVerificationService._drainOne (already wired in PR-2 via
--     conditional require — once this migration + model ship, the check
--     activates without code changes there)
--   - Future leak/transformer auto-checkers (Sprint 10.x): consult before
--     emitting a new alert to avoid creating one operator just suppressed

BEGIN;

CREATE TABLE IF NOT EXISTS alert_suppressions (
    id                  SERIAL PRIMARY KEY,
    infrastructure_type VARCHAR(50) NOT NULL,
    infrastructure_id   INTEGER NOT NULL,
    alert_type          VARCHAR(50) NOT NULL,
    suppress_until      TIMESTAMPTZ NOT NULL,
    reason              VARCHAR(30) NOT NULL
                        CHECK (reason IN (
                            'faulty_sensor',
                            'under_repair',
                            'planned_maintenance',
                            'known_issue',
                            'other'
                        )),
    comment             TEXT,
    suppressed_by       INTEGER REFERENCES users(user_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cleared_at          TIMESTAMPTZ,
    cleared_by          INTEGER REFERENCES users(user_id)
);

-- Active-suppression lookup. Partial WHERE only on `cleared_at IS NULL`
-- because Postgres requires IMMUTABLE functions in index predicates (NOW()
-- is not IMMUTABLE). The runtime query in AlertSuppression.isActive
-- combines the partial scan with `AND suppress_until > NOW()` — Postgres
-- planner uses the partial index for the first cut, then filters expired
-- rows in the heap. Acceptable because expired rows accumulate slowly
-- (operator-driven, not request-driven).
CREATE INDEX IF NOT EXISTS idx_suppression_active
    ON alert_suppressions (infrastructure_type, infrastructure_id, alert_type, suppress_until)
    WHERE cleared_at IS NULL;

-- Operator-history index (list all suppressions for an infrastructure
-- entity, including expired ones, for audit)
CREATE INDEX IF NOT EXISTS idx_suppression_history
    ON alert_suppressions (infrastructure_type, infrastructure_id, created_at DESC);

-- Conditional GRANT block — see migration 025 for rationale (portable
-- across environments where infrasafe_runtime role may not exist).
DO $grant_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON alert_suppressions TO infrasafe_runtime';
        EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE alert_suppressions_id_seq TO infrasafe_runtime';
    END IF;
END
$grant_runtime$;

COMMIT;
