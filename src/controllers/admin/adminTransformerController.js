const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const { buildUpdateQuery } = require('../../utils/dynamicUpdateBuilder');
const adminService = require('../../services/adminService');

/**
 * Admin transformer operations: optimized list, full CRUD, batch ops.
 *
 * Phase 5: list + update share the paginated-list / dynamic-update utils.
 * Custom SELECT keeps the `buildings` join for `building_name`.
 */

const LIST_CONFIG = {
    table: 'transformers',
    entityType: 'transformers',
    tableAlias: 't',
    defaultSort: 'transformer_id',
    defaultLimit: 50,
    selectSql: `
        t.*, b.name AS building_name
        FROM transformers t
        LEFT JOIN buildings b ON t.building_id = b.building_id
    `,
    searchColumns: ['t.name'],
    filters: [
        { param: 'power_min',   column: 't.power_kva',   kind: 'gte', cast: 'float' },
        { param: 'power_max',   column: 't.power_kva',   kind: 'lte', cast: 'float' },
        { param: 'voltage_kv',  column: 't.voltage_kv',  kind: 'exact' },
        { param: 'building_id', column: 't.building_id', kind: 'exact' },
    ],
    // Legacy UI sends sort=id, DB PK is transformer_id
    sortAliasMap: { id: 'transformer_id' },
};

// Note: sort goes through the real column, not the t.alias (validateSortOrder
// whitelist has bare column names). We apply a `t.` prefix below to match
// the pre-refactor behavior for the default transformer_id case.

async function getOptimizedTransformers(req, res, next) {
    try {
        const result = await buildPaginatedList(pool, LIST_CONFIG, req);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getOptimizedTransformers: ${error.message}`);
        next(createError('Internal server error', 500));
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
        next(createError('Internal server error', 500));
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
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error(`Error in getTransformerById: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

const TRANSFORMER_UPDATE_FIELDS = ['name', 'power_kva', 'voltage_kv', 'building_id'];

async function updateTransformer(req, res, next) {
    try {
        const { id } = req.params;
        let query, params;
        try {
            ({ query, params } = buildUpdateQuery(
                'transformers', 'transformer_id', id, req.body, TRANSFORMER_UPDATE_FIELDS
            ));
        } catch (e) {
            if (e.message === 'No valid fields to update') {
                return next(createError('No fields to update', 400));
            }
            throw e;
        }

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
        next(createError('Internal server error', 500));
    }
}

async function deleteTransformer(req, res, next) {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM transformers WHERE transformer_id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return next(createError('Transformer not found', 404));
        }
        res.json({ success: true, message: 'Transformer deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteTransformer: ${error.message}`);
        next(createError('Internal server error', 500));
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
        next(createError('Internal server error', 500));
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
