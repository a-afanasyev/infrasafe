-- PR-1a (AUD-002): static prelude for `migrate.sh baseline`.
--
-- migrate.sh wraps this between `BEGIN;` … `INSERT INTO schema_migrations …; COMMIT;`
-- so the WHOLE baseline is one transaction: any sentinel failure (or a bad
-- INSERT) rolls everything back and leaves NO runner tables behind — which keeps
-- `up`/`status` fail-closed rather than letting them see a half-built state and
-- replay legacy migrations.
--
-- Contents (in order):
--   1. CREATE both runner tables (idempotent).
--   2. Conditional REVOKE of runtime DML on the runner tables (017's ALTER
--      DEFAULT PRIVILEGES auto-grants DML to infrasafe_runtime on every table
--      infrasafe_app creates). Guarded on role-exists so a fresh cluster where
--      017 has not run yet does not error.
--   3. Sentinel-invariant matrix: ≥1 assertion per migration 003–034 proving the
--      hand-applied schema/data actually exists BEFORE we mark it applied. Data-
--      only migrations (031, 032) are checked by a data invariant, not an object.
--
-- This file performs NO migration effects and inserts NO schema_migrations rows
-- on its own — migrate.sh appends the allowlist INSERT after these statements.

-- 1. Runner tables -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migrate_lock (
    id        INT PRIMARY KEY,
    locked_by TEXT NOT NULL,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Lock down runner tables from the runtime role (guarded role-exists) ------
DO $baseline_acl$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        REVOKE ALL ON schema_migrations FROM infrasafe_runtime;
        REVOKE ALL ON migrate_lock      FROM infrasafe_runtime;
    END IF;
END
$baseline_acl$;

-- 3. Sentinel-invariant matrix (one RAISE per failed migration) --------------
DO $baseline_sentinels$
BEGIN
    -- 003 power calculation v2. Prod was bootstrapped from database.sql, whose
    -- canonical schema kept ONLY mv_transformer_load_realtime — 003's building/line
    -- MVs and calculate_phase_power() were superseded and are absent on prod (no
    -- app code references them; re-running 003 would re-introduce objects not in
    -- the canonical schema). Verify the surviving canonical power MV. (012_fix also
    -- checks this MV — on canonical prod both migrations resolve to the same object.)
    IF to_regclass('public.mv_transformer_load_realtime') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 003 mv_transformer_load_realtime (canonical power MV) missing'; END IF;
    -- 004 coordinates / extended fields (PostGIS index)
    IF to_regclass('public.idx_transformers_geom') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 004 idx_transformers_geom missing'; END IF;
    -- 005 paths on power lines
    IF to_regclass('public.idx_lines_main_path') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 005 idx_lines_main_path missing'; END IF;
    -- 006 water-lines cleanup / paths
    IF to_regclass('public.idx_water_lines_main_path') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 006 idx_water_lines_main_path missing'; END IF;
    -- 007 metrics compound index (CREATE INDEX CONCURRENTLY)
    IF to_regclass('public.idx_metrics_ctrl_ts') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 007 idx_metrics_ctrl_ts missing'; END IF;
    -- 008 remove duplicate hot_water. The canonical database.sql bootstrap KEPT
    -- buildings.hot_water (the frontend reads item.hot_water) alongside has_hot_water,
    -- so 008's DROP was effectively reverted on prod — re-running it would break the
    -- map. Verify 008's populate target has_hot_water exists (its surviving half).
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'buildings'
                     AND column_name = 'has_hot_water') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 008 buildings.has_hot_water missing'; END IF;
    -- 009 token_blacklist hash index. Canonical prod indexes token_hash via a
    -- UNIQUE key (token_blacklist_token_hash_key), not 009's named non-unique index,
    -- so lookups are covered. Verify token_blacklist + any index on token_hash.
    -- (009's idx_token_blacklist_expires is genuinely absent on prod → backlog.)
    IF to_regclass('public.token_blacklist') IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_indexes
                      WHERE schemaname = 'public' AND tablename = 'token_blacklist'
                        AND indexdef ILIKE '%token_hash%') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 009 token_blacklist token_hash index missing'; END IF;
    -- 010 missing indexes (cold_water_sources status — unique to 010)
    IF to_regclass('public.idx_cold_water_sources_status') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 010 idx_cold_water_sources_status missing'; END IF;
    -- 011 UK integration foundation (alert_request_map table)
    IF to_regclass('public.alert_request_map') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 011 alert_request_map missing'; END IF;
    -- 012_fix materialized view repair
    IF to_regclass('public.mv_transformer_load_realtime') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 012_fix mv_transformer_load_realtime missing'; END IF;
    -- 012_totp 2FA columns (index)
    IF to_regclass('public.idx_users_totp_enabled') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 012_totp idx_users_totp_enabled missing'; END IF;
    -- 013 account lockout table
    IF to_regclass('public.account_lockout') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 013 account_lockout missing'; END IF;
    -- 014 performance indexes (infra alerts status — unique to 014)
    IF to_regclass('public.idx_infrastructure_alerts_infra_status') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 014 idx_infrastructure_alerts_infra_status missing'; END IF;
    -- 015 alert dedup partial unique index
    IF to_regclass('public.idx_active_alert_dedup') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 015 idx_active_alert_dedup missing'; END IF;
    -- 016 password_changed_at column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'users'
                     AND column_name = 'password_changed_at') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 016 users.password_changed_at missing'; END IF;
    -- 017 runtime role
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 017 role infrasafe_runtime missing'; END IF;
    -- 018 alert_request_map → infrastructure_alerts FK
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_arm_infrasafe_alert') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 018 fk_arm_infrasafe_alert missing'; END IF;
    -- 019 buildings FK indexes (primary_line — unique to 019)
    IF to_regclass('public.idx_buildings_primary_line') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 019 idx_buildings_primary_line missing'; END IF;
    -- 020 MV refresh SECURITY DEFINER wrapper function
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_mv_transformer_load') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 020 refresh_mv_transformer_load missing'; END IF;
    -- 021 alerts.metric_id FK. 021 targeted a legacy `alerts` table that does NOT
    -- exist on canonical prod (the alert table is infrastructure_alerts) — re-running
    -- it would error "relation alerts does not exist". Verify the canonical alert
    -- schema: infrastructure_alerts present AND the legacy `alerts` table absent.
    IF to_regclass('public.infrastructure_alerts') IS NULL
       OR to_regclass('public.alerts') IS NOT NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 021 expected canonical alert schema (infrastructure_alerts present, legacy alerts absent)'; END IF;
    -- 022 UK outbox table
    IF to_regclass('public.uk_outbox') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 022 uk_outbox missing'; END IF;
    -- 023 alert_request_map counter partial index
    IF to_regclass('public.idx_arm_building_status_partial') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 023 idx_arm_building_status_partial missing'; END IF;
    -- 024 alert_rules persistence/reopen columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'alert_rules'
                     AND column_name = 'min_persistence_seconds') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 024 alert_rules.min_persistence_seconds missing'; END IF;
    -- 025 alert_verifications queue
    IF to_regclass('public.alert_verifications') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 025 alert_verifications missing'; END IF;
    -- 026 alert_suppressions table
    IF to_regclass('public.alert_suppressions') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 026 alert_suppressions missing'; END IF;
    -- 027 alerts lifecycle v2 (reopen_chain_id column)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'infrastructure_alerts'
                     AND column_name = 'reopen_chain_id') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 027 infrastructure_alerts.reopen_chain_id missing'; END IF;
    -- 028 drop alert_types catalog (table DROPPED → must be absent)
    IF to_regclass('public.alert_types') IS NOT NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 028 alert_types catalog still present'; END IF;
    -- 029 alert_rule_changes audit log
    IF to_regclass('public.alert_rule_changes') IS NULL THEN
        RAISE EXCEPTION 'baseline sentinel failed: 029 alert_rule_changes missing'; END IF;
    -- 030 uk_request_url_template config seed (data invariant)
    IF NOT EXISTS (SELECT 1 FROM integration_config WHERE key = 'uk_request_url_template') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 030 integration_config uk_request_url_template missing'; END IF;
    -- 031 backfill orphaned resolved_verifying (data invariant: none remain)
    IF EXISTS (
        SELECT 1
        FROM infrastructure_alerts ia
        JOIN alert_verifications av ON av.original_alert_id = ia.alert_id
        WHERE ia.status = 'resolved_verifying'
          AND av.status IN ('passed', 'reopened', 'suppressed', 'skipped', 'engineer_required')
    ) THEN
        RAISE EXCEPTION 'baseline sentinel failed: 031 orphaned resolved_verifying alert(s) present'; END IF;
    -- 032 uk_urgency canonical keys (data invariant: no Russian labels remain)
    IF EXISTS (SELECT 1 FROM alert_rules
               WHERE uk_urgency IN ('Обычная', 'Средняя', 'Срочная', 'Критическая')) THEN
        RAISE EXCEPTION 'baseline sentinel failed: 032 non-canonical uk_urgency value(s) present'; END IF;
    -- 033 alert_verifications.last_checked_at column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'alert_verifications'
                     AND column_name = 'last_checked_at') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 033 alert_verifications.last_checked_at missing'; END IF;
    -- 034 alert_verifications dispatch/lease columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'alert_verifications'
                     AND column_name = 'dispatch_lease_until') THEN
        RAISE EXCEPTION 'baseline sentinel failed: 034 alert_verifications.dispatch_lease_until missing'; END IF;

    RAISE NOTICE 'baseline sentinels: all 33 migrations (003-034) verified present';
END
$baseline_sentinels$;
