const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const adminService = require('../../services/adminService');

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

// [R2-03] Real batch delete (was a stub). controllers has no `updated_at` column,
// so batch column-update is unsupported by design → delete-only; other actions → 501.
async function batchControllersOperation(req, res, next) {
    try {
        const { action, ids } = req.body;

        if (!action || !Array.isArray(ids) || ids.length === 0) {
            return next(createError('Action and a non-empty ids array are required', 400));
        }
        if (ids.length > 1000) {
            return next(createError('Too many ids in one batch (max 1000)', 400));
        }
        if (!ids.every((id) => Number.isInteger(id))) {
            return next(createError('ids must be an array of integers', 400));
        }

        if (action !== 'delete') {
            return next(createError(`Batch action '${action}' is not implemented`, 501));
        }

        const result = await adminService.batchDelete('controllers', 'controller_id', ids);
        res.json({
            success: true,
            message: `Batch ${action} completed`,
            affected: result.rowCount,
        });
    } catch (error) {
        logger.error(`Error in batchControllersOperation: ${error.message}`);
        next(createError('Batch operation failed', 500));
    }
}

module.exports = {
    getOptimizedControllers,
    batchControllersOperation,
};
