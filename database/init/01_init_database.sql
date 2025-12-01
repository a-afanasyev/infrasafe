-- ===============================================
-- Инициализация базы данных InfraSafe с PostGIS
-- Версия: 2.4 (обновлено 23 ноября 2025)
-- Описание: Полная схема БД синхронизированная с реальной базой данных
-- Изменения версии 2.3:
--   - Исправлена структура water_lines (pressure_bar вместо pressure_rating, удалены line_type, maintenance_contact, notes)
--   - Удалены функции расчёта мощности (calculate_phase_power, calculate_three_phase_power) - отсутствуют в реальной БД
--   - Удалены материализованные представления mv_building_power_realtime и mv_line_power_realtime - отсутствуют в реальной БД
--   - Обновлено mv_transformer_load_realtime согласно реальной структуре БД
--   - Добавлена таблица alerts (legacy система алертов)
--   - Добавлена таблица analytics_history (партиционированная таблица для истории аналитики)
--   - Исправлена функция refresh_transformer_analytics (убрана зависимость от несуществующих MV)
--   - Удалён индекс idx_water_lines_type (поле line_type отсутствует в БД)
-- Изменения версии 2.4:
--   - Добавлена функция archive_daily_analytics() для архивирования ежедневной аналитики
--   - Таблица metrics приведена к непартиционированной структуре, совпадающей с дампом 02_seed_data.sql (снимок 2025-11-15)
-- ===============================================

-- Включение расширения PostGIS для работы с географическими данными
CREATE EXTENSION IF NOT EXISTS postgis;

-- ===============================================
-- СИСТЕМА АУТЕНТИФИКАЦИИ И ПОЛЬЗОВАТЕЛИ
-- ===============================================

-- Создание таблицы пользователей (обновленная версия)
CREATE TABLE IF NOT EXISTS users (
    user_id serial PRIMARY KEY,
    username varchar(50) NOT NULL UNIQUE,
    email varchar(100) NOT NULL UNIQUE,
    password_hash varchar(255) NOT NULL,
    full_name varchar(100),
    role varchar(20) DEFAULT 'user', -- 'admin', 'operator', 'user'
    is_active boolean DEFAULT true,
    failed_login_attempts integer DEFAULT 0,
    last_failed_login timestamptz,
    account_locked_until timestamptz,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW(),
    last_login timestamptz
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

-- ===============================================
-- ПРИМЕЧАНИЕ: Таблица infrastructure_lines
-- ===============================================
-- Таблица infrastructure_lines была удалена миграцией 006 (2025-10-22)
-- и заменена на:
--   - lines (линии электропередач)
--   - water_lines (линии водоснабжения)
-- Функционал разделён между этими двумя таблицами
-- ===============================================

-- ===============================================
-- ОСНОВНЫЕ ТАБЛИЦЫ ИНФРАСТРУКТУРЫ
-- ===============================================

-- Создание таблицы зданий (обновленная версия)
CREATE TABLE IF NOT EXISTS buildings (
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

-- Создание таблицы контроллеров
CREATE TABLE IF NOT EXISTS controllers (
    controller_id serial PRIMARY KEY,
    serial_number varchar(50) NOT NULL UNIQUE,
    vendor varchar(50),
    model varchar(50),
    building_id integer REFERENCES buildings(building_id),
    status varchar(20) NOT NULL,
    installed_at timestamptz DEFAULT now(),
    last_heartbeat timestamptz
);

-- ===============================================
-- ТРАНСФОРМАТОРЫ И ЛИНИИ ЭЛЕКТРОПЕРЕДАЧ
-- ===============================================

-- Таблица трансформаторов (обновленная с координатами)
CREATE TABLE IF NOT EXISTS transformers (
    transformer_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    power_kva DECIMAL(10,2) NOT NULL CHECK (power_kva > 0),
    voltage_kv DECIMAL(10,2) NOT NULL CHECK (voltage_kv > 0),
    location VARCHAR(255),
    latitude NUMERIC(9,6), -- Добавлено в миграции 004
    longitude NUMERIC(9,6), -- Добавлено в миграции 004
    geom GEOMETRY(POINT, 4326), -- Добавлено в миграции 004
    installation_date DATE,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Таблица линий электропередач (обновленная с путями и ответвлениями)
CREATE TABLE IF NOT EXISTS lines (
    line_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    voltage_kv DECIMAL(10,2) NOT NULL CHECK (voltage_kv > 0),
    length_km DECIMAL(10,3) NOT NULL CHECK (length_km > 0),
    transformer_id INTEGER REFERENCES transformers(transformer_id) ON DELETE CASCADE,
    -- Координаты начала и конца (для обратной совместимости)
    latitude_start NUMERIC(9,6),
    longitude_start NUMERIC(9,6),
    latitude_end NUMERIC(9,6),
    longitude_end NUMERIC(9,6),
    -- Новые поля для путей и ответвлений (миграция 005)
    main_path JSONB,
    branches JSONB DEFAULT '[]'::jsonb,
    -- Дополнительные поля (миграция 004)
    cable_type VARCHAR(100),
    commissioning_year INTEGER CHECK (commissioning_year >= 1900 AND commissioning_year <= 2100),
    -- PostGIS геометрия
    geom GEOMETRY(LINESTRING, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ===============================================
-- СИСТЕМА ВОДОСНАБЖЕНИЯ
-- ===============================================

-- Таблица линий водоснабжения (обновленная с путями)
CREATE TABLE IF NOT EXISTS water_lines (
    line_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    diameter_mm INTEGER CHECK (diameter_mm > 0),
    material VARCHAR(100),
    pressure_bar NUMERIC(5,2) CHECK (pressure_bar > 0),
    installation_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    -- Координаты (для обратной совместимости)
    latitude_start NUMERIC(9,6),
    longitude_start NUMERIC(9,6),
    latitude_end NUMERIC(9,6),
    longitude_end NUMERIC(9,6),
    -- Новые поля для путей и ответвлений (миграция 006)
    main_path JSONB,
    branches JSONB DEFAULT '[]'::jsonb,
    -- PostGIS геометрия
    geom GEOMETRY(LINESTRING, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Таблица поставщиков воды
CREATE TABLE IF NOT EXISTS water_suppliers (
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
CREATE TABLE IF NOT EXISTS water_measurement_points (
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

-- ===============================================
-- ИНФРАСТРУКТУРНЫЕ ОБЪЕКТЫ
-- ===============================================

-- Таблица электрических трансформаторов (legacy)
CREATE TABLE IF NOT EXISTS power_transformers (
    id varchar(50) PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    capacity_kva numeric(8,2) NOT NULL,
    voltage_primary numeric(8,2),
    voltage_secondary numeric(8,2),
    installation_date date,
    manufacturer varchar(100),
    model varchar(100),
    status varchar(20) DEFAULT 'active',
    maintenance_contact varchar(100),
    notes text,
    geom geometry(POINT, 4326),
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Таблица источников холодной воды
CREATE TABLE IF NOT EXISTS cold_water_sources (
    id varchar(50) PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    source_type varchar(50) NOT NULL, -- 'pumping_station', 'well', 'reservoir'
    capacity_m3_per_hour numeric(8,2),
    operating_pressure_bar numeric(5,2),
    installation_date date,
    status varchar(20) DEFAULT 'active',
    maintenance_contact varchar(100),
    notes text,
    geom geometry(POINT, 4326),
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Таблица источников тепла
CREATE TABLE IF NOT EXISTS heat_sources (
    id varchar(50) PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    source_type varchar(50) NOT NULL, -- 'boiler_house', 'heat_plant', 'chp'
    capacity_mw numeric(8,2),
    fuel_type varchar(50),
    installation_date date,
    status varchar(20) DEFAULT 'active',
    maintenance_contact varchar(100),
    notes text,
    geom geometry(POINT, 4326),
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- ===============================================
-- СИНХРОНИЗАЦИЯ С СОСТОЯНИЕМ SEED (2025-11-15)
-- Добавляем недостающие колонки для совместимости со снапшотом
-- ===============================================
ALTER TABLE IF EXISTS buildings ADD COLUMN IF NOT EXISTS geom geometry(POINT, 4326);
ALTER TABLE IF EXISTS cold_water_sources ADD COLUMN IF NOT EXISTS geom geometry(POINT, 4326);
ALTER TABLE IF EXISTS heat_sources ADD COLUMN IF NOT EXISTS geom geometry(POINT, 4326);
ALTER TABLE IF EXISTS power_transformers ADD COLUMN IF NOT EXISTS geom geometry(POINT, 4326);
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS password_hash varchar(255);

-- ===============================================
-- СИСТЕМА МЕТРИК И МОНИТОРИНГА
-- ===============================================

-- Сбрасываем legacy-партиции метрик и саму таблицу, чтобы привести к структуре seed
DROP TABLE IF EXISTS metrics_current_month;
DROP TABLE IF EXISTS metrics_prev_month;
DROP TABLE IF EXISTS metrics CASCADE;

-- Таблица метрик (непартиционированная — соответствует дампу seed от 2025-11-15)
CREATE TABLE IF NOT EXISTS metrics (
    metric_id bigserial PRIMARY KEY,
    controller_id integer REFERENCES controllers(controller_id),
    timestamp timestamptz NOT NULL,
    -- Электричество
    electricity_ph1 numeric(6,2),
    electricity_ph2 numeric(6,2),
    electricity_ph3 numeric(6,2),
    -- Сила тока
    amperage_ph1 numeric(6,2),
    amperage_ph2 numeric(6,2),
    amperage_ph3 numeric(6,2),
    -- Холодная вода
    cold_water_pressure numeric(5,2),
    cold_water_temp numeric(5,2),
    -- Горячая вода
    hot_water_in_pressure numeric(5,2),
    hot_water_out_pressure numeric(5,2),
    hot_water_in_temp numeric(5,2),
    hot_water_out_temp numeric(5,2),
    -- Окружение
    air_temp numeric(5,2),
    humidity numeric(5,2),
    leak_sensor boolean
);

-- ===============================================
-- СИСТЕМА АЛЕРТОВ
-- ===============================================

-- Создание таблицы типов оповещений
CREATE TABLE IF NOT EXISTS alert_types (
    alert_type_id serial PRIMARY KEY,
    type_name varchar(50) NOT NULL UNIQUE,
    description text
);

-- Таблица для алертов инфраструктуры (основная система)
CREATE TABLE IF NOT EXISTS infrastructure_alerts (
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

-- Таблица алертов (legacy система, для обратной совместимости)
CREATE TABLE IF NOT EXISTS alerts (
    alert_id serial PRIMARY KEY,
    metric_id bigint,
    alert_type_id integer REFERENCES alert_types(alert_type_id),
    severity varchar(20) NOT NULL,
    status varchar(20) DEFAULT 'active',
    created_at timestamptz DEFAULT now(),
    resolved_at timestamptz
);

-- Индексы для таблицы alerts
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_metric ON alerts(metric_id);

-- Партиционированная таблица для истории аналитики
CREATE TABLE IF NOT EXISTS analytics_history (
    id bigserial,
    analysis_type varchar(50) NOT NULL,
    infrastructure_id varchar(50),
    infrastructure_type varchar(50),
    analysis_date date NOT NULL,
    analysis_data jsonb NOT NULL,
    created_at timestamptz DEFAULT NOW(),
    PRIMARY KEY (id, analysis_date)
) PARTITION BY RANGE (analysis_date);

-- Партиции для аналитической истории
CREATE TABLE IF NOT EXISTS analytics_history_current 
PARTITION OF analytics_history
FOR VALUES FROM (date_trunc('month', CURRENT_DATE)) 
TO (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month');

CREATE TABLE IF NOT EXISTS analytics_history_prev 
PARTITION OF analytics_history
FOR VALUES FROM (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') 
TO (date_trunc('month', CURRENT_DATE));

-- Индексы для аналитической истории
CREATE INDEX IF NOT EXISTS idx_analytics_history_type ON analytics_history(analysis_type);
CREATE INDEX IF NOT EXISTS idx_analytics_history_infrastructure ON analytics_history(infrastructure_id, infrastructure_type);
CREATE INDEX IF NOT EXISTS idx_analytics_history_date ON analytics_history(analysis_date);

-- ===============================================
-- СВЯЗИ МЕЖДУ ТАБЛИЦАМИ
-- ===============================================

-- Добавляем поля для связи зданий с инфраструктурой
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS power_transformer_id varchar(50);
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS cold_water_source_id varchar(50);
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS heat_source_id varchar(50);
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS primary_transformer_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS backup_transformer_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS primary_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS backup_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS cold_water_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS hot_water_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS cold_water_supplier_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS hot_water_supplier_id INTEGER;

-- ===============================================
-- ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ
-- ===============================================

-- Индексы для пользователей
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE is_active = true;

-- Индексы для зданий
CREATE INDEX IF NOT EXISTS idx_buildings_town ON buildings(town);
CREATE INDEX IF NOT EXISTS idx_buildings_geom ON buildings USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_buildings_name ON buildings(name);
CREATE INDEX IF NOT EXISTS idx_buildings_region ON buildings(region);
CREATE INDEX IF NOT EXISTS idx_buildings_management_company ON buildings(management_company);

-- Индексы для контроллеров
CREATE INDEX IF NOT EXISTS idx_controllers_building ON controllers(building_id);
CREATE INDEX IF NOT EXISTS idx_controllers_status ON controllers(status);
CREATE INDEX IF NOT EXISTS idx_controllers_heartbeat ON controllers(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_controllers_serial ON controllers(serial_number);

-- Индексы для трансформаторов
CREATE INDEX IF NOT EXISTS idx_transformers_name ON transformers(name);
CREATE INDEX IF NOT EXISTS idx_transformers_power ON transformers(power_kva);
CREATE INDEX IF NOT EXISTS idx_transformers_voltage ON transformers(voltage_kv);
CREATE INDEX IF NOT EXISTS idx_transformers_status ON transformers(status);
CREATE INDEX IF NOT EXISTS idx_transformers_geom ON transformers USING GIST(geom);
-- Дополнительный индекс для координат transformers (миграция 004)
CREATE INDEX IF NOT EXISTS idx_transformers_coordinates ON transformers(latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Индексы для линий электропередач
CREATE INDEX IF NOT EXISTS idx_lines_transformer_id ON lines(transformer_id);
CREATE INDEX IF NOT EXISTS idx_lines_name ON lines(name);
CREATE INDEX IF NOT EXISTS idx_lines_voltage ON lines(voltage_kv);
CREATE INDEX IF NOT EXISTS idx_lines_geom ON lines USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_lines_main_path ON lines USING gin(main_path);
CREATE INDEX IF NOT EXISTS idx_lines_branches ON lines USING gin(branches);

-- Индексы для линий водоснабжения
CREATE INDEX IF NOT EXISTS idx_water_lines_name ON water_lines(name);
CREATE INDEX IF NOT EXISTS idx_water_lines_status ON water_lines(status);
CREATE INDEX IF NOT EXISTS idx_water_lines_geom ON water_lines USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_water_lines_main_path ON water_lines USING gin(main_path);
CREATE INDEX IF NOT EXISTS idx_water_lines_branches ON water_lines USING gin(branches);

-- Индексы для метрик
CREATE INDEX IF NOT EXISTS idx_metrics_controller ON metrics(controller_id);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_leak ON metrics(leak_sensor) WHERE leak_sensor = true;

-- Индексы для алертов
CREATE INDEX IF NOT EXISTS idx_infrastructure_alerts_type ON infrastructure_alerts(type);
CREATE INDEX IF NOT EXISTS idx_infrastructure_alerts_severity ON infrastructure_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_infrastructure_alerts_status ON infrastructure_alerts(status);
CREATE INDEX IF NOT EXISTS idx_infrastructure_alerts_created_at ON infrastructure_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_infrastructure_alerts_infrastructure ON infrastructure_alerts(infrastructure_id, infrastructure_type);

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

-- Функция для обновления last_heartbeat в контроллерах
CREATE OR REPLACE FUNCTION update_controller_heartbeat() RETURNS TRIGGER AS $$
BEGIN
    UPDATE controllers
    SET last_heartbeat = NEW.timestamp
    WHERE controller_id = NEW.controller_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Функция для конвертации координат в main_path для линий
CREATE OR REPLACE FUNCTION convert_line_endpoints_to_path()
RETURNS TRIGGER AS $$
BEGIN
    -- Если main_path пуст, но есть start/end координаты - конвертируем
    IF (NEW.main_path IS NULL OR NEW.main_path = '[]'::jsonb OR jsonb_array_length(NEW.main_path) = 0)
       AND NEW.latitude_start IS NOT NULL 
       AND NEW.longitude_start IS NOT NULL 
       AND NEW.latitude_end IS NOT NULL 
       AND NEW.longitude_end IS NOT NULL THEN
        
        -- Создаём простой путь из 2 точек (начало → конец)
        NEW.main_path = jsonb_build_array(
            jsonb_build_object(
                'lat', NEW.latitude_start,
                'lng', NEW.longitude_start,
                'order', 0,
                'description', 'Начальная точка'
            ),
            jsonb_build_object(
                'lat', NEW.latitude_end,
                'lng', NEW.longitude_end,
                'order', 1,
                'description', 'Конечная точка'
            )
        );
    END IF;
    
    -- Если branches NULL, устанавливаем пустой массив
    IF NEW.branches IS NULL THEN
        NEW.branches = '[]'::jsonb;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Функция для обновления geom из main_path
CREATE OR REPLACE FUNCTION update_line_geom_from_path()
RETURNS TRIGGER AS $$
BEGIN
    -- Если есть main_path, строим LINESTRING из него
    IF NEW.main_path IS NOT NULL AND jsonb_array_length(NEW.main_path) >= 2 THEN
        -- Извлекаем координаты из JSONB и строим LINESTRING
        NEW.geom = ST_GeomFromText(
            'LINESTRING(' || (
                SELECT string_agg(
                    (point->>'lng')::text || ' ' || (point->>'lat')::text, 
                    ', ' 
                    ORDER BY (point->>'order')::int
                )
                FROM jsonb_array_elements(NEW.main_path) AS point
            ) || ')',
            4326
        );
    -- Иначе если есть start/end координаты, используем их
    ELSIF NEW.latitude_start IS NOT NULL 
          AND NEW.longitude_start IS NOT NULL
          AND NEW.latitude_end IS NOT NULL
          AND NEW.longitude_end IS NOT NULL THEN
        NEW.geom = ST_GeomFromText(
            'LINESTRING(' || 
            NEW.longitude_start || ' ' || NEW.latitude_start || ', ' ||
            NEW.longitude_end || ' ' || NEW.latitude_end || 
            ')',
            4326
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Функция для обновления geom трансформаторов (специфичная версия)
-- Отличается от общей функции update_geom_on_coordinates_change() 
-- тем, что проверяет наличие координат перед обновлением
CREATE OR REPLACE FUNCTION update_transformers_geom()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Функция для обновления geom линий водоснабжения из координат начала/конца
CREATE OR REPLACE FUNCTION update_water_lines_geom_from_coordinates()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude_start IS NOT NULL AND NEW.longitude_start IS NOT NULL AND
       NEW.latitude_end IS NOT NULL AND NEW.longitude_end IS NOT NULL THEN
        
        NEW.geom = ST_SetSRID(
            ST_MakeLine(
                ST_MakePoint(NEW.longitude_start, NEW.latitude_start),
                ST_MakePoint(NEW.longitude_end, NEW.latitude_end)
            ),
            4326
        );
    END IF;
    
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- ТРИГГЕРЫ
-- ===============================================

-- Триггеры для автоматического обновления геометрии
DROP TRIGGER IF EXISTS trig_buildings_geom ON buildings;
CREATE TRIGGER trig_buildings_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON buildings
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

DROP TRIGGER IF EXISTS trig_transformers_geom ON transformers;
CREATE TRIGGER trig_transformers_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON transformers
    FOR EACH ROW
    WHEN (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)
    EXECUTE FUNCTION update_transformers_geom();

DROP TRIGGER IF EXISTS trig_power_transformers_geom ON power_transformers;
CREATE TRIGGER trig_power_transformers_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON power_transformers
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

DROP TRIGGER IF EXISTS trig_cold_water_sources_geom ON cold_water_sources;
CREATE TRIGGER trig_cold_water_sources_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON cold_water_sources
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

DROP TRIGGER IF EXISTS trig_heat_sources_geom ON heat_sources;
CREATE TRIGGER trig_heat_sources_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON heat_sources
    FOR EACH ROW EXECUTE FUNCTION update_geom_on_coordinates_change();

-- Триггер для обновления heartbeat
DROP TRIGGER IF EXISTS trig_update_heartbeat ON metrics;
CREATE TRIGGER trig_update_heartbeat
AFTER INSERT ON metrics
FOR EACH ROW
EXECUTE FUNCTION update_controller_heartbeat();

-- Триггеры для автоматического обновления updated_at
DROP TRIGGER IF EXISTS trigger_transformers_updated_at ON transformers;
CREATE TRIGGER trigger_transformers_updated_at
    BEFORE UPDATE ON transformers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_lines_updated_at ON lines;
CREATE TRIGGER trigger_lines_updated_at
    BEFORE UPDATE ON lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_water_lines_updated_at ON water_lines;
CREATE TRIGGER trigger_water_lines_updated_at
    BEFORE UPDATE ON water_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Триггеры для конвертации координат в пути
DROP TRIGGER IF EXISTS trig_lines_convert_endpoints ON lines;
CREATE TRIGGER trig_lines_convert_endpoints
BEFORE INSERT OR UPDATE ON lines
FOR EACH ROW
EXECUTE FUNCTION convert_line_endpoints_to_path();

DROP TRIGGER IF EXISTS trig_lines_update_geom ON lines;
CREATE TRIGGER trig_lines_update_geom
BEFORE INSERT OR UPDATE ON lines
FOR EACH ROW
EXECUTE FUNCTION update_line_geom_from_path();

-- Триггер для обновления geom линий водоснабжения из координат
DROP TRIGGER IF EXISTS trig_water_lines_geom_from_coordinates ON water_lines;
CREATE TRIGGER trig_water_lines_geom_from_coordinates
BEFORE INSERT OR UPDATE OF latitude_start, longitude_start, latitude_end, longitude_end ON water_lines
FOR EACH ROW
EXECUTE FUNCTION update_water_lines_geom_from_coordinates();

-- ===============================================
-- ВНЕШНИЕ КЛЮЧИ
-- ===============================================

-- Добавление внешних ключей для зданий
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_power_transformer') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_power_transformer
            FOREIGN KEY (power_transformer_id) REFERENCES power_transformers(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_cold_water_source') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_source
            FOREIGN KEY (cold_water_source_id) REFERENCES cold_water_sources(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_heat_source') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_heat_source
            FOREIGN KEY (heat_source_id) REFERENCES heat_sources(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_primary_transformer') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_transformer
            FOREIGN KEY (primary_transformer_id) REFERENCES transformers(transformer_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_backup_transformer') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_backup_transformer
            FOREIGN KEY (backup_transformer_id) REFERENCES transformers(transformer_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_primary_line') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_line
            FOREIGN KEY (primary_line_id) REFERENCES lines(line_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_backup_line') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_backup_line
            FOREIGN KEY (backup_line_id) REFERENCES lines(line_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_cold_water_line') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_line
            FOREIGN KEY (cold_water_line_id) REFERENCES water_lines(line_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_hot_water_line') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_hot_water_line
            FOREIGN KEY (hot_water_line_id) REFERENCES water_lines(line_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_cold_water_supplier') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_supplier
            FOREIGN KEY (cold_water_supplier_id) REFERENCES water_suppliers(supplier_id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_buildings_hot_water_supplier') THEN
        ALTER TABLE buildings ADD CONSTRAINT fk_buildings_hot_water_supplier
            FOREIGN KEY (hot_water_supplier_id) REFERENCES water_suppliers(supplier_id);
    END IF;
END $$;

-- ===============================================
-- СИСТЕМА ЛОГИРОВАНИЯ
-- ===============================================

-- Таблица логов
CREATE TABLE IF NOT EXISTS logs (
    log_id bigserial PRIMARY KEY,
    timestamp timestamptz DEFAULT NOW(),
    log_level varchar(10) NOT NULL,
    message text NOT NULL,
    details jsonb
);

-- Индексы для логов
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(log_level);

-- ===============================================
-- МАТЕРИАЛИЗОВАННЫЕ ПРЕДСТАВЛЕНИЯ
-- ===============================================

-- Материализованное представление: Загрузка трансформаторов в реальном времени
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_transformer_load_realtime AS
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
    
    CASE
        WHEN pt.capacity_kva > 0 THEN
            LEAST(100, AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) * 0.4 / pt.capacity_kva * 100)
        ELSE 0
    END as load_percent,
    
    MAX(m.timestamp) as last_metric_time,
    COUNT(CASE WHEN m.timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count

FROM power_transformers pt
LEFT JOIN buildings b ON pt.id::VARCHAR = b.power_transformer_id::VARCHAR
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN metrics m ON c.controller_id = m.controller_id AND m.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY pt.id, pt.name, pt.capacity_kva, pt.status, pt.latitude, pt.longitude;

-- Уникальный индекс для конкурентного обновления материализованного представления
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_transformer_load_id ON mv_transformer_load_realtime(id);
CREATE INDEX IF NOT EXISTS idx_mv_transformer_load_percent ON mv_transformer_load_realtime(load_percent DESC);
CREATE INDEX IF NOT EXISTS idx_mv_transformer_load_status ON mv_transformer_load_realtime(status);

-- ===============================================
-- ФУНКЦИИ ДЛЯ АНАЛИТИКИ
-- ===============================================

-- ===============================================
-- ФУНКЦИИ ДЛЯ ОБНОВЛЕНИЯ МАТЕРИАЛИЗОВАННЫХ ПРЕДСТАВЛЕНИЙ
-- ===============================================

-- Функция для обновления материализованных представлений (legacy, для обратной совместимости)
CREATE OR REPLACE FUNCTION refresh_transformer_analytics() RETURNS void AS $$
BEGIN
    -- Обновляем материализованное представление загрузки трансформаторов
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;

    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'INFO', 'Материализованные представления аналитики трансформаторов обновлены');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'ERROR', 'Ошибка обновления материализованных представлений: ' || SQLERRM);
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

-- ===============================================
-- КОММЕНТАРИИ ДЛЯ ДОКУМЕНТАЦИИ
-- ===============================================

-- Комментарии для таблиц
COMMENT ON TABLE transformers IS 'Трансформаторы для электроснабжения зданий (админка)';
COMMENT ON TABLE lines IS 'Линии электропередач от трансформаторов (админка)';
COMMENT ON TABLE water_lines IS 'Линии водоснабжения (ХВС и ГВС)';
COMMENT ON TABLE water_suppliers IS 'Поставщики холодной и горячей воды';
COMMENT ON TABLE water_measurement_points IS 'Точки измерения расхода воды в зданиях';

-- Комментарии для полей
COMMENT ON COLUMN transformers.latitude IS 'Широта расположения трансформатора';
COMMENT ON COLUMN transformers.longitude IS 'Долгота расположения трансформатора';
COMMENT ON COLUMN transformers.geom IS 'PostGIS геометрия точки трансформатора';
COMMENT ON COLUMN lines.main_path IS 'JSONB массив точек основного пути линии [{lat, lng, order, description}, ...]';
COMMENT ON COLUMN lines.branches IS 'JSONB массив ответвлений от основной линии [{name, branch_id, parent_point_index, points}, ...]';
COMMENT ON COLUMN water_lines.main_path IS 'JSONB массив точек основного пути [{lat, lng, order, description}, ...]';
COMMENT ON COLUMN water_lines.branches IS 'JSONB массив ответвлений [{name, branch_id, parent_point_index, points}, ...]';

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
VALUES (NOW(), 'INFO', 'База данных InfraSafe с PostGIS и оптимизированными индексами успешно инициализирована (версия 2.4, синхронизировано с реальной БД)');
