const db = require('../config/database');
const logger = require('../utils/logger');
const AlertRuleChange = require('./AlertRuleChange');

// [Sprint 10 PR-5] Whitelist of fields the admin UI can PATCH. Anything
// outside this list is rejected to prevent column-name injection or
// accidental edit of immutable identity fields (alert_type, severity).
const EDITABLE_FIELDS = Object.freeze({
    enabled:                     { type: 'boolean' },
    uk_category:                 { type: 'string', maxLen: 50 },
    uk_urgency:                  { type: 'string', maxLen: 50 },
    description:                 { type: 'string', maxLen: 500 },
    min_persistence_seconds:     { type: 'int', min: 1, max: 3600 },
    min_affected_buildings:      { type: 'int', min: 1, max: 100 },
    verification_grace_seconds:  { type: 'int', min: 60, max: 1800 },
    verification_window_seconds: { type: 'int', min: 60, max: 3600 },
    max_reopens_per_24h:         { type: 'int', min: 0, max: 20 },
    reopen_cooldown_min:         { type: 'int', min: 1, max: 1440 },
    reopen_urgency_bump:         { type: 'boolean' }
});

function validateField(name, value) {
    const spec = EDITABLE_FIELDS[name];
    if (!spec) return { ok: false, error: `field "${name}" is not editable` };
    if (spec.type === 'boolean') {
        if (typeof value !== 'boolean') return { ok: false, error: `${name} must be boolean` };
    } else if (spec.type === 'int') {
        if (!Number.isInteger(value)) return { ok: false, error: `${name} must be integer` };
        if (spec.min !== undefined && value < spec.min) return { ok: false, error: `${name} must be ≥ ${spec.min}` };
        if (spec.max !== undefined && value > spec.max) return { ok: false, error: `${name} must be ≤ ${spec.max}` };
    } else if (spec.type === 'string') {
        if (typeof value !== 'string') return { ok: false, error: `${name} must be string` };
        if (spec.maxLen && value.length > spec.maxLen) return { ok: false, error: `${name} exceeds maxLen ${spec.maxLen}` };
    }
    return { ok: true };
}

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

    /**
     * [Sprint 10 PR-5] Toggle enabled flag + write audit entry.
     * Preserves the old single-arg signature for backward compat
     * (callers without userId continue to work, audit just records null).
     */
    static async toggleEnabled(id, enabled, userId = null, reason = null) {
        try {
            const before = await AlertRule.findById(id);
            if (!before) return null;
            if (before.enabled === enabled) return before; // no-op, no audit

            const result = await db.query(
                `UPDATE alert_rules SET enabled = $1, updated_at = NOW()
                 WHERE id = $2 RETURNING *`,
                [enabled, id]
            );
            if (result.rows[0]) {
                await AlertRuleChange.create({
                    rule_id: id,
                    changed_by: userId,
                    field_name: 'enabled',
                    old_value: before.enabled,
                    new_value: enabled,
                    reason
                }).catch((e) => logger.warn(`AlertRule.toggleEnabled audit write failed: ${e.message}`));
            }
            return result.rows[0] || null;
        } catch (error) {
            logger.error(`AlertRule.toggleEnabled error: ${error.message}`);
            throw error;
        }
    }

    /**
     * [Sprint 10 PR-5] PATCH the rule with a subset of editable fields.
     * Validates each field against EDITABLE_FIELDS spec. Writes one audit
     * row per changed field (skipped if value didn't actually change).
     *
     * Returns { rule, changes } where `rule` is the updated row and
     * `changes` is the list of audit entries written (may be empty if
     * all provided values matched current).
     *
     * Throws on invalid field name, type, or out-of-range value.
     */
    static async update(id, fields, userId = null, reason = null) {
        if (!id) throw new Error('AlertRule.update: id is required');
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
            throw new Error('AlertRule.update: fields must be a plain object');
        }
        const fieldNames = Object.keys(fields);
        if (fieldNames.length === 0) throw new Error('AlertRule.update: at least one field required');

        // Validate all fields BEFORE touching the DB so an invalid value
        // doesn't leave a partial state.
        for (const name of fieldNames) {
            const check = validateField(name, fields[name]);
            if (!check.ok) throw new Error(`AlertRule.update: ${check.error}`);
        }

        const before = await AlertRule.findById(id);
        if (!before) return { rule: null, changes: [] };

        // Filter to fields whose value actually changes
        const diffEntries = fieldNames
            .filter((name) => before[name] !== fields[name])
            .map((name) => ({ name, oldValue: before[name], newValue: fields[name] }));

        if (diffEntries.length === 0) {
            return { rule: before, changes: [] };
        }

        // Build dynamic UPDATE — column names are from the EDITABLE_FIELDS
        // whitelist (validated above), so no injection risk
        const setClauses = diffEntries.map((d, i) => `${d.name} = $${i + 2}`);
        setClauses.push('updated_at = NOW()');
        const sql = `UPDATE alert_rules SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`;
        const params = [id, ...diffEntries.map((d) => d.newValue)];

        const result = await db.query(sql, params);
        const updated = result.rows[0];

        // Audit log — one row per changed field
        const auditBatch = diffEntries.map((d) => ({
            rule_id: id,
            changed_by: userId,
            field_name: d.name,
            old_value: d.oldValue,
            new_value: d.newValue,
            reason
        }));
        const changes = await AlertRuleChange.createBatch(auditBatch).catch((e) => {
            logger.warn(`AlertRule.update audit batch failed: ${e.message}`);
            return [];
        });

        return { rule: updated, changes };
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

    /**
     * [Sprint 10 PR-5] Rules + per-rule activity stats for the admin UI
     * dashboard. Stats: count of alerts created in last `withinDays`
     * matching {alert_type, severity}; count of those that were sent to
     * УК via AlertRequestMap; count of reopens (alerts where
     * reopen_sequence > 1).
     */
    static async listWithStats(withinDays = 7) {
        try {
            const safeDays = Math.min(Math.max(parseInt(withinDays, 10) || 7, 1), 365);
            const result = await db.query(
                `SELECT
                    r.*,
                    COALESCE(stats.alert_count, 0)     AS alert_count,
                    COALESCE(stats.escalated_count, 0) AS escalated_count,
                    COALESCE(stats.reopen_count, 0)    AS reopen_count
                 FROM alert_rules r
                 LEFT JOIN LATERAL (
                    SELECT
                      COUNT(*) AS alert_count,
                      COUNT(*) FILTER (
                        WHERE EXISTS (
                          SELECT 1 FROM alert_request_map arm
                          WHERE arm.infrasafe_alert_id = a.alert_id
                            AND arm.status IN ('pending','sent','active','resolved')
                        )
                      ) AS escalated_count,
                      COUNT(*) FILTER (WHERE a.reopen_sequence > 1) AS reopen_count
                    FROM infrastructure_alerts a
                    WHERE a.type = r.alert_type
                      AND a.severity = r.severity
                      AND a.created_at >= NOW() - ($1::int * INTERVAL '1 day')
                 ) AS stats ON TRUE
                 ORDER BY r.alert_type, r.severity`,
                [safeDays]
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertRule.listWithStats error: ${error.message}`);
            throw error;
        }
    }
}

AlertRule.EDITABLE_FIELDS = EDITABLE_FIELDS;

module.exports = AlertRule;
