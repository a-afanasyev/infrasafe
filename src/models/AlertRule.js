const db = require('../config/database');
const logger = require('../utils/logger');

class AlertRule {
    static async findAll() {
        try {
            const result = await db.query(
                'SELECT * FROM alert_rules ORDER BY alert_type, severity'
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertRule.findAll error: ${error.message}`);
            throw error;
        }
    }

    static async findById(id) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_rules WHERE id = $1',
                [id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRule.findById error: ${error.message}`);
            throw error;
        }
    }

    static async toggleEnabled(id, enabled) {
        try {
            const result = await db.query(
                `UPDATE alert_rules SET enabled = $1, updated_at = NOW()
                 WHERE id = $2 RETURNING *`,
                [enabled, id]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRule.toggleEnabled error: ${error.message}`);
            throw error;
        }
    }

    static async findByTypeAndSeverity(alertType, severity) {
        try {
            const result = await db.query(
                'SELECT * FROM alert_rules WHERE alert_type = $1 AND severity = $2 AND enabled = true',
                [alertType, severity]
            );
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRule.findByTypeAndSeverity error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AlertRule;
