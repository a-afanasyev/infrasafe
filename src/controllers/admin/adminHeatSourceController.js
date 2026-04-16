const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const { buildUpdateQuery } = require('../../utils/dynamicUpdateBuilder');

/**
 * Admin heat-source operations: optimized list, full CRUD.
 * UUID PK; list / update share the Phase 5 builders.
 */

const LIST_CONFIG = {
    table: 'heat_sources',
    entityType: 'heat_sources',
    defaultSort: 'id',
    defaultLimit: 50,
    searchColumns: ['name'],
    filters: [
        { param: 'source_type', kind: 'exact' },
        { param: 'status',      kind: 'exact' },
    ],
};

async function getOptimizedHeatSources(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
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

const HEAT_UPDATE_FIELDS = [
    'name', 'address', 'latitude', 'longitude', 'source_type',
    'capacity_mw', 'fuel_type', 'installation_date',
    'status', 'maintenance_contact', 'notes',
];

async function updateHeatSource(req, res, next) {
    try {
        const { id } = req.params;
        let query, params;
        try {
            ({ query, params } = buildUpdateQuery(
                'heat_sources', 'id', id, req.body, HEAT_UPDATE_FIELDS
            ));
        } catch (e) {
            if (e.message === 'No valid fields to update') {
                return next(createError('No fields to update', 400));
            }
            throw e;
        }

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
        const result = await pool.query(
            'DELETE FROM heat_sources WHERE id = $1 RETURNING *',
            [id]
        );
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
