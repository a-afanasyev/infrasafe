-- ================================================
-- Миграция 005: Добавление поддержки путей и ответвлений к таблице lines
-- Дата: 22 октября 2025
-- Цель: Унифицировать формат линий для поддержки изломов и ответвлений
-- ================================================

-- 1. Добавляем JSONB поля для путей и ответвлений
ALTER TABLE lines 
ADD COLUMN IF NOT EXISTS main_path JSONB,
ADD COLUMN IF NOT EXISTS branches JSONB DEFAULT '[]'::jsonb;

-- 2. Добавляем индексы для производительности
CREATE INDEX IF NOT EXISTS idx_lines_main_path ON lines USING gin(main_path);
CREATE INDEX IF NOT EXISTS idx_lines_branches ON lines USING gin(branches);

-- 3. Создаем функцию автоконвертации start/end координат → main_path
-- Эта функция автоматически создаёт main_path из старых координат
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

-- 4. Создаём триггер для автоконвертации
DROP TRIGGER IF EXISTS trig_lines_convert_endpoints ON lines;
CREATE TRIGGER trig_lines_convert_endpoints
BEFORE INSERT OR UPDATE ON lines
FOR EACH ROW
EXECUTE FUNCTION convert_line_endpoints_to_path();

-- 5. Обновляем функцию update_line_geom для работы с main_path
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

-- 6. Обновляем триггер для geom
DROP TRIGGER IF EXISTS trig_lines_geom_from_coordinates ON lines;
CREATE TRIGGER trig_lines_update_geom
BEFORE INSERT OR UPDATE ON lines
FOR EACH ROW
EXECUTE FUNCTION update_line_geom_from_path();

-- 7. Конвертируем существующие линии (если есть координаты)
-- Это безопасно: конвертируем только если main_path пуст
UPDATE lines 
SET main_path = jsonb_build_array(
    jsonb_build_object(
        'lat', latitude_start,
        'lng', longitude_start,
        'order', 0,
        'description', 'Начальная точка линии'
    ),
    jsonb_build_object(
        'lat', latitude_end,
        'lng', longitude_end,
        'order', 1,
        'description', 'Конечная точка линии'
    )
),
branches = '[]'::jsonb
WHERE (main_path IS NULL OR main_path = '[]'::jsonb)
  AND latitude_start IS NOT NULL 
  AND longitude_start IS NOT NULL
  AND latitude_end IS NOT NULL 
  AND longitude_end IS NOT NULL;

-- 8. Комментарии для документации
COMMENT ON COLUMN lines.main_path IS 'JSONB массив точек основного пути линии [{lat, lng, order, description}, ...]';
COMMENT ON COLUMN lines.branches IS 'JSONB массив ответвлений от основной линии [{name, branch_id, parent_point_index, points: [{lat, lng, order}]}, ...]';

-- 9. Проверка результатов миграции
SELECT 
    line_id,
    name,
    CASE 
        WHEN main_path IS NOT NULL AND jsonb_array_length(main_path) > 0 THEN 'Да'
        ELSE 'Нет'
    END as has_main_path,
    jsonb_array_length(main_path) as path_points,
    jsonb_array_length(branches) as branches_count
FROM lines
LIMIT 5;

