const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError, toClientError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const adminService = require('../../services/adminService');
const Transformer = require('../../models/Transformer');
const { sendSuccess } = require('../../utils/apiResponse');

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
        // [AR-4] Раньше уходило `{data, pagination}` без `success` — пятая форма
        // конверта, которую потребитель узнавал по отсутствию ключа. Изменение
        // аддитивное: путь чтения `body.data` на фронте не меняется.
        sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error) {
        logger.error(`Error in getOptimizedTransformers: ${error.message}`);
        next(toClientError(error));
    }
}

async function createTransformer(req, res, next) {
    try {
        const { name, power_kva, voltage_kv } = req.body;

        if (!name || !power_kva || !voltage_kv) {
            return next(createError('Name, power_kva and voltage_kv are required', 400));
        }

        // [AR-3(б)] Через модель. Она принимает и остальные необязательные
        // колонки, но admin-форма шлёт только эти три — поведение не меняется.
        const created = await Transformer.create({ name, power_kva, voltage_kv });

        res.status(201).json({
            success: true,
            data: created,
            message: 'Transformer created successfully'
        });
    } catch (error) {
        logger.error(`Error in createTransformer: ${error.message}`);
        next(toClientError(error));
    }
}

async function getTransformerById(req, res, next) {
    try {
        const { id } = req.params;
        const transformer = await Transformer.findById(id);

        if (!transformer) {
            return next(createError('Transformer not found', 404));
        }
        res.json({ success: true, data: transformer });
    } catch (error) {
        logger.error(`Error in getTransformerById: ${error.message}`);
        next(toClientError(error));
    }
}

// [AR-3(б)] Белый список колонок — в модели (TRANSFORMER_UPDATE_COLUMNS).
async function updateTransformer(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await Transformer.update(id, req.body);

        if (!updated) {
            return next(createError('Transformer not found', 404));
        }
        res.json({
            success: true,
            data: updated,
            message: 'Transformer updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateTransformer: ${error.message}`);
        next(toClientError(error));
    }
}

async function deleteTransformer(req, res, next) {
    try {
        const { id } = req.params;
        // [AUD-008] delegate to model (hits canonical `transformers` table);
        // deleted row is not serialized to the client, so model-instance vs
        // plain-row shape is irrelevant here.
        const deleted = await Transformer.delete(id);
        if (!deleted) {
            return next(createError('Transformer not found', 404));
        }
        res.json({ success: true, message: 'Transformer deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteTransformer: ${error.message}`);
        next(toClientError(error));
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
        next(toClientError(error));
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
