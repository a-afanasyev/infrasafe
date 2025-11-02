-- ===============================================
-- МИГРАЦИЯ: Система расчёта мощности v2
-- ===============================================

-- 1. Функция расчёта мощности по одной фазе: P = U * I * cos(φ) / 1000 (кВт)
CREATE OR REPLACE FUNCTION calculate_phase_power(
    voltage_v NUMERIC,
    amperage_a NUMERIC,
    power_factor NUMERIC DEFAULT 0.85
) RETURNS NUMERIC AS $$
BEGIN
    IF voltage_v IS NULL OR amperage_a IS NULL OR voltage_v <= 0 OR amperage_a < 0 THEN
        RETURN 0;
    END IF
    RETURN ROUND((voltage_v * amperage_a * power_factor / 1000)::NUMERIC, 3);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_phase_power IS 
'Расчёт активной мощности по одной фазе в кВт. P = U * I * cos(φ) / 1000';


-- 2. Материализованное представление: Мощность зданий (агрегация по всем контроллерам)
DROP MATERIALIZED VIEW IF EXISTS mv_transformer_load_realtime CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_line_power_realtime CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_building_power_realtime CASCADE;

CREATE MATERIALIZED VIEW mv_building_power_realtime AS
SELECT
    b.building_id,
    b.name as building_name,
    b.address,
    b.power_transformer_id,
    b.primary_line_id,
    b.backup_line_id,
    
    -- Агрегируем данные по всем контроллерам здания
    MAX(m.timestamp) as last_measurement_time,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    
    -- Суммируем напряжение и ток по всем контроллерам, затем усредняем
    AVG(m.electricity_ph1) as avg_voltage_ph1,
    AVG(m.electricity_ph2) as avg_voltage_ph2,
    AVG(m.electricity_ph3) as avg_voltage_ph3,
    SUM(m.amperage_ph1) as total_amperage_ph1,
    SUM(m.amperage_ph2) as total_amperage_ph2,
    SUM(m.amperage_ph3) as total_amperage_ph3,
    
    -- Мощность по каждой фазе (кВт)
    SUM(calculate_phase_power(m.electricity_ph1, m.amperage_ph1)) as power_ph1_kw,
    SUM(calculate_phase_power(m.electricity_ph2, m.amperage_ph2)) as power_ph2_kw,
    SUM(calculate_phase_power(m.electricity_ph3, m.amperage_ph3)) as power_ph3_kw,
    
    -- Общая мощность здания (кВт)
    SUM(
        calculate_phase_power(m.electricity_ph1, m.amperage_ph1) +
        calculate_phase_power(m.electricity_ph2, m.amperage_ph2) +
        calculate_phase_power(m.electricity_ph3, m.amperage_ph3)
    ) as total_power_kw
    
FROM buildings b
INNER JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN LATERAL (
    SELECT *
    FROM metrics
    WHERE controller_id = c.controller_id
      AND timestamp > NOW() - INTERVAL '1 hour'
    ORDER BY timestamp DESC
    LIMIT 1
) m ON true
WHERE m.timestamp IS NOT NULL
GROUP BY b.building_id, b.name, b.address, b.power_transformer_id, b.primary_line_id, b.backup_line_id;

CREATE UNIQUE INDEX idx_mv_building_power_building_id ON mv_building_power_realtime(building_id);
CREATE INDEX idx_mv_building_power_transformer_id ON mv_building_power_realtime(power_transformer_id) 
    WHERE power_transformer_id IS NOT NULL;
CREATE INDEX idx_mv_building_power_primary_line ON mv_building_power_realtime(primary_line_id)
    WHERE primary_line_id IS NOT NULL;

COMMENT ON MATERIALIZED VIEW mv_building_power_realtime IS 
'Текущая потребляемая мощность каждого здания с детализацией по фазам. Агрегирует данные всех контроллеров здания.';


-- 3. Материализованное представление: Мощность линий
CREATE MATERIALIZED VIEW mv_line_power_realtime AS
SELECT
    l.line_id,
    l.name as line_name,
    l.transformer_id,
    l.voltage_kv,
    
    -- Подключённые здания
    COUNT(DISTINCT bp.building_id) as buildings_count,
    
    -- Суммарная мощность по фазам (кВт)
    COALESCE(SUM(bp.power_ph1_kw), 0) as total_power_ph1_kw,
    COALESCE(SUM(bp.power_ph2_kw), 0) as total_power_ph2_kw,
    COALESCE(SUM(bp.power_ph3_kw), 0) as total_power_ph3_kw,
    
    -- Общая мощность линии (кВт)
    COALESCE(SUM(bp.total_power_kw), 0) as total_power_kw,
    
    -- Средние значения для мониторинга
    AVG(bp.avg_voltage_ph1) as avg_voltage_ph1,
    AVG(bp.avg_voltage_ph2) as avg_voltage_ph2,
    AVG(bp.avg_voltage_ph3) as avg_voltage_ph3,
    AVG(bp.total_amperage_ph1) as avg_amperage_ph1,
    AVG(bp.total_amperage_ph2) as avg_amperage_ph2,
    AVG(bp.total_amperage_ph3) as avg_amperage_ph3,
    
    MAX(bp.last_measurement_time) as last_measurement_time

FROM lines l
LEFT JOIN buildings b ON (b.primary_line_id = l.line_id OR b.backup_line_id = l.line_id)
LEFT JOIN mv_building_power_realtime bp ON bp.building_id = b.building_id
GROUP BY l.line_id, l.name, l.transformer_id, l.voltage_kv;

CREATE UNIQUE INDEX idx_mv_line_power_line_id ON mv_line_power_realtime(line_id);
CREATE INDEX idx_mv_line_power_transformer_id ON mv_line_power_realtime(transformer_id) 
    WHERE transformer_id IS NOT NULL;

COMMENT ON MATERIALIZED VIEW mv_line_power_realtime IS 
'Суммарная потребляемая мощность каждой линии с детализацией по фазам';


-- 4. Материализованное представление: Загрузка трансформаторов
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
    
    -- Подключённые объекты
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
    
    -- Процент загрузки (общий)
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, (COALESCE(SUM(bp.total_power_kw), 0) / pt.capacity_kva) * 100)
        ELSE 0
    END as load_percent,
    
    -- Процент загрузки по каждой фазе (предполагаем равное распределение capacity)
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
    
    -- Средние значения для мониторинга
    AVG(bp.avg_voltage_ph1) as avg_voltage_ph1,
    AVG(bp.avg_voltage_ph2) as avg_voltage_ph2,
    AVG(bp.avg_voltage_ph3) as avg_voltage_ph3,
    AVG(bp.total_amperage_ph1) as avg_amperage_ph1,
    AVG(bp.total_amperage_ph2) as avg_amperage_ph2,
    AVG(bp.total_amperage_ph3) as avg_amperage_ph3,
    
    MAX(bp.last_measurement_time) as last_measurement_time,
    COUNT(CASE WHEN bp.last_measurement_time > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count

FROM power_transformers pt
LEFT JOIN buildings b ON pt.id = b.power_transformer_id
LEFT JOIN lines l ON l.transformer_id::VARCHAR = pt.id
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN mv_building_power_realtime bp ON bp.building_id = b.building_id
GROUP BY pt.id, pt.name, pt.address, pt.capacity_kva, pt.voltage_primary, 
         pt.voltage_secondary, pt.status, pt.latitude, pt.longitude;

CREATE UNIQUE INDEX idx_mv_transformer_load_id ON mv_transformer_load_realtime(id);
CREATE INDEX idx_mv_transformer_load_percent ON mv_transformer_load_realtime(load_percent DESC);

COMMENT ON MATERIALIZED VIEW mv_transformer_load_realtime IS 
'Загрузка трансформаторов с расчётом реальной мощности и детализацией по фазам';


-- 5. Функция обновления
CREATE OR REPLACE FUNCTION refresh_power_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_building_power_realtime;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_line_power_realtime;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_power_materialized_views IS 
'Обновление всех материализованных представлений для расчёта мощности';


-- 6. Представление для анализа дисбаланса фаз
CREATE OR REPLACE VIEW v_phase_imbalance_analysis AS
SELECT
    id,
    name,
    capacity_kva,
    total_power_kw,
    load_percent,
    total_power_ph1_kw,
    total_power_ph2_kw,
    total_power_ph3_kw,
    load_percent_ph1,
    load_percent_ph2,
    load_percent_ph3,
    
    GREATEST(
        ABS(load_percent_ph1 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
        ABS(load_percent_ph2 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3),
        ABS(load_percent_ph3 - (load_percent_ph1 + load_percent_ph2 + load_percent_ph3) / 3)
    ) as phase_imbalance_percent,
    
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

COMMENT ON VIEW v_phase_imbalance_analysis IS 
'Анализ дисбаланса нагрузки по фазам. CRITICAL > 20%, WARNING > 10%';


-- 7. Первичное заполнение
SELECT refresh_power_materialized_views();
