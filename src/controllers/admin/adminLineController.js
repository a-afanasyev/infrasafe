const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder, validatePagination, validateSearchString } = require('../../utils/queryValidation');
const adminService = require('../../services/adminService');

/**
 * Admin power-line operations: optimized list, full CRUD, batch ops.
 */

async function getOptimizedLines(req, res, next) {
    try {
        const {
            page = 1,
            limit = 50,
            sort = 'line_id',
            order = 'asc',
            search,
            voltage_min,
            voltage_max,
            length_min,
            length_max,
            transformer_id
        } = req.query;

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидацию параметров
        const { validSort, validOrder } = validateSortOrder('lines', sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);
        const cleanSearch = validateSearchString(search);

        let query = 'SELECT l.*, t.name as transformer_name FROM lines l LEFT JOIN transformers t ON l.transformer_id = t.transformer_id';
        let countQuery = 'SELECT COUNT(*) FROM lines l LEFT JOIN transformers t ON l.transformer_id = t.transformer_id';
        let params = [];
        let whereConditions = [];

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем очищенную строку поиска
        if (cleanSearch) {
            whereConditions.push('l.name ILIKE $' + (params.length + 1));
            params.push(`%${cleanSearch}%`);
        }
        if (voltage_min) {
            whereConditions.push('l.voltage_kv >= $' + (params.length + 1));
            params.push(voltage_min);
        }
        if (voltage_max) {
            whereConditions.push('l.voltage_kv <= $' + (params.length + 1));
            params.push(voltage_max);
        }
        if (length_min) {
            whereConditions.push('l.length_km >= $' + (params.length + 1));
            params.push(length_min);
        }
        if (length_max) {
            whereConditions.push('l.length_km <= $' + (params.length + 1));
            params.push(length_max);
        }
        if (transformer_id) {
            whereConditions.push('l.transformer_id = $' + (params.length + 1));
            params.push(transformer_id);
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидированные параметры сортировки
        // Исправляем сортировку для line_id (для обратной совместимости)
        const sortField = validSort === 'id' ? 'line_id' : validSort;
        query += ` ORDER BY l.${sortField} ${validOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
        logger.error(`Error in getOptimizedLines: ${error.message}`);
        next(createError(`Failed to get lines: ${error.message}`, 500));
    }
}

async function createLine(req, res, next) {
    try {
        const { name, voltage_kv, length_km, transformer_id } = req.body;

        if (!name || !voltage_kv || !length_km) {
            return next(createError('Name, voltage_kv and length_km are required', 400));
        }

        const query = `
            INSERT INTO lines (name, voltage_kv, length_km, transformer_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;

        const result = await pool.query(query, [name, voltage_kv, length_km, transformer_id]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: 'Line created successfully'
        });

    } catch (error) {
        logger.error(`Error in createLine: ${error.message}`);
        next(createError(`Failed to create line: ${error.message}`, 500));
    }
}

async function getLineById(req, res, next) {
    try {
        const { id } = req.params;

        const query = `
            SELECT l.*, t.name as transformer_name
            FROM lines l
            LEFT JOIN transformers t ON l.transformer_id = t.transformer_id
            WHERE l.line_id = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return next(createError('Line not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        logger.error(`Error in getLineById: ${error.message}`);
        next(createError(`Failed to get line: ${error.message}`, 500));
    }
}

async function updateLine(req, res, next) {
    try {
        const { id } = req.params;
        const { name, voltage_kv, length_km, transformer_id } = req.body;

        const updateFields = [];
        const params = [];
        let paramIndex = 1;

        if (name !== undefined) { updateFields.push(`name = $${paramIndex++}`); params.push(name); }
        if (voltage_kv !== undefined) { updateFields.push(`voltage_kv = $${paramIndex++}`); params.push(voltage_kv); }
        if (length_km !== undefined) { updateFields.push(`length_km = $${paramIndex++}`); params.push(length_km); }
        if (transformer_id !== undefined) { updateFields.push(`transformer_id = $${paramIndex++}`); params.push(transformer_id); }

        if (updateFields.length === 0) {
            return next(createError('No fields to update', 400));
        }

        updateFields.push(`updated_at = NOW()`);
        params.push(id);

        const query = `
            UPDATE lines
            SET ${updateFields.join(', ')}
            WHERE line_id = $${paramIndex}
            RETURNING *
        `;

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return next(createError('Line not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Line updated successfully'
        });

    } catch (error) {
        logger.error(`Error in updateLine: ${error.message}`);
        next(createError(`Failed to update line: ${error.message}`, 500));
    }
}

async function deleteLine(req, res, next) {
    try {
        const { id } = req.params;

        const query = 'DELETE FROM lines WHERE line_id = $1 RETURNING *';
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return next(createError('Line not found', 404));
        }

        res.json({
            success: true,
            message: 'Line deleted successfully'
        });

    } catch (error) {
        logger.error(`Error in deleteLine: ${error.message}`);
        next(createError(`Failed to delete line: ${error.message}`, 500));
    }
}

async function batchLinesOperation(req, res, next) {
    try {
        const { action, ids, data } = req.body;

        if (!action || !ids || !Array.isArray(ids)) {
            return next(createError('Action and ids array are required', 400));
        }

        let result;
        switch (action) {
            case 'delete':
                result = await adminService.batchDelete('lines', 'line_id', ids);
                break;

            case 'update_voltage':
                if (!data || !data.voltage_kv) {
                    return next(createError('voltage_kv is required for update_voltage action', 400));
                }
                result = await adminService.batchUpdateColumn('lines', 'line_id', ids, 'voltage_kv', data.voltage_kv);
                break;

            case 'set_maintenance':
                if (!data || !data.maintenance_date) {
                    return next(createError('maintenance_date is required for set_maintenance action', 400));
                }
                result = await adminService.batchUpdateColumn('lines', 'line_id', ids, 'maintenance_date', data.maintenance_date);
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
        logger.error(`Error in batchLinesOperation: ${error.message}`);
        next(createError(`Batch operation failed: ${error.message}`, 500));
    }
}

module.exports = {
    getOptimizedLines,
    createLine,
    getLineById,
    updateLine,
    deleteLine,
    batchLinesOperation
};
