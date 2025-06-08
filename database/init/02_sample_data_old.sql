-- ===============================================
-- Тестовые данные для InfraSafe
-- ===============================================

-- Тестовые данные для типов алертов
INSERT INTO alert_types (type_name, description) VALUES
('POWER_FAILURE', 'Отключение электроэнергии'),
('WATER_LEAK', 'Утечка воды'),
('OVERHEATING', 'Перегрев оборудования'),
('LOW_PRESSURE', 'Низкое давление в системе'),
('COMMUNICATION_LOST', 'Потеря связи с контроллером');

-- Тестовые трансформаторы
INSERT INTO power_transformers (id, name, address, latitude, longitude, capacity_kva, voltage_primary, voltage_secondary, status, manufacturer) VALUES
('TR-001', 'Трансформатор Центральный-1', 'ул. Ленина, 10, Москва', 55.7558, 37.6176, 630.0, 10000.0, 380.0, 'active', 'ТР Завод'),
('TR-002', 'Трансформатор Южный-2', 'ул. Гагарина, 25, Москва', 55.7308, 37.6142, 1000.0, 10000.0, 380.0, 'active', 'ТР Завод'),
('TR-003', 'Трансформатор Северный-3', 'пр. Мира, 45, Москва', 55.7847, 37.6339, 400.0, 6000.0, 380.0, 'active', 'Сименс'),
('TR-004', 'Трансформатор Восточный-4', 'ул. Баумана, 15, Москва', 55.7663, 37.6790, 800.0, 10000.0, 380.0, 'maintenance', 'АББ'),
('TR-005', 'Трансформатор Западный-5', 'Кутузовский пр., 32, Москва', 55.7441, 37.5529, 500.0, 6000.0, 380.0, 'active', 'ТР Завод');

-- Тестовые источники холодной воды
INSERT INTO cold_water_sources (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour, operating_pressure_bar, status) VALUES
('CW-001', 'Насосная станция №1', 'ул. Водопроводная, 5, Москва', 55.7522, 37.6156, 'pumping_station', 150.0, 4.5, 'active'),
('CW-002', 'Скважина №2', 'ул. Артезианская, 12, Москва', 55.7654, 37.6489, 'well', 80.0, 3.2, 'active'),
('CW-003', 'Резервуар №3', 'ул. Резервная, 8, Москва', 55.7389, 37.5987, 'reservoir', 200.0, 2.8, 'active');

-- Тестовые источники тепла
INSERT INTO heat_sources (id, name, address, latitude, longitude, source_type, capacity_mw, fuel_type, status) VALUES
('HS-001', 'Котельная Центральная', 'ул. Теплая, 3, Москва', 55.7543, 37.6234, 'boiler_house', 5.5, 'gas', 'active'),
('HS-002', 'ТЭЦ №2', 'ул. Энергетиков, 15, Москва', 55.7712, 37.6678, 'chp', 25.0, 'gas', 'active'),
('HS-003', 'Котельная Районная', 'ул. Отопительная, 7, Москва', 55.7234, 37.5845, 'boiler_house', 3.2, 'gas', 'active');

-- Тестовые здания
INSERT INTO buildings (name, address, town, latitude, longitude, region, management_company, has_hot_water, power_transformer_id, cold_water_source_id, heat_source_id) VALUES
('Жилой дом №1', 'ул. Ленина, 12, Москва', 'Москва', 55.7560, 37.6180, 'Центральный', 'УК Центр', true, 'TR-001', 'CW-001', 'HS-001'),
('Жилой дом №2', 'ул. Ленина, 14, Москва', 'Москва', 55.7562, 37.6185, 'Центральный', 'УК Центр', true, 'TR-001', 'CW-001', 'HS-001'),
('Офисное здание', 'ул. Гагарина, 27, Москва', 'Москва', 55.7310, 37.6145, 'Южный', 'УК Юг', false, 'TR-002', 'CW-002', null),
('Торговый центр', 'пр. Мира, 47, Москва', 'Москва', 55.7850, 37.6342, 'Северный', 'УК Север', true, 'TR-003', 'CW-003', 'HS-002'),
('Школа №15', 'ул. Баумана, 17, Москва', 'Москва', 55.7665, 37.6793, 'Восточный', 'УК Восток', true, 'TR-004', 'CW-002', 'HS-002'),
('Больница', 'Кутузовский пр., 34, Москва', 'Москва', 55.7443, 37.5532, 'Западный', 'УК Запад', true, 'TR-005', 'CW-001', 'HS-003'),
('Детский сад №7', 'ул. Ленина, 16, Москва', 'Москва', 55.7564, 37.6190, 'Центральный', 'УК Центр', true, 'TR-001', 'CW-001', 'HS-001'),
('Спортивный комплекс', 'ул. Гагарина, 29, Москва', 'Москва', 55.7312, 37.6148, 'Южный', 'УК Юг', true, 'TR-002', 'CW-002', 'HS-003'),
('Библиотека', 'пр. Мира, 49, Москва', 'Москва', 55.7852, 37.6345, 'Северный', 'УК Север', false, 'TR-003', 'CW-003', null),
('Поликлиника', 'ул. Баумана, 19, Москва', 'Москва', 55.7667, 37.6796, 'Восточный', 'УК Восток', true, 'TR-004', 'CW-002', 'HS-002');

-- Тестовые контроллеры
INSERT INTO controllers (serial_number, vendor, model, building_id, status, last_heartbeat) VALUES
('CTR-001', 'InfraSafe', 'IS-300', 1, 'active', NOW() - INTERVAL '5 minutes'),
('CTR-002', 'InfraSafe', 'IS-300', 2, 'active', NOW() - INTERVAL '3 minutes'),
('CTR-003', 'TechMon', 'TM-250', 3, 'active', NOW() - INTERVAL '2 minutes'),
('CTR-004', 'InfraSafe', 'IS-400', 4, 'active', NOW() - INTERVAL '1 minute'),
('CTR-005', 'SmartCtrl', 'SC-100', 5, 'inactive', NOW() - INTERVAL '2 hours'),
('CTR-006', 'InfraSafe', 'IS-300', 6, 'active', NOW() - INTERVAL '30 seconds'),
('CTR-007', 'TechMon', 'TM-250', 7, 'active', NOW() - INTERVAL '4 minutes'),
('CTR-008', 'InfraSafe', 'IS-400', 8, 'active', NOW() - INTERVAL '1 minute'),
('CTR-009', 'SmartCtrl', 'SC-200', 9, 'maintenance', NOW() - INTERVAL '1 day'),
('CTR-010', 'InfraSafe', 'IS-300', 10, 'active', NOW() - INTERVAL '2 minutes');

-- Тестовые метрики (последние несколько часов)
-- Генерируем данные для активных контроллеров
INSERT INTO metrics (controller_id, timestamp, electricity_ph1, electricity_ph2, electricity_ph3, 
                    amperage_ph1, amperage_ph2, amperage_ph3, cold_water_pressure, cold_water_temp,
                    hot_water_in_pressure, hot_water_out_pressure, hot_water_in_temp, hot_water_out_temp,
                    air_temp, humidity, leak_sensor)
SELECT 
    c.controller_id,
    NOW() - INTERVAL '1 hour' * random() * 24, -- Последние 24 часа
    220 + random() * 20, -- Напряжение фаза 1 (220-240V)
    220 + random() * 20, -- Напряжение фаза 2
    220 + random() * 20, -- Напряжение фаза 3
    5 + random() * 45,   -- Ток фаза 1 (5-50A)
    5 + random() * 45,   -- Ток фаза 2
    5 + random() * 45,   -- Ток фаза 3
    2.5 + random() * 2,  -- Давление холодной воды (2.5-4.5 bar)
    8 + random() * 12,   -- Температура холодной воды (8-20°C)
    3.0 + random() * 2,  -- Давление ГВС на входе (3-5 bar)
    2.5 + random() * 1.5,-- Давление ГВС на выходе (2.5-4 bar)
    55 + random() * 10,  -- Температура ГВС на входе (55-65°C)
    45 + random() * 10,  -- Температура ГВС на выходе (45-55°C)
    18 + random() * 10,  -- Температура воздуха (18-28°C)
    40 + random() * 40,  -- Влажность (40-80%)
    random() < 0.05      -- Датчик протечки (5% вероятность)
FROM controllers c
CROSS JOIN generate_series(1, 50) s
WHERE c.status = 'active'; -- 50 записей для каждого активного контроллера

-- Тестовый пользователь для системы алертов
INSERT INTO users (username, email, password_hash, role, is_active) VALUES
('admin', 'admin@infrasafe.com', '$2b$12$LQv3c1yqBWVHxkd0LQ1Gv.viQxDzWKO9QbmT9Z8Q3ynWqgT.SX/IS', 'admin', true),
('operator', 'operator@infrasafe.com', '$2b$12$LQv3c1yqBWVHxkd0LQ1Gv.viQxDzWKO9QbmT9Z8Q3ynWqgT.SX/IS', 'user', true),
('viewer', 'viewer@infrasafe.com', '$2b$12$LQv3c1yqBWVHxkd0LQ1Gv.viQxDzWKO9QbmT9Z8Q3ynWqgT.SX/IS', 'user', true);

-- Тестовые алерты инфраструктуры
INSERT INTO infrastructure_alerts (type, infrastructure_id, infrastructure_type, severity, message, affected_buildings, data, status) VALUES
('TRANSFORMER_OVERLOAD', 'TR-002', 'transformer', 'WARNING', 'Высокая загрузка трансформатора Южный-2: 87.5%', 2, 
 '{"load_percent": 87.5, "capacity_kva": 1000.0, "threshold_used": 85}', 'active'),
('WATER_PRESSURE_LOW', 'CW-002', 'water_source', 'WARNING', 'Низкое давление в скважине №2: 2.1 bar', 3,
 '{"pressure_bar": 2.1, "normal_pressure": 3.2, "threshold": 2.5}', 'acknowledged'),
('TRANSFORMER_CRITICAL_OVERLOAD', 'TR-003', 'transformer', 'CRITICAL', 'Критическая перегрузка трансформатора Северный-3: 96.2%', 1,
 '{"load_percent": 96.2, "capacity_kva": 400.0, "threshold_used": 95}', 'active'),
('HEATING_TEMP_LOW', 'HS-003', 'heat_source', 'WARNING', 'Низкая температура в котельной Районная: 45°C', 2,
 '{"temperature": 45, "normal_temperature": 65, "threshold": 50}', 'resolved');

-- Обновление материализованного представления
REFRESH MATERIALIZED VIEW mv_transformer_load_realtime;

-- Логируем завершение вставки тестовых данных
INSERT INTO logs (timestamp, log_level, message) 
VALUES (NOW(), 'INFO', 'Тестовые данные успешно загружены в базу данных InfraSafe'); 