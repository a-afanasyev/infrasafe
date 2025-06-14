-- Тестовые данные для InfraSafe

-- Вставляем типы оповещений
INSERT INTO alert_types (type_name, description) VALUES 
('electricity_failure', 'Отключение электроэнергии'),
('water_leak', 'Протечка воды'),
('pressure_low', 'Низкое давление воды'),
('temperature_high', 'Высокая температура'),
('controller_offline', 'Контроллер не отвечает')
ON CONFLICT (type_name) DO NOTHING;

-- Вставляем тестовые здания
INSERT INTO buildings (name, address, town, latitude, longitude, region, management_company, hot_water) VALUES
('ЖК Северный', 'ул. Ленина, 123', 'Ташкент', 41.2995, 69.2401, 'Мирзо-Улугбекский', 'УК "Север"', true),
('ЖК Южный', 'ул. Навои, 456', 'Ташкент', 41.2865, 69.2034, 'Юнусабадский', 'УК "Юг"', true),
('ЖК Восточный', 'ул. Шота Руставели, 789', 'Ташкент', 41.3123, 69.2797, 'Шайхантахурский', 'УК "Восток"', false),
('ЖК Западный', 'ул. Амира Тимура, 321', 'Ташкент', 41.2847, 69.2034, 'Мирабадский', 'УК "Запад"', true),
('ЖК Центральный', 'ул. Алишера Навои, 654', 'Ташкент', 41.2995, 69.2401, 'Яшнабадский', 'УК "Центр"', true),
('ЖК Олимпийский', 'ул. Бунёдкор, 987', 'Ташкент', 41.3158, 69.2348, 'Чилонзорский', 'УК "Олимп"', true)
ON CONFLICT DO NOTHING;

-- Вставляем контроллеры
INSERT INTO controllers (serial_number, vendor, model, building_id, status, installed_at, last_heartbeat) VALUES
('CTRL-001-N', 'InfraTech', 'IT-2000', 1, 'active', NOW() - INTERVAL '30 days', NOW() - INTERVAL '5 minutes'),
('CTRL-002-S', 'InfraTech', 'IT-2000', 2, 'active', NOW() - INTERVAL '25 days', NOW() - INTERVAL '3 minutes'),
('CTRL-003-E', 'SmartSys', 'SS-1500', 3, 'maintenance', NOW() - INTERVAL '20 days', NOW() - INTERVAL '2 hours'),
('CTRL-004-W', 'InfraTech', 'IT-2000', 4, 'active', NOW() - INTERVAL '15 days', NOW() - INTERVAL '1 minute'),
('CTRL-005-C', 'TechMon', 'TM-3000', 5, 'active', NOW() - INTERVAL '10 days', NOW() - INTERVAL '2 minutes'),
('CTRL-006-O', 'InfraTech', 'IT-2000', 6, 'active', NOW() - INTERVAL '5 days', NOW() - INTERVAL '30 seconds')
ON CONFLICT (serial_number) DO NOTHING;

-- Вставляем актуальные метрики (последние данные)
INSERT INTO metrics (
    controller_id, timestamp,
    electricity_ph1, electricity_ph2, electricity_ph3,
    amperage_ph1, amperage_ph2, amperage_ph3,
    cold_water_pressure, cold_water_temp,
    hot_water_in_pressure, hot_water_out_pressure,
    hot_water_in_temp, hot_water_out_temp,
    air_temp, humidity, leak_sensor
) VALUES
-- Здание 1 - нормальные показатели
(1, NOW() - INTERVAL '2 minutes', 
 220.5, 221.0, 219.8, 15.2, 14.8, 15.5,
 2.5, 8.5, 3.2, 2.8, 65.0, 45.0, 22.0, 45.0, false),

-- Здание 2 - проблемы с электричеством
(2, NOW() - INTERVAL '3 minutes',
 185.0, 190.0, 187.5, 18.5, 19.2, 18.8,
 2.3, 9.0, 3.0, 2.6, 62.0, 42.0, 23.5, 48.0, false),

-- Здание 3 - контроллер в обслуживании, старые данные
(3, NOW() - INTERVAL '2 hours',
 NULL, NULL, NULL, NULL, NULL, NULL,
 NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),

-- Здание 4 - протечка!
(4, NOW() - INTERVAL '1 minute',
 218.0, 220.5, 219.0, 14.5, 15.0, 14.8,
 2.7, 7.5, 3.5, 3.1, 68.0, 48.0, 21.0, 52.0, true),

-- Здание 5 - низкое давление воды
(5, NOW() - INTERVAL '2 minutes',
 222.0, 223.5, 221.8, 13.8, 14.2, 14.0,
 0.8, 10.0, 1.2, 0.9, 58.0, 38.0, 24.0, 44.0, false),

-- Здание 6 - отличные показатели
(6, NOW() - INTERVAL '30 seconds',
 221.5, 222.0, 220.8, 14.0, 14.5, 14.2,
 3.0, 8.0, 3.8, 3.4, 70.0, 50.0, 20.5, 46.0, false);

-- Вставляем исторические данные для графиков (последние 24 часа)
INSERT INTO metrics (
    controller_id, timestamp,
    electricity_ph1, electricity_ph2, electricity_ph3,
    amperage_ph1, amperage_ph2, amperage_ph3,
    cold_water_pressure, cold_water_temp,
    hot_water_in_pressure, hot_water_out_pressure,
    hot_water_in_temp, hot_water_out_temp,
    air_temp, humidity, leak_sensor
) 
SELECT 
    controller_id,
    NOW() - (interval '1 hour' * generate_series(1, 24)),
    220 + random() * 20 - 10, -- electricity_ph1: 210-230V
    220 + random() * 20 - 10, -- electricity_ph2: 210-230V  
    220 + random() * 20 - 10, -- electricity_ph3: 210-230V
    14 + random() * 4 - 2,    -- amperage_ph1: 12-16A
    14 + random() * 4 - 2,    -- amperage_ph2: 12-16A
    14 + random() * 4 - 2,    -- amperage_ph3: 12-16A
    2.5 + random() * 1 - 0.5, -- cold_water_pressure: 2-3 Bar
    8 + random() * 4 - 2,     -- cold_water_temp: 6-10°C
    3.2 + random() * 0.8 - 0.4, -- hot_water_in_pressure: 2.8-3.6 Bar
    2.8 + random() * 0.8 - 0.4, -- hot_water_out_pressure: 2.4-3.2 Bar
    65 + random() * 10 - 5,   -- hot_water_in_temp: 60-70°C
    45 + random() * 10 - 5,   -- hot_water_out_temp: 40-50°C
    20 + random() * 8 - 4,    -- air_temp: 16-24°C
    45 + random() * 20 - 10,  -- humidity: 35-55%
    false                     -- leak_sensor: обычно false
FROM controllers 
WHERE status = 'active'; 