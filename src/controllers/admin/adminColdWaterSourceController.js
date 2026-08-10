const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError, toClientError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const ColdWaterSource = require('../../models/ColdWaterSource');
const { sendSuccess } = require('../../utils/apiResponse');

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
        // [AR-4] Раньше уходило `{data, pagination}` без `success` — пятая форма
        // конверта, которую потребитель узнавал по отсутствию ключа. Изменение
        // аддитивное: путь чтения `body.data` на фронте не меняется.
        sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error) {
        logger.error(`Error in getOptimizedColdWaterSources: ${error.message}`);
        next(toClientError(error));
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

        // [AR-3(б)] Через модель, а не сырым INSERT. UUID генерирует модель:
        // раньше это делал только этот путь (`gen_random_uuid()` в SQL), из-за
        // чего обычный POST /api/cold-water-sources падал 500-й.
        const created = await ColdWaterSource.create({
            name, address, latitude, longitude, source_type, capacity_m3_per_hour,
            operating_pressure_bar, installation_date, status, maintenance_contact, notes
        });

        res.status(201).json({
            success: true,
            data: created,
            message: 'Cold water source created successfully'
        });
    } catch (error) {
        logger.error(`Error in createColdWaterSource: ${error.message}`);
        next(toClientError(error));
    }
}

async function getColdWaterSourceById(req, res, next) {
    try {
        const { id } = req.params;
        const source = await ColdWaterSource.findById(id);

        if (!source) {
            return next(createError('Cold water source not found', 404));
        }
        res.json({ success: true, data: source });
    } catch (error) {
        logger.error(`Error in getColdWaterSourceById: ${error.message}`);
        next(toClientError(error));
    }
}

// [AR-3(б)] Список разрешённых к обновлению колонок переехал в модель
// (`updateColumns`), и `buildUpdateQuery` вызывается там же. Здесь его больше
// нет намеренно: пока белый список жил в контроллере, admin-путь мог разойтись
// с обычным — ровно то расхождение, из-за которого заведён пункт.
async function updateColdWaterSource(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await ColdWaterSource.update(id, req.body);

        if (!updated) {
            return next(createError('Cold water source not found', 404));
        }
        res.json({
            success: true,
            data: updated,
            message: 'Cold water source updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateColdWaterSource: ${error.message}`);
        next(toClientError(error));
    }
}

async function deleteColdWaterSource(req, res, next) {
    try {
        const { id } = req.params;
        // [AUD-008] delegate to model; deleted row not serialized to client.
        const deleted = await ColdWaterSource.delete(id);
        if (!deleted) {
            return next(createError('Cold water source not found', 404));
        }
        res.json({ success: true, message: 'Cold water source deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteColdWaterSource: ${error.message}`);
        next(toClientError(error));
    }
}

module.exports = {
    getOptimizedColdWaterSources,
    createColdWaterSource,
    getColdWaterSourceById,
    updateColdWaterSource,
    deleteColdWaterSource
};
