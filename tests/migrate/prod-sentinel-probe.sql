-- READ-ONLY probe: evaluate every baseline sentinel against the live DB without
-- aborting, so we see ALL divergences at once (migrate.sh baseline stops at the
-- first). Returns one row per FAILING sentinel. No rows = all pass.
\pset tuples_only on
\pset format unaligned

SELECT fail FROM (
  SELECT '003 mv_transformer_load_realtime missing' fail WHERE to_regclass('public.mv_transformer_load_realtime') IS NULL
  UNION ALL SELECT '004 idx_transformers_geom missing' WHERE to_regclass('public.idx_transformers_geom') IS NULL
  UNION ALL SELECT '005 idx_lines_main_path missing' WHERE to_regclass('public.idx_lines_main_path') IS NULL
  UNION ALL SELECT '006 idx_water_lines_main_path missing' WHERE to_regclass('public.idx_water_lines_main_path') IS NULL
  UNION ALL SELECT '007 idx_metrics_ctrl_ts missing' WHERE to_regclass('public.idx_metrics_ctrl_ts') IS NULL
  UNION ALL SELECT '008 buildings.has_hot_water missing' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='has_hot_water')
  UNION ALL SELECT '009 token_blacklist token_hash index missing' WHERE to_regclass('public.token_blacklist') IS NULL OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='token_blacklist' AND indexdef ILIKE '%token_hash%')
  UNION ALL SELECT '010 idx_cold_water_sources_status missing' WHERE to_regclass('public.idx_cold_water_sources_status') IS NULL
  UNION ALL SELECT '011 alert_request_map missing' WHERE to_regclass('public.alert_request_map') IS NULL
  UNION ALL SELECT '012_fix mv_transformer_load_realtime missing' WHERE to_regclass('public.mv_transformer_load_realtime') IS NULL
  UNION ALL SELECT '012_totp idx_users_totp_enabled missing' WHERE to_regclass('public.idx_users_totp_enabled') IS NULL
  UNION ALL SELECT '013 account_lockout missing' WHERE to_regclass('public.account_lockout') IS NULL
  UNION ALL SELECT '014 idx_infrastructure_alerts_infra_status missing' WHERE to_regclass('public.idx_infrastructure_alerts_infra_status') IS NULL
  UNION ALL SELECT '015 idx_active_alert_dedup missing' WHERE to_regclass('public.idx_active_alert_dedup') IS NULL
  UNION ALL SELECT '016 users.password_changed_at missing' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='password_changed_at')
  UNION ALL SELECT '017 role infrasafe_runtime missing' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='infrasafe_runtime')
  UNION ALL SELECT '018 fk_arm_infrasafe_alert missing' WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_arm_infrasafe_alert')
  UNION ALL SELECT '019 idx_buildings_primary_line missing' WHERE to_regclass('public.idx_buildings_primary_line') IS NULL
  UNION ALL SELECT '020 refresh_mv_transformer_load missing' WHERE NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='refresh_mv_transformer_load')
  UNION ALL SELECT '021 expected canonical alert schema (infrastructure_alerts present, legacy alerts absent)' WHERE to_regclass('public.infrastructure_alerts') IS NULL OR to_regclass('public.alerts') IS NOT NULL
  UNION ALL SELECT '022 uk_outbox missing' WHERE to_regclass('public.uk_outbox') IS NULL
  UNION ALL SELECT '023 idx_arm_building_status_partial missing' WHERE to_regclass('public.idx_arm_building_status_partial') IS NULL
  UNION ALL SELECT '024 alert_rules.min_persistence_seconds missing' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='alert_rules' AND column_name='min_persistence_seconds')
  UNION ALL SELECT '025 alert_verifications missing' WHERE to_regclass('public.alert_verifications') IS NULL
  UNION ALL SELECT '026 alert_suppressions missing' WHERE to_regclass('public.alert_suppressions') IS NULL
  UNION ALL SELECT '027 infrastructure_alerts.reopen_chain_id missing' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='infrastructure_alerts' AND column_name='reopen_chain_id')
  UNION ALL SELECT '028 alert_types catalog still present' WHERE to_regclass('public.alert_types') IS NOT NULL
  UNION ALL SELECT '029 alert_rule_changes missing' WHERE to_regclass('public.alert_rule_changes') IS NULL
  UNION ALL SELECT '030 integration_config uk_request_url_template missing' WHERE NOT EXISTS (SELECT 1 FROM integration_config WHERE key='uk_request_url_template')
  UNION ALL SELECT '031 orphaned resolved_verifying present' WHERE EXISTS (SELECT 1 FROM infrastructure_alerts ia JOIN alert_verifications av ON av.original_alert_id=ia.alert_id WHERE ia.status='resolved_verifying' AND av.status IN ('passed','reopened','suppressed','skipped','engineer_required'))
  UNION ALL SELECT '032 non-canonical uk_urgency present' WHERE EXISTS (SELECT 1 FROM alert_rules WHERE uk_urgency IN ('Обычная','Средняя','Срочная','Критическая'))
  UNION ALL SELECT '033 alert_verifications.last_checked_at missing' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='alert_verifications' AND column_name='last_checked_at')
  UNION ALL SELECT '034 alert_verifications.dispatch_lease_until missing' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='alert_verifications' AND column_name='dispatch_lease_until')
) t ORDER BY fail;
