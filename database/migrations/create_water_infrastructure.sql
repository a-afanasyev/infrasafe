-- Создание инфраструктуры водоснабжения
-- Линии водоснабжения и поставщики ХВС/ГВС

BEGIN;

-- 1. Создаем таблицу линий водоснабжения
CREATE TABLE IF NOT EXISTS water_lines (
    line_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    diameter_mm INTEGER, -- диаметр трубы в мм
    material VARCHAR(50), -- материал трубы (steel, plastic, copper, etc.)
    pressure_rating DECIMAL(5,2), -- номинальное давление в барах
    installation_date DATE,
    length_km DECIMAL(8,3), -- длина линии в км
    status VARCHAR(20) DEFAULT 'active', -- active, maintenance, inactive
    maintenance_contact VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Создаем таблицу поставщиков водоснабжения
CREATE TABLE IF NOT EXISTS water_suppliers (
    supplier_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL, -- 'cold_water' или 'hot_water'
    company_name VARCHAR(150),
    contact_person VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    address TEXT,
    contract_number VARCHAR(50),
    service_area TEXT, -- зона обслуживания
    tariff_per_m3 DECIMAL(8,2), -- тариф за м3
    status VARCHAR(20) DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Создаем таблицу точек измерения для метрик
CREATE TABLE IF NOT EXISTS water_measurement_points (
    point_id SERIAL PRIMARY KEY,
    building_id INTEGER NOT NULL REFERENCES buildings(building_id),
    pipe_type VARCHAR(20) NOT NULL, -- 'cold_water', 'hot_water_supply', 'hot_water_return'
    location_description VARCHAR(200), -- описание местоположения точки
    meter_serial_number VARCHAR(50), -- серийный номер счетчика
    installation_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Добавляем поля в таблицу buildings для связей
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS water_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS cold_water_supplier_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS hot_water_supplier_id INTEGER;

-- 5. Создаем внешние ключи
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_water_line 
    FOREIGN KEY (water_line_id) REFERENCES water_lines(line_id);

ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_supplier 
    FOREIGN KEY (cold_water_supplier_id) REFERENCES water_suppliers(supplier_id);

ALTER TABLE buildings ADD CONSTRAINT fk_buildings_hot_water_supplier 
    FOREIGN KEY (hot_water_supplier_id) REFERENCES water_suppliers(supplier_id);

-- 6. Создаем индексы
CREATE INDEX IF NOT EXISTS idx_water_lines_status ON water_lines(status);
CREATE INDEX IF NOT EXISTS idx_water_lines_name ON water_lines(name);

CREATE INDEX IF NOT EXISTS idx_water_suppliers_type ON water_suppliers(type);
CREATE INDEX IF NOT EXISTS idx_water_suppliers_status ON water_suppliers(status);
CREATE INDEX IF NOT EXISTS idx_water_suppliers_name ON water_suppliers(name);

CREATE INDEX IF NOT EXISTS idx_buildings_water_line ON buildings(water_line_id);
CREATE INDEX IF NOT EXISTS idx_buildings_cold_water_supplier ON buildings(cold_water_supplier_id);
CREATE INDEX IF NOT EXISTS idx_buildings_hot_water_supplier ON buildings(hot_water_supplier_id);

CREATE INDEX IF NOT EXISTS idx_measurement_points_building ON water_measurement_points(building_id);
CREATE INDEX IF NOT EXISTS idx_measurement_points_pipe_type ON water_measurement_points(pipe_type);

-- 7. Создаем триггеры для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_water_lines_updated_at BEFORE UPDATE ON water_lines 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_water_suppliers_updated_at BEFORE UPDATE ON water_suppliers 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_measurement_points_updated_at BEFORE UPDATE ON water_measurement_points 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Добавляем тестовые данные для линий водоснабжения
INSERT INTO water_lines (name, description, diameter_mm, material, pressure_rating, length_km, status) VALUES
('Линия ХВС Центральная', 'Основная магистраль холодного водоснабжения', 300, 'steel', 6.0, 2.5, 'active'),
('Линия ХВС Восточная', 'Восточная ветка водоснабжения', 200, 'plastic', 4.5, 1.8, 'active'),
('Линия ХВС Западная', 'Западная ветка водоснабжения', 250, 'steel', 5.0, 2.1, 'active'),
('Линия ГВС Центральная', 'Основная магистраль горячего водоснабжения', 150, 'copper', 3.5, 1.5, 'active'),
('Линия ГВС Районная', 'Районная линия горячего водоснабжения', 100, 'steel', 3.0, 1.2, 'maintenance');

-- 9. Добавляем тестовые данные для поставщиков
INSERT INTO water_suppliers (name, type, company_name, contact_person, phone, service_area, tariff_per_m3, status) VALUES
('ХВС Центр', 'cold_water', 'ООО "Водоканал Центр"', 'Иванов И.И.', '+998901234567', 'Центральный район', 1250.00, 'active'),
('ХВС Восток', 'cold_water', 'ООО "АкваВосток"', 'Петров П.П.', '+998902345678', 'Восточный район', 1200.00, 'active'),
('ХВС Запад', 'cold_water', 'ЗАО "ВодоЗапад"', 'Сидоров С.С.', '+998903456789', 'Западный район', 1300.00, 'active'),
('ГВС Тепло', 'hot_water', 'ООО "ТеплоСнаб"', 'Николаев Н.Н.', '+998904567890', 'Весь город', 2500.00, 'active'),
('ГВС Комфорт', 'hot_water', 'ЗАО "КомфортТепло"', 'Федоров Ф.Ф.', '+998905678901', 'Северный район', 2400.00, 'active');

-- 10. Привязываем здания к линиям и поставщикам
UPDATE buildings SET 
    water_line_id = 1,
    cold_water_supplier_id = 1,
    hot_water_supplier_id = 4
WHERE building_id IN (34, 35, 36);

UPDATE buildings SET 
    water_line_id = 2,
    cold_water_supplier_id = 2,
    hot_water_supplier_id = 4
WHERE building_id IN (37, 38, 39);

UPDATE buildings SET 
    water_line_id = 3,
    cold_water_supplier_id = 3,
    hot_water_supplier_id = 5
WHERE building_id IN (40, 41, 42);

-- 11. Создаем точки измерения для нескольких зданий
INSERT INTO water_measurement_points (building_id, pipe_type, location_description, meter_serial_number) VALUES
-- Здание 34 (Farabi-001)
(34, 'cold_water', 'Вход в здание, подвал', 'CW-001-2023'),
(34, 'hot_water_supply', 'Подача ГВС, тех.этаж', 'HWS-001-2023'),
(34, 'hot_water_return', 'Обратка ГВС, тех.этаж', 'HWR-001-2023'),

-- Здание 35 (Farabi-002)  
(35, 'cold_water', 'Техническое помещение', 'CW-002-2023'),
(35, 'hot_water_supply', 'Подача ГВС', 'HWS-002-2023'),
(35, 'hot_water_return', 'Обратка ГВС', 'HWR-002-2023'),

-- Здание 37 (без ГВС)
(37, 'cold_water', 'Подвал здания', 'CW-004-2023');

COMMIT;

-- Проверяем результат
SELECT 
    b.building_id,
    b.name,
    b.address,
    wl.name as water_line,
    cws.name as cold_water_supplier,
    hws.name as hot_water_supplier,
    COUNT(wmp.point_id) as measurement_points
FROM buildings b
LEFT JOIN water_lines wl ON b.water_line_id = wl.line_id
LEFT JOIN water_suppliers cws ON b.cold_water_supplier_id = cws.supplier_id
LEFT JOIN water_suppliers hws ON b.hot_water_supplier_id = hws.supplier_id
LEFT JOIN water_measurement_points wmp ON b.building_id = wmp.building_id
GROUP BY b.building_id, b.name, b.address, wl.name, cws.name, hws.name
ORDER BY b.building_id
LIMIT 10; 