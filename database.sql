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
    hot_water boolean
);
CREATE INDEX idx_buildings_town ON buildings(town);

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

-- Создание таблицы оповещений
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
    password text NOT NULL,
    role varchar(20) DEFAULT 'user',
    created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role);

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

-- Комментарии к таблицам для документации
COMMENT ON TABLE metrics IS 'Содержит данные о метриках с контроллеров';
COMMENT ON TABLE controllers IS 'Устройства, установленные в зданиях для сбора метрик';
COMMENT ON TABLE buildings IS 'Информация о зданиях, где установлены контроллеры'; 