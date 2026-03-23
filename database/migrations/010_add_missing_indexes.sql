-- Migration 010: Add missing indexes for FK columns and status filters
-- Improves JOIN performance on buildings→transformers and status-based queries

CREATE INDEX IF NOT EXISTS idx_buildings_primary_transformer ON buildings(primary_transformer_id);
CREATE INDEX IF NOT EXISTS idx_buildings_backup_transformer ON buildings(backup_transformer_id);
CREATE INDEX IF NOT EXISTS idx_cold_water_sources_status ON cold_water_sources(status);
CREATE INDEX IF NOT EXISTS idx_heat_sources_status ON heat_sources(status);
