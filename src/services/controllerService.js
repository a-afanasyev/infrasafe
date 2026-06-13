const Controller = require('../models/Controller');
const Metric = require('../models/Metric');
const db = require('../config/database');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');

class ControllerService {
    constructor() {
        this.cachePrefix = 'controller';
        this.defaultCacheTTL = 300; // 5 минут
        this.statusTimeout = 600000; // 10 минут - время для определения offline статуса
    }

    // Получить все контроллеры с пагинацией и кэшированием
    async getAllControllers(page = 1, limit = 10, sort = 'controller_id', order = 'asc') {
        try {
            const cacheKey = `${this.cachePrefix}:list:${page}:${limit}:${sort}:${order}`;

            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                logger.debug(`Controllers list получен из кэша: ${cacheKey}`);
                return cached;
            }

            // Получаем данные из БД
            const result = await Controller.findAll(page, limit, sort, order);

            // Сохраняем в кэш
            await cacheService.set(cacheKey, result, { ttl: this.defaultCacheTTL });

            logger.info(`Получено ${result.data?.length || 0} контроллеров (страница ${page})`);
            return result;
        } catch (error) {
            logger.error(`Ошибка получения списка контроллеров: ${error.message}`);
            throw error;
        }
    }

    // Получить контроллер по ID
    async getControllerById(id) {
        try {
            const cacheKey = `${this.cachePrefix}:${id}`;

            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                logger.debug(`Controller ${id} получен из кэша`);
                return cached;
            }

            const controller = await Controller.findById(id);
            if (!controller) {
                logger.warn(`Контроллер с ID ${id} не найден`);
                return null;
            }

            // Сохраняем в кэш
            await cacheService.set(cacheKey, controller, { ttl: this.defaultCacheTTL });

            return controller;
        } catch (error) {
            logger.error(`Ошибка получения контроллера ${id}: ${error.message}`);
            throw error;
        }
    }

    // Получить контроллеры для здания
    async getControllersByBuildingId(buildingId) {
        try {
            const cacheKey = `${this.cachePrefix}:building:${buildingId}`;

            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                logger.debug(`Controllers for building ${buildingId} получены из кэша`);
                return cached;
            }

            const controllers = await Controller.findByBuildingId(buildingId);

            // Сохраняем в кэш
            await cacheService.set(cacheKey, controllers, { ttl: this.defaultCacheTTL });

            logger.info(`Получено ${controllers.length} контроллеров для здания ${buildingId}`);
            return controllers;
        } catch (error) {
            logger.error(`Ошибка получения контроллеров для здания ${buildingId}: ${error.message}`);
            throw error;
        }
    }

    // Получить метрики контроллера
    async getControllerMetrics(controllerId, startDate, endDate) {
        try {
            // Проверяем существование контроллера
            const controller = await this.getControllerById(controllerId);
            if (!controller) {
                const error = new Error('Контроллер не найден');
                error.code = 'CONTROLLER_NOT_FOUND';
                throw error;
            }

            // Создаем ключ кэша с учетом временного диапазона
            const cacheKey = `${this.cachePrefix}:${controllerId}:metrics:${startDate || 'all'}:${endDate || 'all'}`;

            // Для метрик используем более короткий TTL
            const metricsCache = await cacheService.get(cacheKey, { ttl: 60 }); // 1 минута
            if (metricsCache) {
                logger.debug(`Metrics for controller ${controllerId} получены из кэша`);
                return metricsCache;
            }

            const metrics = await Metric.findByControllerId(controllerId, startDate, endDate);

            // Сохраняем в кэш
            await cacheService.set(cacheKey, metrics, { ttl: 60 }); // 1 минута

            logger.info(`Получено ${metrics.length} метрик для контроллера ${controllerId}`);
            return metrics;
        } catch (error) {
            logger.error(`Ошибка получения метрик контроллера ${controllerId}: ${error.message}`);
            throw error;
        }
    }

    // Создать новый контроллер
    async createController(controllerData) {
        try {
            // Валидация данных
            this.validateControllerData(controllerData);

            const newController = await Controller.create(controllerData);

            // Инвалидируем кэш списков
            await this.invalidateControllerListCache();

            logger.info(`Создан новый контроллер: ${newController.serial_number} (ID: ${newController.controller_id})`);
            return newController;
        } catch (error) {
            logger.error(`Ошибка создания контроллера: ${error.message}`);
            throw error;
        }
    }

    // Обновить контроллер
    async updateController(id, updateData) {
        try {
            // Валидация данных
            this.validateControllerData(updateData, true);

            const updatedController = await Controller.update(id, updateData);

            if (!updatedController) {
                logger.warn(`Контроллер с ID ${id} не найден для обновления`);
                return null;
            }

            // Инвалидируем кэш
            await this.invalidateControllerCache(id);

            logger.info(`Обновлен контроллер ${id}: ${updatedController.serial_number}`);
            return updatedController;
        } catch (error) {
            logger.error(`Ошибка обновления контроллера ${id}: ${error.message}`);
            throw error;
        }
    }

    // Обновить статус контроллера
    async updateControllerStatus(id, status) {
        try {
            // Валидация статуса
            if (!status || !['online', 'offline', 'maintenance'].includes(status)) {
                const error = new Error('Некорректное значение статуса');
                error.code = 'INVALID_STATUS';
                throw error;
            }

            const updatedController = await Controller.updateStatus(id, status);

            if (!updatedController) {
                logger.warn(`Контроллер с ID ${id} не найден для обновления статуса`);
                return null;
            }

            // Инвалидируем кэш
            await this.invalidateControllerCache(id);

            logger.info(`Обновлен статус контроллера ${id}: ${status}`);
            return updatedController;
        } catch (error) {
            logger.error(`Ошибка обновления статуса контроллера ${id}: ${error.message}`);
            throw error;
        }
    }

    // Удалить контроллер с проверкой связанных метрик
    async deleteController(id) {
        try {
            // [AUD-036] Existence check only — LIMIT 1 keeps this O(1) on the
            // (potentially huge) metrics table. The previous `error.metricCount`
            // was always 1 (capped by the LIMIT) and had no consumer, so it is
            // dropped rather than replaced with a full COUNT(*) that would scan
            // every metric row just to populate an unused, delete-blocked field.
            const hasMetrics = await Metric.findByControllerId(id, null, null, 1);
            if (hasMetrics.length > 0) {
                const error = new Error('Невозможно удалить контроллер с привязанными метриками');
                error.code = 'CONTROLLER_HAS_METRICS';
                throw error;
            }

            const result = await Controller.delete(id);

            if (!result) {
                logger.warn(`Контроллер с ID ${id} не найден для удаления`);
                return null;
            }

            // Инвалидируем кэш
            await this.invalidateControllerCache(id);

            logger.info(`Удален контроллер ${id}`);
            return result;
        } catch (error) {
            logger.error(`Ошибка удаления контроллера ${id}: ${error.message}`);
            throw error;
        }
    }

    // Найти контроллер по серийному номеру
    async findBySerialNumber(serialNumber) {
        try {
            const cacheKey = `${this.cachePrefix}:serial:${serialNumber}`;

            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                logger.debug(`Controller by serial ${serialNumber} получен из кэша`);
                return cached;
            }

            const controller = await Controller.findBySerialNumber(serialNumber);

            if (controller) {
                // Сохраняем в кэш
                await cacheService.set(cacheKey, controller, { ttl: this.defaultCacheTTL });
            }

            return controller;
        } catch (error) {
            logger.error(`Ошибка поиска контроллера по серийному номеру ${serialNumber}: ${error.message}`);
            throw error;
        }
    }

    // PERF-001: Single CTE query replaces N+1 loop (was 1 + 2N queries for N controllers)
    // Logic: 10-min timeout, only online↔offline transitions, maintenance never touched
    async updateControllersStatusByActivity() {
        try {
            const timeoutMs = this.statusTimeout; // 600000ms = 10 minutes
            const timeoutInterval = `${Math.floor(timeoutMs / 60000)} minutes`;

            const result = await db.query(`
                WITH latest_metrics AS (
                    SELECT DISTINCT ON (controller_id)
                        controller_id,
                        timestamp
                    FROM metrics
                    ORDER BY controller_id, timestamp DESC
                ),
                status_calc AS (
                    SELECT
                        c.controller_id,
                        c.serial_number,
                        c.status AS current_status,
                        CASE
                            WHEN lm.timestamp IS NULL AND c.status != 'maintenance'
                                THEN 'offline'
                            WHEN lm.timestamp < NOW() - $1::interval
                                 AND c.status != 'offline' AND c.status != 'maintenance'
                                THEN 'offline'
                            WHEN lm.timestamp >= NOW() - $1::interval
                                 AND c.status = 'offline'
                                THEN 'online'
                            ELSE c.status
                        END AS new_status
                    FROM controllers c
                    LEFT JOIN latest_metrics lm ON c.controller_id = lm.controller_id
                )
                UPDATE controllers c
                SET status = sc.new_status, updated_at = NOW()
                FROM status_calc sc
                WHERE c.controller_id = sc.controller_id
                  AND c.status IS DISTINCT FROM sc.new_status
                RETURNING c.controller_id, sc.serial_number, sc.current_status, sc.new_status
            `, [timeoutInterval]);

            const updated = result.rowCount;

            for (const row of result.rows) {
                logger.info(`Контроллер ${row.serial_number} переведен из ${row.current_status} в ${row.new_status}`);
            }

            if (updated > 0) {
                await this.invalidateControllerListCache();
            }

            // Preserve original API contract: total = all controllers count
            const countResult = await db.query('SELECT COUNT(*) FROM controllers');
            const total = parseInt(countResult.rows[0].count, 10);

            logger.info(`Обновлено статусов контроллеров: ${updated} из ${total}`);
            return { updated, total };
        } catch (error) {
            logger.error(`Ошибка автоматического обновления статусов контроллеров: ${error.message}`);
            throw error;
        }
    }

    // Получить статистику по контроллерам
    async getControllersStatistics() {
        try {
            const cacheKey = `${this.cachePrefix}:statistics`;

            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                return cached;
            }

            // [AUD-036 p2] Aggregate in SQL (GROUP BY) instead of pulling up to
            // 10000 rows and counting them in JS.
            const [statusRes, buildingRes, totalRes] = await Promise.all([
                db.query('SELECT status, COUNT(*)::int AS n FROM controllers GROUP BY status'),
                db.query(
                    "SELECT COALESCE(building_id::text, 'Не привязан') AS k, COUNT(*)::int AS n " +
                    'FROM controllers GROUP BY building_id'
                ),
                db.query('SELECT COUNT(*)::int AS n FROM controllers')
            ]);

            const total = totalRes.rows[0].n;

            const by_status = { online: 0, offline: 0, maintenance: 0 };
            for (const row of statusRes.rows) {
                // Only the three known statuses (mirror the prior JS filter).
                if (by_status[row.status] !== undefined) {
                    by_status[row.status] = row.n;
                }
            }

            const by_building = {};
            for (const row of buildingRes.rows) {
                by_building[row.k] = row.n;
            }

            const stats = {
                total,
                by_status,
                by_building,
                // [AUD-036 p2] `by_type` is vestigial: the controllers table has no
                // `type` column (cols: vendor, model, building_id, status, …), so the
                // old JS path always yielded { 'Не указан': total }. Preserved to keep
                // the /controllers/statistics contract stable; wiring it to
                // `model`/`vendor` or dropping it is a tracked follow-up.
                by_type: total > 0 ? { 'Не указан': total } : {}
            };

            await cacheService.set(cacheKey, stats, { ttl: this.defaultCacheTTL });

            return stats;
        } catch (error) {
            logger.error(`Ошибка получения статистики контроллеров: ${error.message}`);
            throw error;
        }
    }

    // Валидация данных контроллера
    validateControllerData(data, isUpdate = false) {
        if (!isUpdate) {
            if (!data.serial_number) {
                throw new Error('Серийный номер контроллера обязателен');
            }
        }

        if (data.status && !['online', 'offline', 'maintenance'].includes(data.status)) {
            throw new Error('Некорректный статус контроллера');
        }
    }

    // Инвалидация кэша для конкретного контроллера
    async invalidateControllerCache(controllerId) {
        try {
            await cacheService.invalidate(`${this.cachePrefix}:${controllerId}`);

            // Инвалидируем также кэш по серийному номеру, если есть
            const controller = await Controller.findById(controllerId);
            if (controller && controller.serial_number) {
                await cacheService.invalidate(`${this.cachePrefix}:serial:${controller.serial_number}`);
            }

            await this.invalidateControllerListCache();
            await cacheService.invalidate(`${this.cachePrefix}:statistics`);

            // Инвалидируем кэш метрик
            await cacheService.invalidatePattern(`${this.cachePrefix}:${controllerId}:metrics:`);
        } catch (error) {
            logger.warn(`Ошибка инвалидации кэша контроллера ${controllerId}: ${error.message}`);
        }
    }

    // Инвалидация кэша списков контроллеров
    async invalidateControllerListCache() {
        try {
            await cacheService.invalidatePattern(`${this.cachePrefix}:list:`);
            await cacheService.invalidatePattern(`${this.cachePrefix}:building:`);
        } catch (error) {
            logger.warn(`Ошибка инвалидации кэша списков контроллеров: ${error.message}`);
        }
    }
}

module.exports = new ControllerService();