-- Migration 007: Add compound index on metrics for common query pattern
-- Improves performance for queries filtering by controller_id and ordering by timestamp
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_metrics_ctrl_ts
ON metrics(controller_id, timestamp DESC);
