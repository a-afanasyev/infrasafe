const Metric = require('../models/Metric');
const Controller = require('../models/Controller');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');

class MetricService {
    constructor() {
        this.cachePrefix = 'metric';
        this.defaultCacheTTL = 60; // 1 минута для метрик
        this.realtimeCacheTTL = 30; // 30 секунд для real-time данных
        
        // Пороговые значения для обнаружения аномалий
        this.thresholds = {
            voltage: { min: 200, max: 250 },
            amperage: { min: 0, max: 100 },
            temperature: { min: -40, max: 80 },
            humidity: { min: 0, max: 100 }
        };
    }

    // Получить все метрики с пагинацией и кэшированием
    async getAllMetrics(page = 1, limit = 10, sort = 'timestamp', order = 'desc') {
        try {
            const cacheKey = `${this.cachePrefix}:list:${page}:${limit}:${sort}:${order}`;
            
            // Для метрик используем короткий TTL
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
            if (cached) {
                logger.debug(`Metrics list получен из кэша: ${cacheKey}`);
                return cached;
            }

            const result = await Metric.findAll(page, limit, sort, order);
            
            // Сохраняем в кэш
            await cacheService.set(cacheKey, result, { ttl: this.defaultCacheTTL });
            
            logger.info(`Получено ${result.data?.length || 0} метрик (страница ${page})`);
            return result;
        } catch (error) {
            logger.error(`Ошибка получения списка метрик: ${error.message}`);
            throw error;
        }
    }

    // Получить метрику по ID
    async getMetricById(id) {
        try {
            const cacheKey = `${this.cachePrefix}:${id}`;
            
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
            if (cached) {
                logger.debug(`Metric ${id} получена из кэша`);
                return cached;
            }

            const metric = await Metric.findById(id);
            if (!metric) {
                logger.warn(`Метрика с ID ${id} не найдена`);
                return null;
            }

            // Сохраняем в кэш
            await cacheService.set(cacheKey, metric, { ttl: this.defaultCacheTTL });
            
            return metric;
        } catch (error) {
            logger.error(`Ошибка получения метрики ${id}: ${error.message}`);
            throw error;
        }
    }

    // Получить последние метрики для всех контроллеров
    async getLastMetricsForAllControllers() {
        try {
            const cacheKey = `${this.cachePrefix}:last_all_controllers`;
            
            // Очень короткий TTL для актуальных данных
            const cached = await cacheService.get(cacheKey, { ttl: this.realtimeCacheTTL * 1000 });
            if (cached) {
                logger.debug('Last metrics for all controllers получены из кэша');
                return cached;
            }

            const metrics = await Metric.findLastForAllControllers();
            
            // Сохраняем в кэш
            await cacheService.set(cacheKey, metrics, { ttl: this.realtimeCacheTTL });
            
            logger.info(`Получено ${metrics.length} последних метрик для контроллеров`);
            return metrics;
        } catch (error) {
            logger.error(`Ошибка получения последних метрик для всех контроллеров: ${error.message}`);
            throw error;
        }
    }

    // Получить метрики по ID контроллера
    async getMetricsByControllerId(controllerId, startDate, endDate) {
        try {
            // Проверяем существование контроллера
            const controller = await Controller.findById(controllerId);
            if (!controller) {
                const error = new Error('Контроллер не найден');
                error.code = 'CONTROLLER_NOT_FOUND';
                throw error;
            }

            const cacheKey = `${this.cachePrefix}:controller:${controllerId}:${startDate || 'all'}:${endDate || 'all'}`;
            
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
            if (cached) {
                logger.debug(`Metrics for controller ${controllerId} получены из кэша`);
                return cached;
            }

            const metrics = await Metric.findByControllerId(controllerId, startDate, endDate);
            
            // Сохраняем в кэш
            await cacheService.set(cacheKey, metrics, { ttl: this.defaultCacheTTL });
            
            logger.info(`Получено ${metrics.length} метрик для контроллера ${controllerId}`);
            return metrics;
        } catch (error) {
            logger.error(`Ошибка получения метрик контроллера ${controllerId}: ${error.message}`);
            throw error;
        }
    }

    // Создать новую метрику с валидацией и обновлением статуса контроллера
    async createMetric(metricData) {
        try {
            // Валидация данных метрики
            this.validateMetricData(metricData);

            // Проверяем существование контроллера
            const controllerId = metricData.controller_id;
            if (controllerId) {
                const controller = await Controller.findById(controllerId);
                if (!controller) {
                    const error = new Error('Контроллер не найден');
                    error.code = 'CONTROLLER_NOT_FOUND';
                    throw error;
                }
            }

            // Проверяем на аномалии
            const anomalies = this.detectAnomalies(metricData);
            if (anomalies.length > 0) {
                metricData.anomalies = anomalies;
                logger.warn(`Обнаружены аномалии в метрике для контроллера ${controllerId}: ${anomalies.join(', ')}`);
            }

            const newMetric = await Metric.create(metricData);
            
            // Обновляем статус контроллера на online при получении метрики
            if (controllerId) {
                try {
                    await Controller.updateStatus(controllerId, 'online');
                    logger.debug(`Статус контроллера ${controllerId} обновлен на 'online'`);
                } catch (statusError) {
                    logger.warn(`Не удалось обновить статус контроллера ${controllerId}: ${statusError.message}`);
                }
            }

            // Инвалидируем связанные кэши
            await this.invalidateMetricCaches(controllerId);
            
            logger.info(`Создана новая метрика для контроллера ${controllerId} (ID: ${newMetric.metric_id})`);
            return newMetric;
        } catch (error) {
            logger.error(`Ошибка создания метрики: ${error.message}`);
            throw error;
        }
    }

    // Обработка телеметрии от контроллеров
    async processTelemetry(telemetryData) {
        try {
            const { serial_number, timestamp, metrics } = telemetryData;

            if (!serial_number) {
                throw new Error('Серийный номер контроллера обязателен');
            }

            // Находим контроллер по серийному номеру
            const controller = await Controller.findBySerialNumber(serial_number);
            if (!controller) {
                const error = new Error(`Контроллер с серийным номером ${serial_number} не найден`);
                error.code = 'CONTROLLER_NOT_FOUND';
                throw error;
            }

            // Подготавливаем данные метрики
            const metricData = {
                controller_id: controller.controller_id,
                timestamp: timestamp || new Date().toISOString(),
                ...metrics
            };

            // Создаем метрику
            const newMetric = await this.createMetric(metricData);

            logger.info(`Телеметрия обработана для контроллера ${serial_number} (ID: ${controller.controller_id})`);
            
            return {
                message: 'Телеметрия успешно обработана',
                controller_id: controller.controller_id,
                metric: newMetric
            };
        } catch (error) {
            logger.error(`Ошибка обработки телеметрии: ${error.message}`);
            throw error;
        }
    }

    // Удалить метрику
    async deleteMetric(id) {
        try {
            const result = await Metric.delete(id);
            
            if (!result) {
                logger.warn(`Метрика с ID ${id} не найдена для удаления`);
                return null;
            }

            // Инвалидируем кэши
            await this.invalidateMetricCaches();
            
            logger.info(`Удалена метрика ${id}`);
            return result;
        } catch (error) {
            logger.error(`Ошибка удаления метрики ${id}: ${error.message}`);
            throw error;
        }
    }

    // Получить агрегированные метрики для контроллера
    async getAggregatedMetrics(controllerId, timeFrame = '1h') {
        try {
            const cacheKey = `${this.cachePrefix}:aggregated:${controllerId}:${timeFrame}`;
            
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL * 1000 });
            if (cached) {
                logger.debug(`Aggregated metrics for controller ${controllerId} получены из кэша`);
                return cached;
            }

            // Определяем временной диапазон
            const endDate = new Date();
            const startDate = new Date();
            
            switch (timeFrame) {
                case '1h':
                    startDate.setHours(endDate.getHours() - 1);
                    break;
                case '24h':
                    startDate.setHours(endDate.getHours() - 24);
                    break;
                case '7d':
                    startDate.setDate(endDate.getDate() - 7);
                    break;
                default:
                    startDate.setHours(endDate.getHours() - 1);
            }

            // Получаем метрики за период
            const metrics = await this.getMetricsByControllerId(
                controllerId, 
                startDate.toISOString(), 
                endDate.toISOString()
            );

            // Агрегируем данные
            const aggregated = this.aggregateMetrics(metrics);
            
            // Сохраняем в кэш
            await cacheService.set(cacheKey, aggregated, { ttl: this.defaultCacheTTL });
            
            return aggregated;
        } catch (error) {
            logger.error(`Ошибка получения агрегированных метрик для контроллера ${controllerId}: ${error.message}`);
            throw error;
        }
    }

    // Очистка старых метрик (data retention)
    async cleanupOldMetrics(daysToKeep = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            // Здесь должен быть метод в модели Metric для удаления старых записей
            // const deletedCount = await Metric.deleteOlderThan(cutoffDate);
            
            // Пока используем заглушку
            logger.info(`Cleanup старых метрик (старше ${daysToKeep} дней) - функция в разработке`);
            
            return { 
                message: `Удалены метрики старше ${daysToKeep} дней`,
                cutoffDate: cutoffDate.toISOString()
            };
        } catch (error) {
            logger.error(`Ошибка очистки старых метрик: ${error.message}`);
            throw error;
        }
    }

    // Валидация данных метрики
    validateMetricData(data) {
        if (!data.controller_id) {
            throw new Error('ID контроллера обязателен');
        }

        // Валидация числовых значений
        const numericFields = ['voltage', 'amperage', 'power', 'temperature', 'humidity'];
        
        numericFields.forEach(field => {
            if (data[field] !== undefined && data[field] !== null) {
                if (typeof data[field] !== 'number' || isNaN(data[field])) {
                    throw new Error(`Поле ${field} должно быть числом`);
                }
            }
        });

        // Валидация timestamp
        if (data.timestamp && isNaN(Date.parse(data.timestamp))) {
            throw new Error('Некорректный формат времени');
        }
    }

    // Обнаружение аномалий в метриках
    detectAnomalies(data) {
        const anomalies = [];

        // Проверка напряжения
        if (data.voltage !== undefined) {
            const { min, max } = this.thresholds.voltage;
            if (data.voltage < min || data.voltage > max) {
                anomalies.push(`voltage_out_of_range:${data.voltage}`);
            }
        }

        // Проверка тока
        if (data.amperage !== undefined) {
            const { min, max } = this.thresholds.amperage;
            if (data.amperage < min || data.amperage > max) {
                anomalies.push(`amperage_out_of_range:${data.amperage}`);
            }
        }

        // Проверка температуры
        if (data.temperature !== undefined) {
            const { min, max } = this.thresholds.temperature;
            if (data.temperature < min || data.temperature > max) {
                anomalies.push(`temperature_out_of_range:${data.temperature}`);
            }
        }

        // Проверка влажности
        if (data.humidity !== undefined) {
            const { min, max } = this.thresholds.humidity;
            if (data.humidity < min || data.humidity > max) {
                anomalies.push(`humidity_out_of_range:${data.humidity}`);
            }
        }

        return anomalies;
    }

    // Агрегация метрик
    aggregateMetrics(metrics) {
        if (!metrics || metrics.length === 0) {
            return {
                count: 0,
                period: null,
                voltage: null,
                amperage: null,
                power: null,
                temperature: null,
                humidity: null
            };
        }

        const numericFields = ['voltage', 'amperage', 'power', 'temperature', 'humidity'];
        const aggregated = {
            count: metrics.length,
            period: {
                start: metrics[metrics.length - 1]?.timestamp,
                end: metrics[0]?.timestamp
            }
        };

        numericFields.forEach(field => {
            const values = metrics
                .map(m => m[field])
                .filter(v => v !== null && v !== undefined && !isNaN(v));

            if (values.length > 0) {
                aggregated[field] = {
                    min: Math.min(...values),
                    max: Math.max(...values),
                    avg: values.reduce((sum, v) => sum + v, 0) / values.length,
                    count: values.length
                };
            } else {
                aggregated[field] = null;
            }
        });

        return aggregated;
    }

    // Обновление пороговых значений
    updateThresholds(newThresholds) {
        try {
            this.thresholds = { ...this.thresholds, ...newThresholds };
            logger.info('Пороговые значения обновлены:', this.thresholds);
            return this.thresholds;
        } catch (error) {
            logger.error(`Ошибка обновления пороговых значений: ${error.message}`);
            throw error;
        }
    }

    // Инвалидация кэшей метрик
    async invalidateMetricCaches(controllerId = null) {
        try {
            // Общие кэши
            await cacheService.invalidatePattern(`${this.cachePrefix}:list:`);
            await cacheService.invalidate(`${this.cachePrefix}:last_all_controllers`);
            
            // Кэши конкретного контроллера
            if (controllerId) {
                await cacheService.invalidatePattern(`${this.cachePrefix}:controller:${controllerId}:`);
                await cacheService.invalidatePattern(`${this.cachePrefix}:aggregated:${controllerId}:`);
            }
        } catch (error) {
            logger.warn(`Ошибка инвалидации кэшей метрик: ${error.message}`);
        }
    }
}

module.exports = new MetricService(); 