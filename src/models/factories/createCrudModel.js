/**
 * Phase 6 DRY factory for standard CRUD model classes.
 *
 * Eliminates byte-for-byte duplication between ColdWaterSource and
 * HeatSource (152 lines each, identical scaffolding with different
 * table/column names). The generated class exposes the same public
 * surface the existing controllers already call:
 *
 *   - new ModelClass(row)             → row-wrapper instance
 *   - static findAll(page, limit, sort, order)  → { data, pagination }
 *   - static findById(id)             → instance | null
 *   - static create(data)             → instance
 *   - static update(id, data)         → instance | null
 *   - static delete(id)               → instance | null
 *
 * SECURITY: tableName and idColumn are interpolated into SQL. They
 * MUST be hardcoded strings from the caller — never from req. An
 * identifier regex + the whitelist in dynamicUpdateBuilder protect
 * against misconfiguration.
 */

const db = require('../../config/database');
const logger = require('../../utils/logger');
const { createError } = require('../../utils/helpers');
const { validateSortOrder } = require('../../utils/queryValidation');
const { buildUpdateQuery } = require('../../utils/dynamicUpdateBuilder');

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * @param {object} config
 * @param {string}   config.tableName       SQL table (must match dynamicUpdateBuilder whitelist)
 * @param {string}   config.idColumn        Primary-key column
 * @param {string}   config.entityName      Human-readable name for logs/errors
 * @param {string}   config.entityType      queryValidation entityType key (e.g. 'water_sources')
 * @param {string[]} config.fields          All columns exposed by the row wrapper
 * @param {string[]} config.createColumns   Columns accepted by INSERT (in INSERT order)
 * @param {string[]} config.updateColumns   Columns accepted by UPDATE
 * @param {object}   [config.defaults]      Per-column defaults on create (e.g. { status: 'active' })
 * @returns {class}
 */
function createCrudModel(config) {
    const {
        tableName, idColumn, entityName, entityType,
        fields, createColumns, updateColumns,
        defaults = {},
    } = config;

    if (!tableName || !IDENT_RE.test(tableName)) {
        throw new Error(`createCrudModel: invalid tableName '${tableName}'`);
    }
    if (!idColumn || !IDENT_RE.test(idColumn)) {
        throw new Error(`createCrudModel: invalid idColumn '${idColumn}'`);
    }
    if (!Array.isArray(fields) || !fields.length) {
        throw new Error('createCrudModel: fields array is required');
    }
    for (const arr of [fields, createColumns, updateColumns]) {
        for (const col of arr) {
            if (!IDENT_RE.test(col)) {
                throw new Error(`createCrudModel: invalid column '${col}' in ${tableName}`);
            }
        }
    }

    return class CrudModel {
        constructor(row = {}) {
            for (const f of fields) this[f] = row[f];
            this.created_at = row.created_at;
            this.updated_at = row.updated_at;
        }

        /**
         * @param {number|string} page
         * @param {number|string} limit
         * @param {string} sort    column name (validated via queryValidation.allowedSortColumns)
         * @param {string} order   'asc' | 'desc'
         * @returns {Promise<{ data: Array, pagination: { total, page, limit, totalPages } }>}
         */
        static async findAll(page = 1, limit = 10, sort = idColumn, order = 'asc') {
            try {
                const pageNum  = Math.max(1, parseInt(page, 10) || 1);
                const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 10));
                const offset   = (pageNum - 1) * limitNum;

                const { validSort, validOrder } = validateSortOrder(entityType, sort, order);

                const countResult = await db.query(`SELECT COUNT(*) FROM ${tableName}`);
                const total = parseInt(countResult.rows[0].count, 10) || 0;

                const { rows } = await db.query(
                    `SELECT * FROM ${tableName}
                     ORDER BY ${validSort} ${validOrder}
                     LIMIT $1 OFFSET $2`,
                    [limitNum, offset]
                );

                return {
                    data: rows.map(row => new CrudModel(row)),
                    pagination: {
                        page: pageNum,
                        limit: limitNum,
                        total,
                        totalPages: Math.max(1, Math.ceil(total / limitNum)),
                    },
                };
            } catch (error) {
                logger.error(`Error in ${entityName}.findAll: ${error.message}`);
                throw createError(`Failed to fetch ${entityName}: ${error.message}`, 500);
            }
        }

        static async findById(id) {
            try {
                const { rows } = await db.query(
                    `SELECT * FROM ${tableName} WHERE ${idColumn} = $1`,
                    [id]
                );
                if (!rows.length) return null;
                return new CrudModel(rows[0]);
            } catch (error) {
                logger.error(`Error in ${entityName}.findById: ${error.message}`);
                throw createError(`Failed to fetch ${entityName}: ${error.message}`, 500);
            }
        }

        static async create(data) {
            try {
                const values = createColumns.map(col => {
                    if (data[col] !== undefined) return data[col];
                    if (defaults[col] !== undefined) return defaults[col];
                    return null;
                });
                const placeholders = createColumns.map((_, i) => `$${i + 1}`).join(', ');
                const { rows } = await db.query(
                    `INSERT INTO ${tableName} (${createColumns.join(', ')})
                     VALUES (${placeholders})
                     RETURNING *`,
                    values
                );
                logger.info(`Created ${entityName}: ${data.name || rows[0][idColumn]}`);
                return new CrudModel(rows[0]);
            } catch (error) {
                logger.error(`Error in ${entityName}.create: ${error.message}`);
                throw createError(`Failed to create ${entityName}: ${error.message}`, 500);
            }
        }

        static async update(id, data) {
            try {
                let query, params;
                try {
                    ({ query, params } = buildUpdateQuery(
                        tableName, idColumn, id, data, updateColumns
                    ));
                } catch (e) {
                    if (e.message === 'No valid fields to update') {
                        throw createError(`No valid fields to update ${entityName}`, 400);
                    }
                    throw e;
                }

                const { rows } = await db.query(query, params);
                if (!rows.length) return null;
                logger.info(`Updated ${entityName} with ID: ${id}`);
                return new CrudModel(rows[0]);
            } catch (error) {
                logger.error(`Error in ${entityName}.update: ${error.message}`);
                if (error.statusCode) throw error;
                throw createError(`Failed to update ${entityName}: ${error.message}`, 500);
            }
        }

        static async delete(id) {
            try {
                const { rows } = await db.query(
                    `DELETE FROM ${tableName} WHERE ${idColumn} = $1 RETURNING *`,
                    [id]
                );
                if (!rows.length) return null;
                logger.info(`Deleted ${entityName} with ID: ${id}`);
                return new CrudModel(rows[0]);
            } catch (error) {
                logger.error(`Error in ${entityName}.delete: ${error.message}`);
                throw createError(`Failed to delete ${entityName}: ${error.message}`, 500);
            }
        }
    };
}

module.exports = { createCrudModel };
