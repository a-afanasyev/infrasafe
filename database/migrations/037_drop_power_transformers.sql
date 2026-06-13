-- 037 [AUD-039] Canonicalize transformers — Phase 2 (CONTRACT).
--
-- Follows 036 (EXPAND, deployed + prod-verified 2026-06-13). Phase 1 moved every
-- live read/write onto the canonical `transformers` table and left the legacy
-- `power_transformers` world DORMANT so a rollback to the Phase-1 app image (which
-- no longer references power_transformers) stayed safe. This CONTRACT step removes
-- the now-unreferenced legacy artifacts.
--
-- ALSO FIXES a Phase-1 regression: `Transformer.findNearestBuildings` calls
-- find_nearest_buildings_to_transformer($1,$2,$3) with THREE integer args
-- (id, max_distance, limit), but 036 created only a TWO-arg integer overload, so
-- `GET /api/analytics/transformers/:id/buildings` errored with "function
-- (integer,integer,integer) does not exist". It was latent (no consumer yet — the
-- frontend-redesign plans it). This migration creates the correct THREE-arg integer
-- overload (mirroring the legacy VARCHAR 3-arg: max_distance DEFAULT 1000,
-- limit_count DEFAULT 50 + LIMIT) reading `transformers`, then drops the 2-arg
-- integer one and both VARCHAR/power_transformers overloads.
--
-- Forward-policy: TRANSACTIONAL (own BEGIN/COMMIT) + IDEMPOTENT (CREATE OR REPLACE /
-- DROP ... IF EXISTS). This is a deliberate CONTRACT migration (drops are not
-- expand-only) — valid because the only rollback target is the Phase-1 image, which
-- does not touch power_transformers. Prod has 0 buildings referencing
-- power_transformer_id (verified 2026-06-13). Applied by scripts/migrate.sh.

BEGIN;

-- 1. Correct 3-arg INTEGER nearest-buildings function on `transformers` (fixes the
--    Phase-1 arity regression). Geom-based (matches 036's accurate ST_Distance) +
--    the LIMIT the legacy 3-arg VARCHAR overload provided.
CREATE OR REPLACE FUNCTION find_nearest_buildings_to_transformer(
    transformer_id_param INTEGER,
    radius_meters INTEGER DEFAULT 1000,
    limit_count INTEGER DEFAULT 50
) RETURNS TABLE (
    building_id INTEGER,
    building_name VARCHAR(100),
    distance_meters DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.building_id,
        b.name,
        public.ST_Distance(
            public.ST_Transform(t.geom, 3857),
            public.ST_Transform(b.geom, 3857)
        ) AS distance_meters
    FROM public.buildings b
    CROSS JOIN public.transformers t
    WHERE t.transformer_id = transformer_id_param
      AND public.ST_DWithin(
          public.ST_Transform(t.geom, 3857),
          public.ST_Transform(b.geom, 3857),
          radius_meters
      )
    ORDER BY distance_meters
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop the superseded overloads: 036's 2-arg integer (never called — the model
--    passes 3 args) and both legacy VARCHAR/power_transformers ones.
DROP FUNCTION IF EXISTS find_nearest_buildings_to_transformer(integer, integer);
DROP FUNCTION IF EXISTS find_nearest_buildings_to_transformer(character varying, integer);
DROP FUNCTION IF EXISTS find_nearest_buildings_to_transformer(character varying, integer, integer);

-- 3. Drop the legacy building FK + column (0 rows reference it).
ALTER TABLE buildings DROP CONSTRAINT IF EXISTS fk_buildings_power_transformer;
ALTER TABLE buildings DROP COLUMN IF EXISTS power_transformer_id;

-- 4. Drop the legacy table (CASCADE also removes trig_power_transformers_geom and
--    its indexes). Nothing in live code references it after Phase 1.
DROP TABLE IF EXISTS power_transformers CASCADE;

COMMIT;
