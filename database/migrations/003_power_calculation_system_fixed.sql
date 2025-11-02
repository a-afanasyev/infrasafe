-- ===============================================
-- МИГРАЦИЯ: Система расчёта мощности
-- ===============================================

-- 1. Функция расчёта мощности по одной фазе
CREATE OR REPLACE FUNCTION calculate_phase_power(
    voltage_v NUMERIC,
    amperage_a NUMERIC,
    power_factor NUMERIC DEFAULT 0.85
) RETURNS NUMERIC AS $$
BEGIN
    IF voltage_v IS NULL OR amperage_a IS NULL OR voltage_v <= 0 OR amperage_a < 0 THEN
        RETURN 0;
    END IF;
    RETURN ROUND((voltage_v * amperage_a * power_factor / 1000)::NUMERIC, 3);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Функция расчёта трёхфазной мощности
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
    power_ph1 := calculate_phase_power(voltage_ph1, amperage_ph1, power_factor);
    power_ph2 := calculate_phase_power(voltage_ph2, amperage_ph2, power_factor);
    power_ph3 := calculate_phase_power(voltage_ph3, amperage_ph3, power_factor);
    total_power := power_ph1 + power_ph2 + power_ph3;
    
    RETURN jsonb_build_object(
        'power_ph1_kw', power_ph1,
        'power_ph2_kw', power_ph2,
        'power_ph3_kw', power_ph3,
        'total_power_kw', total_power
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Материализованное представление: Мощность зданий
DROP MATERIALIZED VIEW IF EXISTS mv_building_power_realtime CASCADE;

CREATE MATERIALIZED VIEW mv_building_power_realtime AS
SELECT
    b.building_id,
    b.name as building_name,
    b.address,
    b.power_transformer_id,
    c.controller_id,
    m.timestamp as last_measurement_time,
    
    m.electricity_ph1 as voltage_ph1,
    m.electricity_ph2 as voltage_ph2,
    m.electricity_ph3 as voltage_ph3,
    m.amperage_ph1,
    m.amperage_ph2,
    m.amperage_ph3,
    
    calculate_phase_power(m.electricity_ph1, m.amperage_ph1) as power_ph1_kw,
    calculate_phase_power(m.electricity_ph2, m.amperage_ph2) as power_ph2_kw,
    calculate_phase_power(m.electricity_ph3, m.amperage_ph3) as power_ph3_kw,
    
    (
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
WHERE m.timestamp IS NOT NULL;

CREATE UNIQUE INDEX idx_mv_building_power_building_id ON mv_building_power_realtime(building_id);
CREATE INDEX idx_mv_building_power_transformer_id ON mv_building_power_realtime(power_transformer_id) WHERE power_transformer_id IS NOT NULL;

-- 4. Материализованное представление: Мощность линий
DROP MATERIALIZED VIEW IF EXISTS mv_line_power_realtime CASCADE;

CREATE MATERIALIZED VIEW mv_line_power_realtime AS
SELECT
    l.line_id,
    l.name as line_name,
    l.transformer_id,
    l.voltage_kv,
    
    COUNT(DISTINCT bp.building_id) as buildings_count,
    
    COALESCE(SUM(bp.power_ph1_kw), 0) as total_power_ph1_kw,
    COALESCE(SUM(bp.power_ph2_kw), 0) as total_power_ph2_kw,
    COALESCE(SUM(bp.power_ph3_kw), 0) as total_power_ph3_kw,
    COALESCE(SUM(bp.total_power_kw), 0) as total_power_kw,
    
    AVG(bp.voltage_ph1) as avg_voltage_ph1,
    AVG(bp.voltage_ph2) as avg_voltage_ph2,
    AVG(bp.voltage_ph3) as avg_voltage_ph3,
    AVG(bp.amperage_ph1) as avg_amperage_ph1,
    AVG(bp.amperage_ph2) as avg_amperage_ph2,
    AVG(bp.amperage_ph3) as avg_amperage_ph3,
    
    MAX(bp.last_measurement_time) as last_measurement_time

FROM lines l
LEFT JOIN buildings b ON (b.primary_line_id = l.line_id OR b.backup_line_id = l.line_id)
LEFT JOIN mv_building_power_realtime bp ON bp.building_id = b.building_id
GROUP BY l.line_id, l.name, l.transformer_id, l.voltage_kv;

CREATE UNIQUE INDEX idx_mv_line_power_line_id ON mv_line_power_realtime(line_id);
CREATE INDEX idx_mv_line_power_transformer_id ON mv_line_power_realtime(transformer_id) WHERE transformer_id IS NOT NULL;

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
    
    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT l.line_id) as lines_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.controller_id END) as active_controllers_count,
    
    COALESCE(SUM(bp.power_ph1_kw), 0) as total_power_ph1_kw,
    COALESCE(SUM(bp.power_ph2_kw), 0) as total_power_ph2_kw,
    COALESCE(SUM(bp.power_ph3_kw), 0) as total_power_ph3_kw,
    COALESCE(SUM(bp.total_power_kw), 0) as total_power_kw,
    
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, (COALESCE(SUM(bp.total_power_kw), 0) / pt.capacity_kva) * 100)
        ELSE 0
    END as load_percent,
    
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
    
    AVG(bp.voltage_ph1) as avg_voltage_ph1,
    AVG(bp.voltage_ph2) as avg_voltage_ph2,
    AVG(bp.voltage_ph3) as avg_voltage_ph3,
    AVG(bp.amperage_ph1) as avg_amperage_ph1,
    AVG(bp.amperage_ph2) as avg_amperage_ph2,
    AVG(bp.amperage_ph3) as avg_amperage_ph3,
    
    MAX(bp.last_measurement_time) as last_measurement_time,
    COUNT(CASE WHEN bp.last_measurement_time > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count

FROM power_transformers pt
LEFT JOIN buildings b ON pt.id = b.power_transformer_id
LEFT JOIN lines l ON pt.id::VARCHAR = l.transformer_id
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN mv_building_power_realtime bp ON bp.building_id = b.building_id
GROUP BY pt.id, pt.name, pt.address, pt.capacity_kva, pt.voltage_primary, 
         pt.voltage_secondary, pt.status, pt.latitude, pt.longitude;

CREATE UNIQUE INDEX idx_mv_transformer_load_id ON mv_transformer_load_realtime(id);
CREATE INDEX idx_mv_transformer_load_percent ON mv_transformer_load_realtime(load_percent DESC);

-- 6. Функция автоматического обновления
CREATE OR REPLACE FUNCTION refresh_power_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_building_power_realtime;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_line_power_realtime;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;
END;
$$ LANGUAGE plpgsql;

-- 7. Представление для анализа дисбаланса фаз
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

-- 8. Первичное заполнение
SELECT refresh_power_materialized_views();
