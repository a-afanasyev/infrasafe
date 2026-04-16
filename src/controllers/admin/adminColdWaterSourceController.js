const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const { buildUpdateQuery } = require('../../utils/dynamicUpdateBuilder');

/**
 * Admin cold-water source operations: optimized list, full CRUD.
 * UUID PK; list / update share the Phase 5 builders.
 */

const LIST_CONFIG = {
    table: 'cold_water_sources',
    entityType: 'water_sources',
    defaultSort: 'id',
    defaultLimit: 50,
    searchColumns: ['name'],
    filters: [
        { param: 'source_type', kind: 'exact' },
        { param: 'status',      kind: 'exact' },
    ],
};

async function getOptimizedColdWaterSources(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getOptimizedColdWaterSources: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function createColdWaterSource(req, res, next) {
    try {
        const {
            name, address, latitude, longitude, source_type,
            capacity_m3_per_hour, operating_pressure_bar, installation_date,
            status = 'active', maintenance_contact, notes
        } = req.body;

        if (!name) {
            return next(createError('Name is required', 400));
        }

        const query = `
            INSERT INTO cold_water_sources
            (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour,
             operating_pressure_bar, installation_date, status, maintenance_contact, notes)
            VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
        `;
        const result = await pool.query(query, [
            name, address, latitude, longitude, source_type, capacity_m3_per_hour,
            operating_pressure_bar, installation_date, status, maintenance_contact, notes
        ]);

        res.status(201).json({
            success: true,
            data: result.rows[0],
            message: 'Cold water source created successfully'
        });
    } catch (error) {
        logger.error(`Error in createColdWaterSource: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function getColdWaterSourceById(req, res, next) {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM cold_water_sources WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return next(createError('Cold water source not found', 404));
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error(`Error in getColdWaterSourceById: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

const CWS_UPDATE_FIELDS = [
    'name', 'address', 'latitude', 'longitude', 'source_type',
    'capacity_m3_per_hour', 'operating_pressure_bar', 'installation_date',
    'status', 'maintenance_contact', 'notes',
];

async function updateColdWaterSource(req, res, next) {
    try {
        const { id } = req.params;
        let query, params;
        try {
            ({ query, params } = buildUpdateQuery(
                'cold_water_sources', 'id', id, req.body, CWS_UPDATE_FIELDS
            ));
        } catch (e) {
            if (e.message === 'No valid fields to update') {
                return next(createError('No fields to update', 400));
            }
            throw e;
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            return next(createError('Cold water source not found', 404));
        }
        res.json({
            success: true,
            data: result.rows[0],
            message: 'Cold water source updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateColdWaterSource: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function deleteColdWaterSource(req, res, next) {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM cold_water_sources WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return next(createError('Cold water source not found', 404));
        }
        res.json({ success: true, message: 'Cold water source deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteColdWaterSource: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

module.exports = {
    getOptimizedColdWaterSources,
    createColdWaterSource,
    getColdWaterSourceById,
    updateColdWaterSource,
    deleteColdWaterSource
};
