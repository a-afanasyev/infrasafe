const db = require('../config/database');
const logger = require('../utils/logger');

class IntegrationLog {
    /**
     * Create a new integration log entry
     * @param {Object} data - Log entry data
     * @returns {Promise<Object>} - Created log entry
     */
    static async create(data) {
        try {
            const {
                event_id,
                direction,
                entity_type,
                entity_id,
                action,
                payload,
                status = 'pending'
            } = data;

            const { rows } = await db.query(
                `INSERT INTO integration_log
                (event_id, direction, entity_type, entity_id, action, payload, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [event_id, direction, entity_type, entity_id, action, JSON.stringify(payload), status]
            );

            logger.info(`Created integration log entry with ID: ${rows[0].id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in IntegrationLog.create: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find a log entry by event ID
     * @param {string} eventId - The event ID to search for
     * @returns {Promise<Object|null>} - Log entry or null
     */
    static async findByEventId(eventId) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM integration_log WHERE event_id = $1',
                [eventId]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in IntegrationLog.findByEventId: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find a log entry by ID
     * @param {number} id - The log entry ID
     * @returns {Promise<Object|null>} - Log entry or null
     */
    static async findById(id) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM integration_log WHERE id = $1',
                [id]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in IntegrationLog.findById: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update the status and optional error message of a log entry
     * @param {number} id - The log entry ID
     * @param {string} status - New status
     * @param {string|null} errorMessage - Optional error message
     * @returns {Promise<Object>} - Updated log entry
     */
    static async updateStatus(id, status, errorMessage = null) {
        try {
            const { rows } = await db.query(
                `UPDATE integration_log
                SET status = $1, error_message = $2
                WHERE id = $3
                RETURNING *`,
                [status, errorMessage, id]
            );
            logger.info(`Updated integration log status to ${status} for ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in IntegrationLog.updateStatus: ${error.message}`);
            throw error;
        }
    }

    /**
     * Increment the retry count for a log entry
     * @param {number} id - The log entry ID
     * @returns {Promise<Object>} - Updated log entry
     */
    static async incrementRetry(id) {
        try {
            const { rows } = await db.query(
                `UPDATE integration_log
                SET retry_count = retry_count + 1
                WHERE id = $1
                RETURNING *`,
                [id]
            );
            logger.info(`Incremented retry count for integration log ID: ${id}`);
            return rows[0];
        } catch (error) {
            logger.error(`Error in IntegrationLog.incrementRetry: ${error.message}`);
            throw error;
        }
    }

    /**
     * Find all log entries with optional filters and pagination
     * @param {Object} filters - Optional filter parameters
     * @returns {Promise<Object>} - { logs: [], total: number }
     */
    static async findAll(filters = {}) {
        try {
            const {
                direction,
                status,
                entity_type,
                date_from,
                date_to,
                page = 1,
                limit = 20
            } = filters;

            const offset = (page - 1) * limit;
            const params = [];
            const conditions = [];

            if (direction) {
                params.push(direction);
                conditions.push(`direction = $${params.length}`);
            }

            if (status) {
                params.push(status);
                conditions.push(`status = $${params.length}`);
            }

            if (entity_type) {
                params.push(entity_type);
                conditions.push(`entity_type = $${params.length}`);
            }

            if (date_from) {
                params.push(date_from);
                conditions.push(`created_at >= $${params.length}`);
            }

            if (date_to) {
                params.push(date_to);
                conditions.push(`created_at <= $${params.length}`);
            }

            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

            const countQuery = `SELECT COUNT(*) FROM integration_log ${whereClause}`;
            const { rows: countRows } = await db.query(countQuery, params);
            const total = parseInt(countRows[0].count);

            const dataParams = [...params, limit, offset];
            const dataQuery = `SELECT * FROM integration_log ${whereClause} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
            const { rows: logs } = await db.query(dataQuery, dataParams);

            return { logs, total };
        } catch (error) {
            logger.error(`Error in IntegrationLog.findAll: ${error.message}`);
            throw error;
        }
    }
}

module.exports = IntegrationLog;
