-- ARCH-107: Fix mv_transformer_load_realtime to use active 'transformers' table
-- instead of legacy 'power_transformers'. Column aliases preserve backward compat.

DROP MATERIALIZED VIEW IF EXISTS mv_transformer_load_realtime;

CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS
SELECT
    t.transformer_id AS id,
    t.name,
    t.power_kva AS capacity_kva,
    t.status,
    t.latitude,
    t.longitude,

    COUNT(DISTINCT b.building_id) as buildings_count,
    COUNT(DISTINCT c.controller_id) as controllers_count,
    COUNT(DISTINCT CASE WHEN c.status = 'active' THEN c.controller_id END) as active_controllers_count,

    AVG(COALESCE(m.electricity_ph1, 0) + COALESCE(m.electricity_ph2, 0) + COALESCE(m.electricity_ph3, 0)) as avg_total_voltage,
    AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) as avg_total_amperage,

    CASE
        WHEN t.power_kva > 0 THEN
            LEAST(100, AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) * 0.4 / t.power_kva * 100)
        ELSE 0
    END as load_percent,

    MAX(m.timestamp) as last_metric_time,
    COUNT(CASE WHEN m.timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_metrics_count

FROM transformers t
LEFT JOIN buildings b ON (t.transformer_id = b.primary_transformer_id OR t.transformer_id = b.backup_transformer_id)
LEFT JOIN controllers c ON b.building_id = c.building_id
LEFT JOIN metrics m ON c.controller_id = m.controller_id AND m.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY t.transformer_id, t.name, t.power_kva, t.status, t.latitude, t.longitude;

CREATE UNIQUE INDEX idx_mv_transformer_load_id ON mv_transformer_load_realtime(id);
CREATE INDEX idx_mv_transformer_load_percent ON mv_transformer_load_realtime(load_percent DESC);
CREATE INDEX idx_mv_transformer_load_status ON mv_transformer_load_realtime(status);
