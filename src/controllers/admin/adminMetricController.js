const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder, validatePagination } = require('../../utils/queryValidation');

// Delegate CRUD to the existing metricController
const metricController = require('../metricController');

/**
 * Admin metric operations: optimized list, CRUD delegation, batch ops.
 */

async function getOptimizedMetrics(req, res, next) {
    try {
        const {
            page = 1,
            limit = 100,
            sort = 'timestamp',
            order = 'desc',
            controller_id,
            start_date,
            end_date
        } = req.query;

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидацию параметров
        const { validSort, validOrder } = validateSortOrder('metrics', sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);

        let query = 'SELECT * FROM metrics';
        let countQuery = 'SELECT COUNT(*) FROM metrics';
        let params = [];
        let whereConditions = [];

        if (controller_id) {
            whereConditions.push('controller_id = $' + (params.length + 1));
            params.push(controller_id);
        }
        if (start_date) {
            whereConditions.push('timestamp >= $' + (params.length + 1));
            params.push(start_date);
        }
        if (end_date) {
            whereConditions.push('timestamp <= $' + (params.length + 1));
            params.push(end_date);
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидированные параметры сортировки
        query += ` ORDER BY ${validSort} ${validOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limitNum, offset);

        const [dataResult, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, params.slice(0, -2))
        ]);

        const result = {
            data: dataResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count),
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
            }
        };

        res.json(result);

    } catch (error) {
        logger.error(`Error in getOptimizedMetrics: ${error.message}`);
        next(createError(`Failed to get metrics: ${error.message}`, 500));
    }
}

async function createMetric(req, res, next) {
    return metricController.createMetric(req, res, next);
}

async function getMetricById(req, res, next) {
    return metricController.getMetricById(req, res, next);
}

async function updateMetric(req, res, next) {
    return metricController.updateMetric(req, res, next);
}

async function deleteMetric(req, res, next) {
    return metricController.deleteMetric(req, res, next);
}

async function batchMetricsOperation(req, res, next) {
    try {
        const { action } = req.body;
        res.json({
            success: true,
            message: `Batch ${action} completed (stub)`,
            affected: 0
        });
    } catch (error) {
        next(createError('Batch operation failed', 500));
    }
}

module.exports = {
    getOptimizedMetrics,
    createMetric,
    getMetricById,
    updateMetric,
    deleteMetric,
    batchMetricsOperation
};
