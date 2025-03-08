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
            
            // Проверка допустимости поля сортировки
            const validColumns = ['building_id', 'name', 'address', 'town', 'region', 'management_company'];
            const sortColumn = validColumns.includes(sort) ? sort : 'building_id';
            
            const { rows: buildings } = await db.query(
                `SELECT * FROM buildings 
                 ORDER BY ${sortColumn} ${validOrder} 
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
                'SELECT * FROM buildings WHERE building_id = $1',
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
            const { name, address, town, latitude, longitude, management_company, region, hot_water } = buildingData;
            
            const { rows } = await db.query(
                `INSERT INTO buildings 
                (name, address, town, latitude, longitude, management_company, region, hot_water) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
                RETURNING *`,
                [name, address, town, latitude, longitude, management_company, region, hot_water]
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
            const { name, address, town, latitude, longitude, management_company, region, hot_water } = buildingData;
            
            const { rows } = await db.query(
                `UPDATE buildings 
                SET name = $1, address = $2, town = $3, latitude = $4, longitude = $5, 
                    management_company = $6, region = $7, hot_water = $8
                WHERE building_id = $9 
                RETURNING *`,
                [name, address, town, latitude, longitude, management_company, region, hot_water, id]
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