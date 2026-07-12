const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');
const { buildUpdateQuery } = require('../utils/dynamicUpdateBuilder');
const { validateSearchString } = require('../utils/queryValidation');

// [AUD-009] Columns writable on update (matches the prior hand-rolled set —
// installation_date is create-only, kept that way).
const TRANSFORMER_UPDATE_COLUMNS = [
    'name', 'power_kva', 'voltage_kv', 'latitude', 'longitude',
    'location', 'status', 'manufacturer', 'model',
];

class Transformer {
    constructor(data) {
        this.transformer_id = data.transformer_id;
        this.name = data.name;
        this.power_kva = data.power_kva;
        this.voltage_kv = data.voltage_kv;
        this.latitude = data.latitude;
        this.longitude = data.longitude;
        this.location = data.location;
        this.status = data.status;
        this.manufacturer = data.manufacturer;
        this.model = data.model;
        // [AUD-039] Richer columns consolidated from the deprecated power_transformers
        // table (migration 036). Undefined on rows that predate the port — harmless.
        this.address = data.address;
        this.voltage_primary = data.voltage_primary;
        this.voltage_secondary = data.voltage_secondary;
        this.installation_date = data.installation_date;
        this.maintenance_contact = data.maintenance_contact;
        this.notes = data.notes;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
        this.primary_buildings = data.primary_buildings || [];
        this.backup_buildings = data.backup_buildings || [];
    }

    // Получить все трансформаторы с пагинацией и списком обслуживаемых зданий
    static async findAll(page = 1, limit = 10, filters = {}) {
        try {
            const offset = (page - 1) * limit;
            let whereClause = '';
            let values = [];
            let paramCount = 0;

            // Построение WHERE клаузы для фильтров
            const conditions = [];

            if (filters.name) {
                // M-8: escape ILIKE wildcards (%, _) so a name containing them
                // is matched literally instead of acting as a pattern.
                paramCount++;
                conditions.push(`t.name ILIKE $${paramCount}`);
                values.push(`%${validateSearchString(filters.name)}%`);
            }

            if (filters.power_kva) {
                paramCount++;
                conditions.push(`t.power_kva >= $${paramCount}`);
                values.push(filters.power_kva);
            }

            if (filters.voltage_kv) {
                paramCount++;
                conditions.push(`t.voltage_kv = $${paramCount}`);
                values.push(filters.voltage_kv);
            }

            if (conditions.length > 0) {
                whereClause = 'WHERE ' + conditions.join(' AND ');
            }

            // Запрос для получения общего количества
            const countQuery = `SELECT COUNT(*) FROM transformers t ${whereClause}`;
            const countResult = await db.query(countQuery, values);
            const total = parseInt(countResult.rows[0].count);

            // Запрос для получения данных с пагинацией и списком зданий
            const dataQuery = `
                SELECT
                    t.*,
                    COALESCE(
                        array_agg(DISTINCT pb.name) FILTER (WHERE pb.name IS NOT NULL),
                        '{}'
                    ) as primary_buildings,
                    COALESCE(
                        array_agg(DISTINCT bb.name) FILTER (WHERE bb.name IS NOT NULL),
                        '{}'
                    ) as backup_buildings
                FROM transformers t
                LEFT JOIN buildings pb ON t.transformer_id = pb.primary_transformer_id
                LEFT JOIN buildings bb ON t.transformer_id = bb.backup_transformer_id
                ${whereClause}
                GROUP BY t.transformer_id
                ORDER BY t.transformer_id
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `;
            values.push(limit, offset);

            const { rows } = await db.query(dataQuery, values);

            return {
                data: rows.map(row => new Transformer(row)),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in Transformer.findAll: ${error.message}`);
            throw createError(`Failed to fetch transformers: ${error.message}`, 500);
        }
    }

    // Получить трансформатор по ID
    static async findById(id) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM transformers WHERE transformer_id = $1',
                [id]
            );

            if (!rows.length) {
                return null;
            }

            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.findById: ${error.message}`);
            throw createError(`Failed to fetch transformer: ${error.message}`, 500);
        }
    }

    // Создать новый трансформатор.
    // Обязательные: name, power_kva, voltage_kv. Остальные поля — опциональны
    // и записываются только если переданы (чтобы SQL дефолты и NOT NULL
    // constraints не конфликтовали с "пустыми" значениями из форм).
    static async create(transformerData) {
        try {
            const fields = [];
            const values = [];
            const optionalFields = [
                'name', 'power_kva', 'voltage_kv',
                'location', 'latitude', 'longitude',
                'installation_date', 'manufacturer', 'model', 'status',
            ];
            for (const key of optionalFields) {
                const v = transformerData[key];
                // Skip undefined/null/NaN so PG defaults apply
                if (v === undefined || v === null) continue;
                if (typeof v === 'number' && Number.isNaN(v)) continue;
                fields.push(key);
                values.push(v);
            }
            if (fields.length < 3) {
                throw createError('name, power_kva and voltage_kv are required', 400);
            }

            const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
            const { rows } = await db.query(
                `INSERT INTO transformers (${fields.join(', ')})
                 VALUES (${placeholders})
                 RETURNING *`,
                values
            );

            logger.info(`Created transformer: ${transformerData.name}`);
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.create: ${error.message}`);
            if (error.statusCode) throw error;
            throw createError(`Failed to create transformer: ${error.message}`, 500);
        }
    }

    // Обновить трансформатор.
    // [AUD-009] Делегирует построение SET в общий buildUpdateQuery; пустое тело → 400.
    static async update(id, transformerData) {
        try {
            let query, params;
            try {
                ({ query, params } = buildUpdateQuery(
                    'transformers', 'transformer_id', id, transformerData, TRANSFORMER_UPDATE_COLUMNS
                ));
            } catch (e) {
                if (e.message === 'No valid fields to update') {
                    throw createError('No valid fields to update transformer', 400);
                }
                throw e;
            }

            const { rows } = await db.query(query, params);
            if (!rows.length) {
                return null;
            }

            logger.info(`Updated transformer with ID: ${id}`);
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.update: ${error.message}`);
            if (error.statusCode) throw error;
            throw createError(`Failed to update transformer: ${error.message}`, 500);
        }
    }

    // Удалить трансформатор
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM transformers WHERE transformer_id = $1 RETURNING *',
                [id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Deleted transformer with ID: ${id}`);
            return new Transformer(rows[0]);
        } catch (error) {
            logger.error(`Error in Transformer.delete: ${error.message}`);
            throw createError(`Failed to delete transformer: ${error.message}`, 500);
        }
    }

    // Найти трансформаторы обслуживающие здание
    static async findByBuildingId(buildingId) {
        try {
            const { rows } = await db.query(
                `SELECT DISTINCT t.* FROM transformers t
                 LEFT JOIN buildings b ON (t.transformer_id = b.primary_transformer_id OR t.transformer_id = b.backup_transformer_id)
                 WHERE b.building_id = $1`,
                [buildingId]
            );

            return rows.map(row => new Transformer(row));
        } catch (error) {
            logger.error(`Error in Transformer.findByBuildingId: ${error.message}`);
            throw createError(`Failed to fetch transformers by building: ${error.message}`, 500);
        }
    }

    // ---- [AUD-039] Analytics read-methods ----
    // Consolidated from the deprecated PowerTransformer model onto the canonical
    // `transformers` table. mv_transformer_load_realtime is keyed by transformer_id
    // (migration 012 rebuilt the MV onto `transformers`); the geo methods read
    // transformers.geom (kept in sync from lat/lng by trig_transformers_geom).

    // Real-time load analytics for one transformer (from the MV).
    static async getLoadAnalytics(id) {
        const { rows } = await db.query(
            'SELECT * FROM mv_transformer_load_realtime WHERE id = $1',
            [id]
        );
        return rows.length ? rows[0] : null;
    }

    // All transformers with load analytics, most-loaded first.
    static async getAllWithLoadAnalytics() {
        const { rows } = await db.query(
            'SELECT * FROM mv_transformer_load_realtime ORDER BY load_percent DESC, name'
        );
        return rows;
    }

    // Transformers at/above a load threshold.
    static async getOverloadedTransformers(threshold = 80) {
        const { rows } = await db.query(
            `SELECT * FROM mv_transformer_load_realtime
             WHERE load_percent >= $1
             ORDER BY load_percent DESC`,
            [threshold]
        );
        return rows;
    }

    // Nearest buildings to a transformer. Passes an INTEGER transformer_id →
    // resolves to the INTEGER overload of the function added in migration 036
    // (reads `transformers`, not the legacy power_transformers VARCHAR overload).
    static async findNearestBuildings(id, maxDistance = 1000, limit = 50) {
        const { rows } = await db.query(
            'SELECT * FROM find_nearest_buildings_to_transformer($1, $2, $3)',
            [id, maxDistance, limit]
        );
        return rows;
    }

    // Transformers within a radius (metres) of a point, nearest first.
    static async findInRadius(latitude, longitude, radiusMeters = 5000) {
        const { rows } = await db.query(
            `SELECT t.*,
                    ST_Distance(
                        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                        t.geom::geography
                    ) AS distance_meters
             FROM transformers t
             WHERE t.geom IS NOT NULL
               AND ST_DWithin(
                   ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                   t.geom::geography,
                   $3
               )
             ORDER BY distance_meters`,
            [latitude, longitude, radiusMeters]
        );
        return rows.map(row => ({
            ...new Transformer(row),
            distance_meters: parseFloat(row.distance_meters)
        }));
    }

    // Aggregate statistics across all transformers (capacity = power_kva).
    static async getStatistics() {
        const { rows } = await db.query(
            `SELECT
                COUNT(*) AS total_count,
                COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_count,
                COUNT(CASE WHEN status = 'maintenance' THEN 1 END) AS maintenance_count,
                COUNT(CASE WHEN status = 'inactive' THEN 1 END) AS inactive_count,
                AVG(power_kva) AS avg_capacity,
                SUM(power_kva) AS total_capacity,
                MIN(power_kva) AS min_capacity,
                MAX(power_kva) AS max_capacity
             FROM transformers`
        );
        return rows[0];
    }
}

module.exports = Transformer;