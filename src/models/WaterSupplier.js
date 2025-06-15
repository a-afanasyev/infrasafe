const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

class WaterSupplier {
    constructor(data) {
        this.supplier_id = data.supplier_id;
        this.name = data.name;
        this.type = data.type; // 'cold_water' или 'hot_water'
        this.company_name = data.company_name;
        this.contact_person = data.contact_person;
        this.phone = data.phone;
        this.email = data.email;
        this.address = data.address;
        this.contract_number = data.contract_number;
        this.service_area = data.service_area;
        this.tariff_per_m3 = data.tariff_per_m3;
        this.status = data.status;
        this.notes = data.notes;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.connected_buildings = data.connected_buildings || [];
    }

    // Получить всех поставщиков с пагинацией и списком обслуживаемых зданий
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
                conditions.push(`ws.name ILIKE $${paramCount}`);
                values.push(`%${filters.name}%`);
            }

            if (filters.type) {
                paramCount++;
                conditions.push(`ws.type = $${paramCount}`);
                values.push(filters.type);
            }

            if (filters.status) {
                paramCount++;
                conditions.push(`ws.status = $${paramCount}`);
                values.push(filters.status);
            }

            if (conditions.length > 0) {
                whereClause = 'WHERE ' + conditions.join(' AND ');
            }

            // Запрос для получения общего количества
            const countQuery = `SELECT COUNT(*) FROM water_suppliers ws ${whereClause}`;
            const countResult = await db.query(countQuery, values);
            const total = parseInt(countResult.rows[0].count);

            // Запрос для получения данных с пагинацией и списком зданий
            const dataQuery = `
                SELECT
                    ws.*,
                    COALESCE(
                        array_agg(DISTINCT
                            CASE
                                WHEN ws.type = 'cold_water' THEN bc.name
                                WHEN ws.type = 'hot_water' THEN bh.name
                            END
                        ) FILTER (WHERE
                            (ws.type = 'cold_water' AND bc.name IS NOT NULL) OR
                            (ws.type = 'hot_water' AND bh.name IS NOT NULL)
                        ),
                        '{}'
                    ) as connected_buildings
                FROM water_suppliers ws
                LEFT JOIN buildings bc ON ws.supplier_id = bc.cold_water_supplier_id AND ws.type = 'cold_water'
                LEFT JOIN buildings bh ON ws.supplier_id = bh.hot_water_supplier_id AND ws.type = 'hot_water'
                ${whereClause}
                GROUP BY ws.supplier_id
                ORDER BY ws.supplier_id
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `;
            values.push(limit, offset);

            const { rows } = await db.query(dataQuery, values);

            return {
                data: rows.map(row => new WaterSupplier(row)),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in WaterSupplier.findAll: ${error.message}`);
            throw createError(`Failed to fetch water suppliers: ${error.message}`, 500);
        }
    }

    // Получить поставщика по ID
    static async findById(id) {
        try {
            const { rows } = await db.query(
                `SELECT
                    ws.*,
                    COALESCE(
                        array_agg(DISTINCT
                            CASE
                                WHEN ws.type = 'cold_water' THEN bc.name
                                WHEN ws.type = 'hot_water' THEN bh.name
                            END
                        ) FILTER (WHERE
                            (ws.type = 'cold_water' AND bc.name IS NOT NULL) OR
                            (ws.type = 'hot_water' AND bh.name IS NOT NULL)
                        ),
                        '{}'
                    ) as connected_buildings
                FROM water_suppliers ws
                LEFT JOIN buildings bc ON ws.supplier_id = bc.cold_water_supplier_id AND ws.type = 'cold_water'
                LEFT JOIN buildings bh ON ws.supplier_id = bh.hot_water_supplier_id AND ws.type = 'hot_water'
                WHERE ws.supplier_id = $1
                GROUP BY ws.supplier_id`,
                [id]
            );

            if (!rows.length) {
                return null;
            }

            return new WaterSupplier(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterSupplier.findById: ${error.message}`);
            throw createError(`Failed to fetch water supplier: ${error.message}`, 500);
        }
    }

    // Создать нового поставщика
    static async create(supplierData) {
        try {
            const {
                name, type, company_name, contact_person, phone, email, address,
                contract_number, service_area, tariff_per_m3, status, notes
            } = supplierData;

            const { rows } = await db.query(
                `INSERT INTO water_suppliers
                (name, type, company_name, contact_person, phone, email, address,
                 contract_number, service_area, tariff_per_m3, status, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *`,
                [name, type, company_name, contact_person, phone, email, address,
                 contract_number, service_area, tariff_per_m3, status, notes]
            );

            logger.info(`Created water supplier: ${name} (${type})`);
            return new WaterSupplier(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterSupplier.create: ${error.message}`);
            throw createError(`Failed to create water supplier: ${error.message}`, 500);
        }
    }

    // Обновить поставщика
    static async update(id, supplierData) {
        try {
            const {
                name, type, company_name, contact_person, phone, email, address,
                contract_number, service_area, tariff_per_m3, status, notes
            } = supplierData;

            const { rows } = await db.query(
                `UPDATE water_suppliers
                SET name = $1, type = $2, company_name = $3, contact_person = $4,
                    phone = $5, email = $6, address = $7, contract_number = $8,
                    service_area = $9, tariff_per_m3 = $10, status = $11,
                    notes = $12, updated_at = NOW()
                WHERE supplier_id = $13
                RETURNING *`,
                [name, type, company_name, contact_person, phone, email, address,
                 contract_number, service_area, tariff_per_m3, status, notes, id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Updated water supplier with ID: ${id}`);
            return new WaterSupplier(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterSupplier.update: ${error.message}`);
            throw createError(`Failed to update water supplier: ${error.message}`, 500);
        }
    }

    // Удалить поставщика
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM water_suppliers WHERE supplier_id = $1 RETURNING *',
                [id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Deleted water supplier with ID: ${id}`);
            return new WaterSupplier(rows[0]);
        } catch (error) {
            logger.error(`Error in WaterSupplier.delete: ${error.message}`);
            throw createError(`Failed to delete water supplier: ${error.message}`, 500);
        }
    }

    // Найти поставщиков обслуживающих здание
    static async findByBuildingId(buildingId) {
        try {
            const { rows } = await db.query(
                `SELECT DISTINCT ws.* FROM water_suppliers ws
                 LEFT JOIN buildings b ON (
                     (ws.supplier_id = b.cold_water_supplier_id AND ws.type = 'cold_water') OR
                     (ws.supplier_id = b.hot_water_supplier_id AND ws.type = 'hot_water')
                 )
                 WHERE b.building_id = $1`,
                [buildingId]
            );

            return rows.map(row => new WaterSupplier(row));
        } catch (error) {
            logger.error(`Error in WaterSupplier.findByBuildingId: ${error.message}`);
            throw createError(`Failed to fetch water suppliers by building: ${error.message}`, 500);
        }
    }

    // Получить поставщиков по типу
    static async findByType(type) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM water_suppliers WHERE type = $1 AND status = $2 ORDER BY name',
                [type, 'active']
            );

            return rows.map(row => new WaterSupplier(row));
        } catch (error) {
            logger.error(`Error in WaterSupplier.findByType: ${error.message}`);
            throw createError(`Failed to fetch water suppliers by type: ${error.message}`, 500);
        }
    }
}

module.exports = WaterSupplier;