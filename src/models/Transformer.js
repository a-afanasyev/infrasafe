const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

class Transformer {
    constructor(data) {
        this.transformer_id = data.transformer_id;
        this.name = data.name;
        this.power_kva = data.power_kva;
        this.voltage_kv = data.voltage_kv;
        this.latitude = data.latitude;
        this.longitude = data.longitude;
        this.location = data.location;
        this.status = data.status;
        this.manufacturer = data.manufacturer;
        this.model = data.model;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.primary_buildings = data.primary_buildings || [];
        this.backup_buildings = data.backup_buildings || [];
    }

    // Получить все трансформаторы с пагинацией и списком обслуживаемых зданий
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
                conditions.push(`t.name ILIKE $${paramCount}`);
                values.push(`%${filters.name}%`);
            }

            if (filters.power_kva) {
                paramCount++;
                conditions.push(`t.power_kva >= $${paramCount}`);
                values.push(filters.power_kva);
            }

            if (filters.voltage_kv) {
                paramCount++;
                conditions.push(`t.voltage_kv = $${paramCount}`);
                values.push(filters.voltage_kv);
            }

            if (conditions.length > 0) {
                whereClause = 'WHERE ' + conditions.join(' AND ');
            }

            // Запрос для получения общего количества
            const countQuery = `SELECT COUNT(*) FROM transformers t ${whereClause}`;
            const countResult = await db.query(countQuery, values);
            const total = parseInt(countResult.rows[0].count);

            // Запрос для получения данных с пагинацией и списком зданий
            const dataQuery = `
                SELECT
                    t.*,
                    COALESCE(
                        array_agg(DISTINCT pb.name) FILTER (WHERE pb.name IS NOT NULL),
                        '{}'
                    ) as primary_buildings,
                    COALESCE(
                        array_agg(DISTINCT bb.name) FILTER (WHERE bb.name IS NOT NULL),
                        '{}'
                    ) as backup_buildings
                FROM transformers t
                LEFT JOIN buildings pb ON t.transformer_id = pb.primary_transformer_id
                LEFT JOIN buildings bb ON t.transformer_id = bb.backup_transformer_id
                ${whereClause}
                GROUP BY t.transformer_id
                ORDER BY t.transformer_id
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

    // Создать новый трансформатор.
    // Обязательные: name, power_kva, voltage_kv. Остальные поля — опциональны
    // и записываются только если переданы (чтобы SQL дефолты и NOT NULL
    // constraints не конфликтовали с "пустыми" значениями из форм).
    static async create(transformerData) {
        try {
            const fields = [];
            const values = [];
            const optionalFields = [
                'name', 'power_kva', 'voltage_kv',
                'location', 'latitude', 'longitude',
                'installation_date', 'manufacturer', 'model', 'status',
            ];
            for (const key of optionalFields) {
                const v = transformerData[key];
                // Skip undefined/null/NaN so PG defaults apply
                if (v === undefined || v === null) continue;
                if (typeof v === 'number' && Number.isNaN(v)) continue;
                fields.push(key);
                values.push(v);
            }
            if (fields.length < 3) {
                throw createError('name, power_kva and voltage_kv are required', 400);
            }

            const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
            const { rows } = await db.query(
                `INSERT INTO transformers (${fields.join(', ')})
                 VALUES (${placeholders})
                 RETURNING *`,
                values
            );

            logger.info(`Created transformer: ${transformerData.name}`);
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.create: ${error.message}`);
            if (error.statusCode) throw error;
            throw createError(`Failed to create transformer: ${error.message}`, 500);
        }
    }

    // Обновить трансформатор
    static async update(id, transformerData) {
        try {
            const { 
                name, 
                power_kva, 
                voltage_kv,
                latitude,
                longitude,
                location,
                status,
                manufacturer,
                model
            } = transformerData;

            // Строим динамический SQL запрос для обновления только переданных полей
            const fields = [];
            const values = [];
            let paramCount = 0;

            if (name !== undefined) {
                paramCount++;
                fields.push(`name = $${paramCount}`);
                values.push(name);
            }
            if (power_kva !== undefined) {
                paramCount++;
                fields.push(`power_kva = $${paramCount}`);
                values.push(power_kva);
            }
            if (voltage_kv !== undefined) {
                paramCount++;
                fields.push(`voltage_kv = $${paramCount}`);
                values.push(voltage_kv);
            }
            if (latitude !== undefined) {
                paramCount++;
                fields.push(`latitude = $${paramCount}`);
                values.push(latitude);
            }
            if (longitude !== undefined) {
                paramCount++;
                fields.push(`longitude = $${paramCount}`);
                values.push(longitude);
            }
            if (location !== undefined) {
                paramCount++;
                fields.push(`location = $${paramCount}`);
                values.push(location);
            }
            if (status !== undefined) {
                paramCount++;
                fields.push(`status = $${paramCount}`);
                values.push(status);
            }
            if (manufacturer !== undefined) {
                paramCount++;
                fields.push(`manufacturer = $${paramCount}`);
                values.push(manufacturer);
            }
            if (model !== undefined) {
                paramCount++;
                fields.push(`model = $${paramCount}`);
                values.push(model);
            }

            if (fields.length === 0) {
                throw new Error('No fields to update');
            }

            // Добавляем updated_at
            fields.push('updated_at = NOW()');

            // Добавляем ID в конец
            paramCount++;
            values.push(id);

            const { rows } = await db.query(
                `UPDATE transformers
                SET ${fields.join(', ')}
                WHERE transformer_id = $${paramCount}
                RETURNING *`,
                values
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

    // Найти трансформаторы обслуживающие здание
    static async findByBuildingId(buildingId) {
        try {
            const { rows } = await db.query(
                `SELECT DISTINCT t.* FROM transformers t
                 LEFT JOIN buildings b ON (t.transformer_id = b.primary_transformer_id OR t.transformer_id = b.backup_transformer_id)
                 WHERE b.building_id = $1`,
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