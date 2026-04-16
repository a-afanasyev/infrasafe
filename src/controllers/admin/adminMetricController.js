const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');

/**
 * Admin metric operations: optimized list + batch stub.
 *
 * Phase 5: CRUD proxies removed — adminRoutes.js wires admin metric CRUD
 * directly to src/controllers/metricController.js.
 */

const LIST_CONFIG = {
    table: 'metrics',
    entityType: 'metrics',
    defaultSort: 'timestamp',
    defaultLimit: 100,
    filters: [
        { param: 'controller_id', kind: 'exact' },
        { param: 'start_date',    column: 'timestamp', kind: 'gte' },
        { param: 'end_date',      column: 'timestamp', kind: 'lte' },
    ],
};

async function getOptimizedMetrics(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getOptimizedMetrics: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function batchMetricsOperation(req, res, next) {
    try {
        const { action } = req.body;
        res.json({
            success: true,
            message: `Batch ${action} completed (stub)`,
            affected: 0,
        });
    } catch (error) {
        next(createError('Batch operation failed', 500));
    }
}

module.exports = {
    getOptimizedMetrics,
    batchMetricsOperation,
};
