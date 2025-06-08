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
                    pages: Math.ceil(total / limit)
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
            const { name, voltage_kv, length_km, transformer_id } = lineData;
            
            const { rows } = await db.query(
                `INSERT INTO lines (name, voltage_kv, length_km, transformer_id)
                VALUES ($1, $2, $3, $4) 
                RETURNING *`,
                [name, voltage_kv, length_km, transformer_id]
            );
            
            logger.info(`Created line: ${name}`);
            return new Line(rows[0]);
        } catch (error) {
            logger.error(`Error in Line.create: ${error.message}`);
            throw createError(`Failed to create line: ${error.message}`, 500);
        }
    }

    // Обновить линию
    static async update(id, lineData) {
        try {
            const { name, voltage_kv, length_km, transformer_id } = lineData;
            
            const { rows } = await db.query(
                `UPDATE lines 
                SET name = $1, voltage_kv = $2, length_km = $3, transformer_id = $4, updated_at = NOW()
                WHERE line_id = $5 
                RETURNING *`,
                [name, voltage_kv, length_km, transformer_id, id]
            );
            
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