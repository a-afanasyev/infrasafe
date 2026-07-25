-- Migration 041: alert_rules — сезонное окно правила (B-009)
--
-- Схема не знала про сезон вообще: `grep active_from|active_to` по
-- database/migrations/ и src/models/AlertRule.js давал ноль совпадений. Из-за
-- этого HEATING_FAILURE срабатывает круглый год — в июле «нет горячей воды»
-- отправляется в УК как авария отопления.
--
-- ФОРМАТ: 'MM-DD' в CHAR(5), а не DATE.
--   Окно РЕКУРРЕНТНОЕ (повторяется каждый год) — DATE потребовал бы ежегодного
--   обновления строк и молча «протухал» бы 1 января. Год в значении не нужен.
--   Лексикографическое сравнение zero-padded 'MM-DD' совпадает с календарным
--   ('10-15' > '04-15'), поэтому и SQL-, и JS-сравнение работают напрямую, без
--   парсинга. Плюс значение читаемо и в psql, и в админке — в отличие от
--   MMDD-числа (1015), которое пришлось бы декодировать глазами.
--
-- ПЕРЕХОД ЧЕРЕЗ НОВЫЙ ГОД — основной случай, а не краевой: отопительный сезон
-- идёт с середины октября по середину апреля. Семантика:
--   season_from <= season_to  → внутри, если from <= today <= to   (напр. 06-01..08-31)
--   season_from >  season_to  → внутри, если today >= from ИЛИ today <= to  (10-15..04-15)
-- Логика живёт в src/services/alert/alertGates.js (checkSeasonGate) — здесь
-- только хранение и валидация формата.
--
-- ОБА NULL = круглый год. Это и есть значение по умолчанию для ВСЕХ
-- существующих строк, поэтому миграция НЕ меняет поведение: после её наката
-- (схема применяется до подмены образа) старый код колонок не видит, новый код
-- видит NULL и пропускает гейт. Окно включается отдельным осознанным действием
-- оператора через админку («Правила эскалации»), а не этой миграцией — иначе
-- деплой посреди лета молча выключил бы HEATING-эскалацию.
--
-- ПОЛУЗАПОЛНЕННАЯ ПАРА ЗАПРЕЩЕНА констрейнтом: одно поле без второго — это не
-- «открытый интервал», а почти наверняка недоредактированная строка, и
-- трактовать её пришлось бы гаданием. Пусть падает на записи.
--
-- Expand-only (AUD-043): только nullable-колонки + CHECK'и на них. Откат на
-- предыдущий образ безопасен — старый код эти колонки не читает.

BEGIN;

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS season_from CHAR(5),
    ADD COLUMN IF NOT EXISTS season_to   CHAR(5);

COMMENT ON COLUMN alert_rules.season_from IS
    'B-009: начало сезонного окна в формате MM-DD (рекуррентное, без года). NULL вместе с season_to = правило действует круглый год.';
COMMENT ON COLUMN alert_rules.season_to IS
    'B-009: конец сезонного окна MM-DD, включительно. Если season_from > season_to — окно переходит через Новый год (отопительный сезон).';

-- Формат. Регекс допускает 02-30/02-31 — как ГРАНИЦА такое значение безвредно
-- (сравнение остаётся корректным, просто дата недостижима), а полноценная
-- проверка длины месяца без года невозможна: 02-29 обязана быть валидной.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.alert_rules'::regclass
          AND conname  = 'alert_rules_season_format_check'
    ) THEN
        ALTER TABLE alert_rules
            ADD CONSTRAINT alert_rules_season_format_check
            CHECK (
                (season_from IS NULL OR season_from ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
                AND
                (season_to   IS NULL OR season_to   ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
            );
    END IF;
END
$$;

-- Пара: оба заданы или оба пусты.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.alert_rules'::regclass
          AND conname  = 'alert_rules_season_pair_check'
    ) THEN
        ALTER TABLE alert_rules
            ADD CONSTRAINT alert_rules_season_pair_check
            CHECK ((season_from IS NULL) = (season_to IS NULL));
    END IF;
END
$$;

COMMIT;
