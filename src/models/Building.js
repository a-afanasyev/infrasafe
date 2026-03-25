const db = require('../config/database');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

class Building {
    /**
     * Получить все здания с пагинацией и сортировкой
     * @param {number} page - Номер страницы
     * @param {number} limit - Количество элементов на странице
     * @param {string} sort - Поле для сортировки
     * @param {string} order - Направление сортировки (asc/desc)
     * @returns {Object} Объект с данными и метаданными пагинации
     */
    static async findAll(page = 1, limit = 10, sort = 'building_id', order = 'asc') {
        try {
            const offset = (page - 1) * limit;
            const validOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order : 'asc';

            // ИСПРАВЛЕНИЕ SQL INJECTION: Валидация параметров сортировки
            const { validateSortOrder } = require('../utils/queryValidation');
            const { validSort, validOrder: validOrderSecure } = validateSortOrder('buildings', sort, validOrder);

            const { rows: buildings } = await db.query(
                `SELECT
                    b.*,
                    pt.name as primary_transformer_name,
                    bt.name as backup_transformer_name,
                    pl.name as primary_line_name,
                    bl.name as backup_line_name,
                    cwl.name as cold_water_line_name,
                    hwl.name as hot_water_line_name,
                    cws.name as cold_water_supplier_name,
                    hws.name as hot_water_supplier_name
                FROM buildings b
                LEFT JOIN transformers pt ON b.primary_transformer_id = pt.transformer_id
                LEFT JOIN transformers bt ON b.backup_transformer_id = bt.transformer_id
                LEFT JOIN lines pl ON b.primary_line_id = pl.line_id
                LEFT JOIN lines bl ON b.backup_line_id = bl.line_id
                LEFT JOIN water_lines cwl ON b.cold_water_line_id = cwl.line_id
                LEFT JOIN water_lines hwl ON b.hot_water_line_id = hwl.line_id
                LEFT JOIN water_suppliers cws ON b.cold_water_supplier_id = cws.supplier_id
                LEFT JOIN water_suppliers hws ON b.hot_water_supplier_id = hws.supplier_id
                ORDER BY b.${validSort} ${validOrderSecure}
                LIMIT $1 OFFSET $2`,
                [limit, offset]
            );

            const { rows: countResult } = await db.query('SELECT COUNT(*) FROM buildings');
            const totalCount = parseInt(countResult[0].count);

            return {
                data: buildings,
                pagination: {
                    total: totalCount,
                    page,
                    limit,
                    totalPages: Math.ceil(totalCount / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in Building.findAll: ${error.message}`);
            throw createError(`Failed to fetch buildings: ${error.message}`, 500);
        }
    }

    /**
     * Найти здание по ID
     * @param {number} id - ID здания
     * @returns {Object|null} Объект здания или null
     */
    static async findById(id) {
        try {
            const { rows } = await db.query(
                `SELECT
                    b.*,
                    pt.name as primary_transformer_name,
                    bt.name as backup_transformer_name,
                    pl.name as primary_line_name,
                    bl.name as backup_line_name,
                    cwl.name as cold_water_line_name,
                    hwl.name as hot_water_line_name,
                    cws.name as cold_water_supplier_name,
                    hws.name as hot_water_supplier_name
                FROM buildings b
                LEFT JOIN transformers pt ON b.primary_transformer_id = pt.transformer_id
                LEFT JOIN transformers bt ON b.backup_transformer_id = bt.transformer_id
                LEFT JOIN lines pl ON b.primary_line_id = pl.line_id
                LEFT JOIN lines bl ON b.backup_line_id = bl.line_id
                LEFT JOIN water_lines cwl ON b.cold_water_line_id = cwl.line_id
                LEFT JOIN water_lines hwl ON b.hot_water_line_id = hwl.line_id
                LEFT JOIN water_suppliers cws ON b.cold_water_supplier_id = cws.supplier_id
                LEFT JOIN water_suppliers hws ON b.hot_water_supplier_id = hws.supplier_id
                WHERE b.building_id = $1`,
                [id]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Building.findById: ${error.message}`);
            throw createError(`Failed to fetch building: ${error.message}`, 500);
        }
    }

    /**
     * Найти здание по ID с контроллерами (один запрос, устраняет N+1)
     */
    static async findByIdWithControllers(id) {
        try {
            const { rows } = await db.query(
                `SELECT
                    b.*,
                    pt.name as primary_transformer_name,
                    bt.name as backup_transformer_name,
                    pl.name as primary_line_name,
                    bl.name as backup_line_name,
                    cwl.name as cold_water_line_name,
                    hwl.name as hot_water_line_name,
                    cws.name as cold_water_supplier_name,
                    hws.name as hot_water_supplier_name,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'controller_id', c.controller_id,
                                'serial_number', c.serial_number,
                                'model', c.model,
                                'vendor', c.vendor,
                                'status', c.status,
                                'firmware_version', c.firmware_version,
                                'location', c.location,
                                'last_seen', c.last_seen
                            )
                        ) FILTER (WHERE c.controller_id IS NOT NULL),
                        '[]'
                    ) as controllers
                FROM buildings b
                LEFT JOIN transformers pt ON b.primary_transformer_id = pt.transformer_id
                LEFT JOIN transformers bt ON b.backup_transformer_id = bt.transformer_id
                LEFT JOIN lines pl ON b.primary_line_id = pl.line_id
                LEFT JOIN lines bl ON b.backup_line_id = bl.line_id
                LEFT JOIN water_lines cwl ON b.cold_water_line_id = cwl.line_id
                LEFT JOIN water_lines hwl ON b.hot_water_line_id = hwl.line_id
                LEFT JOIN water_suppliers cws ON b.cold_water_supplier_id = cws.supplier_id
                LEFT JOIN water_suppliers hws ON b.hot_water_supplier_id = hws.supplier_id
                LEFT JOIN controllers c ON c.building_id = b.building_id
                WHERE b.building_id = $1
                GROUP BY b.building_id, pt.name, bt.name, pl.name, bl.name,
                         cwl.name, hwl.name, cws.name, hws.name`,
                [id]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Building.findByIdWithControllers: ${error.message}`);
            throw createError(`Failed to fetch building with controllers: ${error.message}`, 500);
        }
    }

    /**
     * Создать новое здание
     * @param {Object} buildingData - Данные для создания
     * @returns {Object} Созданное здание
     */
    static async create(buildingData) {
        try {
            const {
                name, address, town, latitude, longitude, management_company, region, has_hot_water,
                primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id
            } = buildingData;

            const { rows } = await db.query(
                `INSERT INTO buildings
                (name, address, town, latitude, longitude, management_company, region, has_hot_water,
                 primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                 cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING *`,
                [name, address, town, latitude, longitude, management_company, region, has_hot_water,
                 primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                 cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id]
            );

            logger.info(`Created new building with ID: ${rows[0].building_id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.create: ${error.message}`);
            throw createError(`Failed to create building: ${error.message}`, 500);
        }
    }

    /**
     * Обновить здание
     * @param {number} id - ID здания
     * @param {Object} buildingData - Данные для обновления
     * @returns {Object|null} Обновленное здание или null
     */
    static async update(id, buildingData) {
        try {
            const {
                name, address, town, latitude, longitude, management_company, region, has_hot_water,
                primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id
            } = buildingData;

            const { rows } = await db.query(
                `UPDATE buildings
                SET name = $1, address = $2, town = $3, latitude = $4, longitude = $5,
                    management_company = $6, region = $7, has_hot_water = $8,
                    primary_transformer_id = $9, backup_transformer_id = $10,
                    primary_line_id = $11, backup_line_id = $12,
                    cold_water_line_id = $13, hot_water_line_id = $14,
                    cold_water_supplier_id = $15, hot_water_supplier_id = $16
                WHERE building_id = $17
                RETURNING *`,
                [name, address, town, latitude, longitude, management_company, region, has_hot_water,
                 primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                 cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id, id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Updated building with ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.update: ${error.message}`);
            throw createError(`Failed to update building: ${error.message}`, 500);
        }
    }

    /**
     * Удалить здание
     * @param {number} id - ID здания
     * @returns {Object|null} Удаленное здание или null
     */
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM buildings WHERE building_id = $1 RETURNING *',
                [id]
            );

            if (rows.length) {
                logger.info(`Deleted building with ID: ${id}`);
            }

            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Building.delete: ${error.message}`);
            throw createError(`Failed to delete building: ${error.message}`, 500);
        }
    }

    /**
     * Каскадное удаление здания с контроллерами, метриками и алертами в транзакции
     * Порядок: alerts → metrics → controllers → building
     * @param {number} buildingId - ID здания
     * @returns {Object|null} Удалённое здание или null
     */
    static async deleteCascade(buildingId) {
        const id = parseInt(buildingId, 10);
        if (isNaN(id)) {
            throw createError('Invalid building ID', 400);
        }

        const client = await db.getPool().connect();
        try {
            await client.query('BEGIN');

            // 1. Delete legacy alerts referencing metrics of this building's controllers
            await client.query(
                `DELETE FROM alerts WHERE metric_id IN (
                    SELECT metric_id FROM metrics WHERE controller_id IN (
                        SELECT controller_id FROM controllers WHERE building_id = $1
                    )
                )`,
                [id]
            );

            // 2. Delete infrastructure_alerts for this building's controllers
            await client.query(
                `DELETE FROM infrastructure_alerts
                 WHERE infrastructure_type = 'controller'
                   AND infrastructure_id IN (
                       SELECT controller_id::text FROM controllers WHERE building_id = $1
                   )`,
                [id]
            );

            // 3. Delete metrics for all controllers in this building
            await client.query(
                'DELETE FROM metrics WHERE controller_id IN (SELECT controller_id FROM controllers WHERE building_id = $1)',
                [id]
            );

            // 4. Delete controllers
            await client.query('DELETE FROM controllers WHERE building_id = $1', [id]);

            // 5. Delete the building itself
            const result = await client.query(
                'DELETE FROM buildings WHERE building_id = $1 RETURNING *',
                [id]
            );

            await client.query('COMMIT');

            if (result.rows.length) {
                logger.info(`Cascade-deleted building ${id} with all related data`);
            }

            return result.rows.length ? result.rows[0] : null;
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error(`Error in Building.deleteCascade: ${error.message}`);
            throw createError(`Failed to cascade-delete building: ${error.message}`, 500);
        } finally {
            client.release();
        }
    }
    static async findByExternalId(externalId) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM buildings WHERE external_id = $1',
                [externalId]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Building.findByExternalId: ${error.message}`);
            throw createError(`Failed to find building by external_id: ${error.message}`, 500);
        }
    }

    static async createFromUK(data) {
        try {
            const { external_id, name, address, town } = data;
            const { rows } = await db.query(
                `INSERT INTO buildings (external_id, name, address, town)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [external_id, name, address, town]
            );
            logger.info(`Created building from UK with ID: ${rows[0].building_id}, external_id: ${external_id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.createFromUK: ${error.message}`);
            throw createError(`Failed to create building from UK: ${error.message}`, 500);
        }
    }

    static async updateFromUK(id, ukFields) {
        try {
            const { name, address, town } = ukFields;
            const { rows } = await db.query(
                `UPDATE buildings
                 SET name = $1, address = $2, town = $3, uk_deleted_at = NULL
                 WHERE building_id = $4
                 RETURNING *`,
                [name, address, town, id]
            );
            if (!rows.length) return null;
            logger.info(`Updated building ${id} from UK sync`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.updateFromUK: ${error.message}`);
            throw createError(`Failed to update building from UK: ${error.message}`, 500);
        }
    }

    static async softDelete(id) {
        try {
            const { rows } = await db.query(
                `UPDATE buildings SET uk_deleted_at = NOW()
                 WHERE building_id = $1
                 RETURNING *`,
                [id]
            );
            if (!rows.length) return null;
            logger.info(`Soft-deleted building ${id} (UK removal)`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Building.softDelete: ${error.message}`);
            throw createError(`Failed to soft-delete building: ${error.message}`, 500);
        }
    }
}

module.exports = Building;