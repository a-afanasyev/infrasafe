/**
 * Phase 5 DRY utility: builds a paginated admin list query from a
 * per-controller config + Express req.
 *
 * Used by src/controllers/admin/*.js to replace ~60 LoC of copy-paste
 * per controller (pagination parsing, WHERE construction, COUNT+SELECT
 * dual-query, envelope assembly).
 *
 * SECURITY INVARIANT:
 *   Every SQL identifier (table name, column name, alias, selectSql,
 *   groupBy) is sourced from the caller's hardcoded config object —
 *   NEVER from req. User-supplied values flow only through $n
 *   parameters or through the existing queryValidation allowlist.
 *
 * @see validateSortOrder, validatePagination, validateSearchString
 *      in src/utils/queryValidation.js
 */

const {
    validateSortOrder,
    validatePagination,
    validateSearchString,
} = require('./queryValidation');

const ALLOWED_TABLES = new Set([
    'buildings',
    'controllers',
    'transformers',
    'lines',
    'water_lines',
    'cold_water_sources',
    'heat_sources',
    'metrics',
    'water_suppliers',
]);

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

const FILTER_KINDS = new Set(['exact', 'like', 'gte', 'lte']);

function assertIdent(name, role) {
    if (!IDENT_RE.test(name)) {
        throw new Error(`adminQueryBuilder: invalid ${role} '${name}'`);
    }
}

/**
 * @typedef {Object} FilterSpec
 * @property {string} param - name of req.query field (e.g. 'town', 'status')
 * @property {string} [column] - SQL column to match against (defaults to param)
 * @property {'exact'|'like'|'gte'|'lte'} kind
 * @property {'int'} [cast] - optional numeric cast for gte/lte ranges
 *
 * @typedef {Object} ListConfig
 * @property {string}   table          - whitelist table name
 * @property {string}   entityType     - key in queryValidation.allowedSortColumns
 * @property {string}   [tableAlias]   - SQL alias (e.g. 'wl'); used in FROM when selectSql omitted
 * @property {string}   [defaultSort]  - fallback sort column (takes precedence over queryValidation default)
 * @property {number}   [defaultLimit] - default page size (default: 50)
 * @property {string}   [selectSql]    - full SELECT body incl. FROM/JOIN (default: 'SELECT * FROM <table>')
 * @property {string}   [groupBy]      - optional GROUP BY clause
 * @property {string[]} [searchColumns]- columns to OR-ILIKE when ?search=... present
 * @property {FilterSpec[]} [filters]
 * @property {Object<string,string>} [sortAliasMap] - remap validSort → real column (e.g. { id: 'transformer_id' })
 */

/**
 * Build and run a paginated list query.
 *
 * @param {import('pg').Pool} pool
 * @param {ListConfig} config
 * @param {import('express').Request} req
 * @returns {Promise<{ data: Array<Object>, pagination: { total: number, page: number, limit: number, totalPages: number } }>}
 */
async function buildPaginatedList(pool, config, req) {
    if (!config || typeof config !== 'object') {
        throw new Error('adminQueryBuilder: config is required');
    }
    const {
        table,
        entityType,
        tableAlias,
        defaultSort,
        defaultLimit = 50,
        selectSql,
        groupBy,
        searchColumns,
        filters = [],
        sortAliasMap,
    } = config;

    // Identifier validation — every hardcoded string must still be shaped
    // like a SQL identifier. Defence-in-depth against a future bad config.
    if (!ALLOWED_TABLES.has(table)) {
        throw new Error(`adminQueryBuilder: unsupported table '${table}'`);
    }
    if (tableAlias) assertIdent(tableAlias, 'tableAlias');
    if (groupBy && typeof groupBy !== 'string') {
        throw new Error('adminQueryBuilder: groupBy must be a string');
    }

    // Pull request params — only these come from the caller/user.
    const query = req.query || {};
    const rawSort = query.sort || defaultSort || null;
    const rawOrder = query.order || null;
    const rawPage = query.page || 1;
    const rawLimit = query.limit || defaultLimit;
    const rawSearch = query.search;

    const { validSort, validOrder } = validateSortOrder(entityType, rawSort, rawOrder);
    const { pageNum, limitNum, offset } = validatePagination(rawPage, rawLimit);

    // Resolve sort column: sortAliasMap lets callers expose 'id' while the
    // real column is e.g. 'transformer_id'. The map is from code, not req.
    let sortColumn = validSort;
    if (sortAliasMap && Object.prototype.hasOwnProperty.call(sortAliasMap, validSort)) {
        sortColumn = sortAliasMap[validSort];
    }
    assertIdent(sortColumn, 'sort column');

    const whereConditions = [];
    const params = [];

    for (const f of filters) {
        if (!f || !f.param) continue;
        const value = query[f.param];
        if (value === undefined || value === null || value === '') continue;
        if (!FILTER_KINDS.has(f.kind)) {
            throw new Error(`adminQueryBuilder: unsupported filter kind '${f.kind}' for ${f.param}`);
        }
        const column = f.column || f.param;
        assertIdent(column, `filter column for '${f.param}'`);

        if (f.kind === 'exact') {
            params.push(value);
            whereConditions.push(`${column} = $${params.length}`);
        } else if (f.kind === 'like') {
            const cleanValue = validateSearchString(String(value));
            params.push(`%${cleanValue}%`);
            whereConditions.push(`${column} ILIKE $${params.length}`);
        } else if (f.kind === 'gte' || f.kind === 'lte') {
            let numericValue;
            if (f.cast === 'int') numericValue = parseInt(value, 10);
            else numericValue = Number(value);
            if (!Number.isFinite(numericValue)) continue;
            params.push(numericValue);
            const op = f.kind === 'gte' ? '>=' : '<=';
            whereConditions.push(`${column} ${op} $${params.length}`);
        }
    }

    if (rawSearch && Array.isArray(searchColumns) && searchColumns.length > 0) {
        const cleanSearch = validateSearchString(String(rawSearch));
        if (cleanSearch) {
            params.push(`%${cleanSearch}%`);
            const orParts = searchColumns.map(col => {
                assertIdent(col, 'searchColumn');
                return `${col} ILIKE $${params.length}`;
            });
            whereConditions.push(`(${orParts.join(' OR ')})`);
        }
    }

    const whereClause = whereConditions.length > 0
        ? ` WHERE ${whereConditions.join(' AND ')}`
        : '';

    // COUNT can re-use the same WHERE/params without LIMIT/OFFSET.
    // GROUP BY is intentionally NOT applied to the count query — callers
    // want the total row count, not the grouped result count.
    const countQuery = `SELECT COUNT(*)::bigint AS count FROM ${table}${tableAlias ? ` ${tableAlias}` : ''}${whereClause}`;

    const selectBody = selectSql || `* FROM ${table}${tableAlias ? ` ${tableAlias}` : ''}`;
    const groupByClause = groupBy ? ` ${groupBy}` : '';

    const dataParams = [...params, limitNum, offset];
    const dataQuery = `
        SELECT ${selectBody}
        ${whereClause}
        ${groupByClause}
        ORDER BY ${sortColumn} ${validOrder}
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
    `;

    const [dataResult, countResult] = await Promise.all([
        pool.query(dataQuery, dataParams),
        pool.query(countQuery, params),
    ]);

    const total = parseInt(countResult.rows[0].count, 10) || 0;

    return {
        data: dataResult.rows,
        pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.max(1, Math.ceil(total / limitNum)),
        },
    };
}

module.exports = {
    buildPaginatedList,
    ALLOWED_TABLES,
};
