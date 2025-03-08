const db = require('../config/database');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

class AlertType {
    /**
     * Получить все типы оповещений
     * @returns {Promise<Array>} - Массив типов оповещений
     */
    static async findAll() {
        try {
            const { rows } = await db.query('SELECT * FROM alert_types ORDER BY type_name ASC');
            return rows;
        } catch (error) {
            logger.error(`Error in AlertType.findAll: ${error.message}`);
            throw createError(`Failed to fetch alert types: ${error.message}`, 500);
        }
    }

    /**
     * Найти тип оповещения по ID
     * @param {number} id - ID типа оповещения
     * @returns {Promise<Object|null>} - Объект типа оповещения или null
     */
    static async findById(id) {
        try {
            const { rows } = await db.query('SELECT * FROM alert_types WHERE alert_type_id = $1', [id]);
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in AlertType.findById: ${error.message}`);
            throw createError(`Failed to fetch alert type: ${error.message}`, 500);
        }
    }

    /**
     * Создать новый тип оповещения
     * @param {Object} data - Данные типа оповещения
     * @returns {Promise<Object>} - Созданный тип оповещения
     */
    static async create(data) {
        try {
            const { type_name, description } = data;
            
            const { rows } = await db.query(
                'INSERT INTO alert_types (type_name, description) VALUES ($1, $2) RETURNING *',
                [type_name, description]
            );
            
            logger.info(`Created new alert type with ID: ${rows[0].alert_type_id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in AlertType.create: ${error.message}`);
            throw createError(`Failed to create alert type: ${error.message}`, 500);
        }
    }

    /**
     * Обновить тип оповещения
     * @param {number} id - ID типа оповещения
     * @param {Object} data - Данные для обновления
     * @returns {Promise<Object|null>} - Обновленный тип оповещения или null
     */
    static async update(id, data) {
        try {
            const { type_name, description } = data;
            
            const { rows } = await db.query(
                'UPDATE alert_types SET type_name = $1, description = $2 WHERE alert_type_id = $3 RETURNING *',
                [type_name, description, id]
            );
            
            if (!rows.length) {
                return null;
            }
            
            logger.info(`Updated alert type with ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in AlertType.update: ${error.message}`);
            throw createError(`Failed to update alert type: ${error.message}`, 500);
        }
    }

    /**
     * Удалить тип оповещения
     * @param {number} id - ID типа оповещения
     * @returns {Promise<Object|null>} - Удаленный тип оповещения или null
     */
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM alert_types WHERE alert_type_id = $1 RETURNING *',
                [id]
            );
            
            if (!rows.length) {
                return null;
            }
            
            logger.info(`Deleted alert type with ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in AlertType.delete: ${error.message}`);
            throw createError(`Failed to delete alert type: ${error.message}`, 500);
        }
    }
}

module.exports = AlertType; 