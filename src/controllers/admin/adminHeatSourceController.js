const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError, toClientError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const HeatSource = require('../../models/HeatSource');
const { sendSuccess } = require('../../utils/apiResponse');

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
        // [AR-4] Раньше уходило `{data, pagination}` без `success` — пятая форма
        // конверта, которую потребитель узнавал по отсутствию ключа. Изменение
        // аддитивное: путь чтения `body.data` на фронте не меняется.
        sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error) {
        logger.error(`Error in getOptimizedHeatSources: ${error.message}`);
        next(toClientError(error));
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

        // [AR-3(б)] Через модель, а не сырым INSERT. UUID генерирует модель.
        const created = await HeatSource.create({
            name, address, latitude, longitude, source_type, capacity_mw,
            fuel_type, installation_date, status, maintenance_contact, notes
        });

        res.status(201).json({
            success: true,
            data: created,
            message: 'Heat source created successfully'
        });
    } catch (error) {
        logger.error(`Error in createHeatSource: ${error.message}`);
        next(toClientError(error));
    }
}

async function getHeatSourceById(req, res, next) {
    try {
        const { id } = req.params;
        const source = await HeatSource.findById(id);

        if (!source) {
            return next(createError('Heat source not found', 404));
        }
        res.json({ success: true, data: source });
    } catch (error) {
        logger.error(`Error in getHeatSourceById: ${error.message}`);
        next(toClientError(error));
    }
}

// [AR-3(б)] Белый список колонок переехал в модель (`updateColumns`) —
// см. adminColdWaterSourceController.
async function updateHeatSource(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await HeatSource.update(id, req.body);
        if (!updated) {
            return next(createError('Heat source not found', 404));
        }
        res.json({
            success: true,
            data: updated,
            message: 'Heat source updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateHeatSource: ${error.message}`);
        next(toClientError(error));
    }
}

async function deleteHeatSource(req, res, next) {
    try {
        const { id } = req.params;
        // [AUD-008] delegate to model; deleted row not serialized to client.
        const deleted = await HeatSource.delete(id);
        if (!deleted) {
            return next(createError('Heat source not found', 404));
        }
        res.json({ success: true, message: 'Heat source deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteHeatSource: ${error.message}`);
        next(toClientError(error));
    }
}

module.exports = {
    getOptimizedHeatSources,
    createHeatSource,
    getHeatSourceById,
    updateHeatSource,
    deleteHeatSource
};
