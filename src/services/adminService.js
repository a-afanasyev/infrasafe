const db = require('../config/database');
const logger = require('../utils/logger');

// [Sprint 10 PR-1.5] Removed 'alerts' (legacy table dropped — was 0 rows in
// prod, unused by active code) and 'alert_types' (catalog dropped — never
// reconciled with code-side string literals like LEAK_DETECTED). Active
// alerts live in `infrastructure_alerts` which carries a free-form `type`
// VARCHAR(50) column instead.
// [Q-20] Только то, что реально передают контроллеры (batchDelete — пять
// таблиц, batchUpdateColumn — напряжение и мощность). Прежний список включал
// `users`, `is_active`, `integration_*` и т.п. без единого вызова: он не
// открывал ничего сам (идентификаторы — литералы в коде), но делал пакетную
// правку чужой таблицы одной строкой в контроллере.
const ALLOWED_TABLES = ['buildings', 'controllers', 'metrics', 'transformers', 'lines'];

const ALLOWED_COLUMNS = [
    'building_id', 'controller_id', 'metric_id', 'transformer_id', 'line_id',
    'voltage_kv', 'power_kva'
];

function assertAllowedIdentifier(value, allowlist, label) {
    if (!allowlist.includes(value)) {
        throw new Error(`SQL identifier "${value}" not allowed for ${label}`);
    }
}

/**
 * Shared batch-operation helpers for admin controllers.
 */
class AdminService {

    /**
     * Batch delete rows by ID.
     * @param {string} tableName - SQL table name (must be a trusted literal).
     * @param {string} idColumn  - Primary-key column name (must be a trusted literal).
     * @param {number[]} ids     - Array of IDs to delete.
     * @returns {Promise<{rows: object[], rowCount: number}>}
     */
    async batchDelete(tableName, idColumn, ids) {
        assertAllowedIdentifier(tableName, ALLOWED_TABLES, 'table');
        assertAllowedIdentifier(idColumn, ALLOWED_COLUMNS, 'column');
        const query = `DELETE FROM ${tableName} WHERE ${idColumn} = ANY($1) RETURNING ${idColumn}`;
        const result = await db.query(query, [ids]);
        logger.info(`Batch delete from ${tableName}: ${result.rowCount} rows removed`);
        return result;
    }

    /**
     * Batch update a single column for a set of rows.
     * @param {string} tableName  - SQL table name (must be a trusted literal).
     * @param {string} idColumn   - Primary-key column name (must be a trusted literal).
     * @param {number[]} ids      - Array of IDs to update.
     * @param {string} column     - Column to set (must be a trusted literal).
     * @param {*} value           - New value.
     * @returns {Promise<{rows: object[], rowCount: number}>}
     */
    async batchUpdateColumn(tableName, idColumn, ids, column, value) {
        assertAllowedIdentifier(tableName, ALLOWED_TABLES, 'table');
        assertAllowedIdentifier(idColumn, ALLOWED_COLUMNS, 'column');
        assertAllowedIdentifier(column, ALLOWED_COLUMNS, 'column');
        const query = `UPDATE ${tableName} SET ${column} = $1, updated_at = NOW() WHERE ${idColumn} = ANY($2) RETURNING ${idColumn}`;
        const result = await db.query(query, [value, ids]);
        logger.info(`Batch update ${column} in ${tableName}: ${result.rowCount} rows updated`);
        return result;
    }

    /**
     * [R2-04] Dashboard entity counts. Moved out of adminGeneralController so the
     * controller stays pure HTTP (call service → shape response) instead of running
     * SQL directly. "Active" alerts = active + acknowledged (an acknowledged alert
     * is still open — AUD-007); the legacy `alerts` table was dropped in mig 028, so
     * the live source is `infrastructure_alerts`.
     * @returns {Promise<{buildings:{total:number}, controllers:{total:number}, metrics:{total:number}, alerts:{active:number}}>}
     */
    async getDashboardStats() {
        const [buildings, controllers, metrics, alerts] = await Promise.all([
            db.query('SELECT COUNT(*) FROM buildings'),
            db.query('SELECT COUNT(*) FROM controllers'),
            db.query('SELECT COUNT(*) FROM metrics'),
            db.query("SELECT COUNT(*) FROM infrastructure_alerts WHERE status IN ('active', 'acknowledged')"),
        ]);
        return {
            buildings:   { total: parseInt(buildings.rows[0].count, 10) },
            controllers: { total: parseInt(controllers.rows[0].count, 10) },
            metrics:     { total: parseInt(metrics.rows[0].count, 10) },
            alerts:      { active: parseInt(alerts.rows[0].count, 10) },
        };
    }
}

module.exports = new AdminService();
