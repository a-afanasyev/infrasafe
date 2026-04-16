const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const { buildUpdateQuery } = require('../../utils/dynamicUpdateBuilder');

/**
 * Admin water-line operations: optimized list, full CRUD, batch ops.
 *
 * WaterLine is the most JOIN-heavy list endpoint — the builder uses
 * selectSql + groupBy to aggregate connected buildings. Update retains
 * a small pre-pass to JSON.stringify the main_path / branches JSONB
 * fields before handing over to buildUpdateQuery.
 *
 * Delete keeps its custom pre-check for connected buildings (gotcha
 * noted in the Phase 5 plan — not refactored).
 */

const LIST_CONFIG = {
    table: 'water_lines',
    entityType: 'water_lines',
    tableAlias: 'wl',
    defaultSort: 'line_id',
    defaultLimit: 50,
    selectSql: `
        wl.*,
        COUNT(DISTINCT b.building_id) AS connected_buildings_count,
        ARRAY_AGG(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) AS connected_buildings
        FROM water_lines wl
        LEFT JOIN buildings b ON (wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id)
    `,
    groupBy: 'GROUP BY wl.line_id',
    searchColumns: ['wl.name'],
    filters: [
        { param: 'type',         column: 'wl.name',        kind: 'like' }, // legacy alias
        { param: 'status',       column: 'wl.status',      kind: 'exact' },
        { param: 'material',     column: 'wl.material',    kind: 'like' },
        { param: 'diameter_min', column: 'wl.diameter_mm', kind: 'gte', cast: 'int' },
        { param: 'diameter_max', column: 'wl.diameter_mm', kind: 'lte', cast: 'int' },
    ],
};

async function getOptimizedWaterLines(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getOptimizedWaterLines: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

async function createWaterLine(req, res, next) {
    try {
        const {
            name, description, diameter_mm, material, pressure_bar,
            installation_date, status = 'active',
            latitude_start, longitude_start, latitude_end, longitude_end,
            main_path, branches
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
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error(`Error in getWaterLineById: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

const WATER_LINE_UPDATE_FIELDS = [
    'name', 'description', 'diameter_mm', 'material', 'pressure_bar',
    'installation_date', 'status',
    'latitude_start', 'longitude_start', 'latitude_end', 'longitude_end',
    'main_path', 'branches',
];

async function updateWaterLine(req, res, next) {
    try {
        const { id } = req.params;

        // Pre-transform JSONB-bound fields so the builder can treat them
        // as plain strings. Keeping this here preserves the existing DB
        // contract (store stringified JSON) without leaking it into the
        // generic builder.
        const fields = { ...req.body };
        if (fields.main_path !== undefined) fields.main_path = JSON.stringify(fields.main_path);
        if (fields.branches  !== undefined) fields.branches  = JSON.stringify(fields.branches);

        let query, params;
        try {
            ({ query, params } = buildUpdateQuery(
                'water_lines', 'line_id', id, fields, WATER_LINE_UPDATE_FIELDS
            ));
        } catch (e) {
            if (e.message === 'No valid fields to update') {
                return next(createError('No fields to update', 400));
            }
            throw e;
        }

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

        // Dependency check — intentionally preserved, not refactored.
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
        res.json({ success: true, message: 'Water line deleted successfully' });
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
                const maintenanceQuery = "UPDATE water_lines SET status = 'maintenance', updated_at = NOW() WHERE line_id = ANY($1) RETURNING line_id";
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
