const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const adminService = require('../../services/adminService');
const { sendSuccess } = require('../../utils/apiResponse');

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
        // [AR-4] Раньше уходило `{data, pagination}` без `success` — пятая форма
        // конверта, которую потребитель узнавал по отсутствию ключа. Изменение
        // аддитивное: путь чтения `body.data` на фронте не меняется.
        sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error) {
        logger.error(`Error in getOptimizedBuildings: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

// [R2-03] Real batch delete (was a stub that returned success:true without acting).
// Only `delete` is implemented — there is no defined batch column-update contract
// for buildings, so other actions return 501 instead of faking success.
async function batchBuildingsOperation(req, res, next) {
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

        const result = await adminService.batchDelete('buildings', 'building_id', ids);
        res.json({
            success: true,
            message: `Batch ${action} completed`,
            affected: result.rowCount,
        });
    } catch (error) {
        logger.error(`Error in batchBuildingsOperation: ${error.message}`);
        next(createError('Batch operation failed', 500));
    }
}

module.exports = {
    getOptimizedBuildings,
    batchBuildingsOperation,
};
