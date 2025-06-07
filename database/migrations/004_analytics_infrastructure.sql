-- Миграция 004: Инфраструктурные сущности для аналитики
-- Дата: 2025-01-27
-- Описание: Добавление таблиц для трансформаторов, источников воды и других инфраструктурных объектов

-- Включение PostGIS для геопространственной аналитики
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Таблица электрических трансформаторов
CREATE TABLE power_transformers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    capacity_kva NUMERIC(8,2) NOT NULL, -- Мощность в кВА
    voltage_primary NUMERIC(8,2), -- Первичное напряжение
    voltage_secondary NUMERIC(8,2), -- Вторичное напряжение
    installation_date DATE,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    maintenance_contact VARCHAR(100),
    notes TEXT,
    geom geometry(POINT, 4326), -- Геометрия для PostGIS
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для трансформаторов
CREATE INDEX idx_power_transformers_status ON power_transformers(status);
CREATE INDEX idx_power_transformers_capacity ON power_transformers(capacity_kva);
CREATE INDEX idx_power_transformers_geom ON power_transformers USING GIST(geom);

-- 2. Таблица источников холодной воды (насосные станции, водозаборы)
CREATE TABLE cold_water_sources (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'pumping_station', 'well', 'reservoir'
    capacity_m3_per_hour NUMERIC(8,2), -- Производительность м³/час
    operating_pressure_bar NUMERIC(5,2), -- Рабочее давление
    installation_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    maintenance_contact VARCHAR(100),
    notes TEXT,
    geom geometry(POINT, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для источников холодной воды
CREATE INDEX idx_cold_water_sources_status ON cold_water_sources(status);
CREATE INDEX idx_cold_water_sources_type ON cold_water_sources(source_type);
CREATE INDEX idx_cold_water_sources_geom ON cold_water_sources USING GIST(geom);

-- 3. Таблица источников тепла (котельные, ТЭЦ)
CREATE TABLE heat_sources (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    latitude NUMERIC(9,6) NOT NULL,
    longitude NUMERIC(9,6) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'boiler_house', 'heat_plant', 'chp'
    capacity_mw NUMERIC(8,2), -- Тепловая мощность МВт
    fuel_type VARCHAR(50), -- Тип топлива
    installation_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    maintenance_contact VARCHAR(100),
    notes TEXT,
    geom geometry(POINT, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для источников тепла
CREATE INDEX idx_heat_sources_status ON heat_sources(status);
CREATE INDEX idx_heat_sources_type ON heat_sources(source_type);
CREATE INDEX idx_heat_sources_geom ON heat_sources USING GIST(geom);

-- 4. Обновление таблицы зданий для связи с инфраструктурой
ALTER TABLE buildings ADD COLUMN power_transformer_id VARCHAR(50) REFERENCES power_transformers(id);
ALTER TABLE buildings ADD COLUMN cold_water_source_id VARCHAR(50) REFERENCES cold_water_sources(id);
ALTER TABLE buildings ADD COLUMN heat_source_id VARCHAR(50) REFERENCES heat_sources(id);
ALTER TABLE buildings ADD COLUMN geom geometry(POINT, 4326);

-- Заполняем геометрию для существующих зданий
UPDATE buildings SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326);

-- Индексы для новых связей
CREATE INDEX idx_buildings_power_transformer ON buildings(power_transformer_id);
CREATE INDEX idx_buildings_cold_water_source ON buildings(cold_water_source_id);
CREATE INDEX idx_buildings_heat_source ON buildings(heat_source_id);
CREATE INDEX idx_buildings_geom ON buildings USING GIST(geom);

-- 5. Таблица для алертов инфраструктуры
CREATE TABLE infrastructure_alerts (
    alert_id BIGSERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    infrastructure_id VARCHAR(50) NOT NULL,
    infrastructure_type VARCHAR(50) NOT NULL, -- 'transformer', 'water_source', 'heat_source'
    severity VARCHAR(20) NOT NULL, -- 'INFO', 'WARNING', 'CRITICAL'
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'acknowledged', 'resolved'
    message TEXT NOT NULL,
    affected_buildings INTEGER DEFAULT 0,
    data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    acknowledged_by INTEGER REFERENCES users(user_id),
    resolved_by INTEGER REFERENCES users(user_id)
);

-- Индексы для алертов
CREATE INDEX idx_infrastructure_alerts_type ON infrastructure_alerts(type);
CREATE INDEX idx_infrastructure_alerts_severity ON infrastructure_alerts(severity);
CREATE INDEX idx_infrastructure_alerts_status ON infrastructure_alerts(status);
CREATE INDEX idx_infrastructure_alerts_created_at ON infrastructure_alerts(created_at);
CREATE INDEX idx_infrastructure_alerts_infrastructure ON infrastructure_alerts(infrastructure_id, infrastructure_type);

-- 6. Партиционированная таблица для архивирования аналитики
CREATE TABLE analytics_history (
    id BIGSERIAL,
    analysis_type VARCHAR(50) NOT NULL,
    infrastructure_id VARCHAR(50),
    infrastructure_type VARCHAR(50),
    analysis_date DATE NOT NULL,
    analysis_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (id, analysis_date)
) PARTITION BY RANGE (analysis_date);

-- Создаем партиции для аналитической истории (текущий и предыдущий месяц)
CREATE TABLE analytics_history_current PARTITION OF analytics_history
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE)) TO (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month');

CREATE TABLE analytics_history_prev PARTITION OF analytics_history
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') TO (date_trunc('month', CURRENT_DATE));

-- Индексы для аналитической истории
CREATE INDEX idx_analytics_history_type ON analytics_history(analysis_type);
CREATE INDEX idx_analytics_history_infrastructure ON analytics_history(infrastructure_id, infrastructure_type);
CREATE INDEX idx_analytics_history_date ON analytics_history(analysis_date);

-- 7. Материализованное представление для загрузки трансформаторов в реальном времени
CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS
SELECT 
    pt.id,
    pt.name,
    pt.capacity_kva,
    pt.status,
    pt.latitude,
    pt.longitude,
    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.controller_id END) as active_controllers_count,
    AVG(COALESCE(m.electricity_ph1, 0) + COALESCE(m.electricity_ph2, 0) + COALESCE(m.electricity_ph3, 0)) as avg_total_voltage,
    AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) as avg_total_amperage,
    -- Примерный расчет загрузки (требует уточнения в зависимости от конкретных параметров)
    CASE 
        WHEN pt.capacity_kva > 0 THEN 
            LEAST(100, (AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) * 0.4 / pt.capacity_kva) * 100)
        ELSE 0 
    END as load_percent,
    MAX(m.timestamp) as last_metric_time,
    COUNT(CASE WHEN m.timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count
FROM power_transformers pt
LEFT JOIN buildings b ON pt.id = b.power_transformer_id
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN metrics m ON c.controller_id = m.controller_id 
    AND m.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY pt.id, pt.name, pt.capacity_kva, pt.status, pt.latitude, pt.longitude;

-- Уникальный индекс для конкурентного обновления материализованного представления
CREATE UNIQUE INDEX idx_mv_transformer_load_id ON mv_transformer_load_realtime(id);
CREATE INDEX idx_mv_transformer_load_percent ON mv_transformer_load_realtime(load_percent DESC);
CREATE INDEX idx_mv_transformer_load_status ON mv_transformer_load_realtime(status);

-- 8. Функции для обновления материализованных представлений
CREATE OR REPLACE FUNCTION refresh_transformer_analytics() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;
    
    -- Логируем время обновления
    INSERT INTO logs (timestamp, log_level, message) 
    VALUES (NOW(), 'INFO', 'Материализованное представление трансформаторов обновлено');
    
EXCEPTION WHEN OTHERS THEN
    -- Логируем ошибки
    INSERT INTO logs (timestamp, log_level, message) 
    VALUES (NOW(), 'ERROR', 'Ошибка обновления материализованного представления: ' || SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- 9. Функция для архивирования ежедневной аналитики
CREATE OR REPLACE FUNCTION archive_daily_analytics() RETURNS void AS $$
BEGIN
    -- Архивируем загрузку трансформаторов
    INSERT INTO analytics_history (analysis_type, infrastructure_id, infrastructure_type, analysis_date, analysis_data)
    SELECT 
        'transformer_load',
        id,
        'transformer',
        CURRENT_DATE - INTERVAL '1 day',
        row_to_json(t)
    FROM mv_transformer_load_realtime t
    WHERE NOT EXISTS (
        SELECT 1 FROM analytics_history ah 
        WHERE ah.analysis_type = 'transformer_load' 
        AND ah.infrastructure_id = t.id 
        AND ah.analysis_date = CURRENT_DATE - INTERVAL '1 day'
    );
    
    -- Логируем результат архивирования
    INSERT INTO logs (timestamp, log_level, message) 
    VALUES (NOW(), 'INFO', 'Ежедневная аналитика заархивирована: ' || ROW_COUNT || ' записей');
    
EXCEPTION WHEN OTHERS THEN
    INSERT INTO logs (timestamp, log_level, message) 
    VALUES (NOW(), 'ERROR', 'Ошибка архивирования аналитики: ' || SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- 10. Функция для поиска ближайших зданий к трансформатору
CREATE OR REPLACE FUNCTION find_nearest_buildings_to_transformer(
    transformer_id VARCHAR(50),
    max_distance_meters INTEGER DEFAULT 1000,
    limit_count INTEGER DEFAULT 50
) RETURNS TABLE (
    building_id INTEGER,
    building_name VARCHAR(100),
    distance_meters NUMERIC,
    has_controller BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.building_id,
        b.name,
        ST_Distance(pt.geom::geography, b.geom::geography) as distance_meters,
        EXISTS(SELECT 1 FROM controllers c WHERE c.building_id = b.building_id AND c.status = 'active') as has_controller
    FROM power_transformers pt
    CROSS JOIN buildings b
    WHERE pt.id = transformer_id
      AND ST_DWithin(pt.geom::geography, b.geom::geography, max_distance_meters)
    ORDER BY distance_meters
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 11. Триггер для автоматического обновления геометрии при изменении координат
CREATE OR REPLACE FUNCTION update_geom_on_coordinates_change() RETURNS TRIGGER AS $$
BEGIN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Применяем триггеры
CREATE TRIGGER trig_power_transformers_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON power_transformers
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

CREATE TRIGGER trig_cold_water_sources_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON cold_water_sources
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

CREATE TRIGGER trig_heat_sources_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON heat_sources
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

CREATE TRIGGER trig_buildings_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON buildings
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

-- Комментарии к таблицам
COMMENT ON TABLE power_transformers IS 'Электрические трансформаторы и подстанции';
COMMENT ON TABLE cold_water_sources IS 'Источники холодной воды: насосные станции, скважины, резервуары';
COMMENT ON TABLE heat_sources IS 'Источники тепла: котельные, ТЭЦ, тепловые пункты';
COMMENT ON TABLE infrastructure_alerts IS 'Алерты по состоянию инфраструктурных объектов';
COMMENT ON TABLE analytics_history IS 'Архив аналитических данных с партиционированием по датам';
COMMENT ON MATERIALIZED VIEW mv_transformer_load_realtime IS 'Материализованное представление загрузки трансформаторов в реальном времени'; 