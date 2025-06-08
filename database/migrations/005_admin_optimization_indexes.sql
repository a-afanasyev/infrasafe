-- Миграция для оптимизации админки
-- Добавляет индексы для ускорения запросов админской панели

-- Индексы для таблицы buildings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_name ON buildings(name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_town ON buildings(town);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_management_company ON buildings(management_company);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_region ON buildings(region);

-- Композитные индексы для сортировки в админке
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_name_id ON buildings(name, building_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_town_id ON buildings(town, building_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_region_id ON buildings(region, building_id);

-- Индексы для таблицы controllers
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_building_id ON controllers(building_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_status ON controllers(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_vendor ON controllers(vendor);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_model ON controllers(model);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_serial ON controllers(serial_number);

-- Композитные индексы для сортировки контроллеров
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_status_id ON controllers(status, controller_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_vendor_id ON controllers(vendor, controller_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_building_status ON controllers(building_id, status);

-- Индексы для таблицы metrics (критично для производительности)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_controller_timestamp ON metrics(controller_id, timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_timestamp_controller ON metrics(timestamp DESC, controller_id);

-- Индекс для получения последних метрик по контроллеру
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_controller_latest ON metrics(controller_id, timestamp DESC, metric_id);

-- Индексы для инфраструктурных таблиц
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transformers_name ON transformers(name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transformers_capacity ON transformers(capacity_kva);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transformers_voltage ON transformers(voltage_kv);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_water_sources_name ON water_sources(name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_water_sources_capacity ON water_sources(capacity_m3_per_hour);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_heat_sources_name ON heat_sources(name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_heat_sources_capacity ON heat_sources(capacity_mw);

-- Индексы для системы алертов
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_status ON infrastructure_alerts(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_severity ON infrastructure_alerts(severity);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_created_at ON infrastructure_alerts(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_building_id ON infrastructure_alerts(building_id);

-- Частичные индексы для активных записей (экономия места)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_active_status ON controllers(controller_id, status) 
WHERE status IN ('online', 'maintenance');

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_active ON infrastructure_alerts(alert_id, severity, created_at DESC) 
WHERE status = 'active';

-- Индексы для геопространственных запросов (если используются)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_coordinates ON buildings USING GIST(ST_Point(longitude::float, latitude::float));

-- Функциональные индексы для поиска
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_name_lower ON buildings(LOWER(name));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_buildings_address_lower ON buildings(LOWER(address));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_controllers_serial_lower ON controllers(LOWER(serial_number));

-- Индексы для статистики и аналитики
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_hourly_stats ON metrics(
    DATE_TRUNC('hour', timestamp), 
    controller_id, 
    electricity_ph1, 
    electricity_ph2, 
    electricity_ph3
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_daily_stats ON metrics(
    DATE_TRUNC('day', timestamp), 
    controller_id
);

-- Комментарии для документации
COMMENT ON INDEX idx_buildings_name IS 'Ускоряет поиск зданий по названию в админке';
COMMENT ON INDEX idx_controllers_building_id IS 'Ускоряет загрузку контроллеров для конкретного здания';
COMMENT ON INDEX idx_metrics_controller_timestamp IS 'Критический индекс для загрузки последних метрик';
COMMENT ON INDEX idx_buildings_coordinates IS 'Геопространственный индекс для карты и поиска по радиусу';
COMMENT ON INDEX idx_alerts_active IS 'Частичный индекс только для активных алертов';

-- Обновляем статистику таблиц для оптимизатора
ANALYZE buildings;
ANALYZE controllers;
ANALYZE metrics;
ANALYZE infrastructure_alerts; 