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
            const {
                name, description, diameter_mm, material, pressure_rating,
                installation_date, length_km, status, maintenance_contact, notes
            } = lineData;

            const { rows } = await db.query(
                `INSERT INTO water_lines
                (name, description, diameter_mm, material, pressure_rating,
                 installation_date, length_km, status, maintenance_contact, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *`,
                [name, description, diameter_mm, material, pressure_rating,
                 installation_date, length_km, status, maintenance_contact, notes]
            );

            logger.info(`Created water line: ${name}`);
            return new WaterLine(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterLine.create: ${error.message}`);
            throw createError(`Failed to create water line: ${error.message}`, 500);
        }
    }

    // Обновить линию водоснабжения
    static async update(id, lineData) {
        try {
            const {
                name, description, diameter_mm, material, pressure_rating,
                installation_date, length_km, status, maintenance_contact, notes
            } = lineData;

            const { rows } = await db.query(
                `UPDATE water_lines
                SET name = $1, description = $2, diameter_mm = $3, material = $4,
                    pressure_rating = $5, installation_date = $6, length_km = $7,
                    status = $8, maintenance_contact = $9, notes = $10, updated_at = NOW()
                WHERE line_id = $11
                RETURNING *`,
                [name, description, diameter_mm, material, pressure_rating,
                 installation_date, length_km, status, maintenance_contact, notes, id]
            );

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