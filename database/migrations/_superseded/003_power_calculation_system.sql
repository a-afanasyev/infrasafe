-- ===============================================
-- МИГРАЦИЯ: Система расчёта мощности
-- ===============================================
-- Описание: Добавляет расчёт активной мощности по фазам для зданий, линий и трансформаторов
-- Дата: 2025-11-02
-- ===============================================

-- 1. Функция расчёта мощности по одной фазе
-- P = U * I * cos(φ) / 1000 (кВт)
CREATE OR REPLACE FUNCTION calculate_phase_power(
    voltage_v NUMERIC,
    amperage_a NUMERIC,
    power_factor NUMERIC DEFAULT 0.85
) RETURNS NUMERIC AS $$
BEGIN
    -- Проверка корректности входных данных
    IF voltage_v IS NULL OR amperage_a IS NULL OR voltage_v <= 0 OR amperage_a < 0 THEN
        RETURN 0;
    END IF;
    
    -- P = U * I * cos(φ) / 1000
    RETURN ROUND((voltage_v * amperage_a * power_factor / 1000)::NUMERIC, 3);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_phase_power IS 'Расчёт активной мощности по одной фазе в кВт';


-- 2. Функция расчёта трёхфазной мощности
-- P_total = P1 + P2 + P3
CREATE OR REPLACE FUNCTION calculate_three_phase_power(
    voltage_ph1 NUMERIC,
    voltage_ph2 NUMERIC,
    voltage_ph3 NUMERIC,
    amperage_ph1 NUMERIC,
    amperage_ph2 NUMERIC,
    amperage_ph3 NUMERIC,
    power_factor NUMERIC DEFAULT 0.85
) RETURNS JSONB AS $$
DECLARE
    power_ph1 NUMERIC;
    power_ph2 NUMERIC;
    power_ph3 NUMERIC;
    total_power NUMERIC;
BEGIN
    -- Расчёт мощности по каждой фазе
    power_ph1 := calculate_phase_power(voltage_ph1, amperage_ph1, power_factor);
    power_ph2 := calculate_phase_power(voltage_ph2, amperage_ph2, power_factor);
    power_ph3 := calculate_phase_power(voltage_ph3, amperage_ph3, power_factor);
    
    -- Общая мощность
    total_power := power_ph1 + power_ph2 + power_ph3;
    
    -- Возвращаем JSON с детализацией по фазам
    RETURN jsonb_build_object(
        'power_ph1_kw', power_ph1,
        'power_ph2_kw', power_ph2,
        'power_ph3_kw', power_ph3,
        'total_power_kw', total_power
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_three_phase_power IS 'Расчёт трёхфазной мощности с детализацией по фазам в кВт';


-- 3. Материализованное представление: Мощность зданий в реальном времени
DROP MATERIALIZED VIEW IF EXISTS mv_building_power_realtime CASCADE;

CREATE MATERIALIZED VIEW mv_building_power_realtime AS
SELECT
    b.building_id,
    b.building_name,
    b.address,
    b.power_transformer_id,
    c.controller_id,
    m.timestamp as last_measurement_time,
    
    -- Напряжение по фазам
    m.electricity_ph1 as voltage_ph1,
    m.electricity_ph2 as voltage_ph2,
    m.electricity_ph3 as voltage_ph3,
    
    -- Ток по фазам
    m.amperage_ph1,
    m.amperage_ph2,
    m.amperage_ph3,
    
    -- Мощность по фазам (кВт)
    calculate_phase_power(m.electricity_ph1, m.amperage_ph1) as power_ph1_kw,
    calculate_phase_power(m.electricity_ph2, m.amperage_ph2) as power_ph2_kw,
    calculate_phase_power(m.electricity_ph3, m.amperage_ph3) as power_ph3_kw,
    
    -- Общая мощность здания (кВт)
    (
        calculate_phase_power(m.electricity_ph1, m.amperage_ph1) +
        calculate_phase_power(m.electricity_ph2, m.amperage_ph2) +
        calculate_phase_power(m.electricity_ph3, m.amperage_ph3)
    ) as total_power_kw
    
FROM buildings b
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN LATERAL (
    SELECT *
    FROM metrics
    WHERE controller_id = c.controller_id
      AND timestamp > NOW() - INTERVAL '1 hour'
    ORDER BY timestamp DESC
    LIMIT 1
) m ON true
WHERE c.controller_id IS NOT NULL;

CREATE UNIQUE INDEX idx_mv_building_power_building_id ON mv_building_power_realtime(building_id);
CREATE INDEX idx_mv_building_power_transformer_id ON mv_building_power_realtime(power_transformer_id);

COMMENT ON MATERIALIZED VIEW mv_building_power_realtime IS 'Текущая потребляемая мощность каждого здания с детализацией по фазам';


-- 4. Материализованное представление: Мощность линий электропередач
DROP MATERIALIZED VIEW IF EXISTS mv_line_power_realtime CASCADE;

CREATE MATERIALIZED VIEW mv_line_power_realtime AS
SELECT
    l.line_id,
    l.name as line_name,
    l.transformer_id,
    l.voltage_kv,
    
    -- Количество подключённых зданий
    COUNT(DISTINCT bp.building_id) as buildings_count,
    
    -- Суммарная мощность по фазам (кВт)
    COALESCE(SUM(bp.power_ph1_kw), 0) as total_power_ph1_kw,
    COALESCE(SUM(bp.power_ph2_kw), 0) as total_power_ph2_kw,
    COALESCE(SUM(bp.power_ph3_kw), 0) as total_power_ph3_kw,
    
    -- Общая мощность линии (кВт)
    COALESCE(SUM(bp.total_power_kw), 0) as total_power_kw,
    
    -- Средние значения напряжения и тока
    AVG(bp.voltage_ph1) as avg_voltage_ph1,
    AVG(bp.voltage_ph2) as avg_voltage_ph2,
    AVG(bp.voltage_ph3) as avg_voltage_ph3,
    AVG(bp.amperage_ph1) as avg_amperage_ph1,
    AVG(bp.amperage_ph2) as avg_amperage_ph2,
    AVG(bp.amperage_ph3) as avg_amperage_ph3,
    
    -- Время последнего измерения
    MAX(bp.last_measurement_time) as last_measurement_time

FROM power_lines l
LEFT JOIN buildings b ON b.power_line_id = l.line_id
LEFT JOIN mv_building_power_realtime bp ON bp.building_id = b.building_id
GROUP BY l.line_id, l.name, l.transformer_id, l.voltage_kv;

CREATE UNIQUE INDEX idx_mv_line_power_line_id ON mv_line_power_realtime(line_id);
CREATE INDEX idx_mv_line_power_transformer_id ON mv_line_power_realtime(transformer_id);

COMMENT ON MATERIALIZED VIEW mv_line_power_realtime IS 'Суммарная потребляемая мощность каждой линии электропередач с детализацией по фазам';


-- 5. Обновлённое материализованное представление: Загрузка трансформаторов
DROP MATERIALIZED VIEW IF EXISTS mv_transformer_load_realtime CASCADE;

CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS
SELECT
    pt.id,
    pt.name,
    pt.address,
    pt.capacity_kva,
    pt.voltage_primary,
    pt.voltage_secondary,
    pt.status,
    pt.latitude,
    pt.longitude,
    
    -- Количество подключённых объектов
    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT l.line_id) as lines_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.controller_id END) as active_controllers_count,
    
    -- Суммарная мощность по фазам от всех зданий (кВт)
    COALESCE(SUM(bp.power_ph1_kw), 0) as total_power_ph1_kw,
    COALESCE(SUM(bp.power_ph2_kw), 0) as total_power_ph2_kw,
    COALESCE(SUM(bp.power_ph3_kw), 0) as total_power_ph3_kw,
    
    -- Общая потребляемая мощность (кВт)
    COALESCE(SUM(bp.total_power_kw), 0) as total_power_kw,
    
    -- Процент загрузки трансформатора (по общей мощности)
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, (COALESCE(SUM(bp.total_power_kw), 0) / pt.capacity_kva) * 100)
        ELSE 0
    END as load_percent,
    
    -- Процент загрузки по каждой фазе
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, (COALESCE(SUM(bp.power_ph1_kw), 0) / (pt.capacity_kva / 3)) * 100)
        ELSE 0
    END as load_percent_ph1,
    
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, (COALESCE(SUM(bp.power_ph2_kw), 0) / (pt.capacity_kva / 3)) * 100)
        ELSE 0
    END as load_percent_ph2,
    
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, (COALESCE(SUM(bp.power_ph3_kw), 0) / (pt.capacity_kva / 3)) * 100)
        ELSE 0
    END as load_percent_ph3,
    
    -- Средние значения напряжения и тока
    AVG(bp.voltage_ph1) as avg_voltage_ph1,
    AVG(bp.voltage_ph2) as avg_voltage_ph2,
    AVG(bp.voltage_ph3) as avg_voltage_ph3,
    AVG(bp.amperage_ph1) as avg_amperage_ph1,
    AVG(bp.amperage_ph2) as avg_amperage_ph2,
    AVG(bp.amperage_ph3) as avg_amperage_ph3,
    
    -- Время последнего измерения
    MAX(bp.last_measurement_time) as last_measurement_time,
    
    -- Количество актуальных измерений
    COUNT(CASE WHEN bp.last_measurement_time > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count

FROM power_transformers pt
LEFT JOIN buildings b ON pt.id = b.power_transformer_id
LEFT JOIN power_lines l ON pt.id = l.transformer_id
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN mv_building_power_realtime bp ON bp.building_id = b.building_id
GROUP BY pt.id, pt.name, pt.address, pt.capacity_kva, pt.voltage_primary, 
         pt.voltage_secondary, pt.status, pt.latitude, pt.longitude;

CREATE UNIQUE INDEX idx_mv_transformer_load_id ON mv_transformer_load_realtime(id);
CREATE INDEX idx_mv_transformer_load_percent ON mv_transformer_load_realtime(load_percent DESC);

COMMENT ON MATERIALIZED VIEW mv_transformer_load_realtime IS 'Загрузка трансформаторов с расчётом реальной мощности и детализацией по фазам';


-- 6. Функция автоматического обновления материализованных представлений
CREATE OR REPLACE FUNCTION refresh_power_materialized_views()
RETURNS void AS $$
BEGIN
    -- Обновляем в правильном порядке (от зависимых к независимым)
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_building_power_realtime;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_line_power_realtime;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;
    
    RAISE NOTICE 'Power materialized views refreshed successfully';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_power_materialized_views IS 'Обновление всех материализованных представлений для расчёта мощности';


-- 7. Создаём задачу для периодического обновления (если установлен pg_cron)
-- Обновление каждые 5 минут
-- SELECT cron.schedule('refresh-power-views', '*/5 * * * *', 'SELECT refresh_power_materialized_views();');


-- 8. Представление для детального анализа дисбаланса фаз
CREATE OR REPLACE VIEW v_phase_imbalance_analysis AS
SELECT
    id,
    name,
    capacity_kva,
    total_power_kw,
    load_percent,
    
    -- Мощность по фазам
    total_power_ph1_kw,
    total_power_ph2_kw,
    total_power_ph3_kw,
    
    -- Загрузка по фазам
    load_percent_ph1,
    load_percent_ph2,
    load_percent_ph3,
    
    -- Коэффициент дисбаланса (максимальное отклонение от средней загрузки)
    GREATEST(
        ABS(load_percent_ph1 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
        ABS(load_percent_ph2 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
        ABS(load_percent_ph3 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3)
    ) as phase_imbalance_percent,
    
    -- Статус дисбаланса
    CASE
        WHEN GREATEST(
            ABS(load_percent_ph1 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
            ABS(load_percent_ph2 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
            ABS(load_percent_ph3 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3)
        ) > 20 THEN 'CRITICAL'
        WHEN GREATEST(
            ABS(load_percent_ph1 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
            ABS(load_percent_ph2 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
            ABS(load_percent_ph3 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3)
        ) > 10 THEN 'WARNING'
        ELSE 'OK'
    END as imbalance_status

FROM mv_transformer_load_realtime
WHERE total_power_kw > 0;

COMMENT ON VIEW v_phase_imbalance_analysis IS 'Анализ дисбаланса нагрузки по фазам для трансформаторов';


-- 9. Первичное заполнение материализованных представлений
SELECT refresh_power_materialized_views();

RAISE NOTICE 'Migration 003_power_calculation_system completed successfully';
