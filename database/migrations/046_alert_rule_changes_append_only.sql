-- Migration 046 — журнал правок правил эскалации только на дозапись (Q-29)
--
-- Что было не так
-- ---------------
-- 029 выдавала роли рантайма на alert_rule_changes «узкий» набор
-- SELECT, INSERT. Но 017 задала ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app:
-- каждая новая таблица, созданная этой ролью, сразу получает для
-- infrasafe_runtime SELECT, INSERT, UPDATE, DELETE. GRANT в 029 ничего не
-- сужал — приложение (и тот, кто им завладел) могло переписать или стереть
-- журнал «кто, что и когда менял в правилах».
--
-- Что делает миграция
-- -------------------
-- Отзывает у рантайма UPDATE, DELETE и TRUNCATE на журнале. Приложение журнал
-- только пишет и читает (src/models/AlertRuleChange.js: INSERT + SELECT).
-- ON DELETE CASCADE от alert_rules продолжает работать: ссылочное действие
-- выполняется от владельца таблицы журнала (infrasafe_app), а не от роли,
-- удаляющей правило (проверено в tests/jest/db/alertRuleChangesAppendOnly).
--
-- Тип изменения: expand-only по смыслу — права, которыми код не пользуется.
-- Идемпотентна: повторный REVOKE ничего не меняет.

BEGIN;

DO $revoke_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON alert_rule_changes FROM infrasafe_runtime';
    END IF;
END
$revoke_runtime$;

COMMIT;
