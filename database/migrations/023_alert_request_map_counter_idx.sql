-- Migration 023: partial index for local request-count aggregation
-- Sprint 9 / FIX-007 — InfraSafe-side sender (counter source replacement)
--
-- UK confirmed (FIX-007 round O4) they will NOT implement
-- GET /requests/counts-by-building. The dashboard counter is now built
-- locally from alert_request_map status transitions:
--
--   SELECT building_external_id, COUNT(*) FROM alert_request_map
--   WHERE status IN ('pending', 'sent', 'active')
--   GROUP BY building_external_id;
--
-- Status state machine:
--   pending  — outbox row enqueued, not yet sent
--   sent     — UK acked (202/409); awaiting UK request.created callback
--   active   — UK created request (request_number filled), in lifecycle
--   resolved — UK closed request (Принято / Отменена)
--   cancelled— manual close
--
-- "Currently-open" = {pending, sent, active}; exclude {resolved, cancelled}.
--
-- Caveat (documented in src/services/uk/configProxy.js header):
-- counters are UNDER-COUNTED until UK ARCH-113 lands (UK doesn't emit
-- request.* events for bot-originated requests).
--
-- Idempotent: IF NOT EXISTS guard.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_arm_building_status_partial
    ON alert_request_map (building_external_id)
    WHERE status IN ('pending', 'sent', 'active');

COMMENT ON INDEX idx_arm_building_status_partial IS
    'Sprint 9 / FIX-007: drives configProxy.getRequestCounts SQL aggregation. Partial index on open-state rows only — total scan cost stays proportional to active queue size, not table size.';

COMMIT;
