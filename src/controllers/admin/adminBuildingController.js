const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');

/**
 * Admin building operations: optimized list + batch stub.
 *
 * Phase 5: CRUD proxies removed — adminRoutes.js now wires admin building
 * CRUD directly to src/controllers/buildingController.js. isAdmin +
 * rateLimitStrict middleware already sit at the route level, so there is
 * no authorization regression.
 */

const LIST_CONFIG = {
    table: 'buildings',
    entityType: 'buildings',
    defaultSort: 'building_id',
    defaultLimit: 50,
    searchColumns: ['name'],
    filters: [
        { param: 'town',               kind: 'exact' },
        { param: 'region',             kind: 'exact' },
        { param: 'management_company', kind: 'exact' },
    ],
};

async function getOptimizedBuildings(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getOptimizedBuildings: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function batchBuildingsOperation(req, res, next) {
    try {
        const { action, ids } = req.body;
        res.json({
            success: true,
            message: `Batch ${action} completed (stub)`,
            affected: ids ? ids.length : 0,
        });
    } catch (error) {
        next(createError('Batch operation failed', 500));
    }
}

module.exports = {
    getOptimizedBuildings,
    batchBuildingsOperation,
};
