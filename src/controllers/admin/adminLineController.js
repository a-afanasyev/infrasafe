const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const { buildUpdateQuery } = require('../../utils/dynamicUpdateBuilder');
const adminService = require('../../services/adminService');

/**
 * Admin power-line operations: optimized list, full CRUD, batch ops.
 */

const LIST_CONFIG = {
    table: 'lines',
    entityType: 'lines',
    tableAlias: 'l',
    defaultSort: 'line_id',
    defaultLimit: 50,
    selectSql: `
        l.*, t.name AS transformer_name
        FROM lines l
        LEFT JOIN transformers t ON l.transformer_id = t.transformer_id
    `,
    searchColumns: ['l.name'],
    filters: [
        { param: 'voltage_min',    column: 'l.voltage_kv',    kind: 'gte', cast: 'float' },
        { param: 'voltage_max',    column: 'l.voltage_kv',    kind: 'lte', cast: 'float' },
        { param: 'length_min',     column: 'l.length_km',     kind: 'gte', cast: 'float' },
        { param: 'length_max',     column: 'l.length_km',     kind: 'lte', cast: 'float' },
        { param: 'transformer_id', column: 'l.transformer_id', kind: 'exact' },
    ],
    sortAliasMap: { id: 'line_id' },
};

async function getOptimizedLines(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getOptimizedLines: ${error.message}`);
        next(createError('Internal server error', 500));
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
        next(createError('Internal server error', 500));
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
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error(`Error in getLineById: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

const LINE_UPDATE_FIELDS = ['name', 'voltage_kv', 'length_km', 'transformer_id'];

async function updateLine(req, res, next) {
    try {
        const { id } = req.params;
        let query, params;
        try {
            ({ query, params } = buildUpdateQuery(
                'lines', 'line_id', id, req.body, LINE_UPDATE_FIELDS
            ));
        } catch (e) {
            if (e.message === 'No valid fields to update') {
                return next(createError('No fields to update', 400));
            }
            throw e;
        }

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
        next(createError('Internal server error', 500));
    }
}

async function deleteLine(req, res, next) {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM lines WHERE line_id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return next(createError('Line not found', 404));
        }
        res.json({ success: true, message: 'Line deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteLine: ${error.message}`);
        next(createError('Internal server error', 500));
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
        next(createError('Internal server error', 500));
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
