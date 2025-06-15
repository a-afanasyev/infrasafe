-- Включение расширения PostGIS для работы с географическими данными (опционально)
-- CREATE EXTENSION postgis;

-- Создание таблицы типов оповещений
CREATE TABLE alert_types (
    alert_type_id serial PRIMARY KEY,
    type_name varchar(50) NOT NULL UNIQUE,
    description text
);

-- Создание таблицы зданий
CREATE TABLE buildings (
    building_id serial PRIMARY KEY,
    name varchar(100) NOT NULL,
    address text NOT NULL,
    town varchar(100) NOT NULL,
    -- Используем point из PostGIS вместо двух numeric полей (опционально)
    -- location geography(POINT) NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    region varchar(50),
    management_company varchar(100),
    hot_water boolean,
    -- Связи с инфраструктурными объектами
    power_transformer_id varchar(50),
    cold_water_source_id varchar(50),
    heat_source_id varchar(50),
    has_hot_water boolean DEFAULT false
);
CREATE INDEX idx_buildings_town ON buildings(town);
CREATE INDEX idx_buildings_power_transformer ON buildings(power_transformer_id);
CREATE INDEX idx_buildings_cold_water_source ON buildings(cold_water_source_id);
CREATE INDEX idx_buildings_heat_source ON buildings(heat_source_id);

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
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Индексы для трансформаторов
CREATE INDEX idx_power_transformers_status ON power_transformers(status);
CREATE INDEX idx_power_transformers_capacity ON power_transformers(capacity_kva);

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
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Индексы для источников холодной воды
CREATE INDEX idx_cold_water_sources_status ON cold_water_sources(status);
CREATE INDEX idx_cold_water_sources_type ON cold_water_sources(source_type);

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
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

-- Индексы для источников тепла
CREATE INDEX idx_heat_sources_status ON heat_sources(status);
CREATE INDEX idx_heat_sources_type ON heat_sources(source_type);

-- Добавление внешних ключей для зданий (добавляем позже, чтобы таблицы уже существовали)
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_power_transformer
    FOREIGN KEY (power_transformer_id) REFERENCES power_transformers(id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_source
    FOREIGN KEY (cold_water_source_id) REFERENCES cold_water_sources(id);
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_heat_source
    FOREIGN KEY (heat_source_id) REFERENCES heat_sources(id);

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
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_created_at ON alerts(created_at);
CREATE INDEX idx_alerts_metric ON alerts(metric_id);

-- Таблица для алертов инфраструктуры (новая система)
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
    acknowledged_by integer,
    resolved_by integer
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

-- Создаем партиции для аналитической истории (текущий и предыдущий месяц)
CREATE TABLE analytics_history_current PARTITION OF analytics_history
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE)) TO (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month');

CREATE TABLE analytics_history_prev PARTITION OF analytics_history
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') TO (date_trunc('month', CURRENT_DATE));

-- Индексы для аналитической истории
CREATE INDEX idx_analytics_history_type ON analytics_history(analysis_type);
CREATE INDEX idx_analytics_history_infrastructure ON analytics_history(infrastructure_id, infrastructure_type);
CREATE INDEX idx_analytics_history_date ON analytics_history(analysis_date);

-- Создание партиционированной таблицы для логов
CREATE TABLE logs (
    log_id bigserial,
    timestamp timestamptz NOT NULL,
    log_level varchar(20),
    message text NOT NULL,
    PRIMARY KEY (log_id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Создание партиций для логов (пример)
CREATE TABLE logs_current_month PARTITION OF logs
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE)) TO (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month');
CREATE TABLE logs_prev_month PARTITION OF logs
    FOR VALUES FROM (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month') TO (date_trunc('month', CURRENT_DATE));

-- Создание индексов для таблицы логов
CREATE INDEX idx_logs_timestamp ON logs(timestamp);
CREATE INDEX idx_logs_level ON logs(log_level);

-- Создание таблицы пользователей
CREATE TABLE users (
    user_id serial PRIMARY KEY,
    username varchar(50) NOT NULL UNIQUE,
    email varchar(100) UNIQUE,
    password text NOT NULL,
    role varchar(20) DEFAULT 'user',
    active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(active);

-- Добавление внешних ключей для инфраструктурных алертов после создания таблицы users
ALTER TABLE infrastructure_alerts ADD CONSTRAINT fk_infrastructure_alerts_acknowledged_by
    FOREIGN KEY (acknowledged_by) REFERENCES users(user_id);
ALTER TABLE infrastructure_alerts ADD CONSTRAINT fk_infrastructure_alerts_resolved_by
    FOREIGN KEY (resolved_by) REFERENCES users(user_id);

-- Создание представления для удобного просмотра текущих активных метрик
CREATE VIEW active_controllers AS
SELECT
    c.controller_id,
    c.serial_number,
    b.name AS building_name,
    b.town,
    c.status,
    c.last_heartbeat,
    now() - c.last_heartbeat AS heartbeat_age
FROM
    controllers c
JOIN
    buildings b ON c.building_id = b.building_id
WHERE
    c.status = 'active';

-- Создание триггера для автоматического обновления last_heartbeat при добавлении метрики
CREATE OR REPLACE FUNCTION update_controller_heartbeat() RETURNS TRIGGER AS $$
BEGIN
    UPDATE controllers SET last_heartbeat = NEW.timestamp
    WHERE controller_id = NEW.controller_id;
    RETURN NEW;
END; $$
LANGUAGE plpgsql;

CREATE TRIGGER trig_update_heartbeat
AFTER INSERT ON metrics
FOR EACH ROW
EXECUTE FUNCTION update_controller_heartbeat();

-- Создание индекса для полнотекстового поиска по адресам зданий
CREATE INDEX idx_buildings_address_gin ON buildings USING GIN (to_tsvector('russian', address));

-- Материализованное представление для загрузки трансформаторов в реальном времени (упрощенная версия без PostGIS)
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

-- Функции для обновления материализованных представлений
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

-- Функция для архивирования ежедневной аналитики
CREATE OR REPLACE FUNCTION archive_daily_analytics() RETURNS void AS $$
BEGIN
    -- Архивируем загрузку трансформаторов
    INSERT INTO analytics_history (analysis_type, infrastructure_id, infrastructure_type, analysis_date, analysis_data)
    SELECT
        'transformer_load',
        id,
        'transformer',
        CURRENT_DATE,
        row_to_json(t)
    FROM mv_transformer_load_realtime t;

    -- Логируем архивирование
    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'INFO', 'Ежедневная аналитика заархивирована');

EXCEPTION WHEN OTHERS THEN
    INSERT INTO logs (timestamp, log_level, message)
    VALUES (NOW(), 'ERROR', 'Ошибка архивирования аналитики: ' || SQLERRM);
    RAISE;
END;
$$ LANGUAGE plpgsql;

-- Функция для поиска ближайших зданий к трансформатору (упрощенная версия без PostGIS)
CREATE OR REPLACE FUNCTION find_nearest_buildings_to_transformer(
    transformer_id VARCHAR(50),
    max_distance_meters INTEGER DEFAULT 1000,
    limit_count INTEGER DEFAULT 50
) RETURNS TABLE (
    building_id INTEGER,
    building_name VARCHAR(100),
    distance_meters NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.building_id,
        b.name,
        -- Приблизительное расстояние в метрах (упрощенный расчет)
        (6371000 * acos(cos(radians(pt.latitude)) * cos(radians(b.latitude)) *
         cos(radians(b.longitude) - radians(pt.longitude)) +
         sin(radians(pt.latitude)) * sin(radians(b.latitude)))) as distance_meters
    FROM power_transformers pt
    CROSS JOIN buildings b
    WHERE pt.id = transformer_id
      -- Простая фильтрация по прямоугольной области (приблизительно)
      AND abs(b.latitude - pt.latitude) < (max_distance_meters::numeric / 111000) -- примерно 111км на градус
      AND abs(b.longitude - pt.longitude) < (max_distance_meters::numeric / 111000)
    ORDER BY distance_meters
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Комментарии к таблицам для документации
COMMENT ON TABLE metrics IS 'Содержит данные о метриках с контроллеров';
COMMENT ON TABLE controllers IS 'Устройства, установленные в зданиях для сбора метрик';
COMMENT ON TABLE buildings IS 'Информация о зданиях, где установлены контроллеры';
COMMENT ON TABLE power_transformers IS 'Электрические трансформаторы для анализа нагрузки';
COMMENT ON TABLE infrastructure_alerts IS 'Система алертов для инфраструктурных объектов';
COMMENT ON MATERIALIZED VIEW mv_transformer_load_realtime IS 'Аналитика загрузки трансформаторов в реальном времени';