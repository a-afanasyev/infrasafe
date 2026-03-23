-- Migration 008: Remove duplicate hot_water column from buildings
-- The buildings table has both hot_water and has_hot_water columns.
-- Consolidate into has_hot_water (the canonical column with DEFAULT false).

-- First, merge data: if hot_water has a value, copy it to has_hot_water
UPDATE buildings SET has_hot_water = COALESCE(hot_water, has_hot_water, false)
WHERE hot_water IS NOT NULL;

-- Then drop the duplicate column
ALTER TABLE buildings DROP COLUMN IF EXISTS hot_water;
