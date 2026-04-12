const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder, validatePagination, validateSearchString } = require('../../utils/queryValidation');

/**
 * Admin heat-source operations: optimized list, full CRUD.
 */

async function getOptimizedHeatSources(req, res, next) {
    try {
        const {
            page = 1,
            limit = 50,
            sort = 'source_id',
            order = 'asc',
            search,
            source_type,
            status
        } = req.query;

        const { validSort, validOrder } = validateSortOrder('heat_sources', sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);
        validateSearchString(search);

        let query = 'SELECT * FROM heat_sources';
        let countQuery = 'SELECT COUNT(*) FROM heat_sources';
        let params = [];
        let whereConditions = [];

        if (search) {
            whereConditions.push('name ILIKE $' + (params.length + 1));
            params.push(`%${search}%`);
        }
        if (source_type) {
            whereConditions.push('source_type = $' + (params.length + 1));
            params.push(source_type);
        }
        if (status) {
            whereConditions.push('status = $' + (params.length + 1));
            params.push(status);
        }

        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ` ORDER BY ${validSort} ${validOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limitNum, offset);

        const [dataResult, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, params.slice(0, -2))
        ]);

        res.json({
            data: dataResult.rows,
            pagination: {
                total: parseInt(countResult.rows[0].count),
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
            }
        });

    } catch (error) {
        logger.error(`Error in getOptimizedHeatSources: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function createHeatSource(req, res, next) {
    try {
        const {
            name, address, latitude, longitude, source_type,
            capacity_mw, fuel_type, installation_date,
            status = 'active', maintenance_contact, notes
        } = req.body;

        if (!name || !latitude || !longitude || !source_type) {
            return next(createError('Name, latitude, longitude, and source_type are required', 400));
        }

        const query = `
            INSERT INTO heat_sources
            (id, name, address, latitude, longitude, source_type, capacity_mw,
             fuel_type, installation_date, status, maintenance_contact, notes)
            VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `;

        const result = await pool.query(query, [
            name, address, latitude, longitude, source_type, capacity_mw,
            fuel_type, installation_date, status, maintenance_contact, notes
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: 'Heat source created successfully'
        });

    } catch (error) {
        logger.error(`Error in createHeatSource: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function getHeatSourceById(req, res, next) {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM heat_sources WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return next(createError('Heat source not found', 404));
        }

        res.json({ success: true, data: result.rows[0] });

    } catch (error) {
        logger.error(`Error in getHeatSourceById: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function updateHeatSource(req, res, next) {
    try {
        const { id } = req.params;
        const {
            name, address, latitude, longitude, source_type,
            capacity_mw, fuel_type, installation_date,
            status, maintenance_contact, notes
        } = req.body;

        const updateFields = [];
        const params = [];
        let paramIndex = 1;

        if (name !== undefined) { updateFields.push(`name = $${paramIndex++}`); params.push(name); }
        if (address !== undefined) { updateFields.push(`address = $${paramIndex++}`); params.push(address); }
        if (latitude !== undefined) { updateFields.push(`latitude = $${paramIndex++}`); params.push(latitude); }
        if (longitude !== undefined) { updateFields.push(`longitude = $${paramIndex++}`); params.push(longitude); }
        if (source_type !== undefined) { updateFields.push(`source_type = $${paramIndex++}`); params.push(source_type); }
        if (capacity_mw !== undefined) { updateFields.push(`capacity_mw = $${paramIndex++}`); params.push(capacity_mw); }
        if (fuel_type !== undefined) { updateFields.push(`fuel_type = $${paramIndex++}`); params.push(fuel_type); }
        if (installation_date !== undefined) { updateFields.push(`installation_date = $${paramIndex++}`); params.push(installation_date); }
        if (status !== undefined) { updateFields.push(`status = $${paramIndex++}`); params.push(status); }
        if (maintenance_contact !== undefined) { updateFields.push(`maintenance_contact = $${paramIndex++}`); params.push(maintenance_contact); }
        if (notes !== undefined) { updateFields.push(`notes = $${paramIndex++}`); params.push(notes); }

        if (updateFields.length === 0) {
            return next(createError('No fields to update', 400));
        }

        params.push(id);

        const query = `
            UPDATE heat_sources
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return next(createError('Heat source not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0],
            message: 'Heat source updated successfully'
        });

    } catch (error) {
        logger.error(`Error in updateHeatSource: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function deleteHeatSource(req, res, next) {
    try {
        const { id } = req.params;

        const query = 'DELETE FROM heat_sources WHERE id = $1 RETURNING *';
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return next(createError('Heat source not found', 404));
        }

        res.json({ success: true, message: 'Heat source deleted successfully' });

    } catch (error) {
        logger.error(`Error in deleteHeatSource: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

module.exports = {
    getOptimizedHeatSources,
    createHeatSource,
    getHeatSourceById,
    updateHeatSource,
    deleteHeatSource
};
