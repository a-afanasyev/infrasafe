const db = require('../config/database');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

class Alert {
    /**
     * Получить все оповещения с пагинацией и сортировкой
     * @param {number} page - Номер страницы
     * @param {number} limit - Количество элементов на странице
     * @param {string} status - Статус оповещений (active, resolved, all)
     * @param {string} sort - Поле для сортировки
     * @param {string} order - Направление сортировки (asc/desc)
     * @returns {Promise<Object>} - Объект с оповещениями и информацией о пагинации
     */
    static async findAll(page = 1, limit = 10, status = 'all', sort = 'created_at', order = 'desc') {
        try {
            const offset = (page - 1) * limit;
            const validOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order : 'desc';
            
            // Проверка допустимости поля сортировки
            const validColumns = ['alert_id', 'severity', 'status', 'created_at', 'resolved_at'];
            const sortColumn = validColumns.includes(sort) ? sort : 'created_at';
            
            let query = `
                SELECT a.*, at.type_name, m.controller_id, c.serial_number as controller_serial, b.name as building_name
                FROM alerts a
                JOIN alert_types at ON a.alert_type_id = at.alert_type_id
                JOIN metrics m ON a.metric_id = m.metric_id
                JOIN controllers c ON m.controller_id = c.controller_id
                JOIN buildings b ON c.building_id = b.building_id
            `;
            
            // Добавление фильтра по статусу
            const params = [];
            if (status !== 'all') {
                query += ' WHERE a.status = $1';
                params.push(status);
            }
            
            // Добавление сортировки
            query += ` ORDER BY a.${sortColumn} ${validOrder}`;
            
            // Добавление пагинации
            query += ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
            params.push(limit, offset);
            
            const { rows: alerts } = await db.query(query, params);
            
            // Получение общего количества оповещений
            let countQuery = 'SELECT COUNT(*) FROM alerts';
            if (status !== 'all') {
                countQuery += ' WHERE status = $1';
            }
            
            const { rows: countResult } = await db.query(countQuery, status !== 'all' ? [status] : []);
            const totalCount = parseInt(countResult[0].count);
            
            return {
                data: alerts,
                pagination: {
                    total: totalCount,
                    page,
                    limit,
                    totalPages: Math.ceil(totalCount / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in Alert.findAll: ${error.message}`);
            throw createError(`Failed to fetch alerts: ${error.message}`, 500);
        }
    }

    /**
     * Найти оповещение по ID
     * @param {number} id - ID оповещения
     * @returns {Promise<Object|null>} - Объект оповещения или null
     */
    static async findById(id) {
        try {
            const query = `
                SELECT a.*, at.type_name, m.controller_id, c.serial_number as controller_serial, b.name as building_name
                FROM alerts a
                JOIN alert_types at ON a.alert_type_id = at.alert_type_id
                JOIN metrics m ON a.metric_id = m.metric_id
                JOIN controllers c ON m.controller_id = c.controller_id
                JOIN buildings b ON c.building_id = b.building_id
                WHERE a.alert_id = $1
            `;
            
            const { rows } = await db.query(query, [id]);
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Alert.findById: ${error.message}`);
            throw createError(`Failed to fetch alert: ${error.message}`, 500);
        }
    }

    /**
     * Создать новое оповещение
     * @param {Object} alertData - Данные оповещения
     * @returns {Promise<Object>} - Созданное оповещение
     */
    static async create(alertData) {
        try {
            const { metric_id, alert_type_id, severity, status = 'active' } = alertData;
            
            const { rows } = await db.query(
                `INSERT INTO alerts 
                (metric_id, alert_type_id, severity, status, created_at) 
                VALUES ($1, $2, $3, $4, NOW()) 
                RETURNING *`,
                [metric_id, alert_type_id, severity, status]
            );
            
            logger.info(`Created new alert with ID: ${rows[0].alert_id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Alert.create: ${error.message}`);
            throw createError(`Failed to create alert: ${error.message}`, 500);
        }
    }

    /**
     * Обновить статус оповещения
     * @param {number} id - ID оповещения
     * @param {string} status - Новый статус
     * @returns {Promise<Object|null>} - Обновленное оповещение или null
     */
    static async updateStatus(id, status) {
        try {
            let query = 'UPDATE alerts SET status = $1';
            const params = [status];
            
            // Если статус "resolved", добавляем время разрешения
            if (status === 'resolved') {
                query += ', resolved_at = NOW()';
            }
            
            query += ' WHERE alert_id = $2 RETURNING *';
            params.push(id);
            
            const { rows } = await db.query(query, params);
            
            if (!rows.length) {
                return null;
            }
            
            logger.info(`Updated alert status to ${status} for alert ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Alert.updateStatus: ${error.message}`);
            throw createError(`Failed to update alert status: ${error.message}`, 500);
        }
    }

    /**
     * Удалить оповещение
     * @param {number} id - ID оповещения
     * @returns {Promise<Object|null>} - Удаленное оповещение или null
     */
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM alerts WHERE alert_id = $1 RETURNING *',
                [id]
            );
            
            if (!rows.length) {
                return null;
            }
            
            logger.info(`Deleted alert with ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in Alert.delete: ${error.message}`);
            throw createError(`Failed to delete alert: ${error.message}`, 500);
        }
    }
}

module.exports = Alert; 