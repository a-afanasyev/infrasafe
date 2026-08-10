const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError, toClientError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const adminService = require('../../services/adminService');
const Line = require('../../models/Line');
const { sendSuccess } = require('../../utils/apiResponse');

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
        // [AR-4] Раньше уходило `{data, pagination}` без `success` — пятая форма
        // конверта, которую потребитель узнавал по отсутствию ключа. Изменение
        // аддитивное: путь чтения `body.data` на фронте не меняется.
        sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error) {
        logger.error(`Error in getOptimizedLines: ${error.message}`);
        next(toClientError(error));
    }
}

async function createLine(req, res, next) {
    try {
        const { name, voltage_kv, length_km, transformer_id } = req.body;

        if (!name || !voltage_kv || !length_km) {
            return next(createError('Name, voltage_kv and length_km are required', 400));
        }

        // [AR-3(б)] Через модель.
        const created = await Line.create({ name, voltage_kv, length_km, transformer_id });

        res.status(201).json({
            success: true,
            data: created,
            message: 'Line created successfully'
        });
    } catch (error) {
        logger.error(`Error in createLine: ${error.message}`);
        next(toClientError(error));
    }
}

async function getLineById(req, res, next) {
    try {
        const { id } = req.params;
        // [AR-3(б)] JOIN с трансформатором переехал в Line.findById, чтобы
        // `transformer_name` не пропал из ответа вместе с сырым запросом.
        const line = await Line.findById(id);

        if (!line) {
            return next(createError('Line not found', 404));
        }
        res.json({ success: true, data: line });
    } catch (error) {
        logger.error(`Error in getLineById: ${error.message}`);
        next(toClientError(error));
    }
}

// [AR-3(б)] ИЗМЕНЕНИЕ ПОВЕДЕНИЯ, отмечено намеренно: белый список admin-пути
// состоял из четырёх колонок (name, voltage_kv, length_km, transformer_id), а
// модель разрешает все двенадцать — включая координаты, cable_type,
// commissioning_year и jsonb-геометрию. Обычный `PUT /api/lines/:id` эти
// двенадцать разрешал и раньше, так что узкий admin-список был не рубежом
// безопасности, а расхождением двух путей записи — тем самым, ради которого
// пункт и заведён. Оба пути теперь сходятся на одном списке.
async function updateLine(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await Line.update(id, req.body);

        if (!updated) {
            return next(createError('Line not found', 404));
        }
        res.json({
            success: true,
            data: updated,
            message: 'Line updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateLine: ${error.message}`);
        next(toClientError(error));
    }
}

async function deleteLine(req, res, next) {
    try {
        const { id } = req.params;
        // [AUD-008] delegate to model; deleted row not serialized to client.
        const deleted = await Line.delete(id);
        if (!deleted) {
            return next(createError('Line not found', 404));
        }
        res.json({ success: true, message: 'Line deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteLine: ${error.message}`);
        next(toClientError(error));
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
        next(toClientError(error));
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
