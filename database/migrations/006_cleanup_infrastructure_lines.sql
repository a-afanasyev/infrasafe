-- ================================================
-- Миграция 006: Очистка дублирования infrastructure_lines
-- Дата: 22 октября 2025
-- Цель: Убрать дублирование, сохранить функционал в lines и water_lines
-- ================================================

-- ============================================
-- ЭТАП 1: Обновление water_lines
-- ============================================

-- 1.1. Добавляем поля для поддержки путей и ответвлений
ALTER TABLE water_lines 
ADD COLUMN IF NOT EXISTS line_type VARCHAR(20) DEFAULT 'ХВС',
ADD COLUMN IF NOT EXISTS main_path JSONB,
ADD COLUMN IF NOT EXISTS branches JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS geom geometry(LineString, 4326);

-- 1.2. Добавляем индексы
CREATE INDEX IF NOT EXISTS idx_water_lines_main_path ON water_lines USING gin(main_path);
CREATE INDEX IF NOT EXISTS idx_water_lines_branches ON water_lines USING gin(branches);
CREATE INDEX IF NOT EXISTS idx_water_lines_geom ON water_lines USING gist(geom);

-- 1.3. Создаём функцию обновления geom для water_lines
CREATE OR REPLACE FUNCTION update_water_line_geom_from_path()
RETURNS TRIGGER AS $$
BEGIN
    -- Если есть main_path, строим LINESTRING из него
    IF NEW.main_path IS NOT NULL AND jsonb_array_length(NEW.main_path) >= 2 THEN
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

-- 1.4. Триггер для автообновления geom
DROP TRIGGER IF EXISTS trig_water_lines_update_geom ON water_lines;
CREATE TRIGGER trig_water_lines_update_geom
BEFORE INSERT OR UPDATE ON water_lines
FOR EACH ROW
EXECUTE FUNCTION update_water_line_geom_from_path();

-- 1.5. Конвертируем существующие координаты в main_path
UPDATE water_lines 
SET main_path = jsonb_build_array(
    jsonb_build_object(
        'lat', latitude_start,
        'lng', longitude_start,
        'order', 0,
        'description', 'Начальная точка'
    ),
    jsonb_build_object(
        'lat', latitude_end,
        'lng', longitude_end,
        'order', 1,
        'description', 'Конечная точка'
    )
),
branches = '[]'::jsonb
WHERE (main_path IS NULL OR main_path = '[]'::jsonb)
  AND latitude_start IS NOT NULL 
  AND longitude_start IS NOT NULL
  AND latitude_end IS NOT NULL 
  AND longitude_end IS NOT NULL;

-- ============================================
-- ЭТАП 2: Миграция данных из infrastructure_lines
-- ============================================

-- 2.1. Мигрируем линии ЭЛЕКТРИЧЕСТВА в lines
INSERT INTO lines (
    name, 
    voltage_kv, 
    length_km,
    main_path, 
    branches, 
    cable_type, 
    commissioning_year
)
SELECT 
    name,
    voltage_kv,
    COALESCE(length_km, 0),
    main_path,
    COALESCE(branches, '[]'::jsonb),
    cable_type,
    commissioning_year
FROM infrastructure_lines
WHERE line_type = 'electricity'
ON CONFLICT DO NOTHING;

-- 2.2. Мигрируем линии ХВС в water_lines
INSERT INTO water_lines (
    name,
    description,
    line_type,
    diameter_mm,
    material,
    status,
    main_path,
    branches
)
SELECT 
    name,
    description,
    'ХВС'::character varying,
    diameter_mm,
    material,
    status,
    main_path,
    COALESCE(branches, '[]'::jsonb)
FROM infrastructure_lines
WHERE line_type = 'cold_water'
ON CONFLICT DO NOTHING;

-- 2.3. Мигрируем линии ГВС в water_lines
INSERT INTO water_lines (
    name,
    description,
    line_type,
    diameter_mm,
    material,
    status,
    main_path,
    branches
)
SELECT 
    name,
    description,
    'ГВС'::character varying,
    diameter_mm,
    material,
    status,
    main_path,
    COALESCE(branches, '[]'::jsonb)
FROM infrastructure_lines
WHERE line_type = 'hot_water'
ON CONFLICT DO NOTHING;

-- ============================================
-- ЭТАП 3: Удаление infrastructure_lines
-- ============================================

-- 3.1. Удаляем зависимости (если есть)
DROP TABLE IF EXISTS line_alert_zones CASCADE;

-- 3.2. Удаляем таблицу infrastructure_lines
DROP TABLE IF EXISTS infrastructure_lines CASCADE;

-- 3.3. Удаляем связанные функции и триггеры
DROP FUNCTION IF EXISTS update_line_geom_from_path CASCADE;
DROP FUNCTION IF EXISTS calculate_line_length CASCADE;

-- ============================================
-- ЭТАП 4: Проверка результатов
-- ============================================

-- 4.1. Проверяем lines
SELECT 
    'lines' as table_name,
    COUNT(*) as total,
    COUNT(CASE WHEN main_path IS NOT NULL THEN 1 END) as with_main_path,
    COUNT(CASE WHEN branches IS NOT NULL AND jsonb_array_length(branches) > 0 THEN 1 END) as with_branches
FROM lines;

-- 4.2. Проверяем water_lines
SELECT 
    'water_lines' as table_name,
    COUNT(*) as total,
    COUNT(CASE WHEN main_path IS NOT NULL THEN 1 END) as with_main_path,
    COUNT(CASE WHEN branches IS NOT NULL AND jsonb_array_length(branches) > 0 THEN 1 END) as with_branches,
    COUNT(CASE WHEN line_type = 'ХВС' THEN 1 END) as cold_water,
    COUNT(CASE WHEN line_type = 'ГВС' THEN 1 END) as hot_water
FROM water_lines;

-- 4.3. Убеждаемся что infrastructure_lines удалена
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'infrastructure_lines')
        THEN '❌ Таблица ещё существует'
        ELSE '✅ Таблица успешно удалена'
    END as infrastructure_lines_status;

COMMENT ON COLUMN water_lines.main_path IS 'JSONB массив точек основного пути [{lat, lng, order, description}, ...]';
COMMENT ON COLUMN water_lines.branches IS 'JSONB массив ответвлений [{name, branch_id, parent_point_index, points}, ...]';

