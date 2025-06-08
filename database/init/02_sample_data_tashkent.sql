-- ===============================================
-- Тестовые данные InfraSafe на основе реальных данных Ташкента
-- Источник: https://infrasafe.aisolutions.uz/api/
-- ===============================================

-- Тестовые данные для типов алертов
INSERT INTO alert_types (type_name, description) VALUES
('POWER_FAILURE', 'Отключение электроэнергии'),
('WATER_LEAK', 'Утечка воды'),
('OVERHEATING', 'Перегрев оборудования'),
('LOW_PRESSURE', 'Низкое давление в системе'),
('COMMUNICATION_LOST', 'Потеря связи с контроллером'),
('VOLTAGE_ANOMALY', 'Аномалия напряжения'),
('TEMPERATURE_ANOMALY', 'Аномалия температуры');

-- Реальные трансформаторы для района Фараби в Ташкенте
INSERT INTO power_transformers (id, name, address, latitude, longitude, capacity_kva, voltage_primary, voltage_secondary, status, manufacturer) VALUES
('TR-FARABI-01', 'Трансформатор Фараби-1', 'ул. Фараби, ТП-1, Ташкент', 41.347052, 69.203200, 630.0, 6000.0, 380.0, 'active', 'Узбекэнерго'),
('TR-FARABI-02', 'Трансформатор Фараби-2', 'ул. Фараби, ТП-2, Ташкент', 41.347845, 69.200865, 1000.0, 6000.0, 380.0, 'active', 'Узбекэнерго'),
('TR-OLMAZOR-01', 'Трансформатор Олмазор-1', 'Олмазорский район, ТП-3, Ташкент', 41.348359, 69.198987, 800.0, 10000.0, 380.0, 'active', 'ABB'),
('TR-SHIFONUR-01', 'Трансформатор Шифонур-1', 'ул. Шифонур, ТП-4, Ташкент', 41.351134, 69.219774, 500.0, 6000.0, 380.0, 'maintenance', 'Сименс');

-- Источники холодной воды для Ташкента
INSERT INTO cold_water_sources (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour, operating_pressure_bar, status) VALUES
('CW-FARABI-01', 'Насосная станция Фараби', 'ул. Фараби, НС-1, Ташкент', 41.347200, 69.202000, 'pumping_station', 120.0, 5.0, 'active'),
('CW-OLMAZOR-01', 'Водозабор Олмазор', 'Олмазорский район, Ташкент', 41.348000, 69.200000, 'well', 80.0, 4.5, 'active'),
('CW-SHIFONUR-01', 'Резервуар Шифонур', 'ул. Шифонур, Ташкент', 41.351000, 69.219000, 'reservoir', 200.0, 3.5, 'active');

-- Источники тепла для Ташкента
INSERT INTO heat_sources (id, name, address, latitude, longitude, source_type, capacity_mw, fuel_type, status) VALUES
('HS-FARABI-01', 'Котельная Фараби', 'ул. Фараби, котельная №1, Ташкент', 41.347500, 69.201500, 'boiler_house', 4.5, 'gas', 'active'),
('HS-OLMAZOR-01', 'ТЭЦ Олмазор', 'Олмазорский район, ТЭЦ-2, Ташкент', 41.348500, 69.199500, 'chp', 15.0, 'gas', 'active'),
('HS-CENTRAL-01', 'Центральная котельная', 'Центральный район, Ташкент', 41.350000, 69.210000, 'boiler_house', 8.0, 'gas', 'active');

-- Реальные здания из API с привязкой к инфраструктуре
INSERT INTO buildings (name, address, town, latitude, longitude, region, management_company, has_hot_water, power_transformer_id, cold_water_source_id, heat_source_id) VALUES
('Farabi-001', 'Farabi, 1', 'Tashkent', 41.347052, 69.203200, 'Olmazor', 'Olmazor Holding Grand', false, 'TR-FARABI-01', 'CW-FARABI-01', 'HS-FARABI-01'),
('Farabi-002', 'Farabi, 2', 'Tashkent', 41.346924, 69.202787, 'Olmazor', 'Olmazor Holding Grand', false, 'TR-FARABI-01', 'CW-FARABI-01', 'HS-FARABI-01'),
('Farabi-003', 'Farabi, 3', 'Tashkent', 41.347073, 69.202302, 'Olmazor', 'Olmazor Holding Grand', false, 'TR-FARABI-01', 'CW-FARABI-01', 'HS-FARABI-01'),
('Farabi-004', 'Farabi, 4', 'Tashkent', 41.347249, 69.201718, 'Olmazor', 'Olmazor Holding Grand', false, 'TR-FARABI-01', 'CW-FARABI-01', 'HS-FARABI-01'),
('Farabi-005', 'Farabi, 5', 'Tashkent', 41.347560, 69.201332, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-FARABI-02', 'CW-FARABI-01', 'HS-FARABI-01'),
('Farabi-006', 'Farabi, 6', 'Tashkent', 41.347553, 69.201853, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-FARABI-02', 'CW-FARABI-01', 'HS-FARABI-01'),
('Farabi-007', 'Farabi, 7', 'Tashkent', 41.347553, 69.200757, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-FARABI-02', 'CW-OLMAZOR-01', 'HS-FARABI-01'),
('Farabi-008', 'Farabi, 8', 'Tashkent', 41.347845, 69.200865, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-FARABI-02', 'CW-OLMAZOR-01', 'HS-FARABI-01'),
('Farabi-009', 'Farabi, 9', 'Tashkent', 41.347865, 69.200361, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-FARABI-02', 'CW-OLMAZOR-01', 'HS-OLMAZOR-01'),
('Farabi-010', 'Farabi, 10', 'Tashkent', 41.347845, 69.199813, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-OLMAZOR-01', 'CW-OLMAZOR-01', 'HS-OLMAZOR-01'),
('Farabi-011', 'Farabi, 11', 'Tashkent', 41.347987, 69.199328, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-OLMAZOR-01', 'CW-OLMAZOR-01', 'HS-OLMAZOR-01'),
('Farabi-012', 'Farabi, 12', 'Tashkent', 41.348359, 69.198987, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-OLMAZOR-01', 'CW-OLMAZOR-01', 'HS-OLMAZOR-01'),
('Farabi-013', 'Farabi, 13', 'Tashkent', 41.348345, 69.199490, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-OLMAZOR-01', 'CW-OLMAZOR-01', 'HS-OLMAZOR-01'),
('Farabi-014', 'Farabi, 14', 'Tashkent', 41.348149, 69.199948, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-OLMAZOR-01', 'CW-OLMAZOR-01', 'HS-OLMAZOR-01'),
('Shifonur-3A', 'Shifonur, 3А', 'Tashkent', 41.351134, 69.219774, 'Olmazor', 'test', false, 'TR-SHIFONUR-01', 'CW-SHIFONUR-01', 'HS-CENTRAL-01'),
('Farabi-049', 'улица Фараби, 49', 'Tashkent', 41.347371, 69.202437, 'Olmazor', 'Olmazor Holding Grand', true, 'TR-FARABI-01', 'CW-FARABI-01', 'HS-FARABI-01'),
('Test Building', 'улица Фараби, 4', 'Tashkent', 41.347261, 69.202899, 'Olmazor', 'test', false, 'TR-FARABI-01', 'CW-FARABI-01', 'HS-FARABI-01');

-- Контроллеры WB на базе реальных данных
INSERT INTO controllers (serial_number, vendor, model, building_id, status, last_heartbeat) VALUES
('CTRL001', 'WB', '7.4', 1, 'active', NOW() - INTERVAL '2 minutes'),
('CTRL002', 'WB', '7.4', 5, 'active', NOW() - INTERVAL '1 minute'),
('CTRL003', 'WB', '7.4', 8, 'offline', NOW() - INTERVAL '3 hours'),
('CTRL004', 'WB', '7.4', 10, 'active', NOW() - INTERVAL '30 seconds'),
('CTRL005', 'WB', '7.4', 12, 'active', NOW() - INTERVAL '4 minutes'),
('CTRL006', 'WB', '7.4', 14, 'maintenance', NOW() - INTERVAL '1 day'),
('CTRL007', 'WB', '7.4', 16, 'active', NOW() - INTERVAL '1 minute'),
('CTRL008', 'WB', '7.4', null, 'active', NOW() - INTERVAL '5 minutes'),
('CTRL009', 'WB', '7.4', null, 'active', NOW() - INTERVAL '3 minutes'),
('CTRL010', 'WB', '7.4', null, 'offline', NOW() - INTERVAL '6 hours'),
('CTRL011', 'WB', '7.4', null, 'active', NOW() - INTERVAL '2 minutes'),
('CTRL012', 'WB', '7.4', null, 'active', NULL),
('CTRL013', 'WB', '7.4', null, 'active', NULL),
('CTRL014', 'WB', '7.4', null, 'active', NULL),
('TEST', 'WB', '7.4', null, 'active', NULL);

-- Реалистичные метрики на основе данных Farabi-001
INSERT INTO metrics (controller_id, timestamp, electricity_ph1, electricity_ph2, electricity_ph3, 
                    amperage_ph1, amperage_ph2, amperage_ph3, cold_water_pressure, cold_water_temp,
                    hot_water_in_pressure, hot_water_out_pressure, hot_water_in_temp, hot_water_out_temp,
                    air_temp, humidity, leak_sensor)
SELECT 
    c.controller_id,
    NOW() - INTERVAL '1 hour' * (random() * 24), -- Последние 24 часа
    -- Напряжение базируется на реальных данных 217-218V с вариациями
    CASE 
        WHEN random() < 0.1 THEN 190 + random() * 20  -- 10% низкое напряжение (190-210V)
        WHEN random() < 0.05 THEN 245 + random() * 15  -- 5% высокое напряжение (245-260V)
        ELSE 215 + random() * 6  -- 85% нормальное (215-221V)
    END,
    CASE 
        WHEN random() < 0.1 THEN 190 + random() * 20
        WHEN random() < 0.05 THEN 245 + random() * 15
        ELSE 215 + random() * 6
    END,
    CASE 
        WHEN random() < 0.1 THEN 190 + random() * 20
        WHEN random() < 0.05 THEN 245 + random() * 15
        ELSE 215 + random() * 6
    END,
    -- Ток с возможными перегрузками для создания алертов
    CASE 
        WHEN c.controller_id IN (1, 4, 5) THEN 35 + random() * 25  -- Перегруженные контроллеры (35-60A)
        ELSE 5 + random() * 30  -- Нормальная нагрузка (5-35A)
    END,
    CASE 
        WHEN c.controller_id IN (1, 4, 5) THEN 35 + random() * 25
        ELSE 5 + random() * 30
    END,
    CASE 
        WHEN c.controller_id IN (1, 4, 5) THEN 35 + random() * 25
        ELSE 5 + random() * 30
    END,
    -- Давление холодной воды на основе реальных 5.0 bar
    CASE 
        WHEN random() < 0.15 THEN 1.5 + random() * 1  -- 15% низкое давление
        ELSE 4.5 + random() * 1  -- 85% нормальное (4.5-5.5 bar)
    END,
    -- Температура холодной воды на основе реальных 15°C
    12 + random() * 8,  -- 12-20°C
    -- Давление ГВС на основе реальных 2.84 bar
    CASE 
        WHEN random() < 0.2 THEN 1.5 + random() * 1  -- 20% низкое давление
        ELSE 2.5 + random() * 1  -- 80% нормальное (2.5-3.5 bar)
    END,
    CASE 
        WHEN random() < 0.2 THEN 1.5 + random() * 1
        ELSE 2.5 + random() * 1
    END,
    -- Температура ГВС на основе реальных 31.7°C
    CASE 
        WHEN random() < 0.1 THEN 25 + random() * 10  -- 10% низкая температура
        WHEN random() < 0.05 THEN 65 + random() * 10  -- 5% перегрев
        ELSE 50 + random() * 15  -- 85% нормальная (50-65°C)
    END,
    CASE 
        WHEN random() < 0.1 THEN 25 + random() * 10
        WHEN random() < 0.05 THEN 65 + random() * 10
        ELSE 45 + random() * 15  -- Выходная температура чуть ниже
    END,
    -- Температура воздуха для Ташкента
    18 + random() * 15,  -- 18-33°C (климат Ташкента)
    -- Влажность для Ташкента
    30 + random() * 40,  -- 30-70% (сухой климат)
    -- Датчик протечки
    random() < 0.03      -- 3% вероятность протечки
FROM controllers c
CROSS JOIN generate_series(1, 72) s  -- 72 записи (3 дня по 24 часа) для каждого контроллера
WHERE c.status = 'active';

-- Пользователи системы
INSERT INTO users (username, email, password_hash, role, is_active) VALUES
('admin_tashkent', 'admin@olmazor.uz', '$2b$12$LQv3c1yqBWVHxkd0LQ1Gv.viQxDzWKO9QbmT9Z8Q3ynWqgT.SX/IS', 'admin', true),
('operator_farabi', 'operator@farabi.uz', '$2b$12$LQv3c1yqBWVHxkd0LQ1Gv.viQxDzWKO9QbmT9Z8Q3ynWqgT.SX/IS', 'user', true),
('engineer_olmazor', 'engineer@olmazor.uz', '$2b$12$LQv3c1yqBWVHxkd0LQ1Gv.viQxDzWKO9QbmT9Z8Q3ynWqgT.SX/IS', 'user', true);

-- Алерты инфраструктуры с реалистичными проблемами
INSERT INTO infrastructure_alerts (type, infrastructure_id, infrastructure_type, severity, message, affected_buildings, data, status) VALUES
-- Перегрузка трансформатора Фараби-2 (высокая нагрузка от зданий Farabi-005 до Farabi-009)
('TRANSFORMER_OVERLOAD', 'TR-FARABI-02', 'transformer', 'WARNING', 'Высокая загрузка трансформатора Фараби-2: 87.3%', 5, 
 '{"load_percent": 87.3, "capacity_kva": 1000.0, "affected_buildings": ["Farabi-005", "Farabi-006", "Farabi-007", "Farabi-008", "Farabi-009"], "threshold_used": 85}', 'active'),

-- Критическая перегрузка трансформатора Олмазор-1
('TRANSFORMER_CRITICAL_OVERLOAD', 'TR-OLMAZOR-01', 'transformer', 'CRITICAL', 'КРИТИЧЕСКАЯ перегрузка трансформатора Олмазор-1: 96.8%', 5,
 '{"load_percent": 96.8, "capacity_kva": 800.0, "affected_buildings": ["Farabi-010", "Farabi-011", "Farabi-012", "Farabi-013", "Farabi-014"], "threshold_used": 95}', 'active'),

-- Низкое давление воды в Олмазоре
('WATER_PRESSURE_LOW', 'CW-OLMAZOR-01', 'water_source', 'WARNING', 'Низкое давление в водозаборе Олмазор: 2.1 bar', 7,
 '{"pressure_bar": 2.1, "normal_pressure": 4.5, "affected_buildings": 7, "threshold": 2.5}', 'acknowledged'),

-- Трансформатор на обслуживании
('MAINTENANCE_SCHEDULED', 'TR-SHIFONUR-01', 'transformer', 'INFO', 'Плановое обслуживание трансформатора Шифонур-1', 1,
 '{"maintenance_type": "planned", "expected_duration_hours": 4, "affected_buildings": ["Shifonur-3A"]}', 'active'),

-- Потеря связи с контроллером
('COMMUNICATION_LOST', 'CTRL003', 'controller', 'WARNING', 'Потеря связи с контроллером CTRL003 в здании Farabi-008', 1,
 '{"last_heartbeat": "2025-06-08T00:58:41.000Z", "building": "Farabi-008", "duration_hours": 3}', 'active'),

-- Аномалия напряжения
('VOLTAGE_ANOMALY', 'TR-FARABI-01', 'transformer', 'WARNING', 'Нестабильное напряжение в трансформаторе Фараби-1: колебания 190-250V', 6,
 '{"voltage_min": 190, "voltage_max": 250, "normal_range": "215-225", "affected_buildings": 6}', 'resolved');

-- Обновление материализованного представления с новыми данными
REFRESH MATERIALIZED VIEW mv_transformer_load_realtime;

-- Логируем завершение загрузки данных Ташкента
INSERT INTO logs (timestamp, log_level, message) 
VALUES (NOW(), 'INFO', 'Тестовые данные на базе реального API Ташкента успешно загружены в InfraSafe'); 