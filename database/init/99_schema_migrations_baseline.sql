-- PR-1a (AUD-002): fresh-bootstrap self-declare for the database/init/ path.
--
-- The docker-entrypoint runs database/init/*.sql alphabetically on a fresh
-- volume. Files 01-09 bake the cumulative effects of migrations 003-017
-- (01_init = 003-010 + 012_fix; 03 = 011; 04 = 012_totp; 05 = 013; 06 = 014;
-- 07 = 015; 08 = 016; 09 = 017). This file runs LAST (99_) and:
--   1. creates the runner tables,
--   2. revokes runtime DML on them (017's ALTER DEFAULT PRIVILEGES auto-grants
--      DML to infrasafe_runtime on tables the bootstrap role creates),
--   3. self-declares migrations 003-017 as already-applied, so a subsequent
--      `scripts/migrate.sh up` applies only 018-034.
--
-- Running LAST matters: if any earlier init file fails, the entrypoint aborts
-- before reaching this file, so schema_migrations is NEVER created and `up`
-- fail-closes (exit 2) — an operator reconciles deliberately rather than the
-- runner replaying migrations onto a half-built schema.
--
-- The whole file is ONE transaction: a mid-INSERT failure leaves no runner
-- tables behind (same fail-close guarantee).
--
-- Checksums are sha256 of each migration file's content (the value the runner
-- computes via `git show <commit>:<path> | migrate-discover.js checksum`).
-- Migrations 003-017 are frozen (roll-forward-only), so these are stable; if one
-- is ever edited, `up` will report checksum drift — which is the intended guard.
--
-- NOTE: the unified database.sql bootstrap deliberately does NOT carry a manifest
-- (it is an incomplete legacy snapshot that bakes none of 011-034) — fresh-unified
-- intentionally fail-closes. See database.sql footer + migrations/README.md.

BEGIN;

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

DO $init_acl$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        REVOKE ALL ON schema_migrations FROM infrasafe_runtime;
        REVOKE ALL ON migrate_lock      FROM infrasafe_runtime;
    END IF;
END
$init_acl$;

-- Self-declare migrations 003-017 (baked by 01-09). ON CONFLICT DO NOTHING keeps
-- this idempotent if the file is ever re-run against an existing baseline.
INSERT INTO schema_migrations (filename, checksum) VALUES
    ('003_power_calculation_v2.sql', '6afd851bce541a8531c8838c85cbc19839493ee51240880198fb59765699bc31'),
    ('004_add_coordinates_and_extended_fields.sql', '91f078f5bcf2efc4b5a906b7534d5eacfc4aa29042d755f861310ce70bc610f0'),
    ('005_add_paths_to_lines.sql', '12975415ca3bcbbc63f1b8a348effe1aaf407dfe8cfebbf68c359bb4461bee35'),
    ('006_cleanup_infrastructure_lines.sql', '1936b2f837971772ae6c15ef372f3413b3c23eb488b65a1ea7b362f4a5dd66d3'),
    ('007_add_metrics_compound_index.sql', 'a597a058b22ea9b741a2d32fdcd10e47f91667440e0f14bade6516e44a6874ae'),
    ('008_remove_duplicate_hot_water.sql', '3e4af606cc191ef1ad66ffad3057ac03fdaae2689a1b5764db850eff6c83fb95'),
    ('009_token_blacklist_hash_index.sql', '133dbb9ad994b16ac42c85159eb26437a51fbdf60ef4a5d0587bd00c4056fc09'),
    ('010_add_missing_indexes.sql', '5370de1b2683c81fad33f2cbe4488af117ff06437d089baad3b8d398459b2996'),
    ('011_uk_integration.sql', '7a19a8d83a1009b8780493722b186bf1ac705be18bd83a3c06d1c0aa4bbc7873'),
    ('012_fix_materialized_view.sql', 'e5df32282fabf84bec3d3f067300fe30dfbb999eed6ab3cec3274e678a4fd7c1'),
    ('012_totp_2fa.sql', '73c5b050fbe29fd4ff7da60dc91320622fa084cad736d7b2668d5eb273fabec7'),
    ('013_account_lockout.sql', '99acbc6a556b9957cc1f352f8dd4309213e2b92ee25cf18b2ca1235a0d290cc8'),
    ('014_performance_indexes.sql', '01442819475777a318fac75fc82736a6c66169a8b3705b17991827e0d760b87e'),
    ('015_alert_dedup_constraint.sql', '2e60b62285da05e99f15c96903c8042f397daefbf45ea5cd7fb8ff7962f2a01d'),
    ('016_password_changed_at.sql', 'a5e683b62ec436600ae02fc937f39722a41ee1b5b9b60ba4649d032fd4abe573'),
    ('017_runtime_role.sql', '189185f115f0caecc2cb2e8fe6522cfd265e5ca16224079d72861ee237038f7b')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
