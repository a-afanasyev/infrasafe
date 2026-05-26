-- Migration 030: uk_request_url_template seed in integration_config (B-001 / Sprint 11)
--
-- Adds a config-driven URL template for the admin-UI «Открыть в УК» button.
-- Template substitutes ${uk_frontend_url} and ${uk_request_number} at click
-- time. Stored in DB (not env / hardcoded) so the UK team can change the
-- format without forcing an InfraSafe frontend release.
--
-- DEFAULT VALUE — confirmed by UK team 2026-05-27:
--   '${uk_frontend_url}/dashboard?request=${uk_request_number}'
--
-- Resolves to e.g. https://infrasafe.uz/uk/dashboard?request=260527-001.
-- UK side will land a follow-up PR adding useSearchParams to KanbanPage
-- so the linked ticket auto-opens in a modal; until that ships, the link
-- still takes the operator to the right dashboard (just without the
-- request modal pre-opened) — acceptable per UK team.
--
-- Notes from UK confirmation:
--   - {uk_request_number} taken as-is (YYMMDD-NNN, chars [0-9-]) — no
--     URL-encoding needed (we still encodeURIComponent client-side as a
--     defensive no-op for the current charset).
--   - Single route /dashboard (not /admin/dashboard) — admin + manager
--     roles both land there via ProtectedRoute.
--   - Unauthenticated open → UK /login?redirect=... preserves target.
--
-- Why ON CONFLICT DO NOTHING:
--   Idempotent rerun in dev; never overwrite an operator-tuned value
--   on prod re-apply.

BEGIN;

-- integration_config schema is (key, value, updated_at) only — no
-- description column (verified against migration 011). Documentation
-- for this row lives in this migration header comment above.
INSERT INTO integration_config (key, value)
VALUES (
    'uk_request_url_template',
    '${uk_frontend_url}/dashboard?request=${uk_request_number}'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
