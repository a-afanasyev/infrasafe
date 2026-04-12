const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder, validatePagination, validateSearchString } = require('../../utils/queryValidation');

/**
 * Admin water-line operations: optimized list, full CRUD, batch ops.
 */

async function getOptimizedWaterLines(req, res, next) {
    try {
        const {
            page = 1,
            limit = 50,
            sort = 'line_id',
            order = 'asc',
            search,
            type,
            status,
            material,
            diameter_min,
            diameter_max
        } = req.query;

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидацию параметров
        const { validSort, validOrder } = validateSortOrder('water_lines', sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);
        const cleanSearch = validateSearchString(search);

        let query = `
            SELECT wl.*,
                   COUNT(DISTINCT b.building_id) as connected_buildings_count,
                   ARRAY_AGG(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as connected_buildings
            FROM water_lines wl
            LEFT JOIN buildings b ON (wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id)
        `;
        let countQuery = 'SELECT COUNT(*) FROM water_lines wl';
        let params = [];
        let whereConditions = [];

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем очищенную строку поиска
        if (cleanSearch) {
            whereConditions.push('wl.name ILIKE $' + (params.length + 1));
            params.push(`%${cleanSearch}%`);
        }
        if (type) {
            whereConditions.push('wl.name ILIKE $' + (params.length + 1));
            params.push(`%${type}%`);
        }
        if (status) {
            whereConditions.push('wl.status = $' + (params.length + 1));
            params.push(status);
        }
        if (material) {
            whereConditions.push('wl.material ILIKE $' + (params.length + 1));
            params.push(`%${material}%`);
        }
        if (diameter_min) {
            whereConditions.push('wl.diameter_mm >= $' + (params.length + 1));
            params.push(parseInt(diameter_min));
        }
        if (diameter_max) {
            whereConditions.push('wl.diameter_mm <= $' + (params.length + 1));
            params.push(parseInt(diameter_max));
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        // ИСПРАВЛЕНИЕ SQL INJECTION: используем валидированные параметры сортировки
        query += ` GROUP BY wl.line_id ORDER BY wl.${validSort} ${validOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
        logger.error(`Error in getOptimizedWaterLines: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function createWaterLine(req, res, next) {
    try {
        const {
            name,
            description,
            diameter_mm,
            material,
            pressure_bar,
            installation_date,
            status = 'active',
            latitude_start,
            longitude_start,
            latitude_end,
            longitude_end,
            main_path,
            branches
        } = req.body;

        if (!name || !diameter_mm || !material) {
            return next(createError('Name, diameter_mm, and material are required', 400));
        }

        const query = `
            INSERT INTO water_lines (name, description, diameter_mm, material, pressure_bar, installation_date, status,
                latitude_start, longitude_start, latitude_end, longitude_end, main_path, branches)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        `;

        const result = await pool.query(query, [
            name, description, diameter_mm, material, pressure_bar, installation_date, status,
            latitude_start, longitude_start, latitude_end, longitude_end,
            main_path ? JSON.stringify(main_path) : null,
            branches ? JSON.stringify(branches) : '[]'
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: 'Water line created successfully'
        });

    } catch (error) {
        logger.error(`Error in createWaterLine: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function getWaterLineById(req, res, next) {
    try {
        const { id } = req.params;

        const query = `
            SELECT wl.*,
                   COUNT(DISTINCT b.building_id) as connected_buildings_count,
                   ARRAY_AGG(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as connected_buildings
            FROM water_lines wl
            LEFT JOIN buildings b ON (wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id)
            WHERE wl.line_id = $1
            GROUP BY wl.line_id
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return next(createError('Water line not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        logger.error(`Error in getWaterLineById: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function updateWaterLine(req, res, next) {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            diameter_mm,
            material,
            pressure_bar,
            installation_date,
            status,
            latitude_start,
            longitude_start,
            latitude_end,
            longitude_end,
            main_path,
            branches
        } = req.body;

        const updateFields = [];
        const params = [];
        let paramIndex = 1;

        if (name !== undefined) { updateFields.push(`name = $${paramIndex++}`); params.push(name); }
        if (description !== undefined) { updateFields.push(`description = $${paramIndex++}`); params.push(description); }
        if (diameter_mm !== undefined) { updateFields.push(`diameter_mm = $${paramIndex++}`); params.push(diameter_mm); }
        if (material !== undefined) { updateFields.push(`material = $${paramIndex++}`); params.push(material); }
        if (pressure_bar !== undefined) { updateFields.push(`pressure_bar = $${paramIndex++}`); params.push(pressure_bar); }
        if (installation_date !== undefined) { updateFields.push(`installation_date = $${paramIndex++}`); params.push(installation_date); }
        if (status !== undefined) { updateFields.push(`status = $${paramIndex++}`); params.push(status); }
        if (latitude_start !== undefined) { updateFields.push(`latitude_start = $${paramIndex++}`); params.push(latitude_start); }
        if (longitude_start !== undefined) { updateFields.push(`longitude_start = $${paramIndex++}`); params.push(longitude_start); }
        if (latitude_end !== undefined) { updateFields.push(`latitude_end = $${paramIndex++}`); params.push(latitude_end); }
        if (longitude_end !== undefined) { updateFields.push(`longitude_end = $${paramIndex++}`); params.push(longitude_end); }
        if (main_path !== undefined) { updateFields.push(`main_path = $${paramIndex++}`); params.push(JSON.stringify(main_path)); }
        if (branches !== undefined) { updateFields.push(`branches = $${paramIndex++}`); params.push(JSON.stringify(branches)); }

        if (updateFields.length === 0) {
            return next(createError('No fields to update', 400));
        }

        updateFields.push(`updated_at = NOW()`);
        params.push(id);

        const query = `
            UPDATE water_lines
            SET ${updateFields.join(', ')}
            WHERE line_id = $${paramIndex}
            RETURNING *
        `;

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return next(createError('Water line not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Water line updated successfully'
        });

    } catch (error) {
        logger.error(`Error in updateWaterLine: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function deleteWaterLine(req, res, next) {
    try {
        const { id } = req.params;

        // Проверяем, есть ли связанные здания
        const checkQuery = 'SELECT COUNT(*) FROM buildings WHERE cold_water_line_id = $1 OR hot_water_line_id = $1';
        const checkResult = await pool.query(checkQuery, [id]);

        if (parseInt(checkResult.rows[0].count) > 0) {
            return next(createError('Cannot delete water line: it has connected buildings', 400));
        }

        const query = 'DELETE FROM water_lines WHERE line_id = $1 RETURNING *';
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return next(createError('Water line not found', 404));
        }

        res.json({
            success: true,
            message: 'Water line deleted successfully'
        });

    } catch (error) {
        logger.error(`Error in deleteWaterLine: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function batchWaterLinesOperation(req, res, next) {
    try {
        const { action, ids, data } = req.body;

        if (!action || !ids || !Array.isArray(ids)) {
            return next(createError('Action and ids array are required', 400));
        }

        let result;
        switch (action) {
            case 'delete': {
                // Проверяем, есть ли связанные здания
                const checkQuery = 'SELECT building_id FROM buildings WHERE cold_water_line_id = ANY($1) OR hot_water_line_id = ANY($1)';
                const checkResult = await pool.query(checkQuery, [ids]);

                if (checkResult.rows.length > 0) {
                    return next(createError('Cannot delete water lines: some have connected buildings', 400));
                }

                const deleteQuery = 'DELETE FROM water_lines WHERE line_id = ANY($1) RETURNING line_id';
                result = await pool.query(deleteQuery, [ids]);
                break;
            }

            case 'update_status': {
                if (!data || !data.status) {
                    return next(createError('status is required for update_status action', 400));
                }
                const updateStatusQuery = 'UPDATE water_lines SET status = $1, updated_at = NOW() WHERE line_id = ANY($2) RETURNING line_id';
                result = await pool.query(updateStatusQuery, [data.status, ids]);
                break;
            }

            case 'set_maintenance': {
                const maintenanceQuery = 'UPDATE water_lines SET status = \'maintenance\', updated_at = NOW() WHERE line_id = ANY($1) RETURNING line_id';
                result = await pool.query(maintenanceQuery, [ids]);
                break;
            }

            default:
                return next(createError(`Unknown action: ${action}`, 400));
        }

        res.json({
            success: true,
            message: `Batch ${action} completed`,
            affected: result.rows.length
        });

    } catch (error) {
        logger.error(`Error in batchWaterLinesOperation: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

module.exports = {
    getOptimizedWaterLines,
    createWaterLine,
    getWaterLineById,
    updateWaterLine,
    deleteWaterLine,
    batchWaterLinesOperation
};
