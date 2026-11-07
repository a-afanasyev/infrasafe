const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');
const { metricsQuery } = require('../config/thresholds');

// Числовые столбцы metrics — те, по которым считаются агрегаты. Зеркало
// NUMERIC_METRIC_FIELDS в metricService (там — для валидации входа).
const NUMERIC_METRIC_COLUMNS = Object.freeze([
    'electricity_ph1', 'electricity_ph2', 'electricity_ph3',
    'amperage_ph1', 'amperage_ph2', 'amperage_ph3',
    'cold_water_pressure', 'cold_water_temp',
    'hot_water_in_pressure', 'hot_water_out_pressure',
    'hot_water_in_temp', 'hot_water_out_temp',
    'air_temp', 'humidity'
]);

class Metric {
    static get NUMERIC_METRIC_COLUMNS() { return NUMERIC_METRIC_COLUMNS; }
    static get MAX_ROWS() { return metricsQuery.maxRows; }
    /**
     * Получить все метрики с пагинацией и сортировкой
     * @param {number} page - Номер страницы
     * @param {number} limit - Лимит записей на странице
     * @param {string} sort - Поле для сортировки
     * @param {string} order - Порядок сортировки (asc/desc)
     * @returns {Promise<Object>} - Объект с метриками и информацией о пагинации
     */
    static async findAll(page = 1, limit = 10, sort = 'timestamp', order = 'desc') {
        try {
            const offset = (page - 1) * limit;

            // Проверка сортировки для безопасности
            const validOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order : 'desc';
            const validColumns = [
                'metric_id', 'controller_id', 'timestamp',
                'electricity_ph1', 'electricity_ph2', 'electricity_ph3',
                'amperage_ph1', 'amperage_ph2', 'amperage_ph3',
                'cold_water_pressure', 'cold_water_temp',
                'hot_water_in_pressure', 'hot_water_out_pressure',
                'hot_water_in_temp', 'hot_water_out_temp',
                'air_temp', 'humidity', 'leak_sensor'
            ];
            const sortColumn = validColumns.includes(sort) ? sort : 'timestamp';

            // ИСПРАВЛЕНИЕ SQL INJECTION: Валидация параметров сортировки
            const { validateSortOrder } = require('../utils/queryValidation');
            const { validSort, validOrder: validOrderSecure } = validateSortOrder('metrics', sortColumn, validOrder);
            
            // Выборка с JOIN для получения данных о контроллерах
            const metricsQuery = `
                SELECT m.*, c.serial_number as controller_serial
                FROM metrics m
                LEFT JOIN controllers c ON m.controller_id = c.controller_id
                ORDER BY m.${validSort} ${validOrderSecure}
                LIMIT $1 OFFSET $2
            `;

            const { rows: metrics } = await db.query(metricsQuery, [limit, offset]);

            // Получение общего количества метрик
            const { rows: countResult } = await db.query('SELECT COUNT(*) FROM metrics');
            const totalCount = parseInt(countResult[0].count);

            return {
                data: metrics,
                pagination: {
                    total: totalCount,
                    page,
                    limit,
                    totalPages: Math.ceil(totalCount / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in Metric.findAll: ${error.message}`);
            throw createError(`Failed to fetch metrics: ${error.message}`);
        }
    }

    /**
     * Получить метрику по ID
     * @param {number} id - ID метрики
     * @returns {Promise<Object|null>} - Объект метрики или null, если не найдена
     */
    static async findById(id) {
        try {
            const query = `
                SELECT m.*, c.serial_number as controller_serial
                FROM metrics m
                LEFT JOIN controllers c ON m.controller_id = c.controller_id
                WHERE m.metric_id = $1
            `;

            const { rows } = await db.query(query, [id]);
            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Metric.findById: ${error.message}`);
            throw createError(`Failed to fetch metric: ${error.message}`);
        }
    }

    /**
     * Получить метрики по ID контроллера с возможностью фильтрации по дате
     * @param {number} controllerId - ID контроллера
     * @param {string} startDate - Начальная дата (опционально)
     * @param {string} endDate - Конечная дата (опционально)
     * @param {number} [limit=metricsQuery.maxRows] - Потолок строк. [S-INJ-2]
     *   LIMIT стоит ВСЕГДА: без него один запрос за всю историю контроллера
     *   тянул десятки тысяч строк в кучу и в кэш. Агрегаты за период считает
     *   aggregateByControllerId в SQL — этот метод отдаёт только сырые строки.
     * @returns {Promise<Array>} - Массив метрик (новые первыми)
     */
    static async findByControllerId(controllerId, startDate, endDate, limit = metricsQuery.maxRows) {
        try {
            let query = `
                SELECT * FROM metrics
                WHERE controller_id = $1
            `;

            const params = [controllerId];

            // Добавление фильтров по дате, если указаны
            if (startDate && endDate) {
                query += ` AND timestamp BETWEEN $2 AND $3`;
                params.push(startDate, endDate);
            } else if (startDate) {
                query += ` AND timestamp >= $2`;
                params.push(startDate);
            } else if (endDate) {
                query += ` AND timestamp <= $2`;
                params.push(endDate);
            }

            query += ` ORDER BY timestamp DESC`;

            // SEC-002 / [S-INJ-2]: LIMIT всегда; кривое значение → потолок.
            const safeLimit = Number.isInteger(limit) && limit > 0
                ? Math.min(limit, metricsQuery.maxRows)
                : metricsQuery.maxRows;
            query += ` LIMIT $${params.length + 1}`;
            params.push(safeLimit);

            const { rows } = await db.query(query, params);
            return rows;
        } catch (error) {
            logger.error(`Error in Metric.findByControllerId: ${error.message}`);
            throw createError(`Failed to fetch metrics for controller: ${error.message}`);
        }
    }

    /**
     * [S-INJ-2] Агрегаты за период — в SQL, по ВСЕМ строкам периода, а не по
     * обрезанной выборке findByControllerId: при одном измерении в минуту
     * неделя даёт 10 080 строк, и LIMIT 5000 прятал бы старые экстремумы.
     * Форма ответа совпадает с прежним aggregateMetrics (JS), чтобы потребители
     * GET /metrics/controller/:id/aggregated ничего не заметили.
     * @returns {Promise<Object>} { count, period:{start,end}, <поле>:{min,max,avg,count}|null }
     */
    static async aggregateByControllerId(controllerId, startDate, endDate) {
        try {
            const aggExpr = NUMERIC_METRIC_COLUMNS.map((c) =>
                `MIN(${c})::float AS ${c}_min, MAX(${c})::float AS ${c}_max, ` +
                `AVG(${c})::float AS ${c}_avg, COUNT(${c})::int AS ${c}_count`
            ).join(',\n                    ');
            const { rows } = await db.query(
                `SELECT COUNT(*)::int AS count,
                        MIN(timestamp) AS period_start,
                        MAX(timestamp) AS period_end,
                        ${aggExpr}
                   FROM metrics
                  WHERE controller_id = $1
                    AND timestamp BETWEEN $2 AND $3`,
                [controllerId, startDate, endDate]
            );
            const r = rows[0];
            if (!r || r.count === 0) {
                return { count: 0, period: null };
            }
            const aggregated = { count: r.count, period: { start: r.period_start, end: r.period_end } };
            for (const c of NUMERIC_METRIC_COLUMNS) {
                aggregated[c] = r[`${c}_count`] > 0
                    ? { min: r[`${c}_min`], max: r[`${c}_max`], avg: r[`${c}_avg`], count: r[`${c}_count`] }
                    : null;
            }
            return aggregated;
        } catch (error) {
            logger.error(`Error in Metric.aggregateByControllerId: ${error.message}`);
            throw createError(`Failed to aggregate metrics for controller: ${error.message}`);
        }
    }

    /**
     * Получить последние метрики для всех контроллеров
     * @returns {Promise<Array>} - Массив последних метрик для каждого контроллера
     */
    static async findLastForAllControllers() {
        try {
            // Используем оконную функцию для выбора самой последней метрики для каждого контроллера
            const query = `
                WITH ranked_metrics AS (
                    SELECT
                        m.*,
                        ROW_NUMBER() OVER (PARTITION BY m.controller_id ORDER BY m.timestamp DESC) as rn
                    FROM
                        metrics m
                )
                SELECT
                    rm.*,
                    c.serial_number as controller_serial,
                    b.name as building_name,
                    b.building_id
                FROM
                    ranked_metrics rm
                JOIN
                    controllers c ON rm.controller_id = c.controller_id
                JOIN
                    buildings b ON c.building_id = b.building_id
                WHERE
                    rm.rn = 1
                ORDER BY
                    c.controller_id ASC
            `;

            const { rows } = await db.query(query);
            return rows;
        } catch (error) {
            logger.error(`Error in Metric.findLastForAllControllers: ${error.message}`);
            throw createError(`Failed to fetch latest metrics: ${error.message}`);
        }
    }

    /**
     * Создать новую метрику
     * @param {Object} metricData - Данные метрики
     * @returns {Promise<Object>} - Созданная метрика
     */
    static async create(metricData) {
        try {
            const {
                controller_id, timestamp,
                electricity_ph1, electricity_ph2, electricity_ph3,
                amperage_ph1, amperage_ph2, amperage_ph3,
                cold_water_pressure, cold_water_temp,
                hot_water_in_pressure, hot_water_out_pressure,
                hot_water_in_temp, hot_water_out_temp,
                air_temp, humidity, leak_sensor
            } = metricData;

            const currentTimestamp = timestamp || new Date().toISOString();

            const query = `
                INSERT INTO metrics
                (controller_id, timestamp,
                 electricity_ph1, electricity_ph2, electricity_ph3,
                 amperage_ph1, amperage_ph2, amperage_ph3,
                 cold_water_pressure, cold_water_temp,
                 hot_water_in_pressure, hot_water_out_pressure,
                 hot_water_in_temp, hot_water_out_temp,
                 air_temp, humidity, leak_sensor)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING *
            `;

            const { rows } = await db.query(query, [
                controller_id, currentTimestamp,
                electricity_ph1, electricity_ph2, electricity_ph3,
                amperage_ph1, amperage_ph2, amperage_ph3,
                cold_water_pressure, cold_water_temp,
                hot_water_in_pressure, hot_water_out_pressure,
                hot_water_in_temp, hot_water_out_temp,
                air_temp, humidity, leak_sensor
            ]);

            return rows[0];
        } catch (error) {
            logger.error(`Error in Metric.create: ${error.message}`);
            throw createError(`Failed to create metric: ${error.message}`);
        }
    }

    /**
     * ARCH-103: Delete metrics older than cutoffDate in batches to avoid long locks.
     * @param {Date} cutoffDate
     * @param {number} batchSize - rows per DELETE (default 10000)
     * @returns {Promise<number>} - total rows deleted
     */
    static async deleteOlderThan(cutoffDate, batchSize = 10000) {
        if (!(cutoffDate instanceof Date) || isNaN(cutoffDate.getTime())) {
            throw new TypeError('cutoffDate must be a valid Date object');
        }
        const safeBatch = Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 100000
            ? batchSize : 10000;

        let totalDeleted = 0;
        let deleted;

        try {
            do {
                const result = await db.query(
                    `DELETE FROM metrics
                     WHERE metric_id IN (
                         SELECT metric_id FROM metrics
                         WHERE timestamp < $1
                         LIMIT $2
                     )`,
                    [cutoffDate.toISOString(), safeBatch]
                );
                deleted = result.rowCount;
                totalDeleted += deleted;
            } while (deleted === safeBatch);
        } catch (error) {
            logger.error(`deleteOlderThan failed after deleting ${totalDeleted} rows: ${error.message}`);
            throw error;
        }

        return totalDeleted;
    }

    /**
     * Удалить метрику по ID
     * @param {number} id - ID метрики
     * @returns {Promise<Object|null>} - Удаленная метрика или null, если не найдена
     */
    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM metrics WHERE metric_id = $1 RETURNING *',
                [id]
            );

            return rows.length ? rows[0] : null;
        } catch (error) {
            logger.error(`Error in Metric.delete: ${error.message}`);
            throw createError(`Failed to delete metric: ${error.message}`);
        }
    }
}

module.exports = Metric;