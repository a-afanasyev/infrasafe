-- Migration 032: normalize alert_rules.uk_urgency to canonical keys
--
-- UK contract change (2026-06): the canonical urgency value on the wire is a
-- key — low | medium | high | critical — not the Russian labels
-- (Обычная/Средняя/Срочная/Критическая) seeded by migration 011 / init
-- 03_uk_integration.sql. UK accepts the old Russian during a transition window
-- but asked us to switch to keys.
--
-- The outbound forwarder (src/services/uk/alertForwarder.js) already normalizes
-- to a key at send time and tolerates both formats, so this backfill is NOT
-- required for wire-correctness — it aligns the stored canonical data (and the
-- admin "Правила эскалации" UI, which renders uk_urgency verbatim) with the new
-- contract, so operators see keys instead of mixed Russian/key values.
--
-- Idempotent: rows already holding a key are left unchanged by the CASE ELSE.
-- Safe on a fresh DB (init seed already uses keys → CASE matches nothing).

UPDATE alert_rules
SET uk_urgency = CASE uk_urgency
        WHEN 'Обычная'     THEN 'low'
        WHEN 'Средняя'     THEN 'medium'
        WHEN 'Срочная'     THEN 'high'
        WHEN 'Критическая' THEN 'critical'
        ELSE uk_urgency
    END
WHERE uk_urgency IN ('Обычная', 'Средняя', 'Срочная', 'Критическая');
