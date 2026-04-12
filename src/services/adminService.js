const db = require('../config/database');
const logger = require('../utils/logger');

const ALLOWED_TABLES = [
    'buildings', 'controllers', 'metrics', 'alerts', 'alert_types',
    'power_transformers', 'transformers', 'cold_water_sources', 'heat_sources',
    'water_lines', 'water_suppliers', 'users', 'lines',
    'integration_config', 'integration_log', 'alert_rules', 'alert_request_map'
];

const ALLOWED_COLUMNS = [
    'building_id', 'controller_id', 'metric_id', 'alert_id', 'alert_type_id',
    'transformer_id', 'cold_water_source_id', 'heat_source_id',
    'water_line_id', 'water_supplier_id', 'user_id', 'id', 'line_id',
    'status', 'is_active', 'name', 'address', 'description',
    'voltage_kv', 'power_kva', 'maintenance_date',
    'updated_at', 'created_at'
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
}

module.exports = new AdminService();
