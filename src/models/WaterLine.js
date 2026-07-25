const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');
const { buildUpdateQuery } = require('../utils/dynamicUpdateBuilder');
const { validateSearchString } = require('../utils/queryValidation');

// [AUD-009] Columns writable on create/update and which of them are jsonb.
const WATER_LINE_JSON_COLUMNS = new Set(['main_path', 'branches']);
const WATER_LINE_WRITABLE_COLUMNS = [
    'name', 'description', 'diameter_mm', 'material', 'pressure_bar',
    'installation_date', 'status', 'main_path', 'branches',
    'latitude_start', 'longitude_start', 'latitude_end', 'longitude_end',
];

// [M-12] Домен статуса водной линии. Источник истины — UI-селектор
// frontend-html/admin.html (active / maintenance / inactive); ветка
// set_maintenance в admin-контроллере пишет MAINTENANCE.
const WATER_LINE_STATUS = Object.freeze({
    ACTIVE: 'active',
    MAINTENANCE: 'maintenance',
    INACTIVE: 'inactive',
});
const ALLOWED_STATUSES = Object.freeze(Object.values(WATER_LINE_STATUS));

/**
 * [M-12] Бросает 400, если статус вне домена. `undefined`/`null` пропускаются
 * осознанно — колонка nullable с DEFAULT 'active', отсутствие поля означает
 * «не меняем».
 * @param {*} status
 */
function assertValidStatus(status) {
    if (status === undefined || status === null) return;
    if (!ALLOWED_STATUSES.includes(status)) {
        throw createError(
            `Invalid status: allowed values are ${ALLOWED_STATUSES.join(', ')}`,
            400
        );
    }
}

class WaterLine {
    constructor(data) {
        this.line_id = data.line_id;
        this.name = data.name;
        this.description = data.description;
        this.diameter_mm = data.diameter_mm;
        this.material = data.material;
        this.pressure_bar = data.pressure_bar;
        this.installation_date = data.installation_date;
        this.status = data.status;
        this.latitude_start = data.latitude_start;
        this.longitude_start = data.longitude_start;
        this.latitude_end = data.latitude_end;
        this.longitude_end = data.longitude_end;
        this.main_path = data.main_path;
        this.branches = data.branches;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.connected_buildings = data.connected_buildings || [];
    }

    // Получить все линии водоснабжения с пагинацией и списком обслуживаемых зданий
    static async findAll(page = 1, limit = 10, filters = {}) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            let values = [];
            let paramCount = 0;

            // Построение WHERE клаузы для фильтров
            const conditions = [];

            if (filters.name) {
                // [M-8] escape ILIKE wildcards (%, _) so a name containing them
                // is matched literally instead of acting as a pattern.
                paramCount++;
                conditions.push(`wl.name ILIKE $${paramCount}`);
                values.push(`%${validateSearchString(filters.name)}%`);
            }

            if (filters.status) {
                paramCount++;
                conditions.push(`wl.status = $${paramCount}`);
                values.push(filters.status);
            }

            if (filters.material) {
                paramCount++;
                conditions.push(`wl.material = $${paramCount}`);
                values.push(filters.material);
            }

            if (conditions.length > 0) {
                whereClause = 'WHERE ' + conditions.join(' AND ');
            }

            // Запрос для получения общего количества
            const countQuery = `SELECT COUNT(*) FROM water_lines wl ${whereClause}`;
            const countResult = await db.query(countQuery, values);
            const total = parseInt(countResult.rows[0].count);

            // Запрос для получения данных с пагинацией и списком зданий
            const dataQuery = `
                SELECT
                    wl.*,
                    COALESCE(
                        array_agg(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL),
                        '{}'
                    ) as connected_buildings
                FROM water_lines wl
                LEFT JOIN buildings b ON wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id
                ${whereClause}
                GROUP BY wl.line_id
                ORDER BY wl.line_id
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `;
            values.push(limit, offset);

            const { rows } = await db.query(dataQuery, values);

            return {
                data: rows.map(row => new WaterLine(row)),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in WaterLine.findAll: ${error.message}`);
            throw createError(`Failed to fetch water lines: ${error.message}`, 500);
        }
    }

    // Получить линию по ID
    static async findById(id) {
        try {
            const { rows } = await db.query(
                `SELECT
                    wl.*,
                    COALESCE(
                        array_agg(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL),
                        '{}'
                    ) as connected_buildings
                FROM water_lines wl
                LEFT JOIN buildings b ON wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id
                WHERE wl.line_id = $1
                GROUP BY wl.line_id`,
                [id]
            );

            if (!rows.length) {
                return null;
            }

            return new WaterLine(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterLine.findById: ${error.message}`);
            throw createError(`Failed to fetch water line: ${error.message}`, 500);
        }
    }

    // Создать новую линию водоснабжения.
    // [AUD-009] Поля включаются по присутствию (`!== undefined`) — как в update();
    // прежняя truthiness-проверка `name`/`main_path`/`branches` и пустое тело
    // приводили к 500. jsonb-колонки сериализуются; отсутствующие опускаются.
    static async create(lineData) {
        try {
            assertValidStatus(lineData.status);   // [M-12]
            const fields = [];
            const values = [];
            for (const col of WATER_LINE_WRITABLE_COLUMNS) {
                const v = lineData[col];
                if (v === undefined) continue;
                fields.push(col);
                values.push(WATER_LINE_JSON_COLUMNS.has(col) ? JSON.stringify(v) : v);
            }
            if (fields.length === 0) {
                throw createError('No fields provided to create water line', 400);
            }

            const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
            const { rows } = await db.query(
                `INSERT INTO water_lines (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
                values
            );

            logger.info(`Created water line: ${lineData.name}`);
            return new WaterLine(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterLine.create: ${error.message}`);
            if (error.statusCode) throw error;
            throw createError(`Failed to create water line: ${error.message}`, 500);
        }
    }

    // Обновить линию водоснабжения.
    // [AUD-009] Делегирует построение SET в общий buildUpdateQuery; пустое тело → 400.
    static async update(id, lineData) {
        try {
            assertValidStatus(lineData.status);   // [M-12]
            const fields = { ...lineData };
            for (const col of WATER_LINE_JSON_COLUMNS) {
                if (fields[col] !== undefined) fields[col] = JSON.stringify(fields[col]);
            }

            let query, params;
            try {
                ({ query, params } = buildUpdateQuery('water_lines', 'line_id', id, fields, WATER_LINE_WRITABLE_COLUMNS));
            } catch (e) {
                if (e.message === 'No valid fields to update') {
                    throw createError('No valid fields to update water line', 400);
                }
                throw e;
            }

            const { rows } = await db.query(query, params);
            if (!rows.length) {
                return null;
            }

            logger.info(`Updated water line with ID: ${id}`);
            return new WaterLine(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterLine.update: ${error.message}`);
            if (error.statusCode) throw error;
            throw createError(`Failed to update water line: ${error.message}`, 500);
        }
    }

    // Удалить линию водоснабжения
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM water_lines WHERE line_id = $1 RETURNING *',
                [id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Deleted water line with ID: ${id}`);
            return new WaterLine(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterLine.delete: ${error.message}`);
            throw createError(`Failed to delete water line: ${error.message}`, 500);
        }
    }

    static async findSuppliersForLine(lineId) {
        try {
            const { rows } = await db.query(
                `SELECT DISTINCT ws.* FROM water_suppliers ws
                 JOIN buildings b ON (ws.supplier_id = b.cold_water_supplier_id OR ws.supplier_id = b.hot_water_supplier_id)
                 WHERE b.cold_water_line_id = $1 OR b.hot_water_line_id = $1`,
                [lineId]
            );
            return rows;
        } catch (error) {
            logger.error(`Error in WaterLine.findSuppliersForLine: ${error.message}`);
            throw createError(`Failed to fetch suppliers for line: ${error.message}`, 500);
        }
    }

    // Найти линию обслуживающую здание
    static async findByBuildingId(buildingId) {
        try {
            const { rows } = await db.query(
                `SELECT wl.* FROM water_lines wl
                 JOIN buildings b ON wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id
                 WHERE b.building_id = $1`,
                [buildingId]
            );

            return rows.length ? new WaterLine(rows[0]) : null;
        } catch (error) {
            logger.error(`Error in WaterLine.findByBuildingId: ${error.message}`);
            throw createError(`Failed to fetch water line by building: ${error.message}`, 500);
        }
    }
}

module.exports = WaterLine;
// [M-12] Дополняем дефолтный экспорт, не заменяя его — WaterLine остаётся
// callable как `require('../models/WaterLine')`.
module.exports.WATER_LINE_STATUS = WATER_LINE_STATUS;
module.exports.ALLOWED_STATUSES = ALLOWED_STATUSES;
module.exports.assertValidStatus = assertValidStatus;
