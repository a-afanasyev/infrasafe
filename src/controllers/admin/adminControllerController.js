const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder, validatePagination, validateSearchString } = require('../../utils/queryValidation');

// Delegate CRUD to the existing controllerController
const controllerController = require('../controllerController');

/**
 * Admin controller operations: optimized list, CRUD delegation, batch ops.
 */

async function getOptimizedControllers(req, res, next) {
    try {
        const {
            page = 1,
            limit = 50,
            sort = 'controller_id',
            order = 'asc',
            search,
            status,
            manufacturer,
            building_id
        } = req.query;

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидацию параметров
        const { validSort, validOrder } = validateSortOrder('controllers', sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);
        const cleanSearch = validateSearchString(search);

        let query = 'SELECT * FROM controllers';
        let countQuery = 'SELECT COUNT(*) FROM controllers';
        let params = [];
        let whereConditions = [];

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем очищенную строку поиска
        if (cleanSearch) {
            whereConditions.push('serial_number ILIKE $' + (params.length + 1));
            params.push(`%${cleanSearch}%`);
        }
        if (status) {
            whereConditions.push('status = $' + (params.length + 1));
            params.push(status);
        }
        if (manufacturer) {
            whereConditions.push('manufacturer = $' + (params.length + 1));
            params.push(manufacturer);
        }
        if (building_id) {
            whereConditions.push('building_id = $' + (params.length + 1));
            params.push(building_id);
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
        logger.error(`Error in getOptimizedControllers: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function createController(req, res, next) {
    return controllerController.createController(req, res, next);
}

async function getControllerById(req, res, next) {
    return controllerController.getControllerById(req, res, next);
}

async function updateController(req, res, next) {
    return controllerController.updateController(req, res, next);
}

async function deleteController(req, res, next) {
    return controllerController.deleteController(req, res, next);
}

async function batchControllersOperation(req, res, next) {
    try {
        const { action, ids } = req.body;
        res.json({
            success: true,
            message: `Batch ${action} completed (stub)`,
            affected: ids ? ids.length : 0
        });
    } catch (error) {
        next(createError('Batch operation failed', 500));
    }
}

module.exports = {
    getOptimizedControllers,
    createController,
    getControllerById,
    updateController,
    deleteController,
    batchControllersOperation
};
