const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');

/**
 * Admin controller (IoT device) operations: optimized list + batch stub.
 *
 * Phase 5: CRUD proxies removed — adminRoutes.js wires admin controller
 * CRUD directly to src/controllers/controllerController.js.
 */

const LIST_CONFIG = {
    table: 'controllers',
    entityType: 'controllers',
    defaultSort: 'controller_id',
    defaultLimit: 50,
    searchColumns: ['serial_number'],
    filters: [
        { param: 'status',       kind: 'exact' },
        { param: 'manufacturer', kind: 'exact' },
        { param: 'building_id',  kind: 'exact' },
    ],
};

async function getOptimizedControllers(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getOptimizedControllers: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function batchControllersOperation(req, res, next) {
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
    getOptimizedControllers,
    batchControllersOperation,
};
