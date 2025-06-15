-- ===============================================
-- Инициализация базы данных InfraSafe с PostGIS
-- ===============================================

-- Включение расширения PostGIS для работы с географическими данными
CREATE EXTENSION IF NOT EXISTS postgis;

-- Создание таблицы типов оповещений
CREATE TABLE alert_types (
    alert_type_id serial PRIMARY KEY,
    type_name varchar(50) NOT NULL UNIQUE,
    description text
);

-- Создание таблицы пользователей (для админки и системы алертов)
CREATE TABLE users (
    user_id serial PRIMARY KEY,
    username varchar(50) NOT NULL UNIQUE,
    email varchar(100) NOT NULL UNIQUE,
    password_hash varchar(255) NOT NULL,
    full_name varchar(100),
    role varchar(20) DEFAULT 'user', -- 'admin', 'operator', 'user'
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW(),
    last_login timestamptz
);

-- Индексы для пользователей
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = true;

-- Создание таблицы зданий
CREATE TABLE buildings (
    building_id serial PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    town varchar(100) NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    region varchar(50),
    management_company varchar(100),
    hot_water boolean,
    has_hot_water boolean DEFAULT false,
    geom geometry(POINT, 4326), -- PostGIS геометрия
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Индексы для зданий
CREATE INDEX idx_buildings_town ON buildings(town);
CREATE INDEX idx_buildings_geom ON buildings USING GIST(geom);

-- Создание таблиц инфраструктурных объектов

-- 1. Таблица электрических трансформаторов
CREATE TABLE power_transformers (
    id varchar(50) PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    capacity_kva numeric(8,2) NOT NULL, -- Мощность в кВА
    voltage_primary numeric(8,2), -- Первичное напряжение
    voltage_secondary numeric(8,2), -- Вторичное напряжение
    installation_date date,
    manufacturer varchar(100),
    model varchar(100),
    status varchar(20) DEFAULT 'active',
    maintenance_contact varchar(100),
    notes text,
    geom geometry(POINT, 4326), -- PostGIS геометрия
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Индексы для трансформаторов
CREATE INDEX idx_power_transformers_status ON power_transformers(status);
CREATE INDEX idx_power_transformers_capacity ON power_transformers(capacity_kva);
CREATE INDEX idx_power_transformers_geom ON power_transformers USING GIST(geom);

-- 2. Таблица источников холодной воды (насосные станции, водозаборы)
CREATE TABLE cold_water_sources (
    id varchar(50) PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    source_type varchar(50) NOT NULL, -- 'pumping_station', 'well', 'reservoir'
    capacity_m3_per_hour numeric(8,2), -- Производительность м³/час
    operating_pressure_bar numeric(5,2), -- Рабочее давление
    installation_date date,
    status varchar(20) DEFAULT 'active',
    maintenance_contact varchar(100),
    notes text,
    geom geometry(POINT, 4326),
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Индексы для источников холодной воды
CREATE INDEX idx_cold_water_sources_status ON cold_water_sources(status);
CREATE INDEX idx_cold_water_sources_type ON cold_water_sources(source_type);
CREATE INDEX idx_cold_water_sources_geom ON cold_water_sources USING GIST(geom);

-- 3. Таблица источников тепла (котельные, ТЭЦ)
CREATE TABLE heat_sources (
    id varchar(50) PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    source_type varchar(50) NOT NULL, -- 'boiler_house', 'heat_plant', 'chp'
    capacity_mw numeric(8,2), -- Тепловая мощность МВт
    fuel_type varchar(50), -- Тип топлива
    installation_date date,
    status varchar(20) DEFAULT 'active',
    maintenance_contact varchar(100),
    notes text,
    geom geometry(POINT, 4326),
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Индексы для источников тепла
CREATE INDEX idx_heat_sources_status ON heat_sources(status);
CREATE INDEX idx_heat_sources_type ON heat_sources(source_type);
CREATE INDEX idx_heat_sources_geom ON heat_sources USING GIST(geom);

-- ===============================================
-- ТАБЛИЦЫ ВОДОСНАБЖЕНИЯ
-- ===============================================

-- Таблица линий водоснабжения
CREATE TABLE water_lines (
    line_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    diameter_mm INTEGER CHECK (diameter_mm > 0),
    material VARCHAR(100),
    pressure_bar DECIMAL(5,2) CHECK (pressure_bar > 0),
    installation_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Таблица поставщиков воды
CREATE TABLE water_suppliers (
    supplier_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    supplier_type VARCHAR(50) NOT NULL, -- 'cold_water', 'hot_water', 'both'
    contact_person VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    tariff_per_m3 DECIMAL(10,2),
    contract_number VARCHAR(100),
    contract_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Таблица точек измерения воды
CREATE TABLE water_measurement_points (
    point_id SERIAL PRIMARY KEY,
    building_id INTEGER NOT NULL REFERENCES buildings(building_id) ON DELETE CASCADE,
    point_type VARCHAR(50) NOT NULL, -- 'cold_water', 'hot_water_supply', 'hot_water_return'
    location VARCHAR(255),
    meter_serial VARCHAR(100),
    installation_date DATE,
    last_reading DECIMAL(10,3),
    last_reading_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для водоснабжения
CREATE INDEX idx_water_lines_name ON water_lines(name);
CREATE INDEX idx_water_lines_status ON water_lines(status);
CREATE INDEX idx_water_suppliers_name ON water_suppliers(name);
CREATE INDEX idx_water_suppliers_type ON water_suppliers(supplier_type);
CREATE INDEX idx_water_suppliers_status ON water_suppliers(status);
CREATE INDEX idx_water_measurement_points_building ON water_measurement_points(building_id);
CREATE INDEX idx_water_measurement_points_type ON water_measurement_points(point_type);

-- ===============================================
-- ОБНОВЛЕНИЕ ТАБЛИЦЫ ЗДАНИЙ ДЛЯ НОВОЙ АРХИТЕКТУРЫ
-- ===============================================

-- Добавляем поля для связи с инфраструктурой (старые связи)
ALTER TABLE buildings ADD COLUMN power_transformer_id varchar(50);
ALTER TABLE buildings ADD COLUMN cold_water_source_id varchar(50);
ALTER TABLE buildings ADD COLUMN heat_source_id varchar(50);

-- Добавляем поля для новой архитектуры (здания → трансформаторы/линии)
ALTER TABLE buildings ADD COLUMN primary_transformer_id INTEGER;
ALTER TABLE buildings ADD COLUMN backup_transformer_id INTEGER;
ALTER TABLE buildings ADD COLUMN primary_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN backup_line_id INTEGER;

-- Добавляем поля для водоснабжения
ALTER TABLE buildings ADD COLUMN cold_water_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN hot_water_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN cold_water_supplier_id INTEGER;
ALTER TABLE buildings ADD COLUMN hot_water_supplier_id INTEGER;

-- Добавление внешних ключей (старые связи)
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_power_transformer
    FOREIGN KEY (power_transformer_id) REFERENCES power_transformers(id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_source
    FOREIGN KEY (cold_water_source_id) REFERENCES cold_water_sources(id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_heat_source
    FOREIGN KEY (heat_source_id) REFERENCES heat_sources(id);

-- Добавление внешних ключей (новая архитектура)
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_transformer
    FOREIGN KEY (primary_transformer_id) REFERENCES transformers(transformer_id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_backup_transformer
    FOREIGN KEY (backup_transformer_id) REFERENCES transformers(transformer_id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_line
    FOREIGN KEY (primary_line_id) REFERENCES lines(line_id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_backup_line
    FOREIGN KEY (backup_line_id) REFERENCES lines(line_id);

-- Добавление внешних ключей для водоснабжения
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_line
    FOREIGN KEY (cold_water_line_id) REFERENCES water_lines(line_id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_hot_water_line
    FOREIGN KEY (hot_water_line_id) REFERENCES water_lines(line_id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_supplier
    FOREIGN KEY (cold_water_supplier_id) REFERENCES water_suppliers(supplier_id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_hot_water_supplier
    FOREIGN KEY (hot_water_supplier_id) REFERENCES water_suppliers(supplier_id);

-- Индексы для связей (старые)
CREATE INDEX idx_buildings_power_transformer ON buildings(power_transformer_id);
CREATE INDEX idx_buildings_cold_water_source ON buildings(cold_water_source_id);
CREATE INDEX idx_buildings_heat_source ON buildings(heat_source_id);

-- Индексы для связей (новая архитектура)
CREATE INDEX idx_buildings_primary_transformer ON buildings(primary_transformer_id);
CREATE INDEX idx_buildings_backup_transformer ON buildings(backup_transformer_id);
CREATE INDEX idx_buildings_primary_line ON buildings(primary_line_id);
CREATE INDEX idx_buildings_backup_line ON buildings(backup_line_id);

-- Индексы для водоснабжения
CREATE INDEX idx_buildings_cold_water_line ON buildings(cold_water_line_id);
CREATE INDEX idx_buildings_hot_water_line ON buildings(hot_water_line_id);
CREATE INDEX idx_buildings_cold_water_supplier ON buildings(cold_water_supplier_id);
CREATE INDEX idx_buildings_hot_water_supplier ON buildings(hot_water_supplier_id);

-- Создание таблицы контроллеров
CREATE TABLE controllers (
    controller_id serial PRIMARY KEY,
    serial_number varchar(50) NOT NULL UNIQUE,
    vendor varchar(50),
    model varchar(50),
    building_id integer REFERENCES buildings(building_id),
    status varchar(20) NOT NULL,
    installed_at timestamptz DEFAULT now(),
    last_heartbeat timestamptz
);

-- Индексы для контроллеров
CREATE INDEX idx_controllers_building ON controllers(building_id);
CREATE INDEX idx_controllers_status ON controllers(status);
CREATE INDEX idx_controllers_heartbeat ON controllers(last_heartbeat);

-- Создание партиционированной таблицы для метрик
CREATE TABLE metrics (
    metric_id bigserial,
    controller_id integer REFERENCES controllers(controller_id),
    timestamp timestamptz NOT NULL,
    -- Обычные столбцы для электричества
    electricity_ph1 numeric(6,2),
    electricity_ph2 numeric(6,2),
    electricity_ph3 numeric(6,2),
    -- Обычные столбцы для силы тока
    amperage_ph1 numeric(6,2),
    amperage_ph2 numeric(6,2),
    amperage_ph3 numeric(6,2),
    -- Обычные столбцы для холодной воды
    cold_water_pressure numeric(5,2),
    cold_water_temp numeric(5,2),
    -- Обычные столбцы для горячей воды
    hot_water_in_pressure numeric(5,2),
    hot_water_out_pressure numeric(5,2),
    hot_water_in_temp numeric(5,2),
    hot_water_out_temp numeric(5,2),
    -- Параметры окружающей среды
    air_temp numeric(5,2),
    humidity numeric(5,2),
    leak_sensor boolean,
    -- Составной PRIMARY KEY включающий ключ партиционирования
    PRIMARY KEY (metric_id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Создание партиций для метрик (пример)
CREATE TABLE metrics_current_month PARTITION OF metrics
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE)) TO (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month');
CREATE TABLE metrics_prev_month PARTITION OF metrics
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') TO (date_trunc('month', CURRENT_DATE));

-- Создание индексов для таблицы метрик
CREATE INDEX idx_metrics_controller ON metrics(controller_id);
CREATE INDEX idx_metrics_timestamp ON metrics(timestamp);
CREATE INDEX idx_metrics_leak ON metrics(leak_sensor) WHERE leak_sensor = true;

-- Создание таблицы оповещений (старая система)
CREATE TABLE alerts (
    alert_id serial PRIMARY KEY,
    metric_id bigint,
    alert_type_id integer REFERENCES alert_types(alert_type_id),
    severity varchar(20) NOT NULL,
    status varchar(20) DEFAULT 'active',
    created_at timestamptz DEFAULT now(),
    resolved_at timestamptz
);

-- Индексы для старых алертов
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_created_at ON alerts(created_at);
CREATE INDEX idx_alerts_metric ON alerts(metric_id);

-- ===============================================
-- СИСТЕМА АЛЕРТОВ ИНФРАСТРУКТУРЫ (НОВАЯ)
-- ===============================================

-- Таблица пользователей (для связей в алертах)
CREATE TABLE IF NOT EXISTS users (
    user_id serial PRIMARY KEY,
    username varchar(50) NOT NULL UNIQUE,
    email varchar(100) UNIQUE,
    password_hash varchar(255) NOT NULL,
    role varchar(20) DEFAULT 'user',
    is_active boolean DEFAULT true,
    failed_login_attempts integer DEFAULT 0,
    last_failed_login timestamptz,
    account_locked_until timestamptz,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Таблица для refresh токенов
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id bigserial PRIMARY KEY,
    user_id integer REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash varchar(255) NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz DEFAULT NOW()
);

-- Таблица черного списка токенов
CREATE TABLE IF NOT EXISTS token_blacklist (
    id bigserial PRIMARY KEY,
    token_hash varchar(255) NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    blacklisted_at timestamptz DEFAULT NOW()
);

-- Таблица для алертов инфраструктуры (ОСНОВНАЯ НОВАЯ СИСТЕМА)
CREATE TABLE infrastructure_alerts (
    alert_id bigserial PRIMARY KEY,
    type varchar(50) NOT NULL,
    infrastructure_id varchar(50) NOT NULL,
    infrastructure_type varchar(50) NOT NULL, -- 'transformer', 'water_source', 'heat_source'
    severity varchar(20) NOT NULL, -- 'INFO', 'WARNING', 'CRITICAL'
    status varchar(20) DEFAULT 'active', -- 'active', 'acknowledged', 'resolved'
    message text NOT NULL,
    affected_buildings integer DEFAULT 0,
    data jsonb,
    created_at timestamptz DEFAULT NOW(),
    acknowledged_at timestamptz,
    resolved_at timestamptz,
    acknowledged_by integer REFERENCES users(user_id),
    resolved_by integer REFERENCES users(user_id)
);

-- Индексы для алертов инфраструктуры
CREATE INDEX idx_infrastructure_alerts_type ON infrastructure_alerts(type);
CREATE INDEX idx_infrastructure_alerts_severity ON infrastructure_alerts(severity);
CREATE INDEX idx_infrastructure_alerts_status ON infrastructure_alerts(status);
CREATE INDEX idx_infrastructure_alerts_created_at ON infrastructure_alerts(created_at);
CREATE INDEX idx_infrastructure_alerts_infrastructure ON infrastructure_alerts(infrastructure_id, infrastructure_type);

-- Партиционированная таблица для архивирования аналитики
CREATE TABLE analytics_history (
    id bigserial,
    analysis_type varchar(50) NOT NULL,
    infrastructure_id varchar(50),
    infrastructure_type varchar(50),
    analysis_date date NOT NULL,
    analysis_data jsonb NOT NULL,
    created_at timestamptz DEFAULT NOW(),
    PRIMARY KEY (id, analysis_date)
) PARTITION BY RANGE (analysis_date);

-- Создаем партиции для аналитической истории
CREATE TABLE analytics_history_current PARTITION OF analytics_history
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE)) TO (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month');

CREATE TABLE analytics_history_prev PARTITION OF analytics_history
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') TO (date_trunc('month', CURRENT_DATE));

-- Индексы для аналитической истории
CREATE INDEX idx_analytics_history_type ON analytics_history(analysis_type);
CREATE INDEX idx_analytics_history_infrastructure ON analytics_history(infrastructure_id, infrastructure_type);
CREATE INDEX idx_analytics_history_date ON analytics_history(analysis_date);

-- Материализованное представление для загрузки трансформаторов в реальном времени
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
    -- Примерный расчет загрузки
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

-- Таблица логов
CREATE TABLE IF NOT EXISTS logs (
    log_id bigserial PRIMARY KEY,
    timestamp timestamptz DEFAULT NOW(),
    log_level varchar(10) NOT NULL,
    message text NOT NULL,
    details jsonb
);

-- ===============================================
-- ФУНКЦИИ И ТРИГГЕРЫ
-- ===============================================

-- Функция для обновления геометрии при изменении координат
CREATE OR REPLACE FUNCTION update_geom_on_coordinates_change() RETURNS TRIGGER AS $$
BEGIN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггеры для автоматического обновления геометрии
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

-- Функция для обновления last_heartbeat в контроллерах
CREATE OR REPLACE FUNCTION update_controller_heartbeat() RETURNS TRIGGER AS $$
BEGIN
    UPDATE controllers
    SET last_heartbeat = NEW.timestamp
    WHERE controller_id = NEW.controller_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для обновления heartbeat
CREATE TRIGGER trig_update_heartbeat
AFTER INSERT ON metrics
FOR EACH ROW
EXECUTE FUNCTION update_controller_heartbeat();

-- Функции для обновления материализованных представлений
CREATE OR REPLACE FUNCTION refresh_transformer_analytics() RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;

    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'INFO', 'Материализованное представление трансформаторов обновлено');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'ERROR', 'Ошибка обновления материализованного представления: ' || SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Функция для архивирования ежедневной аналитики
CREATE OR REPLACE FUNCTION archive_daily_analytics() RETURNS void AS $$
BEGIN
    -- Архивируем загрузку трансформаторов
    INSERT INTO analytics_history (analysis_type, infrastructure_id, infrastructure_type, analysis_date, analysis_data)
    SELECT
        'daily_transformer_load',
        id,
        'transformer',
        CURRENT_DATE,
        jsonb_build_object(
            'load_percent', load_percent,
            'buildings_count', buildings_count,
            'active_controllers_count', active_controllers_count,
            'avg_total_voltage', avg_total_voltage,
            'avg_total_amperage', avg_total_amperage
        )
    FROM mv_transformer_load_realtime
    WHERE last_metric_time > CURRENT_DATE - INTERVAL '1 day';

    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'INFO', 'Ежедневная аналитика заархивирована');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'ERROR', 'Ошибка архивирования аналитики: ' || SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Функция поиска ближайших зданий к трансформатору
CREATE OR REPLACE FUNCTION find_nearest_buildings_to_transformer(
    transformer_id_param VARCHAR(50),
    radius_meters INTEGER DEFAULT 1000
) RETURNS TABLE (
    building_id INTEGER,
    building_name VARCHAR(100),
    distance_meters DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.building_id,
        b.name,
        ST_Distance(
            ST_Transform(pt.geom, 3857),
            ST_Transform(b.geom, 3857)
        ) as distance_meters
    FROM buildings b
    CROSS JOIN power_transformers pt
    WHERE pt.id = transformer_id_param
    AND ST_DWithin(
        ST_Transform(pt.geom, 3857),
        ST_Transform(b.geom, 3857),
        radius_meters
    )
    ORDER BY distance_meters;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- ИНДЕКСЫ ДЛЯ ПОИСКА И ОПТИМИЗАЦИИ АДМИНКИ
-- ===============================================

-- Полнотекстовый поиск для адресов зданий
CREATE INDEX idx_buildings_address_gin ON buildings USING GIN (to_tsvector('russian', address));

-- Составной индекс для быстрого поиска активных алертов
CREATE INDEX idx_infrastructure_alerts_active ON infrastructure_alerts(status, created_at DESC) WHERE status = 'active';

-- ===============================================
-- ДОПОЛНИТЕЛЬНЫЕ ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ АДМИНКИ
-- ===============================================

-- Индексы для зданий (поиск и сортировка в админке)
CREATE INDEX IF NOT EXISTS idx_buildings_name ON buildings(name);
CREATE INDEX IF NOT EXISTS idx_buildings_region ON buildings(region);
CREATE INDEX IF NOT EXISTS idx_buildings_management_company ON buildings(management_company);

-- Композитные индексы для эффективной сортировки в админке
CREATE INDEX IF NOT EXISTS idx_buildings_name_id ON buildings(name, building_id);
CREATE INDEX IF NOT EXISTS idx_buildings_town_id ON buildings(town, building_id);
CREATE INDEX IF NOT EXISTS idx_buildings_region_id ON buildings(region, building_id);

-- Индексы для контроллеров (расширенные для админки)
CREATE INDEX IF NOT EXISTS idx_controllers_vendor ON controllers(vendor);
CREATE INDEX IF NOT EXISTS idx_controllers_model ON controllers(model);
CREATE INDEX IF NOT EXISTS idx_controllers_serial ON controllers(serial_number);

-- Композитные индексы для сортировки контроллеров
CREATE INDEX IF NOT EXISTS idx_controllers_status_id ON controllers(status, controller_id);
CREATE INDEX IF NOT EXISTS idx_controllers_vendor_id ON controllers(vendor, controller_id);
CREATE INDEX IF NOT EXISTS idx_controllers_building_status ON controllers(building_id, status);

-- Критически важные индексы для метрик (производительность админки)
CREATE INDEX IF NOT EXISTS idx_metrics_controller_timestamp ON metrics(controller_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp_controller ON metrics(timestamp DESC, controller_id);

-- Индекс для получения последних метрик по контроллеру (часто используется в админке)
CREATE INDEX IF NOT EXISTS idx_metrics_controller_latest ON metrics(controller_id, timestamp DESC, metric_id);

-- Индексы для инфраструктурных объектов (для админки инфраструктуры)
CREATE INDEX IF NOT EXISTS idx_power_transformers_name ON power_transformers(name);
CREATE INDEX IF NOT EXISTS idx_cold_water_sources_name ON cold_water_sources(name);
CREATE INDEX IF NOT EXISTS idx_heat_sources_name ON heat_sources(name);

-- Частичные индексы для активных записей (экономия места и скорость)
CREATE INDEX IF NOT EXISTS idx_controllers_active_status ON controllers(controller_id, status)
WHERE status IN ('online', 'maintenance');

-- Функциональные индексы для поиска (без учета регистра)
CREATE INDEX IF NOT EXISTS idx_buildings_name_lower ON buildings(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_buildings_address_lower ON buildings(LOWER(address));
CREATE INDEX IF NOT EXISTS idx_controllers_serial_lower ON controllers(LOWER(serial_number));

-- Индексы для статистики и аналитики в админке
CREATE INDEX IF NOT EXISTS idx_metrics_hourly_stats ON metrics(
    DATE_TRUNC('hour', timestamp),
    controller_id,
    electricity_ph1,
    electricity_ph2,
    electricity_ph3
);

-- Дополнительные индексы для системы алертов
CREATE INDEX IF NOT EXISTS idx_infrastructure_alerts_building_ref ON infrastructure_alerts(
    infrastructure_id, infrastructure_type
) WHERE infrastructure_type = 'building';

-- Индекс для быстрого подсчета статистики в админке
CREATE INDEX IF NOT EXISTS idx_buildings_stats ON buildings(town, region, management_company);
CREATE INDEX IF NOT EXISTS idx_controllers_stats ON controllers(status, vendor, building_id);

-- Комментарии для документации новых индексов
COMMENT ON INDEX idx_buildings_name IS 'Ускоряет поиск зданий по названию в админке';
COMMENT ON INDEX idx_controllers_serial_lower IS 'Поиск контроллеров по серийному номеру без учета регистра';
COMMENT ON INDEX idx_metrics_controller_timestamp IS 'Критический индекс для загрузки последних метрик в админке';
COMMENT ON INDEX idx_controllers_active_status IS 'Частичный индекс только для активных контроллеров';
COMMENT ON INDEX idx_metrics_hourly_stats IS 'Индекс для агрегированной статистики по часам в админке';

-- ===============================================
-- ДОПОЛНИТЕЛЬНЫЕ ТАБЛИЦЫ ДЛЯ АДМИНКИ
-- ===============================================

-- Таблица трансформаторов для CRUD операций в админке
CREATE TABLE IF NOT EXISTS transformers (
    transformer_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    power_kva DECIMAL(10,2) NOT NULL CHECK (power_kva > 0),
    voltage_kv DECIMAL(10,2) NOT NULL CHECK (voltage_kv > 0),
    location VARCHAR(255),
    installation_date DATE,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Таблица линий электропередач для CRUD операций в админке
CREATE TABLE IF NOT EXISTS lines (
    line_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    voltage_kv DECIMAL(10,2) NOT NULL CHECK (voltage_kv > 0),
    length_km DECIMAL(10,3) NOT NULL CHECK (length_km > 0),
    transformer_id INTEGER REFERENCES transformers(transformer_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Комментарии для новых таблиц
COMMENT ON TABLE transformers IS 'Трансформаторы для электроснабжения зданий (админка)';
COMMENT ON TABLE lines IS 'Линии электропередач от трансформаторов (админка)';
COMMENT ON TABLE water_lines IS 'Линии водоснабжения (ХВС и ГВС)';
COMMENT ON TABLE water_suppliers IS 'Поставщики холодной и горячей воды';
COMMENT ON TABLE water_measurement_points IS 'Точки измерения расхода воды в зданиях';

-- Индексы для оптимизации админки - трансформаторы
CREATE INDEX IF NOT EXISTS idx_transformers_name ON transformers(name);
CREATE INDEX IF NOT EXISTS idx_transformers_name_lower ON transformers(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_transformers_power ON transformers(power_kva);
CREATE INDEX IF NOT EXISTS idx_transformers_voltage ON transformers(voltage_kv);
CREATE INDEX IF NOT EXISTS idx_transformers_status ON transformers(status);
CREATE INDEX IF NOT EXISTS idx_transformers_manufacturer ON transformers(manufacturer);
CREATE INDEX IF NOT EXISTS idx_transformers_created_at ON transformers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transformers_stats ON transformers(power_kva, voltage_kv, status);

-- Индексы для оптимизации админки - линии электропередач
CREATE INDEX IF NOT EXISTS idx_lines_transformer_id ON lines(transformer_id);
CREATE INDEX IF NOT EXISTS idx_lines_name ON lines(name);
CREATE INDEX IF NOT EXISTS idx_lines_name_lower ON lines(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_lines_voltage ON lines(voltage_kv);
CREATE INDEX IF NOT EXISTS idx_lines_length ON lines(length_km);
CREATE INDEX IF NOT EXISTS idx_lines_created_at ON lines(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lines_stats ON lines(transformer_id, voltage_kv, length_km);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры для автоматического обновления updated_at
CREATE TRIGGER trigger_transformers_updated_at
    BEFORE UPDATE ON transformers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_lines_updated_at
    BEFORE UPDATE ON lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_water_lines_updated_at
    BEFORE UPDATE ON water_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_water_suppliers_updated_at
    BEFORE UPDATE ON water_suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_water_measurement_points_updated_at
    BEFORE UPDATE ON water_measurement_points
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ===============================================
-- ЗАВЕРШЕНИЕ ИНИЦИАЛИЗАЦИИ
-- ===============================================

-- Обновляем статистику таблиц для оптимизатора после создания всех индексов
ANALYZE users;
ANALYZE buildings;
ANALYZE controllers;
ANALYZE metrics;
ANALYZE infrastructure_alerts;
ANALYZE power_transformers;
ANALYZE cold_water_sources;
ANALYZE heat_sources;
ANALYZE transformers;
ANALYZE lines;
ANALYZE water_lines;
ANALYZE water_suppliers;
ANALYZE water_measurement_points;

-- Логируем успешную инициализацию
INSERT INTO logs (timestamp, log_level, message)
VALUES (NOW(), 'INFO', 'База данных InfraSafe с PostGIS и оптимизированными индексами успешно инициализирована');