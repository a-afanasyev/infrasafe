const db = require('../config/database');
const logger = require('../utils/logger');

class AlertRequestMap {
    static async findByAlertId(alertId) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_request_map WHERE infrasafe_alert_id = $1 ORDER BY created_at',
                [alertId]
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertRequestMap.findByAlertId error: ${error.message}`);
            throw error;
        }
    }

    static async create(data) {
        try {
            const { infrasafe_alert_id, building_external_id, idempotency_key, status = 'pending' } = data;
            const result = await db.query(
                `INSERT INTO alert_request_map
                 (infrasafe_alert_id, building_external_id, idempotency_key, status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, NOW(), NOW())
                 RETURNING *`,
                [infrasafe_alert_id, building_external_id, idempotency_key, status]
            );
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505') {
                logger.warn('AlertRequestMap.create: duplicate alert+building pair');
                return null;
            }
            logger.error(`AlertRequestMap.create error: ${error.message}`);
            throw error;
        }
    }

    static async findByAlertAndBuilding(alertId, buildingExternalId) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_request_map WHERE infrasafe_alert_id = $1 AND building_external_id = $2',
                [alertId, buildingExternalId]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRequestMap.findByAlertAndBuilding error: ${error.message}`);
            throw error;
        }
    }

    static async markSent(id, requestNumber) {
        try {
            const result = await db.query(
                `UPDATE alert_request_map SET status = $1, uk_request_number = $2, updated_at = NOW()
                 WHERE id = $3 RETURNING *`,
                ['sent', requestNumber, id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRequestMap.markSent error: ${error.message}`);
            throw error;
        }
    }

    static async findByIdempotencyKey(idempotencyKey) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_request_map WHERE idempotency_key = $1',
                [idempotencyKey]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRequestMap.findByIdempotencyKey error: ${error.message}`);
            throw error;
        }
    }

    static async findByRequestNumber(requestNumber) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_request_map WHERE uk_request_number = $1',
                [requestNumber]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRequestMap.findByRequestNumber error: ${error.message}`);
            throw error;
        }
    }

    static async updateStatus(id, status) {
        try {
            const result = await db.query(
                'UPDATE alert_request_map SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
                [status, id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRequestMap.updateStatus error: ${error.message}`);
            throw error;
        }
    }

    static async areAllTerminal(alertId) {
        try {
            const result = await db.query(
                `SELECT COUNT(*) as total,
                        COUNT(*) FILTER (WHERE status IN ('resolved', 'cancelled')) as terminal
                 FROM alert_request_map
                 WHERE infrasafe_alert_id = $1`,
                [alertId]
            );
            const row = result.rows[0];
            if (!row || parseInt(row.total) === 0) return false;
            return parseInt(row.terminal) === parseInt(row.total);
        } catch (error) {
            logger.error(`AlertRequestMap.areAllTerminal error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AlertRequestMap;
