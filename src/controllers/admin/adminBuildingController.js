const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder, validatePagination, validateSearchString } = require('../../utils/queryValidation');

// Delegate CRUD to the existing buildingController
const buildingController = require('../buildingController');

/**
 * Admin building operations: optimized list, CRUD delegation, batch ops.
 */

async function getOptimizedBuildings(req, res, next) {
    try {
        const {
            page = 1,
            limit = 50,
            sort = 'building_id',
            order = 'asc',
            search,
            town,
            region,
            management_company
        } = req.query;

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидацию параметров
        const { validSort, validOrder } = validateSortOrder('buildings', sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);
        const cleanSearch = validateSearchString(search);

        let query = 'SELECT * FROM buildings';
        let countQuery = 'SELECT COUNT(*) FROM buildings';
        let params = [];
        let whereConditions = [];

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем очищенную строку поиска
        if (cleanSearch) {
            whereConditions.push('name ILIKE $' + (params.length + 1));
            params.push(`%${cleanSearch}%`);
        }
        if (town) {
            whereConditions.push('town = $' + (params.length + 1));
            params.push(town);
        }
        if (region) {
            whereConditions.push('region = $' + (params.length + 1));
            params.push(region);
        }
        if (management_company) {
            whereConditions.push('management_company = $' + (params.length + 1));
            params.push(management_company);
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
        logger.error(`Error in getOptimizedBuildings: ${error.message}`);
        next(createError(`Failed to get buildings: ${error.message}`, 500));
    }
}

async function createBuilding(req, res, next) {
    return buildingController.createBuilding(req, res, next);
}

async function getBuildingById(req, res, next) {
    return buildingController.getBuildingById(req, res, next);
}

async function updateBuilding(req, res, next) {
    return buildingController.updateBuilding(req, res, next);
}

async function deleteBuilding(req, res, next) {
    return buildingController.deleteBuilding(req, res, next);
}

async function batchBuildingsOperation(req, res, next) {
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
    getOptimizedBuildings,
    createBuilding,
    getBuildingById,
    updateBuilding,
    deleteBuilding,
    batchBuildingsOperation
};
