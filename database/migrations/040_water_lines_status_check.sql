-- Migration 040: water_lines.status — CHECK-констрейнт (M-12b, PR-2b)
--
-- Вторая половина M-12. PR-2 (d6c0f8e, #148) закрыл ПРИЛОЖЕНИЕ: whitelist
-- `WaterLine.assertValidStatus` подключён во все пять путей записи `status`
-- (модель create/update, admin create/update, batch update_status). Но БД
-- по-прежнему принимает что угодно ≤20 символов: `database/init/01_init_database
-- .sql:162` объявляет `status VARCHAR(20) DEFAULT 'active'` без CHECK. Любой
-- прямой SQL, будущий контроллер в обход модели или ручной psql-фикс на проде
-- снова разъедут домен и сломают status-фильтры карты/админки.
--
-- ДОМЕН — три значения, источник истины: селектор в frontend-html/admin.html
-- (active / maintenance / inactive), с которым согласованы `WATER_LINE_STATUS`
-- в src/models/WaterLine.js и ветка set_maintenance в admin-контроллере.
--
-- NULL РАЗРЕШЁН ЯВНО. Колонка nullable с DEFAULT 'active', и `assertValidStatus`
-- намеренно пропускает null/undefined («поле не передано» ≠ «поле невалидно»).
-- Полагаться на то, что `status IN (...)` для NULL даёт NULL и молча проходит
-- CHECK, нельзя: это неочевидная трёхзначная логика, которую легко сломать
-- будущей правкой. Пишем условие целиком.
--
-- КОНСТРЕЙНТ СРАЗУ ВАЛИДНЫЙ (не NOT VALID). Проверено перед релизом:
-- `SELECT count(*) FROM water_lines` = 0 на ОБОИХ продах (profk и infrasafe.uz,
-- 2026-07-25), значений вне домена нет и сканировать нечего — валидация
-- мгновенная, ACCESS EXCLUSIVE держится доли секунды. NOT VALID здесь был бы
-- хуже: он оставил бы констрейнт непроверенным навсегда (VALIDATE никто потом
-- не запускает) без единой причины.
--
-- ЭТО CONTRACT CHANGE, А НЕ EXPAND-ONLY (AUD-043). Раннер применяет схему ДО
-- подмены образа, и при откате на предыдущий образ констрейнт остаётся. Здесь
-- это безопасно: образ, к которому откатываются, — уже PR-2, в нём тот же
-- whitelist на уровне приложения, так что окна «схема строже кода» нет. Именно
-- поэтому 040 едет ОТДЕЛЬНЫМ релизом ПОСЛЕ PR-2, а не вместе с ним.
--
-- Идемпотентна: пере-применение не упадёт (констрейнт добавляется только если
-- его ещё нет).

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.water_lines'::regclass
          AND conname  = 'water_lines_status_check'
    ) THEN
        ALTER TABLE water_lines
            ADD CONSTRAINT water_lines_status_check
            CHECK (status IS NULL OR status IN ('active', 'maintenance', 'inactive'));
    END IF;
END
$$;

COMMENT ON CONSTRAINT water_lines_status_check ON water_lines IS
    'M-12b: домен статуса водной линии (active/maintenance/inactive; NULL = не задан, колонка nullable с DEFAULT active). Дублирует WaterLine.assertValidStatus на уровне БД — защищает от записи мимо модели.';

COMMIT;
