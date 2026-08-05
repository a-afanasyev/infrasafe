'use strict';

/**
 * [Sprint 10 PR-5] AlertRuleChange audit log model.
 *
 * Records every field-level edit of `alert_rules` made through the admin
 * UI. Writes are per-field (one row per field change), so a PATCH that
 * updates 3 fields creates 3 audit rows — gives operator a clean timeline
 * for revert / "who tuned this last week" lookups.
 *
 * Schema: see database/migrations/029_alert_rule_changes.sql
 */

const db = require('../config/database');
const logger = require('../utils/logger');

class AlertRuleChange {
    /**
     * Record a single field change.
     *
     * @param {Object} data
     * @param {number} data.rule_id
     * @param {number} [data.changed_by]   — user_id (null for system writes)
     * @param {string} data.field_name
     * @param {string|number|boolean|null} data.old_value
     * @param {string|number|boolean|null} data.new_value
     * @param {string} [data.reason]
     */
    static async create(data) {
        const { rule_id, changed_by = null, field_name, old_value, new_value, reason = null } = data;
        if (!rule_id || !field_name) {
            throw new Error('AlertRuleChange.create: rule_id and field_name are required');
        }
        try {
            const result = await db.query(
                `INSERT INTO alert_rule_changes
                    (rule_id, changed_by, field_name, old_value, new_value, reason, changed_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 RETURNING *`,
                [
                    rule_id, changed_by, field_name,
                    old_value === null || old_value === undefined ? null : String(old_value),
                    new_value === null || new_value === undefined ? null : String(new_value),
                    reason
                ]
            );
            return result.rows[0];
        } catch (error) {
            logger.error(`AlertRuleChange.create error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Record multiple field changes atomically. Used by AlertRule.update
     * when PATCH touches several fields. Wraps in a single transaction so
     * either all audit rows commit or none do.
     */
    static async createBatch(changes) {
        if (!Array.isArray(changes) || changes.length === 0) return [];
        const client = await db.getPool().connect();
        try {
            await client.query('BEGIN');
            const inserted = [];
            for (const c of changes) {
                const result = await client.query(
                    `INSERT INTO alert_rule_changes
                        (rule_id, changed_by, field_name, old_value, new_value, reason, changed_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW())
                     RETURNING *`,
                    [
                        c.rule_id, c.changed_by || null, c.field_name,
                        c.old_value === null || c.old_value === undefined ? null : String(c.old_value),
                        c.new_value === null || c.new_value === undefined ? null : String(c.new_value),
                        c.reason || null
                    ]
                );
                inserted.push(result.rows[0]);
            }
            await client.query('COMMIT');
            return inserted;
        } catch (error) {
            // [R2-22] Guard ROLLBACK: on a dropped connection the ROLLBACK itself
            // throws and would mask the original error. Swallow it, keep the cause.
            // [AR-11] Пустой catch заменён: сбой отката теперь логируется, а не
            // исчезает бесследно. [CO-2] Клиент помечается как испорченный.
            await db.safeRollback(client, 'AlertRuleChange.createBatch');
            logger.error(`AlertRuleChange.createBatch error: ${error.message}`);
            throw error;
        } finally {
            db.releaseClient(client);
        }
    }

    /**
     * Fetch change history for a rule, most-recent first. Limit clamped
     * to 200 to avoid runaway responses (UI uses a modal with pagination
     * if more is needed; for typical "what changed this week?" 50 covers).
     */
    static async findByRuleId(ruleId, limit = 50) {
        try {
            const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
            const result = await db.query(
                `SELECT arc.id, arc.rule_id, arc.changed_by, arc.changed_at,
                        arc.field_name, arc.old_value, arc.new_value, arc.reason,
                        u.username AS changed_by_username
                 FROM alert_rule_changes arc
                 LEFT JOIN users u ON u.user_id = arc.changed_by
                 WHERE arc.rule_id = $1
                 ORDER BY arc.changed_at DESC
                 LIMIT $2`,
                [ruleId, safeLimit]
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertRuleChange.findByRuleId error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AlertRuleChange;
