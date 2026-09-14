const pool = require('../../config/database');
const logger = require('../../utils/logger');
const { createError, toClientError } = require('../../utils/helpers');
const { buildPaginatedList } = require('../../utils/adminQueryBuilder');
const WaterLine = require('../../models/WaterLine');
const { WATER_LINE_STATUS } = require('../../models/WaterLine');
const { sendSuccess } = require('../../utils/apiResponse');

/**
 * Admin water-line operations: optimized list, full CRUD, batch ops.
 *
 * WaterLine is the most JOIN-heavy list endpoint — the builder uses
 * selectSql + groupBy to aggregate connected buildings. Update retains
 * a small pre-pass to JSON.stringify the main_path / branches JSONB
 * fields before handing over to buildUpdateQuery.
 *
 * [AR-3(б)] SQL здесь не пишется: пакетные операции и проверка связанных
 * зданий ушли в модель (`WaterLine.deleteMany` / `updateStatusMany` /
 * `findConnectedBuildingIds`). Сама проверка осталась ветвлением КОНТРОЛЛЕРА,
 * а не частью delete в модели: запрет на удаление линии с потребителями
 * действует только на admin-пути, и втягивание его в модель навесило бы тот же
 * запрет обычному `DELETE /api/water-lines/:id`, где его сегодня нет.
 *
 * [M-12] `status` пишется тремя путями этого файла (create / update /
 * batch update_status) — домен проверяется assertValidStatus внутри модели на
 * всех трёх. Catch-блоки пропускают наружу ТОЛЬКО 4xx: 5xx схлопывается в
 * generic 500, чтобы не утёк внутренний текст ошибки.
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

        // [AR-3(б)] Проверка связанных зданий остаётся ветвлением ЭТОГО пути —
        // см. шапку файла. В модель ушёл только запрос.
        const connected = await WaterLine.findConnectedBuildingIds([id]);
        if (connected.length > 0) {
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
                const connected = await WaterLine.findConnectedBuildingIds(ids);
                if (connected.length > 0) {
                    return next(createError('Cannot delete water lines: some have connected buildings', 400));
                }
                result = await WaterLine.deleteMany(ids);
                break;
            }
            case 'update_status': {
                if (!data || !data.status) {
                    return next(createError('status is required for update_status action', 400));
                }
                // [M-12] Домен проверяет сама модель.
                result = await WaterLine.updateStatusMany(ids, data.status);
                break;
            }
            case 'set_maintenance': {
                // [M-12] Значение — из общего домена, а не литералом.
                result = await WaterLine.updateStatusMany(ids, WATER_LINE_STATUS.MAINTENANCE);
                break;
            }
            default:
                return next(createError(`Unknown action: ${action}`, 400));
        }

        res.json({
            success: true,
            message: `Batch ${action} completed`,
            affected: result.length
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
