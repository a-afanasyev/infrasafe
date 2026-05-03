-- Migration 014 — performance indexes (PERF-002, PERF-010 / Phase 12C.2)
--
-- Based on EXPLAIN ANALYZE of live queries against the current dataset.
--
-- 1. idx_metrics_ctrl_ts — compound (controller_id, timestamp DESC).
--    Migration 007 declared this index but was never applied to this database
--    (pg_indexes shows only idx_metrics_controller + idx_metrics_timestamp).
--    Without the compound index the planner chooses a backward scan on
--    idx_metrics_timestamp + post-filter, which degrades as the metrics table
--    grows past the current ~94-row dataset.
--
-- 2. idx_infrastructure_alerts_infra_status — covering index for loadActiveAlerts()
--    and similar queries that filter by both infrastructure_(type|id) and
--    status simultaneously. Current indexes handle each column separately
--    (idx_..._infrastructure covers the pair; idx_..._status covers status)
--    but the planner needs a single composite for the common "active alerts
--    for this piece of infrastructure" lookup.
--
-- NOTE: buildings(town) and buildings FK transformer indexes already exist
-- and are covered by migrations 007/010/011. No action needed for
-- PERF-002's "power_transformer_id" — that column is a legacy VARCHAR FK
-- to the deprecated power_transformers table; live code paths prefer
-- primary/backup_transformer_id (INTEGER), which are already indexed.

-- Retry-safe: matches the original migration 007 signature.
CREATE INDEX IF NOT EXISTS idx_metrics_ctrl_ts
    ON metrics(controller_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_infrastructure_alerts_infra_status
    ON infrastructure_alerts(infrastructure_type, infrastructure_id, status);

COMMENT ON INDEX idx_metrics_ctrl_ts IS
    'PERF-002: Compound index for latest-metric-per-controller LATERAL lookups.';
COMMENT ON INDEX idx_infrastructure_alerts_infra_status IS
    'PERF-010: Composite for "active alerts for a piece of infrastructure" filter.';
