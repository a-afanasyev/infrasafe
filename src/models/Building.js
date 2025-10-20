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
     * Создать новое здание
     * @param {Object} buildingData - Данные для создания
     * @returns {Object} Созданное здание
     */
    static async create(buildingData) {
        try {
            const {
                name, address, town, latitude, longitude, management_company, region, hot_water,
                primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id
            } = buildingData;

            const { rows } = await db.query(
                `INSERT INTO buildings
                (name, address, town, latitude, longitude, management_company, region, hot_water,
                 primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                 cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING *`,
                [name, address, town, latitude, longitude, management_company, region, hot_water,
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
                name, address, town, latitude, longitude, management_company, region, hot_water,
                primary_transformer_id, backup_transformer_id, primary_line_id, backup_line_id,
                cold_water_line_id, hot_water_line_id, cold_water_supplier_id, hot_water_supplier_id
            } = buildingData;

            const { rows } = await db.query(
                `UPDATE buildings
                SET name = $1, address = $2, town = $3, latitude = $4, longitude = $5,
                    management_company = $6, region = $7, hot_water = $8,
                    primary_transformer_id = $9, backup_transformer_id = $10,
                    primary_line_id = $11, backup_line_id = $12,
                    cold_water_line_id = $13, hot_water_line_id = $14,
                    cold_water_supplier_id = $15, hot_water_supplier_id = $16
                WHERE building_id = $17
                RETURNING *`,
                [name, address, town, latitude, longitude, management_company, region, hot_water,
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
}

module.exports = Building;