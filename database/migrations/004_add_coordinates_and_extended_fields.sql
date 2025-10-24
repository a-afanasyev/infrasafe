-- ===============================================
-- Миграция 004: Добавление координат и расширенных полей
-- Дата: 2025-10-21
-- Описание: Добавление координат для объектов инфраструктуры
--           и дополнительных полей для линий электропередач
-- ===============================================

-- ===============================================
-- 1. ТРАНСФОРМАТОРЫ (transformers)
-- Добавление координат и PostGIS геометрии
-- ===============================================

-- Добавляем поля координат
ALTER TABLE transformers 
ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS geom GEOMETRY(POINT, 4326);

-- Индекс для пространственных запросов
CREATE INDEX IF NOT EXISTS idx_transformers_geom ON transformers USING GIST(geom);

-- Индекс для координат
CREATE INDEX IF NOT EXISTS idx_transformers_coordinates ON transformers(latitude, longitude)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Триггер для автоматического обновления geom при изменении координат
-- Используем существующую функцию update_geom_on_coordinates_change()
CREATE TRIGGER IF NOT EXISTS trig_transformers_coordinates_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON transformers
    FOR EACH ROW 
    WHEN (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)
    EXECUTE FUNCTION update_geom_on_coordinates_change();

-- Комментарии
COMMENT ON COLUMN transformers.latitude IS 'Широта расположения трансформатора';
COMMENT ON COLUMN transformers.longitude IS 'Долгота расположения трансформатора';
COMMENT ON COLUMN transformers.geom IS 'PostGIS геометрия точки трансформатора';

-- ===============================================
-- 2. ЛИНИИ ЭЛЕКТРОПЕРЕДАЧ (lines)
-- Добавление координат начала/конца и дополнительных полей
-- ===============================================

-- Добавляем координаты начальной и конечной точки
ALTER TABLE lines 
ADD COLUMN IF NOT EXISTS latitude_start NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS longitude_start NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS latitude_end NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS longitude_end NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS geom GEOMETRY(LINESTRING, 4326);

-- НОВЫЕ ПОЛЯ: тип кабеля и год ввода
ALTER TABLE lines
ADD COLUMN IF NOT EXISTS cable_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS commissioning_year INTEGER 
    CHECK (commissioning_year >= 1900 AND commissioning_year <= 2100);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_lines_geom ON lines USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_lines_cable_type ON lines(cable_type) WHERE cable_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lines_commissioning_year ON lines(commissioning_year) 
WHERE commissioning_year IS NOT NULL;

-- Функция для создания LINESTRING из координат начала и конца
CREATE OR REPLACE FUNCTION update_lines_geom_from_coordinates()
RETURNS TRIGGER AS $$
BEGIN
    -- Проверяем наличие всех 4 координат
    IF NEW.latitude_start IS NOT NULL AND NEW.longitude_start IS NOT NULL AND
       NEW.latitude_end IS NOT NULL AND NEW.longitude_end IS NOT NULL THEN
        
        -- Создаем LINESTRING из двух точек
        NEW.geom = ST_SetSRID(
            ST_MakeLine(
                ST_MakePoint(NEW.longitude_start, NEW.latitude_start),
                ST_MakePoint(NEW.longitude_end, NEW.latitude_end)
            ),
            4326
        );
        
        -- Вычисляем длину линии в километрах
        NEW.length_km = ROUND(
            (ST_Length(ST_Transform(NEW.geom, 3857)) / 1000.0)::NUMERIC,
            3
        );
    END IF;
    
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для автоматического обновления геометрии
DROP TRIGGER IF EXISTS trig_lines_geom_from_coordinates ON lines;
CREATE TRIGGER trig_lines_geom_from_coordinates
    BEFORE INSERT OR UPDATE OF latitude_start, longitude_start, latitude_end, longitude_end ON lines
    FOR EACH ROW
    EXECUTE FUNCTION update_lines_geom_from_coordinates();

-- Комментарии
COMMENT ON COLUMN lines.latitude_start IS 'Широта начальной точки линии';
COMMENT ON COLUMN lines.longitude_start IS 'Долгота начальной точки линии';
COMMENT ON COLUMN lines.latitude_end IS 'Широта конечной точки линии';
COMMENT ON COLUMN lines.longitude_end IS 'Долгота конечной точки линии';
COMMENT ON COLUMN lines.cable_type IS 'Тип кабеля (copper, aluminum, steel_aluminum, fiber)';
COMMENT ON COLUMN lines.commissioning_year IS 'Год ввода в эксплуатацию';
COMMENT ON COLUMN lines.geom IS 'PostGIS геометрия линии (LINESTRING)';

-- ===============================================
-- 3. ЛИНИИ ВОДОСНАБЖЕНИЯ (water_lines)
-- Добавление координат начала/конца
-- ===============================================

-- Добавляем координаты
ALTER TABLE water_lines
ADD COLUMN IF NOT EXISTS latitude_start NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS longitude_start NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS latitude_end NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS longitude_end NUMERIC(9,6),
ADD COLUMN IF NOT EXISTS geom GEOMETRY(LINESTRING, 4326);

-- Индекс
CREATE INDEX IF NOT EXISTS idx_water_lines_geom ON water_lines USING GIST(geom);

-- Триггер для геометрии (используем ту же функцию)
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

DROP TRIGGER IF EXISTS trig_water_lines_geom_from_coordinates ON water_lines;
CREATE TRIGGER trig_water_lines_geom_from_coordinates
    BEFORE INSERT OR UPDATE OF latitude_start, longitude_start, latitude_end, longitude_end ON water_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_water_lines_geom_from_coordinates();

-- Комментарии
COMMENT ON COLUMN water_lines.latitude_start IS 'Широта начальной точки линии водоснабжения';
COMMENT ON COLUMN water_lines.longitude_start IS 'Долгота начальной точки линии водоснабжения';
COMMENT ON COLUMN water_lines.latitude_end IS 'Широта конечной точки линии водоснабжения';
COMMENT ON COLUMN water_lines.longitude_end IS 'Долгота конечной точки линии водоснабжения';

-- ===============================================
-- 4. ЛИНИИ ИНФРАСТРУКТУРЫ (infrastructure_lines)
-- Добавление cable_type и commissioning_year
-- ===============================================

-- Добавляем новые поля (если еще не добавлены)
ALTER TABLE infrastructure_lines
ADD COLUMN IF NOT EXISTS cable_type VARCHAR(100),
ADD COLUMN IF NOT EXISTS commissioning_year INTEGER 
    CHECK (commissioning_year >= 1900 AND commissioning_year <= 2100);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_infrastructure_lines_cable_type 
ON infrastructure_lines(cable_type) WHERE cable_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_infrastructure_lines_commissioning_year 
ON infrastructure_lines(commissioning_year) WHERE commissioning_year IS NOT NULL;

-- Комментарии
COMMENT ON COLUMN infrastructure_lines.cable_type IS 'Тип кабеля/провода (для линий электропередач)';
COMMENT ON COLUMN infrastructure_lines.commissioning_year IS 'Год ввода линии в эксплуатацию';

-- ===============================================
-- 5. ПРИМЕЧАНИЯ
-- ===============================================

-- Таблицы cold_water_sources и heat_sources УЖЕ ИМЕЮТ координаты:
-- - latitude NUMERIC(9,6)
-- - longitude NUMERIC(9,6)
-- - geom GEOMETRY(POINT, 4326)
-- - Триггеры для обновления geom уже созданы
-- Для них нужно только добавить UI редактирование

-- ===============================================
-- 6. ОБНОВЛЕНИЕ СТАТИСТИКИ
-- ===============================================

ANALYZE transformers;
ANALYZE lines;
ANALYZE water_lines;
ANALYZE infrastructure_lines;

-- ===============================================
-- 7. ЛОГИРОВАНИЕ
-- ===============================================

INSERT INTO logs (timestamp, log_level, message)
VALUES (NOW(), 'INFO', 'Миграция 004: Добавлены координаты и расширенные поля успешно');

