-- Phase 14 / [P0-5]: least-privilege runtime role for the InfraSafe application.
--
-- Background
-- ----------
-- Before this migration the application connected to PostgreSQL as
-- `infrasafe_app` — the SAME role that was created via POSTGRES_USER at
-- container init, which gives it SUPERUSER/CREATEROLE/CREATEDB rights.
-- An application bug or SQL injection therefore had full DDL access:
-- DROP TABLE, CREATE EXTENSION, ALTER ROLE, etc.
--
-- Fix
-- ---
-- Split the responsibilities:
--   * `infrasafe_app`     — bootstrap / migration role. Keeps superuser
--                            so migrations and pg_dump still work.
--   * `infrasafe_runtime` — created here. LOGIN only. SELECT / INSERT /
--                            UPDATE / DELETE on existing tables, USAGE
--                            on sequences, EXECUTE on functions. No
--                            DDL, no CREATE, no role-management.
--
-- The materialized-view refresh function (`refresh_transformer_analytics`)
-- needs MV ownership to call REFRESH MATERIALIZED VIEW CONCURRENTLY,
-- which `infrasafe_runtime` deliberately does NOT have. We therefore
-- mark that function `SECURITY DEFINER` so it runs as its owner
-- (`infrasafe_app`) regardless of which role invokes it. The function
-- takes zero arguments, so there is no parameter-injection surface.
--
-- Idempotency
-- -----------
-- Safe to run multiple times — wrapped in DO blocks / IF NOT EXISTS.
--
-- Operator runbook
-- ----------------
-- See `docs/p0-5-runtime-role-2026-05-21.md` for the password-setting
-- ALTER ROLE step (kept out of this committed file by design) and the
-- env-var swap.

-- =============================================================================
-- 1. Create role with a known-rejected placeholder password.
--    Operator MUST `ALTER ROLE infrasafe_runtime LOGIN PASSWORD '<strong>'`
--    before the app can connect.
--
-- 2026-05-21 follow-up [1A-FU-C-L3]: role is created NOLOGIN so a
-- developer who forgets the runbook cannot log in with a placeholder
-- password. The operator's atomic step is the single source of truth
-- that turns LOGIN on AND sets the real password.
-- =============================================================================

DO $migration_017$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        -- [1A-FU-C-L3] NOLOGIN by design. Operator does:
        --   ALTER ROLE infrasafe_runtime LOGIN PASSWORD '<strong>';
        -- in one atomic step. No placeholder credential ever lives in
        -- a usable state.
        -- [1A-FU2-DB-M2] Explicit denial attributes — defence-in-depth
        -- against a future operator copying a wrong ALTER ROLE from
        -- another runbook (e.g. accidentally adding SUPERUSER). Pinning
        -- them in CREATE ROLE makes the intent self-documenting.
        -- [1A-FU2-DB-M1] CONNECTION LIMIT 20 — matches the default pg
        -- pool size in src/config/db.js. Without it, a connection leak
        -- in the app can exhaust max_connections cluster-wide.
        CREATE ROLE infrasafe_runtime
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            INHERIT
            CONNECTION LIMIT 20;
        COMMENT ON ROLE infrasafe_runtime IS
            'Least-privilege runtime role for the InfraSafe app (P0-5). '
            'Created NOLOGIN — operator must `ALTER ROLE infrasafe_runtime '
            'LOGIN PASSWORD ''<strong>''` before the app can use it. See '
            'docs/p0-5-runtime-role-2026-05-21.md.';
    ELSE
        -- Re-runnable migration: ensure attributes are correct even on
        -- a pre-existing role that may have been created with looser
        -- defaults. Each ALTER is idempotent — already-set flags are a no-op.
        ALTER ROLE infrasafe_runtime
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            CONNECTION LIMIT 20;
    END IF;
END
$migration_017$;

-- =============================================================================
-- 2. Connect + schema usage
--    [1A-FU-C-M2]: use current_database() so the migration works on staging
--    /custom-named DBs without silent no-op.
-- =============================================================================

DO $grant_connect$
BEGIN
    EXECUTE format(
        'GRANT CONNECT ON DATABASE %I TO infrasafe_runtime',
        current_database()
    );
END
$grant_connect$;

GRANT USAGE ON SCHEMA public TO infrasafe_runtime;

-- =============================================================================
-- 3. DML on every existing table and sequence in public.
--    Includes materialized views (pg_class.relkind='m') for SELECT.
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO infrasafe_runtime;

-- [1A-FU2-DB-H2] USAGE + SELECT only — DO NOT grant UPDATE on sequences.
-- UPDATE allows setval() which can rewind / fast-forward a PK sequence
-- and produce duplicate primary keys. USAGE+SELECT is enough for
-- nextval() / currval() which is the only operation INSERT needs.
GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA public
    TO infrasafe_runtime;

-- [1A-FU2-DB-H1] EXECUTE is granted on the snapshot of functions that
-- exist at migration time (needed for refresh_transformer_analytics,
-- find_nearest_buildings_to_transformer, and trigger helpers). We
-- deliberately do NOT auto-grant EXECUTE on FUTURE functions via
-- ALTER DEFAULT PRIVILEGES (step 4 below) — every new function added
-- by a later migration must be granted EXECUTE explicitly, so any
-- SECURITY DEFINER function added by accident does not auto-leak
-- elevated rights to the runtime role.
GRANT EXECUTE
    ON ALL FUNCTIONS IN SCHEMA public
    TO infrasafe_runtime;

-- =============================================================================
-- 4. Default privileges — apply to FUTURE objects created by infrasafe_app.
--    Without this, every subsequent migration would have to re-GRANT.
-- =============================================================================

ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO infrasafe_runtime;

-- [1A-FU2-DB-H2] USAGE+SELECT only for future sequences too. No UPDATE.
ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public
    GRANT USAGE, SELECT                  ON SEQUENCES TO infrasafe_runtime;

-- [1A-FU2-DB-H1] Intentionally NO `GRANT EXECUTE ON FUNCTIONS` default.
-- Future migrations must `GRANT EXECUTE ON FUNCTION public.<name>(...)
-- TO infrasafe_runtime` explicitly for each function the app calls. This
-- prevents a future SECURITY DEFINER function from being auto-callable
-- by the runtime role.

-- =============================================================================
-- 5. Materialized-view refresh: SECURITY DEFINER wrapper.
--    Function definition itself was created in init/01_init_database.sql or
--    migration 003_power_calculation_v2.sql. We only flip its security model.
-- =============================================================================

DO $set_security_definer$
BEGIN
    -- Only flip if the function exists — protects against drift if the
    -- function gets renamed in a future migration.
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'refresh_transformer_analytics'
    ) THEN
        ALTER FUNCTION public.refresh_transformer_analytics()
            SECURITY DEFINER
            SET search_path = pg_catalog, public;
        -- [1A-FU-S-L2] Canonical search_path order — pg_catalog first
        -- so built-in operators / functions cannot be shadowed by an
        -- attacker-controlled schema. `public` last because that is
        -- where our own functions live. pg_temp deliberately omitted —
        -- the function takes zero arguments, has no temp-table use
        -- case, and including it widens the resolution surface.
    END IF;
END
$set_security_definer$;

-- =============================================================================
-- 6. Belt-and-braces: remove the default CREATE on schema public from PUBLIC
--    (PostgreSQL 15+ already does this, but older clusters may not).
-- =============================================================================

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
