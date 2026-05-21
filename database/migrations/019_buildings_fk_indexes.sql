-- Migration 019: Add missing FK indexes on buildings
-- Sprint 5 / P3-4
--
-- Postgres does NOT auto-index FK source columns. The buildings table has
-- 10+ FK columns; migration 010 already covers primary_transformer_id and
-- backup_transformer_id. The rest are still un-indexed, so queries like
-- "all buildings on cold water source X" or "delete water_source N" force
-- sequential scans and slow ON DELETE checks.
--
-- power_transformer_id is intentionally skipped — it's a legacy VARCHAR FK
-- to a deprecated table; live code uses primary/backup_transformer_id.
--
-- Also re-asserts the two transformer FK indexes from migration 010. Audit
-- (2026-05-21) revealed they're missing on prod — migration 010 was never
-- applied to that environment. `IF NOT EXISTS` makes the re-assertion a
-- no-op where migration 010 did run.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS. Non-CONCURRENT — buildings is small
-- (tens of rows), the brief lock is acceptable.

-- Re-assert migration 010 (idempotent on environments where 010 already ran).
CREATE INDEX IF NOT EXISTS idx_buildings_primary_transformer
    ON buildings(primary_transformer_id);

CREATE INDEX IF NOT EXISTS idx_buildings_backup_transformer
    ON buildings(backup_transformer_id);

CREATE INDEX IF NOT EXISTS idx_buildings_cold_water_source
    ON buildings(cold_water_source_id)
    WHERE cold_water_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_heat_source
    ON buildings(heat_source_id)
    WHERE heat_source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_primary_line
    ON buildings(primary_line_id)
    WHERE primary_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_backup_line
    ON buildings(backup_line_id)
    WHERE backup_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_cold_water_line
    ON buildings(cold_water_line_id)
    WHERE cold_water_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_hot_water_line
    ON buildings(hot_water_line_id)
    WHERE hot_water_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_cold_water_supplier
    ON buildings(cold_water_supplier_id)
    WHERE cold_water_supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_hot_water_supplier
    ON buildings(hot_water_supplier_id)
    WHERE hot_water_supplier_id IS NOT NULL;
