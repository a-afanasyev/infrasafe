const db = require('../config/database');
const logger = require('../utils/logger');

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
        const query = `UPDATE ${tableName} SET ${column} = $1, updated_at = NOW() WHERE ${idColumn} = ANY($2) RETURNING ${idColumn}`;
        const result = await db.query(query, [value, ids]);
        logger.info(`Batch update ${column} in ${tableName}: ${result.rowCount} rows updated`);
        return result;
    }
}

module.exports = new AdminService();
