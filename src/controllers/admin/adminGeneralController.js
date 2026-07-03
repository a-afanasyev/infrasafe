const { createError } = require('../../utils/helpers');
const adminService = require('../../services/adminService');
const logger = require('../../utils/logger');

// Phase 9.3 (YAGNI-007 / YAGNI-008): globalSearch and exportData were
// pure stubs — globalSearch returned an empty result with "Search
// completed (stub)" and exportData returned HTTP 501. Both are removed
// along with their routes; operators rely on the per-entity list
// endpoints (/admin/buildings etc.) for filtering and the admin panel
// does not expose a "export" button in production. Re-add when there
// is a concrete use case.

// [R2-04] Data access lives in adminService.getDashboardStats(); this handler
// stays pure HTTP — call the service, shape the response, map errors.
async function getAdminStats(req, res, next) {
    try {
        const stats = await adminService.getDashboardStats();
        res.json(stats);
    } catch (error) {
        // AUD-029: surface the real cause; the client still gets a generic 500.
        logger.error(`Error in getAdminStats: ${error.message}`);
        next(createError('Failed to get stats', 500));
    }
}

module.exports = {
    getAdminStats,
};
