const cacheService = require('./cacheService');
const { CircuitBreakerFactory } = require('../utils/circuitBreaker');
const PowerTransformer = require('../models/PowerTransformer');
const db = require('../config/database');
const logger = require('../utils/logger');

class AnalyticsService {
    constructor() {
        // Circuit breakers для разных типов операций
        this.transformerAnalyticsBreaker = CircuitBreakerFactory.createAnalyticsBreaker('TransformerAnalytics');
        this.databaseBreaker = CircuitBreakerFactory.createDatabaseBreaker('AnalyticsDB');
        this.materializedViewBreaker = CircuitBreakerFactory.createAnalyticsBreaker('MaterializedView');

        // Пороги для алертов
        this.thresholds = {
            transformer_overload: 80, // % загрузки
            transformer_critical: 95,
            water_pressure_low: 2.0, // бар
            water_pressure_critical: 1.5,
            heating_temp_delta_low: 15 // °C разность температур
        };
    }

    // Получение загрузки трансформатора с кэшированием и отказоустойчивостью
    async getTransformerLoad(transformerId) {
        return await this.transformerAnalyticsBreaker.execute(async () => {
            // Сначала пытаемся получить из кэша
            const cached = await cacheService.getTransformerAnalytics(transformerId);
            if (cached) {
                logger.debug(`Загрузка трансформатора ${transformerId} получена из кэша`);
                return cached;
            }

            // Если кэш пуст, запрашиваем из материализованного представления
            const data = await this.materializedViewBreaker.execute(async () => {
                const result = await PowerTransformer.getLoadAnalytics(transformerId);
                if (!result) {
                    throw new Error(`Трансформатор ${transformerId} не найден в аналитических данных`);
                }
                return result;
            },
            // Fallback: получаем базовые данные из основной таблицы
            async () => {
                logger.warn(`Используем fallback для трансформатора ${transformerId}`);
                const transformer = await PowerTransformer.findById(transformerId);
                if (!transformer) {
                    throw new Error(`Трансформатор ${transformerId} не найден`);
                }

                // Возвращаем базовую структуру без детальной аналитики
                return {
                    id: transformer.id,
                    name: transformer.name,
                    capacity_kva: transformer.capacity_kva,
                    status: transformer.status,
                    latitude: transformer.latitude,
                    longitude: transformer.longitude,
                    buildings_count: transformer.buildings_count || 0,
                    controllers_count: transformer.controllers_count || 0,
                    active_controllers_count: 0,
                    avg_total_voltage: 0,
                    avg_total_amperage: 0,
                    load_percent: 0,
                    last_metric_time: null,
                    recent_metrics_count: 0,
                    is_fallback: true
                };
            });

            // Сохраняем в кэш
            await cacheService.setTransformerAnalytics(transformerId, data);

            // Автоматическая проверка на алерты (только если данные не fallback)
            if (!data.is_fallback && data.load_percent > 0) {
                this.checkForAlerts(transformerId, data);
            }

            return data;
        });
    }

    // Асинхронная проверка на алерты (не блокирует основной запрос)
    async checkForAlerts(transformerId, _loadData) {
        try {
            // Выполняем в фоне, чтобы не замедлять ответ API
            setImmediate(async () => {
                try {
                    const alertService = require('./alertService');
                    await alertService.checkTransformerLoad(transformerId);
                } catch (error) {
                    logger.error(`Ошибка фоновой проверки алертов для трансформатора ${transformerId}:`, error);
                }
            });
        } catch (error) {
            // Игнорируем ошибки фоновых проверок, чтобы не влиять на основной API
            logger.warn(`Не удалось запустить проверку алертов для трансформатора ${transformerId}:`, error.message);
        }
    }

    // Получение всех трансформаторов с аналитикой
    async getAllTransformersWithAnalytics() {
        const cacheKey = 'transformers:all:analytics';

        return await this.transformerAnalyticsBreaker.execute(async () => {
            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: 120 }); // 2 минуты
            if (cached) {
                logger.debug('Список всех трансформаторов получен из кэша');
                return cached;
            }

            // Получаем из материализованного представления
            const data = await this.materializedViewBreaker.execute(async () => {
                return await PowerTransformer.getAllWithLoadAnalytics();
            },
            // Fallback: получаем базовые данные
            async () => {
                logger.warn('Используем fallback для списка всех трансформаторов');
                return await PowerTransformer.findAll();
            });

            // Сохраняем в кэш
            await cacheService.set(cacheKey, data, { ttl: 120 }); // 2 минуты

            return data;
        });
    }

    // Получение трансформаторов с высокой загрузкой
    async getOverloadedTransformers(threshold = null) {
        const actualThreshold = threshold || this.thresholds.transformer_overload;
        const cacheKey = `transformers:overloaded:${actualThreshold}`;

        return await this.transformerAnalyticsBreaker.execute(async () => {
            // Проверяем кэш (короткий TTL для критических данных)
            const cached = await cacheService.get(cacheKey, { ttl: 30 }); // 30 секунд
            if (cached) {
                logger.debug(`Перегруженные трансформаторы (>${actualThreshold}%) получены из кэша`);
                return cached;
            }

            const data = await this.materializedViewBreaker.execute(async () => {
                return await PowerTransformer.getOverloadedTransformers(actualThreshold);
            },
            // Fallback: пустой массив для избежания ошибок
            async () => {
                logger.warn('Fallback: возвращаем пустой список перегруженных трансформаторов');
                return [];
            });

            await cacheService.set(cacheKey, data, { ttl: 30 }); // 30 секунд

            return data;
        });
    }

    // Обновление материализованного представления
    async refreshTransformerAnalytics() {
        return await this.databaseBreaker.execute(async () => {
            const query = 'SELECT refresh_transformer_analytics()';
            await db.query(query);

            // Инвалидируем связанные кэши
            await this.invalidateTransformerCaches();

            logger.info('Материализованное представление трансформаторов обновлено');
            return { success: true, refreshed_at: new Date().toISOString() };
        });
    }

    // Инвалидация кэшей трансформаторов
    async invalidateTransformerCaches() {
        try {
            await cacheService.invalidatePattern('transformer');
            logger.info('Кэши трансформаторов инвалидированы');
        } catch (error) {
            logger.error('Ошибка инвалидации кэшей:', error.message);
        }
    }

    // Поиск ближайших зданий к трансформатору
    async findNearestBuildings(transformerId, maxDistance = 1000, limit = 50) {
        const cacheKey = `transformer:${transformerId}:buildings:${maxDistance}:${limit}`;

        return await this.transformerAnalyticsBreaker.execute(async () => {
            const cached = await cacheService.get(cacheKey, { ttl: 300 }); // 5 минут
            if (cached) {
                return cached;
            }

            const data = await PowerTransformer.findNearestBuildings(transformerId, maxDistance, limit);
            await cacheService.set(cacheKey, data, { ttl: 300 }); // 5 минут

            return data;
        });
    }

    // Геопространственный поиск трансформаторов
    async findTransformersInRadius(latitude, longitude, radiusMeters = 5000) {
        const cacheKey = `transformers:geo:${latitude}:${longitude}:${radiusMeters}`;

        return await this.transformerAnalyticsBreaker.execute(async () => {
            const cached = await cacheService.get(cacheKey, { ttl: 600 }); // 10 минут
            if (cached) {
                return cached;
            }

            const data = await PowerTransformer.findInRadius(latitude, longitude, radiusMeters);
            await cacheService.set(cacheKey, data, { ttl: 600 }); // 10 минут

            return data;
        });
    }

    // Получение статистики по трансформаторам
    async getTransformerStatistics() {
        const cacheKey = 'transformers:statistics';

        return await this.transformerAnalyticsBreaker.execute(async () => {
            const cached = await cacheService.get(cacheKey, { ttl: 600 }); // 10 минут
            if (cached) {
                return cached;
            }

            const data = await PowerTransformer.getStatistics();
            await cacheService.set(cacheKey, data, { ttl: 600 }); // 10 минут

            return data;
        });
    }

    // Анализ загрузки электросетей по зонам
    async getLoadAnalysByZone() {
        const cacheKey = 'analytics:load:by_zone';

        return await this.databaseBreaker.execute(async () => {
            const cached = await cacheService.get(cacheKey, { ttl: 300 }); // 5 минут
            if (cached) {
                return cached;
            }

            // ARCH-107: join through active 'transformers' table (not legacy power_transformers)
            const query = `
                SELECT
                    b.town as zone_name,
                    COUNT(DISTINCT mv.id) as transformers_count,
                    COUNT(DISTINCT b.building_id) as buildings_count,
                    AVG(mv.load_percent) as avg_load_percent,
                    MAX(mv.load_percent) as max_load_percent,
                    COUNT(CASE WHEN mv.load_percent > $1 THEN 1 END) as overloaded_count
                FROM buildings b
                LEFT JOIN mv_transformer_load_realtime mv
                    ON (b.primary_transformer_id = mv.id OR b.backup_transformer_id = mv.id)
                WHERE b.town IS NOT NULL
                GROUP BY b.town
                ORDER BY avg_load_percent DESC NULLS LAST
            `;

            const result = await db.query(query, [this.thresholds.transformer_overload]);
            const data = result.rows;

            await cacheService.set(cacheKey, data, { ttl: 300 }); // 5 минут

            return data;
        });
    }

    // Прогнозирование пиковых нагрузок
    async getPeakLoadForecast(transformerId, hours = 24) {
        const cacheKey = `transformer:${transformerId}:forecast:${hours}h`;

        return await this.databaseBreaker.execute(async () => {
            const cached = await cacheService.get(cacheKey, { ttl: 1800 }); // 30 минут
            if (cached) {
                return cached;
            }

            // Запрос исторических данных для прогноза
            const query = `
                SELECT
                    DATE_TRUNC('hour', m.timestamp) as hour,
                    AVG(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) as avg_amperage,
                    MAX(COALESCE(m.amperage_ph1, 0) + COALESCE(m.amperage_ph2, 0) + COALESCE(m.amperage_ph3, 0)) as max_amperage
                FROM metrics m
                JOIN controllers c ON m.controller_id = c.controller_id
                JOIN buildings b ON c.building_id = b.building_id
                WHERE b.power_transformer_id = $1
                  AND m.timestamp > NOW() - INTERVAL '7 days'
                GROUP BY DATE_TRUNC('hour', m.timestamp)
                ORDER BY hour DESC
                LIMIT 168
            `;

            const result = await db.query(query, [transformerId]);

            // Простейший прогноз на основе паттернов
            const historicalData = result.rows;
            const forecast = this.generateSimpleForecast(historicalData, hours);

            const data = {
                transformer_id: transformerId,
                forecast_hours: hours,
                historical_data: historicalData,
                forecast: forecast,
                generated_at: new Date().toISOString()
            };

            await cacheService.set(cacheKey, data, { ttl: 1800 }); // 30 минут

            return data;
        });
    }

    // Простой алгоритм прогнозирования
    generateSimpleForecast(historicalData, hours) {
        if (historicalData.length === 0) {
            return [];
        }

        // Группируем по часам дня для выявления паттернов
        const hourlyPatterns = {};

        historicalData.forEach(record => {
            const hour = new Date(record.hour).getHours();
            if (!hourlyPatterns[hour]) {
                hourlyPatterns[hour] = [];
            }
            hourlyPatterns[hour].push(parseFloat(record.avg_amperage));
        });

        // Вычисляем средние значения по часам
        const hourlyAverages = {};
        for (const [hour, values] of Object.entries(hourlyPatterns)) {
            hourlyAverages[hour] = values.reduce((a, b) => a + b, 0) / values.length;
        }

        // Генерируем прогноз
        const forecast = [];
        const startTime = new Date();

        for (let i = 1; i <= hours; i++) {
            const forecastTime = new Date(startTime.getTime() + (i * 60 * 60 * 1000));
            const hour = forecastTime.getHours();
            const predictedLoad = hourlyAverages[hour] || 0;

            forecast.push({
                timestamp: forecastTime.toISOString(),
                predicted_amperage: predictedLoad,
                confidence: historicalData.length > 24 ? 'medium' : 'low'
            });
        }

        return forecast;
    }

    // Получение состояния всех Circuit Breaker'ов
    getCircuitBreakerStatus() {
        return {
            transformer_analytics: this.transformerAnalyticsBreaker.getState(),
            database: this.databaseBreaker.getState(),
            materialized_view: this.materializedViewBreaker.getState(),
            cache_stats: cacheService.getStats()
        };
    }

    // Принудительный сброс Circuit Breaker'ов
    resetCircuitBreakers() {
        this.transformerAnalyticsBreaker.reset();
        this.databaseBreaker.reset();
        this.materializedViewBreaker.reset();

        logger.info('Все Circuit Breaker\'ы сброшены');
    }

    // Обновление порогов для алертов
    updateThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        logger.info('Пороги алертов обновлены:', this.thresholds);

        // Инвалидируем связанные кэши
        this.invalidateTransformerCaches();
    }
}

// Экспортируем синглтон
module.exports = new AnalyticsService();