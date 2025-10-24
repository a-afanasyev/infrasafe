const db = require('../config/database');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

class Controller {
    /**
     * Получить все контроллеры с пагинацией и сортировкой
     * @param {number} page - Номер страницы
     * @param {number} limit - Количество элементов на странице
     * @param {string} sort - Поле для сортировки
     * @param {string} order - Направление сортировки (asc/desc)
     * @returns {Object} Объект с данными и метаданными пагинации
     */
    static async findAll(page = 1, limit = 10, sort = 'controller_id', order = 'asc') {
        try {
            const offset = (page - 1) * limit;
            const validOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order : 'asc';

            // Проверка допустимости поля сортировки
            // ИСПРАВЛЕНИЕ SQL INJECTION: Валидация параметров сортировки
            const { validateSortOrder } = require('../utils/queryValidation');
            const { validSort, validOrder: validOrderSecure } = validateSortOrder('controllers', sort, validOrder);

            const { rows: controllers } = await db.query(
                `SELECT c.*, b.name as building_name
                 FROM controllers c
                 LEFT JOIN buildings b ON c.building_id = b.building_id
                 ORDER BY c.${validSort} ${validOrderSecure}
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            );

            const { rows: countResult } = await db.query('SELECT COUNT(*) FROM controllers');
            const totalCount = parseInt(countResult[0].count);

            return {
                data: controllers,
                pagination: {
                    total: totalCount,
                    page,
                    limit,
                    totalPages: Math.ceil(totalCount / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in Controller.findAll: ${error.message}`);
            throw createError(`Failed to fetch controllers: ${error.message}`, 500);
        }
    }

    /**
     * Найти контроллер по ID
     * @param {number} id - ID контроллера
     * @returns {Object|null} Объект контроллера или null
     */
    static async findById(id) {
        try {
            const { rows } = await db.query(
                `SELECT c.*, b.name as building_name
                 FROM controllers c
                 LEFT JOIN buildings b ON c.building_id = b.building_id
                 WHERE c.controller_id = $1`,
                [id]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Controller.findById: ${error.message}`);
            throw createError(`Failed to fetch controller: ${error.message}`, 500);
        }
    }

    /**
     * Найти контроллеры по ID здания
     * @param {number} buildingId - ID здания
     * @returns {Array} Массив контроллеров
     */
    static async findByBuildingId(buildingId) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM controllers WHERE building_id = $1',
                [buildingId]
            );
            return rows;
        } catch (error) {
            logger.error(`Error in Controller.findByBuildingId: ${error.message}`);
            throw createError(`Failed to fetch controllers by building: ${error.message}`, 500);
        }
    }

    /**
     * Создать новый контроллер
     * @param {Object} controllerData - Данные для создания
     * @returns {Object} Созданный контроллер
     */
    static async create(controllerData) {
        try {
            const { serial_number, vendor, model, building_id, status } = controllerData;

            const { rows } = await db.query(
                `INSERT INTO controllers
                (serial_number, vendor, model, building_id, status)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
                [serial_number, vendor, model, building_id, status]
            );

            logger.info(`Created new controller with ID: ${rows[0].controller_id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Controller.create: ${error.message}`);
            throw createError(`Failed to create controller: ${error.message}`, 500);
        }
    }

    /**
     * Обновить контроллер
     * @param {number} id - ID контроллера
     * @param {Object} controllerData - Данные для обновления
     * @returns {Object|null} Обновленный контроллер или null
     */
    static async update(id, controllerData) {
        try {
            const { serial_number, vendor, model, building_id, status } = controllerData;

            const { rows } = await db.query(
                `UPDATE controllers
                SET serial_number = $1, vendor = $2, model = $3,
                    building_id = $4, status = $5
                WHERE controller_id = $6
                RETURNING *`,
                [serial_number, vendor, model, building_id, status, id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Updated controller with ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Controller.update: ${error.message}`);
            throw createError(`Failed to update controller: ${error.message}`, 500);
        }
    }

    /**
     * Обновить статус контроллера
     * @param {number} id - ID контроллера
     * @param {string} status - Новый статус
     * @returns {Object|null} Обновленный контроллер или null
     */
    static async updateStatus(id, status) {
        try {
            const { rows } = await db.query(
                `UPDATE controllers
                SET status = $1
                WHERE controller_id = $2
                RETURNING *`,
                [status, id]
            );

            if (rows.length) {
                logger.info(`Updated status for controller with ID: ${id} to ${status}`);
            }

            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Controller.updateStatus: ${error.message}`);
            throw createError(`Failed to update controller status: ${error.message}`, 500);
        }
    }

    /**
     * Удалить контроллер
     * @param {number} id - ID контроллера
     * @returns {Object|null} Удаленный контроллер или null
     */
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM controllers WHERE controller_id = $1 RETURNING *',
                [id]
            );

            if (rows.length) {
                logger.info(`Deleted controller with ID: ${id}`);
            }

            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Controller.delete: ${error.message}`);
            throw createError(`Failed to delete controller: ${error.message}`, 500);
        }
    }

    /**
     * Найти контроллер по серийному номеру
     * @param {string} serialNumber - Серийный номер контроллера
     * @returns {Object|null} Объект контроллера или null, если не найден
     */
    static async findBySerialNumber(serialNumber) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM controllers WHERE serial_number = $1',
                [serialNumber]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Controller.findBySerialNumber: ${error.message}`);
            throw createError(`Failed to fetch controller by serial number: ${error.message}`, 500);
        }
    }
}

module.exports = Controller;