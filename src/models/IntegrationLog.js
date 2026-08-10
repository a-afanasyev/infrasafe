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
                status = 'pending',
                error_message = null
            } = data;

            const { rows } = await db.query(
                `INSERT INTO integration_log
                (event_id, direction, entity_type, entity_id, action, payload, status, error_message)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [event_id, direction, entity_type, entity_id, action, JSON.stringify(payload), status, error_message]
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
     * [B-007] Update a log entry's status keyed by event_id.
     * Used by the UK outbox drain worker to reflect retry/dead/success
     * transitions onto the row written at enqueue time. event_id is the
     * idempotency key, so it uniquely identifies the outbound event.
     * @param {string} eventId - The event_id (idempotency key)
     * @param {string} status - New status ('success' | 'retrying' | 'failed' | ...)
     * @param {string|null} errorMessage - Optional error detail
     * @returns {Promise<Object|null>} - Updated row, or null if no row matched
     */
    static async updateStatusByEventId(eventId, status, errorMessage = null) {
        try {
            const { rows } = await db.query(
                `UPDATE integration_log
                SET status = $1, error_message = $2
                WHERE event_id = $3
                RETURNING *`,
                [status, errorMessage, eventId]
            );
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in IntegrationLog.updateStatusByEventId: ${error.message}`);
            throw error;
        }
    }

    /**
     * [Variant A — UK deterministic event_id contract, 2026-07-22]
     * Atomically reclaim a failed inbound event row for reprocessing.
     * With deterministic event_ids a sender retry carries the SAME id, so a
     * leftover status='error' row must not permanently swallow the redelivery.
     * The `AND status = 'error'` guard makes the claim race-safe: of N
     * concurrent redeliveries exactly one wins the UPDATE (row → pending),
     * the rest match nothing and skip — same TOCTOU property the insert-first
     * UNIQUE constraint gives fresh events.
     * @param {string} eventId - The event_id of the failed row
     * @returns {Promise<Object|null>} - Reclaimed row, or null if no error row matched
     */
    static async reclaimErrorByEventId(eventId) {
        try {
            const { rows } = await db.query(
                `UPDATE integration_log
                SET status = 'pending', error_message = NULL, retry_count = retry_count + 1
                WHERE event_id = $1 AND status = 'error'
                RETURNING *`,
                [eventId]
            );
            if (rows.length) {
                logger.info(`Reclaimed error integration log entry for retry, ID: ${rows[0].id}`);
                return rows[0];
            }
            return null;
        } catch (error) {
            logger.error(`Error in IntegrationLog.reclaimErrorByEventId: ${error.message}`);
            throw error;
        }
    }

    /**
     * Increment the retry count for a log entry
     * @param {number} id - The log entry ID
     * @returns {Promise<Object>} - Updated log entry
     */
    /**
     * [AR-11] Пометить запись к повтору: статус в 'pending' и счётчик +1
     * ОДНИМ запросом.
     *
     * `retryLog` в контроллере делал это двумя автокоммитами — `updateStatus`,
     * затем `incrementRetry`. Между ними существовало окно, в котором строка
     * уже 'pending', а счётчик ещё старый: параллельный обработчик мог взять её
     * в работу повторно, а падение между вызовами оставляло счётчик
     * рассинхронизированным навсегда.
     *
     * Транзакция здесь была бы лишней: обе правки — по одной и той же строке
     * одной таблицы, и один UPDATE атомарен по определению. Отдельный метод, а
     * не связка в контроллере, — потому что «пометить к повтору» это одна
     * операция предметной области, а не две технические.
     *
     * @param {number} id
     * @returns {Promise<Object|null>} обновлённая строка или null
     */
    static async markForRetry(id) {
        try {
            const { rows } = await db.query(
                `UPDATE integration_log
                SET status = 'pending', retry_count = retry_count + 1
                WHERE id = $1
                RETURNING *`,
                [id]
            );
            logger.info(`Marked integration log ${id} for retry`);
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in IntegrationLog.markForRetry: ${error.message}`);
            throw error;
        }
    }

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

            const safePage = Math.max(1, page || 1);
            const safeLimit = Math.min(Math.max(1, limit || 20), 100);
            const offset = (safePage - 1) * safeLimit;
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

            const dataParams = [...params, safeLimit, offset];
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
