// [B-024] Public aggregate counts for the map layer panel.
//
// Anonymous map visitors cannot load auth-gated layer details (the
// /transformers, /lines, /alerts, … endpoints are default-deny → 401), so the
// layer panel used to show a wall of "(0)" for everyone until login. This model
// exposes ONLY integer counts (no coordinates, names, statuses or any row
// detail) so the public GET /api/map-layer-counts endpoint can seed honest
// numbers without widening the anonymous data surface.
//
// Tables mirror what each frontend layer loads (public/map-layers-control.js):
//   🏢 Здания            → buildings
//   📊 Контроллеры       → controllers
//   ⚡ Трансформаторы    → transformers      (the /transformers route table)
//   🔌 Линии электро…    → lines
//   💧 Источники воды    → cold_water_sources
//   🚰 Линии водоснаб…   → water_lines
//   🔥 Источники тепла   → heat_sources
//   ⚠️ Алерты            → infrastructure_alerts WHERE status = 'active'

'use strict';

const db = require('../config/database');
const logger = require('../utils/logger');

// Single round-trip: scalar subqueries always return exactly one row, so a
// connection hiccup fails the whole call rather than yielding partial counts.
const COUNTS_QUERY = `
    SELECT
        (SELECT count(*) FROM buildings)          AS buildings,
        (SELECT count(*) FROM controllers)        AS controllers,
        (SELECT count(*) FROM transformers)       AS transformers,
        (SELECT count(*) FROM lines)              AS power_lines,
        (SELECT count(*) FROM cold_water_sources) AS water_sources,
        (SELECT count(*) FROM water_lines)        AS water_lines,
        (SELECT count(*) FROM heat_sources)       AS heat_sources,
        (SELECT count(*) FROM infrastructure_alerts WHERE status = 'active') AS alerts_active
`;

const COUNT_KEYS = [
    'buildings',
    'controllers',
    'transformers',
    'power_lines',
    'water_sources',
    'water_lines',
    'heat_sources',
    'alerts_active'
];

// pg returns count(*) as a bigint string; coerce to a safe non-negative integer.
const toCount = (value) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

class MapLayerCounts {
    static async getCounts() {
        try {
            const { rows } = await db.query(COUNTS_QUERY);
            const row = rows[0] || {};
            return COUNT_KEYS.reduce((acc, key) => {
                acc[key] = toCount(row[key]);
                return acc;
            }, {});
        } catch (error) {
            logger.error(`MapLayerCounts.getCounts error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = MapLayerCounts;
