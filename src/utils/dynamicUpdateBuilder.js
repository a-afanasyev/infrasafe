/**
 * Phase 5 DRY utility: builds a dynamic UPDATE query from a partial
 * fields object, safely scoped to a per-controller allowlist of columns.
 *
 * Replaces the 20-line `updateFields.push(...)` pattern duplicated
 * across five admin controllers (transformer, line, water_line,
 * cold_water_source, heat_source).
 *
 * SECURITY INVARIANT:
 *   `table`, `pkColumn`, and every column name in `allowedFields` come
 *   from the caller's hardcoded config — NEVER from `req`. Values
 *   themselves flow through $n placeholders. Both table and pk are
 *   double-checked via the allowlist Set + identifier regex.
 */

const ALLOWED_UPDATE_TABLES = new Set([
    'buildings',
    'controllers',
    'transformers',
    'lines',
    'water_lines',
    'cold_water_sources',
    'heat_sources',
    'water_suppliers',
    'metrics',
]);

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Build a parameterized UPDATE statement.
 *
 * @param {string} table      - whitelist table name
 * @param {string} pkColumn   - primary-key column name
 * @param {string|number} id  - primary-key value
 * @param {Object<string, *>} fields
 *        Partial map of column → value. Only keys present in `allowedFields`
 *        AND with non-undefined values are included in the SET clause.
 * @param {string[]} allowedFields - column allowlist (from controller config)
 * @returns {{ query: string, params: Array }}
 * @throws {Error} when table or pkColumn fail validation, or when no valid
 *                 fields remain after filtering.
 */
function buildUpdateQuery(table, pkColumn, id, fields, allowedFields) {
    if (!ALLOWED_UPDATE_TABLES.has(table)) {
        throw new Error(`dynamicUpdateBuilder: unsupported table '${table}'`);
    }
    if (!IDENT_RE.test(pkColumn)) {
        throw new Error(`dynamicUpdateBuilder: invalid pkColumn '${pkColumn}'`);
    }
    if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
        throw new Error('dynamicUpdateBuilder: allowedFields must be a non-empty array');
    }
    for (const col of allowedFields) {
        if (!IDENT_RE.test(col)) {
            throw new Error(`dynamicUpdateBuilder: invalid allowed column '${col}'`);
        }
    }
    if (!fields || typeof fields !== 'object') {
        throw new Error('dynamicUpdateBuilder: fields object is required');
    }

    const allowed = new Set(allowedFields);
    const setClauses = [];
    const params = [];

    for (const [column, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        if (!allowed.has(column)) continue;
        params.push(value);
        setClauses.push(`${column} = $${params.length}`);
    }

    if (setClauses.length === 0) {
        throw new Error('No valid fields to update');
    }

    // updated_at is always refreshed — matches the current per-controller behavior.
    params.push(id);
    const query = `
        UPDATE ${table}
        SET ${setClauses.join(', ')}, updated_at = NOW()
        WHERE ${pkColumn} = $${params.length}
        RETURNING *
    `;

    return { query, params };
}

module.exports = {
    buildUpdateQuery,
    ALLOWED_UPDATE_TABLES,
};
