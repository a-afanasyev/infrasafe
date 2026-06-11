-- PR-1a (AUD-002): synthetic "prod-like" schema for the migration-runner e2e.
--
-- Provides exactly the objects/data each baseline sentinel (003-034) checks, so
-- `migrate.sh baseline` can verify the matrix end-to-end against a throwaway DB
-- without reconstructing the real prod schema. The harness also DROPs a single
-- object to prove a sentinel failure rolls the whole baseline back.
--
-- It also replicates migration 017's ALTER DEFAULT PRIVILEGES (here FOR ROLE
-- postgres, the test's creator role) so that when baseline CREATEs the runner
-- tables, infrasafe_runtime auto-inherits DML — exercising the conditional
-- REVOKE for real.

-- runtime role (017) + its auto-grant of DML on future tables created by the
-- creator role. In prod the creator is infrasafe_app; here it is postgres.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        CREATE ROLE infrasafe_runtime NOLOGIN;
    END IF;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO infrasafe_runtime;

-- base tables referenced by sentinels / FKs
CREATE TABLE buildings (            -- 008: canonical prod KEEPS hot_water + has_hot_water
    id            SERIAL PRIMARY KEY,
    primary_line  INT,
    hot_water     BOOLEAN,
    has_hot_water BOOLEAN DEFAULT false
);
CREATE TABLE transformers (id SERIAL PRIMARY KEY, geom INT);
CREATE TABLE power_lines (id SERIAL PRIMARY KEY, main_path INT);
CREATE TABLE water_lines (id SERIAL PRIMARY KEY, main_path INT);
CREATE TABLE cold_water_sources (id SERIAL PRIMARY KEY, status TEXT);
-- 009: mirror prod — token_hash indexed via a UNIQUE key (token_blacklist_token_hash_key),
-- not 009's named idx_token_blacklist_hash.
CREATE TABLE token_blacklist (id SERIAL PRIMARY KEY, token_hash TEXT UNIQUE);
CREATE TABLE users (                -- 016 password_changed_at, 012_totp index
    id                 SERIAL PRIMARY KEY,
    password_changed_at TIMESTAMPTZ,
    totp_enabled       BOOLEAN DEFAULT false
);
CREATE TABLE metrics (id SERIAL PRIMARY KEY, controller_id INT, "timestamp" TIMESTAMPTZ);
-- 021: canonical alert table is infrastructure_alerts; the legacy `alerts` table
-- (021's FK target) does NOT exist on prod, so we do not create it here either.
CREATE TABLE infrastructure_alerts (   -- 027 reopen_chain_id; 021 canonical alert table
    alert_id        SERIAL PRIMARY KEY,
    status          TEXT,
    reopen_chain_id UUID,
    infra_type      TEXT,
    metric_id       INT
);
CREATE TABLE alert_request_map (       -- 018 FK to infrastructure_alerts
    id            SERIAL PRIMARY KEY,
    alert_id      INT,
    building_id   INT,
    status        TEXT,
    CONSTRAINT fk_arm_infrasafe_alert FOREIGN KEY (alert_id) REFERENCES infrastructure_alerts(alert_id)
);
CREATE TABLE alert_rules (             -- 024 min_persistence_seconds, 032 uk_urgency
    id                      SERIAL PRIMARY KEY,
    alert_type              TEXT,
    severity                TEXT,
    uk_urgency              TEXT,
    min_persistence_seconds INT DEFAULT 60
);
CREATE TABLE integration_config (key TEXT PRIMARY KEY, value TEXT);          -- 030
CREATE TABLE account_lockout (id SERIAL PRIMARY KEY);                        -- 013
CREATE TABLE uk_outbox (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ);      -- 022
CREATE TABLE alert_suppressions (id SERIAL PRIMARY KEY);                     -- 026
CREATE TABLE alert_rule_changes (id SERIAL PRIMARY KEY);                     -- 029
CREATE TABLE alert_verifications (     -- 025, 031 join, 033 last_checked_at, 034 dispatch
    id                 SERIAL PRIMARY KEY,
    original_alert_id  INT,
    status             TEXT,
    processed_at       TIMESTAMPTZ,
    last_checked_at    TIMESTAMPTZ,
    dispatch_lease_until TIMESTAMPTZ
);

-- materialized view (003 + 012_fix both resolve to this canonical one on prod;
-- 003's building/line MVs were superseded and are absent on canonical prod).
CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS SELECT 1 AS x;

-- function (020)
CREATE OR REPLACE FUNCTION refresh_mv_transformer_load() RETURNS void
    LANGUAGE sql AS 'SELECT 1';

-- indexes the sentinels look up by name
CREATE INDEX idx_transformers_geom               ON transformers(geom);
CREATE INDEX idx_lines_main_path                 ON power_lines(main_path);
CREATE INDEX idx_water_lines_main_path           ON water_lines(main_path);
CREATE INDEX idx_metrics_ctrl_ts                 ON metrics(controller_id, "timestamp");
CREATE INDEX idx_cold_water_sources_status       ON cold_water_sources(status);
CREATE INDEX idx_infrastructure_alerts_infra_status ON infrastructure_alerts(infra_type, status);
CREATE UNIQUE INDEX idx_active_alert_dedup       ON infrastructure_alerts(alert_id);
CREATE INDEX idx_buildings_primary_line          ON buildings(primary_line);
CREATE INDEX idx_arm_building_status_partial     ON alert_request_map(building_id, status);
CREATE INDEX idx_users_totp_enabled              ON users(totp_enabled);

-- data invariants: 030 seed present; 031 no orphans; 032 canonical urgency
INSERT INTO integration_config (key, value) VALUES ('uk_request_url_template', 'x');
INSERT INTO alert_rules (alert_type, severity, uk_urgency) VALUES ('VOLTAGE_ANOMALY', 'WARNING', 'medium');
