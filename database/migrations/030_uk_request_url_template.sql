-- Migration 030: uk_request_url_template seed in integration_config (B-001 / Sprint 11)
--
-- Adds a config-driven URL template for the admin-UI «Открыть в УК» button.
-- Template substitutes ${uk_frontend_url} and ${uk_request_number} at click
-- time. Stored in DB (not env / hardcoded) so the UK team can change the
-- format without forcing an InfraSafe frontend release.
--
-- DEFAULT VALUE — PENDING UK CONFIRMATION:
--   '${uk_frontend_url}/requests/${uk_request_number}'
--   This is a REST-style guess. UK team is being asked to confirm the
--   exact format expected by their `onOpenRelated` prop (alternatives
--   considered: `?open=<number>` query param, `/admin/dashboard?request=
--   <number>`). Operator can override via admin UI «Интеграция УК» tab
--   without re-running migration.
--
-- Why ON CONFLICT DO NOTHING:
--   Idempotent rerun in dev; never overwrite an operator-tuned value
--   on prod re-apply.

BEGIN;

INSERT INTO integration_config (key, value, description)
VALUES (
    'uk_request_url_template',
    '${uk_frontend_url}/requests/${uk_request_number}',
    'URL template for the admin-UI "Открыть в УК" button. Substitutes ${uk_frontend_url} (from integration_config.uk_frontend_url) and ${uk_request_number} (from alert_request_map). PENDING UK contract confirmation.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
