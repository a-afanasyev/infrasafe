-- Migration 042: домен статуса контроллера + счётчик активных в представлении
--
-- Что было не так
-- ---------------
-- Домен `controllers.status` не был закреплён нигде, кроме кода:
--   * в схеме — `varchar(20) NOT NULL` без DEFAULT и без CHECK
--     (01_init_database.sql:98);
--   * приложение требует online | offline | maintenance
--     (validators.js:47, controllerService.js:174, а с волны C — ещё и
--     whitelist на всех трёх путях записи модели);
--   * `mv_transformer_load_realtime` считает `c.status = 'active'`
--     (01_init_database.sql:846) — значение, которого в этом домене НЕТ.
--
-- Следствие: `active_controllers_count` в представлении — всегда ноль.
-- Проверено на infrasafe.uz: у трансформатора 12 `controllers_count = 1` при
-- `active_controllers_count = 0`.
--
-- Откуда взялось 'active': это домен статуса ТРАНСФОРМАТОРА
-- (`transformers.status DEFAULT 'active'`, 01_init_database.sql:120), где оно
-- законно. В представлении, объединяющем обе сущности, условие написали по
-- соседней колонке.
--
-- ⚠️ Поправка к комментарию в src/observability/metrics.js:148-152: там сказано,
-- что `DEFAULT 'active'` стоит у контроллеров со ссылкой на строку 120. Строка
-- 120 — это `transformers`. У `controllers` DEFAULT'а нет вовсе (проверено на
-- обеих площадках через information_schema). Комментарий исправлен тем же PR.
--
-- Обход этой же проблемы уже живёт в metrics.js: `expected_controllers`
-- считается от обратного (`IS DISTINCT FROM 'maintenance'`) именно потому, что
-- фильтр по 'active' давал бы ноль и правило о протухшей телеметрии молчало бы
-- вечно. Обход остаётся — он корректен по смыслу («ждём телеметрию от всего,
-- что не выведено в обслуживание»), но теперь у него есть закреплённый домен.
--
-- Данные на момент миграции
-- -------------------------
-- profk: контроллеров нет вовсе. infrasafe.uz: 2 строки, обе 'online'.
-- Значений вне домена на продах НЕТ — CHECK ставится сразу VALID, сканировать
-- нечего. Расхождение живёт только в dev-сиде (active=10, online=21), поэтому
-- шаг 1 ниже на продах будет no-op, а свежий bootstrap перестанет создавать
-- строки вне домена (правка 02_seed_data.sql тем же PR).
--
-- Тип изменения: CONTRACT, не expand-only. Ставится ПОСЛЕ того, как приложение
-- уже отвергает значения вне домена (волна C, whitelist в модели) — то есть
-- образ отката несёт тот же список, и откат безопасен. Тот же порядок, что у
-- миграции 040 для водных линий.

BEGIN;

-- Шаг 1. Привести существующие значения к домену.
-- На продах — no-op. В dev/fresh переводит сид'овое 'active' в 'online':
-- по смыслу это одно и то же («работает»), а не 'maintenance' и не 'offline'.
UPDATE controllers
   SET status = 'online'
 WHERE status NOT IN ('online', 'offline', 'maintenance');

-- Шаг 2. Закрепить домен в схеме.
-- NOT NULL уже стоит в определении таблицы, поэтому NULL здесь не обсуждается —
-- в отличие от миграции 040, где колонка nullable и NULL разрешён явно.
ALTER TABLE controllers
    DROP CONSTRAINT IF EXISTS controllers_status_check;

ALTER TABLE controllers
    ADD CONSTRAINT controllers_status_check
    CHECK (status IN ('online', 'offline', 'maintenance'));

COMMENT ON CONSTRAINT controllers_status_check ON controllers IS
    'Миграция 042: домен статуса контроллера. Источник истины — validators.js:47 и Controller.assertValidControllerStatus. НЕ путать с transformers.status, где домен другой и включает active.';

-- Шаг 3. Пересоздать представление с корректным счётчиком.
--
-- DROP + CREATE, а не CREATE OR REPLACE: у материализованных представлений
-- REPLACE не существует. Имя сохраняется, поэтому SECURITY DEFINER обёртка
-- `refresh_mv_transformer_load()` из миграции 020 продолжает работать без
-- изменений. Владельцем становится роль, выполняющая миграцию
-- (infrasafe_app) — та же, что владела им раньше, иначе обёртка потеряла бы
-- право на REFRESH.
DROP MATERIALIZED VIEW IF EXISTS mv_transformer_load_realtime;

CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS
SELECT
    t.transformer_id AS id,
    t.name,
    t.power_kva AS capacity_kva,
    t.status,
    t.latitude,
    t.longitude,

    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    -- [042] Было `c.status = 'active'` — значение из домена ТРАНСФОРМАТОРА,
    -- поэтому счётчик всегда возвращал 0. 'online' — единственный статус
    -- контроллера, означающий «на связи и работает».
    COUNT(DISTINCT CASE WHEN c.status = 'online' THEN c.controller_id END) as active_controllers_count,

    AVG(COALESCE(m.electricity_ph1, 0) + COALESCE(m.electricity_ph2, 0) + COALESCE(m.electricity_ph3, 0)) as avg_total_voltage,
    AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) as avg_total_amperage,

    CASE
        WHEN t.power_kva > 0 THEN
            LEAST(100, AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) * 0.4 / t.power_kva * 100)
        ELSE 0
    END as load_percent,

    MAX(m.timestamp) as last_metric_time,
    COUNT(CASE WHEN m.timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count

FROM transformers t
LEFT JOIN buildings b ON b.primary_transformer_id = t.transformer_id
                      OR b.backup_transformer_id = t.transformer_id
LEFT JOIN controllers c ON c.building_id = b.building_id
LEFT JOIN metrics m ON m.controller_id = c.controller_id
                    AND m.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY t.transformer_id, t.name, t.power_kva, t.status, t.latitude, t.longitude;

-- Индексы восстанавливаются вместе с представлением. UNIQUE по id обязателен:
-- без него `REFRESH MATERIALIZED VIEW CONCURRENTLY` в обёртке 020 откажется
-- работать, а обычный REFRESH блокировал бы читателей — ровно то, ради чего
-- обёртку и заводили.
CREATE UNIQUE INDEX idx_mv_transformer_load_id
    ON mv_transformer_load_realtime (id);
CREATE INDEX idx_mv_transformer_load_percent
    ON mv_transformer_load_realtime (load_percent DESC);
CREATE INDEX idx_mv_transformer_load_status
    ON mv_transformer_load_realtime (status);

-- Права пересоздаются вместе с объектом: прежний ACL был
-- {infrasafe_app=arwdDxt, infrasafe_runtime=arwd}. Приложению нужен только
-- SELECT — пишет в представление исключительно REFRESH, а он идёт через
-- SECURITY DEFINER обёртку от имени владельца.
DO $grant_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'GRANT SELECT ON mv_transformer_load_realtime TO infrasafe_runtime';
    END IF;
END
$grant_runtime$;

COMMIT;
