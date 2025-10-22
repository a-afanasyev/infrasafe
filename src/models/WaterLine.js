const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

class WaterLine {
    constructor(data) {
        this.line_id = data.line_id;
        this.name = data.name;
        this.description = data.description;
        this.diameter_mm = data.diameter_mm;
        this.material = data.material;
        this.pressure_rating = data.pressure_rating;
        this.installation_date = data.installation_date;
        this.length_km = data.length_km;
        this.status = data.status;
        this.maintenance_contact = data.maintenance_contact;
        this.notes = data.notes;
        this.line_type = data.line_type;
        this.supplier_id = data.supplier_id;
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
                paramCount++;
                conditions.push(`wl.name ILIKE $${paramCount}`);
                values.push(`%${filters.name}%`);
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
                    pages: Math.ceil(total / limit)
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

    // Создать новую линию водоснабжения
    static async create(lineData) {
        try {
            // Динамическое построение SQL для поддержки всех полей
            const fields = [];
            const values = [];
            let paramCount = 0;
            
            // Обязательные поля
            if (lineData.name) {
                fields.push('name');
                values.push(lineData.name);
                paramCount++;
            }
            
            // Опциональные поля
            if (lineData.description !== undefined) {
                fields.push('description');
                values.push(lineData.description);
                paramCount++;
            }
            
            if (lineData.line_type) {
                fields.push('line_type');
                values.push(lineData.line_type);
                paramCount++;
            }
            
            if (lineData.diameter_mm !== undefined) {
                fields.push('diameter_mm');
                values.push(lineData.diameter_mm);
                paramCount++;
            }
            
            if (lineData.material !== undefined) {
                fields.push('material');
                values.push(lineData.material);
                paramCount++;
            }
            
            if (lineData.pressure_rating !== undefined) {
                fields.push('pressure_rating');
                values.push(lineData.pressure_rating);
                paramCount++;
            }
            
            if (lineData.installation_date !== undefined) {
                fields.push('installation_date');
                values.push(lineData.installation_date);
                paramCount++;
            }
            
            if (lineData.length_km !== undefined) {
                fields.push('length_km');
                values.push(lineData.length_km);
                paramCount++;
            }
            
            if (lineData.status !== undefined) {
                fields.push('status');
                values.push(lineData.status);
                paramCount++;
            }
            
            if (lineData.main_path) {
                fields.push('main_path');
                values.push(JSON.stringify(lineData.main_path));
                paramCount++;
            }
            
            if (lineData.branches) {
                fields.push('branches');
                values.push(JSON.stringify(lineData.branches));
                paramCount++;
            }
            
            if (lineData.latitude_start !== undefined) {
                fields.push('latitude_start');
                values.push(lineData.latitude_start);
                paramCount++;
            }
            
            if (lineData.longitude_start !== undefined) {
                fields.push('longitude_start');
                values.push(lineData.longitude_start);
                paramCount++;
            }
            
            if (lineData.latitude_end !== undefined) {
                fields.push('latitude_end');
                values.push(lineData.latitude_end);
                paramCount++;
            }
            
            if (lineData.longitude_end !== undefined) {
                fields.push('longitude_end');
                values.push(lineData.longitude_end);
                paramCount++;
            }
            
            const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
            const query = `
                INSERT INTO water_lines (${fields.join(', ')})
                VALUES (${placeholders})
                RETURNING *
            `;

            const { rows } = await db.query(query, values);

            logger.info(`Created water line: ${lineData.name}`);
            return new WaterLine(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterLine.create: ${error.message}`);
            throw createError(`Failed to create water line: ${error.message}`, 500);
        }
    }

    // Обновить линию водоснабжения
    static async update(id, lineData) {
        try {
            // Динамическое построение SQL для обновления только предоставленных полей
            const updates = [];
            const values = [];
            let paramCount = 0;
            
            if (lineData.name !== undefined) {
                paramCount++;
                updates.push(`name = $${paramCount}`);
                values.push(lineData.name);
            }
            
            if (lineData.description !== undefined) {
                paramCount++;
                updates.push(`description = $${paramCount}`);
                values.push(lineData.description);
            }
            
            if (lineData.line_type !== undefined) {
                paramCount++;
                updates.push(`line_type = $${paramCount}`);
                values.push(lineData.line_type);
            }
            
            if (lineData.diameter_mm !== undefined) {
                paramCount++;
                updates.push(`diameter_mm = $${paramCount}`);
                values.push(lineData.diameter_mm);
            }
            
            if (lineData.material !== undefined) {
                paramCount++;
                updates.push(`material = $${paramCount}`);
                values.push(lineData.material);
            }
            
            if (lineData.pressure_rating !== undefined) {
                paramCount++;
                updates.push(`pressure_rating = $${paramCount}`);
                values.push(lineData.pressure_rating);
            }
            
            if (lineData.installation_date !== undefined) {
                paramCount++;
                updates.push(`installation_date = $${paramCount}`);
                values.push(lineData.installation_date);
            }
            
            if (lineData.length_km !== undefined) {
                paramCount++;
                updates.push(`length_km = $${paramCount}`);
                values.push(lineData.length_km);
            }
            
            if (lineData.status !== undefined) {
                paramCount++;
                updates.push(`status = $${paramCount}`);
                values.push(lineData.status);
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
            
            // Всегда обновляем updated_at
            updates.push(`updated_at = NOW()`);
            
            // ID для WHERE
            paramCount++;
            values.push(id);
            
            const query = `
                UPDATE water_lines
                SET ${updates.join(', ')}
                WHERE line_id = $${paramCount}
                RETURNING *
            `;

            const { rows } = await db.query(query, values);

            if (!rows.length) {
                return null;
            }

            logger.info(`Updated water line with ID: ${id}`);
            return new WaterLine(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterLine.update: ${error.message}`);
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

    // Найти линию обслуживающую здание
    static async findByBuildingId(buildingId) {
        try {
            const { rows } = await db.query(
                `SELECT wl.* FROM water_lines wl
                 JOIN buildings b ON wl.line_id = b.water_line_id
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