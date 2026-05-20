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
        CREATE ROLE infrasafe_runtime
            LOGIN
            PASSWORD 'CHANGE_ME_VIA_OPERATOR_RUNBOOK_DO_NOT_USE_IN_PROD';
        COMMENT ON ROLE infrasafe_runtime IS
            'Least-privilege runtime role (P0-5). Operator must ALTER ROLE '
            'with a strong password and pass it via DB_PASSWORD env to the app.';
    END IF;
END
$init_09$;

GRANT CONNECT ON DATABASE infrasafe TO infrasafe_runtime;
GRANT USAGE  ON SCHEMA   public      TO infrasafe_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO infrasafe_runtime;

GRANT USAGE, SELECT, UPDATE
    ON ALL SEQUENCES IN SCHEMA public
    TO infrasafe_runtime;

GRANT EXECUTE
    ON ALL FUNCTIONS IN SCHEMA public
    TO infrasafe_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO infrasafe_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE          ON SEQUENCES TO infrasafe_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE infrasafe_app IN SCHEMA public
    GRANT EXECUTE                        ON FUNCTIONS TO infrasafe_runtime;

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
            SET search_path = public, pg_temp;
    END IF;
END
$sec_def_09$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
