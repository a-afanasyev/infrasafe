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

// NOTE: the transformers table has no building_id column — the FK lives on
// buildings (primary_transformer_id / backup_transformer_id). The pre-Phase-5
// controller tried to LEFT JOIN buildings on a non-existent column, so that
// path never worked at runtime. This refactor drops the broken JOIN along
// with the building_id filter; if the UI needs associated buildings it
// should query buildings where primary/backup_transformer_id = :id.
const LIST_CONFIG = {
    table: 'transformers',
    entityType: 'transformers',
    tableAlias: 't',
    defaultSort: 'transformer_id',
    defaultLimit: 50,
    searchColumns: ['t.name'],
    filters: [
        { param: 'power_min',  column: 't.power_kva',  kind: 'gte', cast: 'float' },
        { param: 'power_max',  column: 't.power_kva',  kind: 'lte', cast: 'float' },
        { param: 'voltage_kv', column: 't.voltage_kv', kind: 'exact' },
    ],
    sortAliasMap: { id: 'transformer_id' },
};

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
        const { name, power_kva, voltage_kv } = req.body;

        if (!name || !power_kva || !voltage_kv) {
            return next(createError('Name, power_kva and voltage_kv are required', 400));
        }

        const query = `
            INSERT INTO transformers (name, power_kva, voltage_kv)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        const result = await pool.query(query, [name, power_kva, voltage_kv]);

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
        const result = await pool.query(
            'SELECT * FROM transformers WHERE transformer_id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return next(createError('Transformer not found', 404));
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        logger.error(`Error in getTransformerById: ${error.message}`);
        next(createError('Internal server error', 500));
    }
}

const TRANSFORMER_UPDATE_FIELDS = [
    'name', 'power_kva', 'voltage_kv',
    'location', 'latitude', 'longitude', 'manufacturer', 'model', 'status',
    'installation_date',
];

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
