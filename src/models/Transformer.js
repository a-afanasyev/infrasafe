const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

class Transformer {
    constructor(data) {
        this.transformer_id = data.transformer_id;
        this.name = data.name;
        this.power_kva = data.power_kva;
        this.voltage_kv = data.voltage_kv;
        this.building_id = data.building_id;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    // Получить все трансформаторы с пагинацией
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
            
            if (filters.power_kva) {
                paramCount++;
                conditions.push(`power_kva >= $${paramCount}`);
                values.push(filters.power_kva);
            }
            
            if (filters.voltage_kv) {
                paramCount++;
                conditions.push(`voltage_kv = $${paramCount}`);
                values.push(filters.voltage_kv);
            }
            
            if (filters.building_id) {
                paramCount++;
                conditions.push(`building_id = $${paramCount}`);
                values.push(filters.building_id);
            }

            if (conditions.length > 0) {
                whereClause = 'WHERE ' + conditions.join(' AND ');
            }

            // Запрос для получения общего количества
            const countQuery = `SELECT COUNT(*) FROM transformers ${whereClause}`;
            const countResult = await db.query(countQuery, values);
            const total = parseInt(countResult.rows[0].count);

            // Запрос для получения данных с пагинацией
            const dataQuery = `
                SELECT * FROM transformers 
                ${whereClause}
                ORDER BY transformer_id 
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `;
            values.push(limit, offset);

            const { rows } = await db.query(dataQuery, values);
            
            return {
                data: rows.map(row => new Transformer(row)),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in Transformer.findAll: ${error.message}`);
            throw createError(`Failed to fetch transformers: ${error.message}`, 500);
        }
    }

    // Получить трансформатор по ID
    static async findById(id) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM transformers WHERE transformer_id = $1',
                [id]
            );
            
            if (!rows.length) {
                return null;
            }
            
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.findById: ${error.message}`);
            throw createError(`Failed to fetch transformer: ${error.message}`, 500);
        }
    }

    // Создать новый трансформатор
    static async create(transformerData) {
        try {
            const { name, power_kva, voltage_kv, building_id } = transformerData;
            
            const { rows } = await db.query(
                `INSERT INTO transformers (name, power_kva, voltage_kv, building_id)
                VALUES ($1, $2, $3, $4) 
                RETURNING *`,
                [name, power_kva, voltage_kv, building_id]
            );
            
            logger.info(`Created transformer: ${name}`);
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.create: ${error.message}`);
            throw createError(`Failed to create transformer: ${error.message}`, 500);
        }
    }

    // Обновить трансформатор
    static async update(id, transformerData) {
        try {
            const { name, power_kva, voltage_kv, building_id } = transformerData;
            
            const { rows } = await db.query(
                `UPDATE transformers 
                SET name = $1, power_kva = $2, voltage_kv = $3, building_id = $4, updated_at = NOW()
                WHERE transformer_id = $5 
                RETURNING *`,
                [name, power_kva, voltage_kv, building_id, id]
            );
            
            if (!rows.length) {
                return null;
            }
            
            logger.info(`Updated transformer with ID: ${id}`);
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.update: ${error.message}`);
            throw createError(`Failed to update transformer: ${error.message}`, 500);
        }
    }

    // Удалить трансформатор
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM transformers WHERE transformer_id = $1 RETURNING *',
                [id]
            );
            
            if (!rows.length) {
                return null;
            }
            
            logger.info(`Deleted transformer with ID: ${id}`);
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.delete: ${error.message}`);
            throw createError(`Failed to delete transformer: ${error.message}`, 500);
        }
    }

    // Найти трансформаторы по building_id
    static async findByBuildingId(buildingId) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM transformers WHERE building_id = $1',
                [buildingId]
            );
            
            return rows.map(row => new Transformer(row));
        } catch (error) {
            logger.error(`Error in Transformer.findByBuildingId: ${error.message}`);
            throw createError(`Failed to fetch transformers by building: ${error.message}`, 500);
        }
    }
}

module.exports = Transformer; 