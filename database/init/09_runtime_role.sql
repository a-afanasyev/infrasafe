-- [P0-5] mirror of database/migrations/017_runtime_role.sql for fresh-install init.
--
-- This file is intended to land in /docker-entrypoint-initdb.d/ via a future
-- compose mount (today the actual mounted init file is `database.sql` —
-- divergence tracked separately). On fresh containers it runs AS the
-- POSTGRES_USER bootstrap account, which is the same `infrasafe_app` role
-- referenced below.
--
-- For existing prod databases, do NOT apply this file — use the migration
-- in `database/migrations/017_runtime_role.sql` and follow
-- `docs/p0-5-runtime-role-2026-05-21.md`.
--
-- See the migration file for full design notes and operator runbook.

DO $init_09$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        -- [1A-FU-C-L3] NOLOGIN — operator runbook sets LOGIN + password.
        -- [1A-FU2-DB-M2] explicit denial attrs prevent accidental SUPERUSER.
        -- [1A-FU2-DB-M1] CONNECTION LIMIT 20 matches the pg pool default.
        CREATE ROLE infrasafe_runtime
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            INHERIT
            CONNECTION LIMIT 20;
        COMMENT ON ROLE infrasafe_runtime IS
            'Least-privilege runtime role (P0-5). Created NOLOGIN — operator '
            'must `ALTER ROLE infrasafe_runtime LOGIN PASSWORD ...` and pass it '
            'via DB_PASSWORD env to the app.';
    ELSE
        ALTER ROLE infrasafe_runtime
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOREPLICATION
            CONNECTION LIMIT 20;
    END IF;
END
$init_09$;

-- [1A-FU-C-M2] current_database() handles renamed staging DBs.
DO $init_09_grant_connect$
BEGIN
    EXECUTE format(
        'GRANT CONNECT ON DATABASE %I TO infrasafe_runtime',
        current_database()
    );
END
$init_09_grant_connect$;

GRANT USAGE ON SCHEMA public TO infrasafe_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO infrasafe_runtime;

-- [1A-FU2-DB-H2] USAGE+SELECT only — no UPDATE, which would allow setval().
GRANT USAGE, SELECT
    ON ALL SEQUENCES IN SCHEMA public
    TO infrasafe_runtime;

-- [1A-FU2-DB-H1] Snapshot grant on existing functions. Future functions
-- must be granted EXECUTE explicitly per migration to prevent accidental
-- SECURITY DEFINER auto-leak.
GRANT EXECUTE
    ON ALL FUNCTIONS IN SCHEMA public
    TO infrasafe_runtime;

-- [#150 e2e-ci] The header's assumption "POSTGRES_USER == infrasafe_app" holds
-- for prod bootstraps but NOT for the dev stack (docker-compose.dev.yml uses
-- POSTGRES_USER=postgres). The official postgres entrypoint runs init scripts
-- with ON_ERROR_STOP, so an unguarded reference to the absent role aborted the
-- whole init partway (rest of this file + 99_schema_migrations_baseline never
-- ran; the container only came up on restart over the half-initialized volume).
-- Guard the default-privilege grants on role existence; dev doesn't need them
-- (its app connects as the postgres superuser).
DO $default_priv_09$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_app') THEN
        ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO infrasafe_runtime;
        -- [1A-FU2-DB-H2] USAGE+SELECT only for future sequences.
        ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public
            GRANT USAGE, SELECT                  ON SEQUENCES TO infrasafe_runtime;
        -- [1A-FU2-DB-H1] No EXECUTE auto-grant. Each future function explicit.
    ELSE
        RAISE NOTICE '09_runtime_role: role infrasafe_app absent (dev bootstrap) — skipping default-privilege grants';
    END IF;
END
$default_priv_09$;

DO $sec_def_09$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'refresh_transformer_analytics'
    ) THEN
        ALTER FUNCTION public.refresh_transformer_analytics()
            SECURITY DEFINER
            SET search_path = pg_catalog, public;
        -- [1A-FU-S-L2] canonical pg_catalog-first ordering
    END IF;
END
$sec_def_09$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
