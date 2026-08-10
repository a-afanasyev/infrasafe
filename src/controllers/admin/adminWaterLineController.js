const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError, toClientError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const WaterLine = require('../../models/WaterLine');
// [AR-3(б)] `assertValidStatus` остался нужен ТОЛЬКО пакетной операции
// update_status: она пишет напрямую (модель не умеет bulk), и без явной
// проверки whitelist M-12 на этом пути обходился бы.
const { WATER_LINE_STATUS, assertValidStatus } = require('../../models/WaterLine');
const { sendSuccess } = require('../../utils/apiResponse');

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
 *
 * [M-12] `status` пишется тремя путями этого файла (create / update /
 * batch update_status) — каждый проверяется assertValidStatus. Catch-блоки
 * пропускают наружу ТОЛЬКО 4xx: 5xx схлопывается в generic 500, чтобы не
 * утёк внутренний текст ошибки.
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
        // [AR-4] Раньше уходило `{data, pagination}` без `success` — пятая форма
        // конверта, которую потребитель узнавал по отсутствию ключа. Изменение
        // аддитивное: путь чтения `body.data` на фронте не меняется.
        sendSuccess(res, result.data, { pagination: result.pagination });
    } catch (error) {
        logger.error(`Error in getOptimizedWaterLines: ${error.message}`);
        next(toClientError(error));
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
        // [AR-3(б)] Явный вызов assertValidStatus отсюда убран: `WaterLine.create`
        // делает его сам (M-12), и ручной импорт проверки в контроллер был именно
        // тем симптомом, из-за которого пункт заведён. Ответ не меняется — 400
        // с тем же текстом, просто рождённый на слой ниже.

        // [AR-3(б)] Через модель. Сериализацию jsonb она делает сама
        // (WATER_LINE_JSON_COLUMNS) — здесь этого знания больше нет.
        const created = await WaterLine.create({
            name, description, diameter_mm, material, pressure_bar, installation_date, status,
            latitude_start, longitude_start, latitude_end, longitude_end, main_path, branches
        });

        res.status(201).json({
            success: true,
            data: created,
            message: 'Water line created successfully'
        });
    } catch (error) {
        logger.error(`Error in createWaterLine: ${error.message}`);
        next(toClientError(error));
    }
}

async function getWaterLineById(req, res, next) {
    try {
        const { id } = req.params;
        // [AR-3(б)] `WaterLine.findById` делает тот же LEFT JOIN и отдаёт
        // `connected_buildings`. Поле `connected_buildings_count` уходит из
        // ответа ДЕТАЛЬНОЙ карточки. Во фронте оно не читается ни разу
        // (`grep connected_buildings_count public/` — пусто); единственная
        // ссылка была в юнит-тесте, и та лишь повторяла форму прежнего
        // запроса, а не проверяла чьё-то ожидание. Длина массива имён даёт
        // то же число. В ЛИСТИНГЕ счётчик остаётся — там он считается
        // агрегатом по всей выборке и его убирать незачем.
        const waterLine = await WaterLine.findById(id);

        if (!waterLine) {
            return next(createError('Water line not found', 404));
        }
        res.json({ success: true, data: waterLine });
    } catch (error) {
        logger.error(`Error in getWaterLineById: ${error.message}`);
        next(toClientError(error));
    }
}

// [AR-3(б)] Здесь были: свой белый список колонок, своя сериализация jsonb и
// свой вызов assertValidStatus. Всё три переехали в модель — она и раньше
// делала ровно это для обычного `PUT /api/water-lines/:id`. Двойной путь
// записи в `water_lines`, с которого начинался пункт, закрыт.
async function updateWaterLine(req, res, next) {
    try {
        const { id } = req.params;
        const updated = await WaterLine.update(id, req.body);

        if (!updated) {
            return next(createError('Water line not found', 404));
        }
        res.json({
            success: true,
            data: updated,
            message: 'Water line updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateWaterLine: ${error.message}`);
        next(toClientError(error));
    }
}

async function deleteWaterLine(req, res, next) {
    try {
        const { id } = req.params;

        // [AR-3(б)] Проверка связанных зданий ОСТАЁТСЯ здесь намеренно: она
        // спрашивает `buildings`, а не `water_lines`, и перенос её в модель
        // добавил бы этот запрет обычному `DELETE /api/water-lines/:id`, где
        // его сегодня нет. Менять поведение чужого маршрута под предлогом
        // рефактора admin-пути неправильно — это отдельное решение.
        const checkQuery = 'SELECT COUNT(*) FROM buildings WHERE cold_water_line_id = $1 OR hot_water_line_id = $1';
        const checkResult = await pool.query(checkQuery, [id]);
        if (parseInt(checkResult.rows[0].count) > 0) {
            return next(createError('Cannot delete water line: it has connected buildings', 400));
        }

        const deleted = await WaterLine.delete(id);
        if (!deleted) {
            return next(createError('Water line not found', 404));
        }
        res.json({ success: true, message: 'Water line deleted successfully' });
    } catch (error) {
        logger.error(`Error in deleteWaterLine: ${error.message}`);
        next(toClientError(error));
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
                assertValidStatus(data.status);   // [M-12]
                const updateStatusQuery = 'UPDATE water_lines SET status = $1, updated_at = NOW() WHERE line_id = ANY($2) RETURNING line_id';
                result = await pool.query(updateStatusQuery, [data.status, ids]);
                break;
            }
            case 'set_maintenance': {
                // [M-12] Значение — из общего домена, параметром, а не литералом.
                const maintenanceQuery = 'UPDATE water_lines SET status = $1, updated_at = NOW() WHERE line_id = ANY($2) RETURNING line_id';
                result = await pool.query(maintenanceQuery, [WATER_LINE_STATUS.MAINTENANCE, ids]);
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
        next(toClientError(error));
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
