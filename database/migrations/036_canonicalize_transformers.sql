-- 036 [AUD-039] Canonicalize transformers — Phase 1 (EXPAND).
--
-- Background: prod carried TWO divergent transformer worlds. `transformers`
-- (INT transformer_id, power_kva) is the WIRED/canonical one — the map's
-- /api/transformers layer, the mv_transformer_load_realtime MV (rebuilt onto it
-- by migration 012), power-analytics, and buildings.primary/backup_transformer_id
-- all read it. `power_transformers` (VARCHAR id, capacity_kva, richer columns +
-- PostGIS geom) is LEGACY but was still actively read by the /analytics/* surface
-- via PowerTransformer.js — a split-brain where /analytics showed the 4 real test
-- rows while the map showed the 1 test row in `transformers`. This consolidates
-- onto `transformers`.
--
-- Forward-policy (roll-forward-only, see migrations/README): TRANSACTIONAL (own
-- BEGIN/COMMIT) + IDEMPOTENT (ADD COLUMN IF NOT EXISTS / INSERT ... WHERE NOT
-- EXISTS / CREATE OR REPLACE / guarded UPDATE+DELETE) + EXPAND-ONLY / backward-
-- compatible: `power_transformers` and `buildings.power_transformer_id` are left
-- DORMANT and dropped only later by 037 (CONTRACT), so a rollback to the old app
-- image (which still SELECTs power_transformers) stays safe during the deploy
-- window. Applied by scripts/migrate.sh, not a manual psql накат.
--
-- Data note: all transformer rows are TEST data (operator-confirmed 2026-06-13,
-- deletable). The port below copies power_transformers' rows into `transformers`
-- (capacity_kva→power_kva), re-points the one wired building off the '1111' test
-- row onto the ported Олмазор row, and drops '1111'. `transformers.geom` is kept
-- in sync from lat/lng by the existing trig_transformers_geom trigger, so the port
-- only needs latitude/longitude.

BEGIN;

-- 1. Richer columns that only power_transformers had (geom/manufacturer/model/
--    installation_date/status/latitude/longitude already exist on transformers).
ALTER TABLE transformers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE transformers ADD COLUMN IF NOT EXISTS voltage_primary NUMERIC(10,2);
ALTER TABLE transformers ADD COLUMN IF NOT EXISTS voltage_secondary NUMERIC(10,2);
ALTER TABLE transformers ADD COLUMN IF NOT EXISTS maintenance_contact VARCHAR(255);
ALTER TABLE transformers ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Port the (test) rows from the legacy table. transformers.voltage_kv and
--    power_kva carry NOT NULL CHECK (> 0) constraints → COALESCE/NULLIF guards.
--    Matched by name so re-apply is a no-op (no natural key shared across tables).
INSERT INTO transformers
    (name, power_kva, voltage_kv, latitude, longitude, location, address,
     voltage_primary, voltage_secondary, installation_date, manufacturer, model,
     status, maintenance_contact, notes)
SELECT
    pt.name,
    COALESCE(NULLIF(pt.capacity_kva, 0), 1)        AS power_kva,
    COALESCE(NULLIF(pt.voltage_primary, 0), 10)    AS voltage_kv,
    pt.latitude,
    pt.longitude,
    pt.address                                     AS location,
    pt.address,
    pt.voltage_primary,
    pt.voltage_secondary,
    pt.installation_date,
    pt.manufacturer,
    pt.model,
    COALESCE(pt.status, 'active'),
    pt.maintenance_contact,
    pt.notes
FROM power_transformers pt
WHERE NOT EXISTS (
    SELECT 1 FROM transformers t WHERE t.name = pt.name
);

-- 3. Re-point any building still wired to the '1111' test transformer onto the
--    ported 'Трансформатор Олмазор-1' row (operator decision 2026-06-13). Guarded
--    so it is a safe no-op once '1111' is gone (re-apply) or if the target is
--    absent.
UPDATE buildings
SET primary_transformer_id = (
        SELECT transformer_id FROM transformers
        WHERE name = 'Трансформатор Олмазор-1' ORDER BY transformer_id LIMIT 1
    )
WHERE primary_transformer_id IN (SELECT transformer_id FROM transformers WHERE name = '1111')
  AND EXISTS (SELECT 1 FROM transformers WHERE name = 'Трансформатор Олмазор-1');

-- 4. Drop the '1111' test row (now unreferenced after step 3).
DELETE FROM transformers WHERE name = '1111';

-- 5. INTEGER overload of the nearest-buildings function, reading `transformers`.
--    Coexists with the VARCHAR/power_transformers overload (dropped in 037). The
--    Transformer model passes an INTEGER transformer_id, resolving to this one.
CREATE OR REPLACE FUNCTION find_nearest_buildings_to_transformer(
    transformer_id_param INTEGER,
    radius_meters INTEGER DEFAULT 1000
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
    ORDER BY distance_meters;
END;
$$ LANGUAGE plpgsql;

COMMIT;
