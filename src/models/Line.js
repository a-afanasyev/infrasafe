const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

class Line {
    constructor(data) {
        this.line_id = data.line_id;
        this.name = data.name;
        this.voltage_kv = data.voltage_kv;
        this.length_km = data.length_km;
        this.transformer_id = data.transformer_id;
        this.main_path = data.main_path;
        this.branches = data.branches;
        this.cable_type = data.cable_type;
        this.commissioning_year = data.commissioning_year;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
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
                paramCount++;
                conditions.push(`name ILIKE $${paramCount}`);
                values.push(`%${filters.name}%`);
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
    static async findById(id) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM lines WHERE line_id = $1',
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

    // Создать новую линию
    static async create(lineData) {
        try {
            // Динамическое построение SQL запроса для поддержки всех полей
            const fields = [];
            const values = [];

            // Обязательные поля
            if (lineData.name) { fields.push('name'); values.push(lineData.name); }
            if (lineData.voltage_kv) { fields.push('voltage_kv'); values.push(lineData.voltage_kv); }
            if (lineData.length_km) { fields.push('length_km'); values.push(lineData.length_km); }

            // Опциональные поля
            if (lineData.transformer_id) { fields.push('transformer_id'); values.push(lineData.transformer_id); }
            if (lineData.main_path) { fields.push('main_path'); values.push(JSON.stringify(lineData.main_path)); }
            if (lineData.branches) { fields.push('branches'); values.push(JSON.stringify(lineData.branches)); }
            if (lineData.cable_type) { fields.push('cable_type'); values.push(lineData.cable_type); }
            if (lineData.commissioning_year) { fields.push('commissioning_year'); values.push(lineData.commissioning_year); }
            if (lineData.latitude_start) { fields.push('latitude_start'); values.push(lineData.latitude_start); }
            if (lineData.longitude_start) { fields.push('longitude_start'); values.push(lineData.longitude_start); }
            if (lineData.latitude_end) { fields.push('latitude_end'); values.push(lineData.latitude_end); }
            if (lineData.longitude_end) { fields.push('longitude_end'); values.push(lineData.longitude_end); }

            // Формируем запрос
            const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
            const query = `
                INSERT INTO lines (${fields.join(', ')})
                VALUES (${placeholders})
                RETURNING *
            `;
            
            const { rows } = await db.query(query, values);

            logger.info(`Created line: ${lineData.name}`);
            return new Line(rows[0]);
        } catch (error) {
            logger.error(`Error in Line.create: ${error.message}`);
            throw createError(`Failed to create line: ${error.message}`, 500);
        }
    }

    // Обновить линию
    static async update(id, lineData) {
        try {
            // Динамическое построение SQL запроса для обновления только предоставленных полей
            const updates = [];
            const values = [];
            let paramCount = 0;
            
            // Проверяем каждое поле и добавляем в запрос если оно предоставлено
            if (lineData.name !== undefined) {
                paramCount++;
                updates.push(`name = $${paramCount}`);
                values.push(lineData.name);
            }
            
            if (lineData.voltage_kv !== undefined) {
                paramCount++;
                updates.push(`voltage_kv = $${paramCount}`);
                values.push(lineData.voltage_kv);
            }
            
            if (lineData.length_km !== undefined) {
                paramCount++;
                updates.push(`length_km = $${paramCount}`);
                values.push(lineData.length_km);
            }
            
            if (lineData.transformer_id !== undefined) {
                paramCount++;
                updates.push(`transformer_id = $${paramCount}`);
                values.push(lineData.transformer_id);
            }
            
            if (lineData.main_path !== undefined) {
                paramCount++;
                updates.push(`main_path = $${paramCount}`);
                values.push(JSON.stringify(lineData.main_path));
            }
            
            if (lineData.branches !== undefined) {
                paramCount++;
                updates.push(`branches = $${paramCount}`);
                values.push(JSON.stringify(lineData.branches));
            }
            
            if (lineData.cable_type !== undefined) {
                paramCount++;
                updates.push(`cable_type = $${paramCount}`);
                values.push(lineData.cable_type);
            }
            
            if (lineData.commissioning_year !== undefined) {
                paramCount++;
                updates.push(`commissioning_year = $${paramCount}`);
                values.push(lineData.commissioning_year);
            }
            
            if (lineData.latitude_start !== undefined) {
                paramCount++;
                updates.push(`latitude_start = $${paramCount}`);
                values.push(lineData.latitude_start);
            }
            
            if (lineData.longitude_start !== undefined) {
                paramCount++;
                updates.push(`longitude_start = $${paramCount}`);
                values.push(lineData.longitude_start);
            }
            
            if (lineData.latitude_end !== undefined) {
                paramCount++;
                updates.push(`latitude_end = $${paramCount}`);
                values.push(lineData.latitude_end);
            }
            
            if (lineData.longitude_end !== undefined) {
                paramCount++;
                updates.push(`longitude_end = $${paramCount}`);
                values.push(lineData.longitude_end);
            }
            
            // Всегда обновляем updated_at (без параметра, т.к. используем NOW())
            updates.push(`updated_at = NOW()`);
            
            // ID линии для WHERE
            paramCount++;
            values.push(id);
            
            // Формируем и выполняем запрос
            const query = `
                UPDATE lines
                SET ${updates.join(', ')}
                WHERE line_id = $${paramCount}
                RETURNING *
            `;

            const { rows } = await db.query(query, values);

            if (!rows.length) {
                return null;
            }

            logger.info(`Updated line with ID: ${id}`);
            return new Line(rows[0]);
        } catch (error) {
            logger.error(`Error in Line.update: ${error.message}`);
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