-- Изменение логики связей: один трансформатор обслуживает много зданий
-- Здание может питаться от двух трансформаторов (основной + резервный)
-- Здание может питаться от двух линий (основная + резервная)

BEGIN;

-- 1. Удаляем старый внешний ключ из таблицы transformers
ALTER TABLE transformers DROP CONSTRAINT IF EXISTS transformers_building_id_fkey;
ALTER TABLE transformers DROP COLUMN IF EXISTS building_id;

-- 2. Добавляем новые поля в таблицу buildings для связи с трансформаторами
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS primary_transformer_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS backup_transformer_id INTEGER;

-- 3. Добавляем новые поля в таблицу buildings для связи с линиями
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS primary_line_id INTEGER;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS backup_line_id INTEGER;

-- 4. Создаем внешние ключи для новых связей
ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_transformer 
    FOREIGN KEY (primary_transformer_id) REFERENCES transformers(transformer_id);

ALTER TABLE buildings ADD CONSTRAINT fk_buildings_backup_transformer 
    FOREIGN KEY (backup_transformer_id) REFERENCES transformers(transformer_id);

ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_line 
    FOREIGN KEY (primary_line_id) REFERENCES lines(line_id);

ALTER TABLE buildings ADD CONSTRAINT fk_buildings_backup_line 
    FOREIGN KEY (backup_line_id) REFERENCES lines(line_id);

-- 5. Создаем индексы для новых полей
CREATE INDEX IF NOT EXISTS idx_buildings_primary_transformer ON buildings(primary_transformer_id);
CREATE INDEX IF NOT EXISTS idx_buildings_backup_transformer ON buildings(backup_transformer_id);
CREATE INDEX IF NOT EXISTS idx_buildings_primary_line ON buildings(primary_line_id);
CREATE INDEX IF NOT EXISTS idx_buildings_backup_line ON buildings(backup_line_id);

-- 6. Удаляем старый индекс
DROP INDEX IF EXISTS idx_transformers_building_id;

-- 7. Обновляем существующие данные: переносим связи из transformers в buildings
-- Для этого нужно узнать текущие связи
UPDATE buildings SET primary_transformer_id = 1 WHERE building_id IN (34, 40);
UPDATE buildings SET primary_transformer_id = 2 WHERE building_id IN (35, 41);
UPDATE buildings SET primary_transformer_id = 3 WHERE building_id IN (36, 42);

-- Назначаем резервные трансформаторы для некоторых зданий
UPDATE buildings SET backup_transformer_id = 4 WHERE building_id = 34;
UPDATE buildings SET backup_transformer_id = 5 WHERE building_id = 35;

-- 8. Назначаем основные линии для зданий
UPDATE buildings SET primary_line_id = 1 WHERE building_id IN (34, 35, 36);
UPDATE buildings SET primary_line_id = 2 WHERE building_id IN (37, 38, 39);
UPDATE buildings SET primary_line_id = 3 WHERE building_id IN (40, 41, 42);

-- Назначаем резервные линии для критически важных зданий
UPDATE buildings SET backup_line_id = 2 WHERE building_id = 34;
UPDATE buildings SET backup_line_id = 3 WHERE building_id = 38;

COMMIT;

-- Проверяем результат
SELECT 
    b.building_id,
    b.name,
    b.address,
    pt.name as primary_transformer,
    bt.name as backup_transformer,
    pl.name as primary_line,
    bl.name as backup_line
FROM buildings b
LEFT JOIN transformers pt ON b.primary_transformer_id = pt.transformer_id
LEFT JOIN transformers bt ON b.backup_transformer_id = bt.transformer_id  
LEFT JOIN lines pl ON b.primary_line_id = pl.line_id
LEFT JOIN lines bl ON b.backup_line_id = bl.line_id
ORDER BY b.building_id
LIMIT 10; 