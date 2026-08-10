const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');
const { buildUpdateQuery } = require('../utils/dynamicUpdateBuilder');
const { validateSearchString } = require('../utils/queryValidation');

// [AUD-009] Columns writable on create/update and which of them are jsonb.
const LINE_JSON_COLUMNS = new Set(['main_path', 'branches']);
const LINE_WRITABLE_COLUMNS = [
    'name', 'voltage_kv', 'length_km', 'transformer_id',
    'main_path', 'branches', 'cable_type', 'commissioning_year',
    'latitude_start', 'longitude_start', 'latitude_end', 'longitude_end',
];

class Line {
    constructor(data) {
        this.line_id = data.line_id;
        this.name = data.name;
        this.voltage_kv = data.voltage_kv;
        this.length_km = data.length_km;
        this.transformer_id = data.transformer_id;
        // [AR-3(б)] Асимметрия, обнаруженная при переводе admin-контроллеров на
        // модель: эти четыре колонки ЕСТЬ в LINE_WRITABLE_COLUMNS, то есть модель
        // умела их записывать — но не отдавала обратно. Создав линию с
        // координатами через `Line.create`, вызывающий получал объект без них
        // и не мог отличить «не сохранилось» от «не показано».
        this.latitude_start = data.latitude_start;
        this.longitude_start = data.longitude_start;
        this.latitude_end = data.latitude_end;
        this.longitude_end = data.longitude_end;
        this.main_path = data.main_path;
        this.branches = data.branches;
        this.cable_type = data.cable_type;
        this.commissioning_year = data.commissioning_year;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        // Присутствует только у findById (LEFT JOIN); у остальных путей undefined.
        this.transformer_name = data.transformer_name;
    }

    // Получить все линии с пагинацией
    static async findAll(page = 1, limit = 10, filters = {}) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            let values = [];
            let paramCount = 0;

            // Построение WHERE клаузы для фильтров
            const conditions = [];

            if (filters.name) {
                // M-8: escape ILIKE wildcards (%, _) so a name containing them
                // is matched literally instead of acting as a pattern.
                paramCount++;
                conditions.push(`name ILIKE $${paramCount}`);
                values.push(`%${validateSearchString(filters.name)}%`);
            }

            if (filters.voltage_kv) {
                paramCount++;
                conditions.push(`voltage_kv = $${paramCount}`);
                values.push(filters.voltage_kv);
            }

            if (filters.transformer_id) {
                paramCount++;
                conditions.push(`transformer_id = $${paramCount}`);
                values.push(filters.transformer_id);
            }

            if (conditions.length > 0) {
                whereClause = 'WHERE ' + conditions.join(' AND ');
            }

            // Запрос для получения общего количества
            const countQuery = `SELECT COUNT(*) FROM lines ${whereClause}`;
            const countResult = await db.query(countQuery, values);
            const total = parseInt(countResult.rows[0].count);

            // Запрос для получения данных с пагинацией
            const dataQuery = `
                SELECT * FROM lines
                ${whereClause}
                ORDER BY line_id
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `;
            values.push(limit, offset);

            const { rows } = await db.query(dataQuery, values);

            return {
                data: rows.map(row => new Line(row)),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in Line.findAll: ${error.message}`);
            throw createError(`Failed to fetch lines: ${error.message}`, 500);
        }
    }

    // Получить линию по ID
    // [AR-3(б)] JOIN с трансформатором перенесён сюда из admin-контроллера:
    // без него подмена сырого запроса на модель убрала бы `transformer_name`
    // из ответа детальной карточки. Для остальных вызывающих поле аддитивное.
    // Тот же приём уже применён в `WaterLine.findById` (там подтягиваются
    // связанные здания), так что «модель — только плоский CRUD» здесь не догма.
    static async findById(id) {
        try {
            const { rows } = await db.query(
                `SELECT l.*, t.name AS transformer_name
                 FROM lines l
                 LEFT JOIN transformers t ON l.transformer_id = t.transformer_id
                 WHERE l.line_id = $1`,
                [id]
            );

            if (!rows.length) {
                return null;
            }

            return new Line(rows[0]);
        } catch (error) {
            logger.error(`Error in Line.findById: ${error.message}`);
            throw createError(`Failed to fetch line: ${error.message}`, 500);
        }
    }

    // Создать новую линию.
    // [AUD-009] Поля включаются по присутствию (`!== undefined`) — как в update();
    // прежняя truthiness-проверка теряла явный 0 и падала 500 на пустом теле.
    // jsonb-колонки сериализуются; отсутствующие поля опускаются (применяются
    // дефолты PG).
    static async create(lineData) {
        try {
            const fields = [];
            const values = [];
            for (const col of LINE_WRITABLE_COLUMNS) {
                const v = lineData[col];
                if (v === undefined) continue;
                fields.push(col);
                values.push(LINE_JSON_COLUMNS.has(col) ? JSON.stringify(v) : v);
            }
            if (fields.length === 0) {
                throw createError('No fields provided to create line', 400);
            }

            const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
            const { rows } = await db.query(
                `INSERT INTO lines (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
                values
            );

            logger.info(`Created line: ${lineData.name}`);
            return new Line(rows[0]);
        } catch (error) {
            logger.error(`Error in Line.create: ${error.message}`);
            if (error.statusCode) throw error;
            throw createError(`Failed to create line: ${error.message}`, 500);
        }
    }

    // Обновить линию.
    // [AUD-009] Делегирует построение SET в общий buildUpdateQuery (как фабрика
    // CRUD-моделей) — пустое/нераспознанное тело → 400, а не SET-только-updated_at.
    static async update(id, lineData) {
        try {
            const fields = { ...lineData };
            for (const col of LINE_JSON_COLUMNS) {
                if (fields[col] !== undefined) fields[col] = JSON.stringify(fields[col]);
            }

            let query, params;
            try {
                ({ query, params } = buildUpdateQuery('lines', 'line_id', id, fields, LINE_WRITABLE_COLUMNS));
            } catch (e) {
                if (e.message === 'No valid fields to update') {
                    throw createError('No valid fields to update line', 400);
                }
                throw e;
            }

            const { rows } = await db.query(query, params);
            if (!rows.length) {
                return null;
            }

            logger.info(`Updated line with ID: ${id}`);
            return new Line(rows[0]);
        } catch (error) {
            logger.error(`Error in Line.update: ${error.message}`);
            if (error.statusCode) throw error;
            throw createError(`Failed to update line: ${error.message}`, 500);
        }
    }

    // Удалить линию
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM lines WHERE line_id = $1 RETURNING *',
                [id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Deleted line with ID: ${id}`);
            return new Line(rows[0]);
        } catch (error) {
            logger.error(`Error in Line.delete: ${error.message}`);
            throw createError(`Failed to delete line: ${error.message}`, 500);
        }
    }

    // Найти линии по transformer_id
    static async findByTransformerId(transformerId) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM lines WHERE transformer_id = $1',
                [transformerId]
            );

            return rows.map(row => new Line(row));
        } catch (error) {
            logger.error(`Error in Line.findByTransformerId: ${error.message}`);
            throw createError(`Failed to fetch lines by transformer: ${error.message}`, 500);
        }
    }
}

module.exports = Line;