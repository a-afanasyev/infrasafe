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
}

module.exports = AlertRequestMap;
