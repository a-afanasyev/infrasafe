-- Migration 022: UK webhook outbox table
-- Sprint 9 / FIX-007 — InfraSafe-side sender
--
-- Persistent outbox queue for outbound webhooks InfraSafe → UK
-- (POST /api/v2/webhooks/infrasafe/alert, HMAC-SHA256 signed).
--
-- Why an outbox (vs synchronous send from alertEvents listener):
--   1. UK enforces 60/мин rate-limit (fixed-window, per IP). We need to
--      drain at ≤30/мин locally to avoid 429 storms. A persistent queue
--      with a drain worker enforces this independently of alert
--      generation rate.
--   2. Survives container restart. With alertEvents being fire-and-forget,
--      an in-memory retry loop would lose unsent events on app restart.
--   3. Backfill after UK downtime: drains queued events at the safe rate
--      without manual intervention.
--
-- Design constraints (validated by Plan agent + UK contract round Q):
--   - `payload_body` is TEXT, NOT JSONB. PostgreSQL reorders JSONB keys
--     on round-trip, which would break HMAC-SHA256 over the canonical
--     body bytes. We sign exactly the bytes we POST, verbatim.
--   - `event_id` is UNIQUE — ON CONFLICT DO NOTHING on enqueue gives
--     idempotent retries even when alertForwarder retries the same
--     mapping (self-healing for pending-mapping-no-outbox-row case).
--   - `next_attempt_at` drives the drain worker's WHERE clause; partial
--     index on (next_attempt_at WHERE status='pending') keeps the worker
--     SELECT cheap.
--   - Status transitions: pending → sent (on 202/409) | dead (on
--     401/422 or after 5 failed attempts on 5xx).
--   - No `signed_at` column: the signature timestamp `t` MUST be current
--     at HTTP send time (UK enforces 300s window). Stale `t` from
--     enqueue would 401 after any non-trivial drain delay.
--
-- Drain rate: enforced by ukOutboxService interval (default 2000ms
-- between picks; one inflight at a time), not by SQL.
--
-- Multi-replica: ukOutboxService uses pg_try_advisory_lock to ensure
-- only one replica drains at a time. FOR UPDATE SKIP LOCKED on
-- pickNext() is a belt-and-braces guard.

BEGIN;

CREATE TABLE IF NOT EXISTS uk_outbox (
    id                 BIGSERIAL PRIMARY KEY,
    event_id           VARCHAR(64) NOT NULL UNIQUE,
    payload_body       TEXT NOT NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sent', 'dead')),
    attempt_count      INTEGER NOT NULL DEFAULT 0,
    next_attempt_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error         TEXT,
    last_response_code INTEGER,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at            TIMESTAMPTZ
);

COMMENT ON TABLE uk_outbox IS
    'Sprint 9 / FIX-007: persistent outbox for outbound InfraSafe→UK webhooks (alert.created). Drained by ukOutboxService at ≤30/мин via pg_try_advisory_lock + FOR UPDATE SKIP LOCKED.';

COMMENT ON COLUMN uk_outbox.payload_body IS
    'Canonical request body bytes (TEXT, not JSONB) for HMAC-SHA256 signing. Must be POSTed verbatim — re-stringify would invalidate the signature.';

COMMENT ON COLUMN uk_outbox.event_id IS
    'Unique idempotency key. Mirrors AlertRequestMap.idempotency_key. Used as UK''s replay-dedup key (Phase 1: 600s Redis TTL; Phase 2: persistent webhook_inbox).';

-- Partial index: drives the drain worker's pickNext query.
-- WHERE clause filters to only active queue; sorted by next_attempt_at
-- so backoff'd rows naturally come after fresh ones.
CREATE INDEX IF NOT EXISTS idx_uk_outbox_drain
    ON uk_outbox (next_attempt_at)
    WHERE status = 'pending';

-- Reverse-chronological index for diagnostic queries (recent activity).
CREATE INDEX IF NOT EXISTS idx_uk_outbox_created_at
    ON uk_outbox (created_at DESC);

-- Grants for runtime role (per migration 017 pattern). Bulk
-- GRANT EXECUTE ON ALL FUNCTIONS / GRANT … ON ALL TABLES from 017 is a
-- point-in-time snapshot and does NOT cover tables created after it,
-- so we grant explicitly here.
DO $grant_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON uk_outbox TO infrasafe_runtime';
        EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE uk_outbox_id_seq TO infrasafe_runtime';
    END IF;
END
$grant_runtime$;

COMMIT;
