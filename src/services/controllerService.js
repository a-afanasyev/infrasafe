const Controller = require('../models/Controller');
const Metric = require('../models/Metric');
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
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
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
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
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
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
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
            const metricsCache = await cacheService.get(cacheKey, { ttl: 60000 }); // 1 минута
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
            // Проверяем наличие связанных метрик
            const metrics = await Metric.findByControllerId(id);
            if (metrics.length > 0) {
                const error = new Error('Невозможно удалить контроллер с привязанными метриками');
                error.code = 'CONTROLLER_HAS_METRICS';
                error.metricCount = metrics.length;
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

            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
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

    // Автоматическое определение статуса контроллеров по последним метрикам
    async updateControllersStatusByActivity() {
        try {
            const allControllers = await Controller.findAll(1, 10000, 'controller_id', 'asc');
            const controllers = allControllers.data || [];

            const now = new Date();
            let updated = 0;

            for (const controller of controllers) {
                try {
                    // Получаем последнюю метрику контроллера
                    const lastMetrics = await Metric.findByControllerId(controller.controller_id, null, null, 1);

                    if (lastMetrics.length === 0) {
                        // Нет метрик - контроллер offline
                        if (controller.status !== 'offline') {
                            await Controller.updateStatus(controller.controller_id, 'offline');
                            updated++;
                        }
                        continue;
                    }

                    const lastMetric = lastMetrics[0];
                    const metricTime = new Date(lastMetric.timestamp);
                    const timeDiff = now - metricTime;

                    // Если последняя метрика старше timeout времени - контроллер offline
                    if (timeDiff > this.statusTimeout && controller.status !== 'offline' && controller.status !== 'maintenance') {
                        await Controller.updateStatus(controller.controller_id, 'offline');
                        updated++;
                        logger.info(`Контроллер ${controller.serial_number} переведен в offline (последняя метрика: ${lastMetric.timestamp})`);
                    }
                    // Если метрика свежая и контроллер был offline - переводим в online
                    else if (timeDiff <= this.statusTimeout && controller.status === 'offline') {
                        await Controller.updateStatus(controller.controller_id, 'online');
                        updated++;
                        logger.info(`Контроллер ${controller.serial_number} переведен в online`);
                    }
                } catch (error) {
                    logger.warn(`Ошибка обновления статуса контроллера ${controller.controller_id}: ${error.message}`);
                }
            }

            if (updated > 0) {
                // Инвалидируем кэши списков
                await this.invalidateControllerListCache();
            }

            logger.info(`Обновлено статусов контроллеров: ${updated} из ${controllers.length}`);
            return { updated, total: controllers.length };
        } catch (error) {
            logger.error(`Ошибка автоматического обновления статусов контроллеров: ${error.message}`);
            throw error;
        }
    }

    // Получить статистику по контроллерам
    async getControllersStatistics() {
        try {
            const cacheKey = `${this.cachePrefix}:statistics`;

            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
            if (cached) {
                return cached;
            }

            const allControllers = await Controller.findAll(1, 10000, 'controller_id', 'asc');
            const controllers = allControllers.data || [];

            const stats = {
                total: controllers.length,
                by_status: {
                    online: 0,
                    offline: 0,
                    maintenance: 0
                },
                by_building: {},
                by_type: {}
            };

            controllers.forEach(controller => {
                // По статусу
                if (stats.by_status[controller.status] !== undefined) {
                    stats.by_status[controller.status]++;
                }

                // По зданиям
                const buildingId = controller.building_id || 'Не привязан';
                stats.by_building[buildingId] = (stats.by_building[buildingId] || 0) + 1;

                // По типу (если есть поле type)
                const type = controller.type || 'Не указан';
                stats.by_type[type] = (stats.by_type[type] || 0) + 1;
            });

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