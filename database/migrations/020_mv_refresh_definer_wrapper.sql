-- Migration 020: SECURITY DEFINER wrapper for MV refresh
-- Sprint 6 follow-up (2026-05-22)
--
-- Problem chain:
--   1. `infrasafe_runtime` (the app's runtime role per migration 017) does
--      NOT own materialized views, so a direct
--          REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime
--      from the app fails with `must be owner of materialized view ...`.
--   2. The pre-existing `refresh_transformer_analytics()` IS SECURITY DEFINER
--      (flipped by migration 017) so it bypasses ownership — but it also
--      `INSERT`s an audit row into `public.logs`, which is partitioned by
--      date in production with no auto-partition creation. The INSERT raises
--      `no partition of relation "logs" found for row`, the function's
--      EXCEPTION block re-raises, and the caller sees a failure even though
--      the REFRESH itself succeeded.
--
-- Fix:
--   Add a dedicated, side-effect-free SECURITY DEFINER wrapper called from
--   the Node-side scheduler (src/services/mvRefreshService.js). The existing
--   `refresh_transformer_analytics()` is left untouched for the legacy
--   admin-triggered refresh endpoint (src/services/analyticsService.js:157).
--
-- Security notes (mirroring the rationale in migration 017):
--   - SECURITY DEFINER runs as the function owner. The migration runs as
--     the bootstrap user (`infrasafe_app`), which owns the MV; this lets
--     the function REFRESH it.
--   - `SET search_path = pg_catalog, public` locks the resolution order so
--     an attacker-controlled schema cannot shadow builtins.
--   - Zero arguments → no parameter-injection surface.
--   - EXECUTE granted only to `infrasafe_runtime` (and revoked from PUBLIC),
--     so the function is not auto-callable.
--   - Idempotent: CREATE OR REPLACE + IF EXISTS guard around GRANT.

CREATE OR REPLACE FUNCTION public.refresh_mv_transformer_load()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_transformer_load_realtime;
END;
$$;

COMMENT ON FUNCTION public.refresh_mv_transformer_load() IS
    'Sprint 6 / P0-6: side-effect-free MV refresh wrapper called by ' ||
    'src/services/mvRefreshService.js. SECURITY DEFINER so runtime role ' ||
    'can invoke it without owning the materialized view.';

REVOKE ALL ON FUNCTION public.refresh_mv_transformer_load() FROM PUBLIC;

DO $grant_runtime$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'infrasafe_runtime') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.refresh_mv_transformer_load() TO infrasafe_runtime';
    END IF;
END
$grant_runtime$;
