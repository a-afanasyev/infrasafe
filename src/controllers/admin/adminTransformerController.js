const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder, validatePagination, validateSearchString } = require('../../utils/queryValidation');
const adminService = require('../../services/adminService');

/**
 * Admin transformer operations: optimized list, full CRUD, batch ops.
 */

async function getOptimizedTransformers(req, res, next) {
    try {
        const {
            page = 1,
            limit = 50,
            sort = 'transformer_id',
            order = 'asc',
            search,
            power_min,
            power_max,
            voltage_kv,
            building_id
        } = req.query;

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидацию параметров
        const { validSort, validOrder } = validateSortOrder('transformers', sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);
        const cleanSearch = validateSearchString(search);

        let query = 'SELECT t.*, b.name as building_name FROM transformers t LEFT JOIN buildings b ON t.building_id = b.building_id';
        let countQuery = 'SELECT COUNT(*) FROM transformers t LEFT JOIN buildings b ON t.building_id = b.building_id';
        let params = [];
        let whereConditions = [];

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем очищенную строку поиска
        if (cleanSearch) {
            whereConditions.push('t.name ILIKE $' + (params.length + 1));
            params.push(`%${cleanSearch}%`);
        }
        if (power_min) {
            whereConditions.push('t.power_kva >= $' + (params.length + 1));
            params.push(power_min);
        }
        if (power_max) {
            whereConditions.push('t.power_kva <= $' + (params.length + 1));
            params.push(power_max);
        }
        if (voltage_kv) {
            whereConditions.push('t.voltage_kv = $' + (params.length + 1));
            params.push(voltage_kv);
        }
        if (building_id) {
            whereConditions.push('t.building_id = $' + (params.length + 1));
            params.push(building_id);
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидированные параметры сортировки
        // Исправляем сортировку для transformer_id (для обратной совместимости)
        const sortField = validSort === 'id' ? 'transformer_id' : validSort;
        query += ` ORDER BY t.${sortField} ${validOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
        logger.error(`Error in getOptimizedTransformers: ${error.message}`);
        next(createError(`Failed to get transformers: ${error.message}`, 500));
    }
}

async function createTransformer(req, res, next) {
    try {
        const { name, power_kva, voltage_kv, building_id } = req.body;

        if (!name || !power_kva || !voltage_kv) {
            return next(createError('Name, power_kva and voltage_kv are required', 400));
        }

        const query = `
            INSERT INTO transformers (name, power_kva, voltage_kv, building_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;

        const result = await pool.query(query, [name, power_kva, voltage_kv, building_id]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: 'Transformer created successfully'
        });

    } catch (error) {
        logger.error(`Error in createTransformer: ${error.message}`);
        next(createError(`Failed to create transformer: ${error.message}`, 500));
    }
}

async function getTransformerById(req, res, next) {
    try {
        const { id } = req.params;

        const query = `
            SELECT t.*, b.name as building_name
            FROM transformers t
            LEFT JOIN buildings b ON t.building_id = b.building_id
            WHERE t.transformer_id = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return next(createError('Transformer not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        logger.error(`Error in getTransformerById: ${error.message}`);
        next(createError(`Failed to get transformer: ${error.message}`, 500));
    }
}

async function updateTransformer(req, res, next) {
    try {
        const { id } = req.params;
        const { name, power_kva, voltage_kv, building_id } = req.body;

        const updateFields = [];
        const params = [];
        let paramIndex = 1;

        if (name !== undefined) { updateFields.push(`name = $${paramIndex++}`); params.push(name); }
        if (power_kva !== undefined) { updateFields.push(`power_kva = $${paramIndex++}`); params.push(power_kva); }
        if (voltage_kv !== undefined) { updateFields.push(`voltage_kv = $${paramIndex++}`); params.push(voltage_kv); }
        if (building_id !== undefined) { updateFields.push(`building_id = $${paramIndex++}`); params.push(building_id); }

        if (updateFields.length === 0) {
            return next(createError('No fields to update', 400));
        }

        updateFields.push(`updated_at = NOW()`);
        params.push(id);

        const query = `
            UPDATE transformers
            SET ${updateFields.join(', ')}
            WHERE transformer_id = $${paramIndex}
            RETURNING *
        `;

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return next(createError('Transformer not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Transformer updated successfully'
        });

    } catch (error) {
        logger.error(`Error in updateTransformer: ${error.message}`);
        next(createError(`Failed to update transformer: ${error.message}`, 500));
    }
}

async function deleteTransformer(req, res, next) {
    try {
        const { id } = req.params;

        const query = 'DELETE FROM transformers WHERE transformer_id = $1 RETURNING *';
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return next(createError('Transformer not found', 404));
        }

        res.json({
            success: true,
            message: 'Transformer deleted successfully'
        });

    } catch (error) {
        logger.error(`Error in deleteTransformer: ${error.message}`);
        next(createError(`Failed to delete transformer: ${error.message}`, 500));
    }
}

async function batchTransformersOperation(req, res, next) {
    try {
        const { action, ids, data } = req.body;

        if (!action || !ids || !Array.isArray(ids)) {
            return next(createError('Action and ids array are required', 400));
        }

        let result;
        switch (action) {
            case 'delete':
                result = await adminService.batchDelete('transformers', 'transformer_id', ids);
                break;

            case 'update_voltage':
                if (!data || !data.voltage_kv) {
                    return next(createError('voltage_kv is required for update_voltage action', 400));
                }
                result = await adminService.batchUpdateColumn('transformers', 'transformer_id', ids, 'voltage_kv', data.voltage_kv);
                break;

            case 'update_power':
                if (!data || !data.power_kva) {
                    return next(createError('power_kva is required for update_power action', 400));
                }
                result = await adminService.batchUpdateColumn('transformers', 'transformer_id', ids, 'power_kva', data.power_kva);
                break;

            default:
                return next(createError(`Unknown action: ${action}`, 400));
        }

        res.json({
            success: true,
            message: `Batch ${action} completed`,
            affected: result.rows.length
        });

    } catch (error) {
        logger.error(`Error in batchTransformersOperation: ${error.message}`);
        next(createError(`Batch operation failed: ${error.message}`, 500));
    }
}

module.exports = {
    getOptimizedTransformers,
    createTransformer,
    getTransformerById,
    updateTransformer,
    deleteTransformer,
    batchTransformersOperation
};
