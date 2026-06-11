const { createError } = require('../../utils/helpers');
const db = require('../../config/database');
const logger = require('../../utils/logger');

// Phase 9.3 (YAGNI-007 / YAGNI-008): globalSearch and exportData were
// pure stubs — globalSearch returned an empty result with "Search
// completed (stub)" and exportData returned HTTP 501. Both are removed
// along with their routes; operators rely on the per-entity list
// endpoints (/admin/buildings etc.) for filtering and the admin panel
// does not expose a "export" button in production. Re-add when there
// is a concrete use case.

async function getAdminStats(req, res, next) {
    try {
        const [buildings, controllers, metrics, alerts] = await Promise.all([
            db.query('SELECT COUNT(*) FROM buildings'),
            db.query('SELECT COUNT(*) FROM controllers'),
            db.query('SELECT COUNT(*) FROM metrics'),
            // AUD-007: the live alert system is infrastructure_alerts; the legacy
            // `alerts` table was dropped in migration 028. "Active" for the
            // dashboard = active + acknowledged (an acknowledged alert is still open).
            db.query("SELECT COUNT(*) FROM infrastructure_alerts WHERE status IN ('active', 'acknowledged')"),
        ]);

        res.json({
            buildings: { total: parseInt(buildings.rows[0].count, 10) },
            controllers: { total: parseInt(controllers.rows[0].count, 10) },
            metrics: { total: parseInt(metrics.rows[0].count, 10) },
            alerts: { active: parseInt(alerts.rows[0].count, 10) },
        });
    } catch (error) {
        // AUD-029: surface the real cause; the client still gets a generic 500.
        logger.error(`Error in getAdminStats: ${error.message}`);
        next(createError('Failed to get stats', 500));
    }
}

module.exports = {
    getAdminStats,
};
