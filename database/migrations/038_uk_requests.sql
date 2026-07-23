-- Migration 038: uk_requests — UK-originated request registry
-- request.reconcile contract (agreed with UK 2026-07-23; follow-up the
-- ARCH-114 spec anticipated as "request.reconcile with the buildings
-- reference").
--
-- Problem this closes: the reconciliation inventory (GET /uk-requests-metrics)
-- read alert_request_map only. Requests originated on the UK side (bot /
-- dashboard) have no ARM row — infrasafe_alert_id is NOT NULL by design and
-- that invariant carries the alert auto-resolve flow, so such requests can
-- never live in ARM. UK's set-diff therefore saw them as permanently missing
-- and re-sent them as repairs every cycle (the "eternal repair" loop observed
-- 2026-07-23 after UK's deterministic-event_id rollout).
--
-- Design:
--   - uk_request_number UNIQUE is the upsert key. Each UK reconcile cycle
--     mints a FRESH event_id (bypasses both sides' dedup by design), so
--     convergence comes from ON CONFLICT (uk_request_number) DO UPDATE in
--     UkRequest.reconcile — one row per request no matter how many cycles.
--   - building_external_id is NULLABLE: yard/legacy UK requests don't resolve
--     to a building. Null rows still appear in the inventory (closing the
--     repair loop) but can't contribute to per-building map counters.
--   - status uses UK's production dictionary (same values as
--     request.status_changed, e.g. 'Принято'/'Отменена' terminal). Terminality
--     semantics live in code (requestProcessor.TERMINAL_STATUSES).
--   - VARCHAR sizes mirror the webhook validation caps (50 for number,
--     100 for status) rather than ARM's tighter VARCHAR(20).
--
-- Expand-only (AUD-043): new table, no changes to existing objects.

BEGIN;

CREATE TABLE IF NOT EXISTS uk_requests (
    id                   SERIAL PRIMARY KEY,
    uk_request_number    VARCHAR(50)  NOT NULL UNIQUE,
    status               VARCHAR(100),
    building_external_id UUID,
    first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reconciled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE uk_requests IS
    'UK-originated requests (bot/dashboard) learned via request.reconcile. Requests originated from InfraSafe alerts live in alert_request_map instead; the inventory endpoint serves the union of both.';
COMMENT ON COLUMN uk_requests.uk_request_number IS
    'UK request number — the reconcile upsert key and the value UK set-diffs on.';
COMMENT ON COLUMN uk_requests.building_external_id IS
    'sha256("uk-building-{id}")-derived UUID shared with UK; NULL for yard/legacy requests that resolve to no building.';

-- Per-building lookup for the map counters union.
CREATE INDEX IF NOT EXISTS idx_uk_requests_building
    ON uk_requests (building_external_id)
    WHERE building_external_id IS NOT NULL;

-- Grants for runtime role (per migration 022 pattern): 017's bulk grants are
-- a point-in-time snapshot and do not cover tables created after it.
DO $grant_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON uk_requests TO infrasafe_runtime';
        EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE uk_requests_id_seq TO infrasafe_runtime';
    END IF;
END
$grant_runtime$;

COMMIT;
