const analyticsService = require('../services/analyticsService');
const PowerTransformer = require('../models/PowerTransformer');
const logger = require('../utils/logger');

class AnalyticsController {

    // Получение загрузки конкретного трансформатора
    static async getTransformerLoad(req, res) {
        try {
            const { transformerId } = req.params;

            if (!transformerId) {
                return res.status(400).json({
                    success: false,
                    message: 'ID трансформатора обязателен'
                });
            }

            const loadData = await analyticsService.getTransformerLoad(transformerId);

            res.json({
                success: true,
                data: loadData
            });

        } catch (error) {
            logger.error('Ошибка получения загрузки трансформатора:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Получение всех трансформаторов с аналитикой
    static async getAllTransformersAnalytics(req, res) {
        try {
            const {
                status,
                min_load_percent,
                max_load_percent,
                overloaded_only
            } = req.query;

            let transformers = await analyticsService.getAllTransformersWithAnalytics();

            // Фильтрация по параметрам
            if (status) {
                transformers = transformers.filter(t => t.status === status);
            }

            if (min_load_percent !== undefined) {
                const minLoad = parseFloat(min_load_percent);
                transformers = transformers.filter(t => (t.load_percent || 0) >= minLoad);
            }

            if (max_load_percent !== undefined) {
                const maxLoad = parseFloat(max_load_percent);
                transformers = transformers.filter(t => (t.load_percent || 0) <= maxLoad);
            }

            if (overloaded_only === 'true') {
                transformers = transformers.filter(t => (t.load_percent || 0) > 80);
            }

            res.json({
                success: true,
                data: transformers,
                count: transformers.length
            });

        } catch (error) {
            logger.error('Ошибка получения аналитики всех трансформаторов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Получение перегруженных трансформаторов
    static async getOverloadedTransformers(req, res) {
        try {
            const { threshold } = req.query;
            const loadThreshold = threshold ? parseFloat(threshold) : undefined;

            const overloadedTransformers = await analyticsService.getOverloadedTransformers(loadThreshold);

            res.json({
                success: true,
                data: overloadedTransformers,
                count: overloadedTransformers.length,
                threshold: loadThreshold || 80
            });

        } catch (error) {
            logger.error('Ошибка получения перегруженных трансформаторов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Геопространственный поиск трансформаторов
    static async findTransformersInRadius(req, res) {
        try {
            const { latitude, longitude, radius } = req.query;

            if (!latitude || !longitude) {
                return res.status(400).json({
                    success: false,
                    message: 'Координаты latitude и longitude обязательны'
                });
            }

            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            const radiusMeters = radius ? parseInt(radius) : 5000;

            if (isNaN(lat) || isNaN(lng)) {
                return res.status(400).json({
                    success: false,
                    message: 'Некорректные координаты'
                });
            }

            const transformers = await analyticsService.findTransformersInRadius(lat, lng, radiusMeters);

            res.json({
                success: true,
                data: transformers,
                count: transformers.length,
                search_params: {
                    latitude: lat,
                    longitude: lng,
                    radius_meters: radiusMeters
                }
            });

        } catch (error) {
            logger.error('Ошибка геопространственного поиска:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Поиск ближайших зданий к трансформатору
    static async findNearestBuildings(req, res) {
        try {
            const { transformerId } = req.params;
            const { max_distance, limit } = req.query;

            const maxDistance = max_distance ? parseInt(max_distance) : 1000;
            const limitCount = limit ? parseInt(limit) : 50;

            const buildings = await analyticsService.findNearestBuildings(
                transformerId,
                maxDistance,
                limitCount
            );

            res.json({
                success: true,
                data: buildings,
                count: buildings.length,
                transformer_id: transformerId,
                search_params: {
                    max_distance_meters: maxDistance,
                    limit: limitCount
                }
            });

        } catch (error) {
            logger.error('Ошибка поиска ближайших зданий:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Анализ загрузки по зонам
    static async getLoadAnalyticsByZone(req, res) {
        try {
            const zoneAnalytics = await analyticsService.getLoadAnalysByZone();

            res.json({
                success: true,
                data: zoneAnalytics,
                count: zoneAnalytics.length
            });

        } catch (error) {
            logger.error('Ошибка получения аналитики по зонам:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Прогнозирование нагрузки
    static async getPeakLoadForecast(req, res) {
        try {
            const { transformerId } = req.params;
            const { hours } = req.query;

            const forecastHours = hours ? parseInt(hours) : 24;

            if (forecastHours < 1 || forecastHours > 168) { // Максимум неделя
                return res.status(400).json({
                    success: false,
                    message: 'Количество часов должно быть от 1 до 168'
                });
            }

            const forecast = await analyticsService.getPeakLoadForecast(transformerId, forecastHours);

            res.json({
                success: true,
                data: forecast
            });

        } catch (error) {
            logger.error('Ошибка получения прогноза нагрузки:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Статистика по трансформаторам
    static async getTransformerStatistics(req, res) {
        try {
            const statistics = await analyticsService.getTransformerStatistics();

            res.json({
                success: true,
                data: statistics
            });

        } catch (error) {
            logger.error('Ошибка получения статистики трансформаторов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Обновление материализованного представления
    static async refreshAnalytics(req, res) {
        try {
            const result = await analyticsService.refreshTransformerAnalytics();

            res.json({
                success: true,
                message: 'Аналитические данные обновлены',
                data: result
            });

        } catch (error) {
            logger.error('Ошибка обновления аналитики:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Инвалидация кэшей
    static async invalidateCaches(req, res) {
        try {
            await analyticsService.invalidateTransformerCaches();

            res.json({
                success: true,
                message: 'Кэши аналитики очищены'
            });

        } catch (error) {
            logger.error('Ошибка инвалидации кэшей:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Состояние системы мониторинга
    static async getSystemStatus(req, res) {
        try {
            const circuitBreakerStatus = analyticsService.getCircuitBreakerStatus();

            res.json({
                success: true,
                data: {
                    timestamp: new Date().toISOString(),
                    circuit_breakers: circuitBreakerStatus,
                    system_health: 'operational' // Можно расширить логику проверки
                }
            });

        } catch (error) {
            logger.error('Ошибка получения состояния системы:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Сброс Circuit Breaker'ов
    static async resetCircuitBreakers(req, res) {
        try {
            analyticsService.resetCircuitBreakers();

            res.json({
                success: true,
                message: 'Circuit Breaker\'ы сброшены'
            });

        } catch (error) {
            logger.error('Ошибка сброса Circuit Breaker\'ов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Обновление порогов алертов
    static async updateThresholds(req, res) {
        try {
            const { thresholds } = req.body;

            if (!thresholds || typeof thresholds !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: 'Некорректные данные порогов'
                });
            }

            analyticsService.updateThresholds(thresholds);

            res.json({
                success: true,
                message: 'Пороги алертов обновлены',
                data: thresholds
            });

        } catch (error) {
            logger.error('Ошибка обновления порогов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // CRUD операции для трансформаторов

    // Создание трансформатора
    static async createTransformer(req, res) {
        try {
            const transformerData = req.body;

            // Валидация обязательных полей
            const requiredFields = ['id', 'name', 'address', 'latitude', 'longitude', 'capacity_kva'];
            for (const field of requiredFields) {
                if (!transformerData[field]) {
                    return res.status(400).json({
                        success: false,
                        message: `Поле ${field} обязательно`
                    });
                }
            }

            const transformer = await PowerTransformer.create(transformerData);

            // Инвалидируем кэши после создания
            await analyticsService.invalidateTransformerCaches();

            res.status(201).json({
                success: true,
                data: transformer,
                message: 'Трансформатор создан успешно'
            });

        } catch (error) {
            logger.error('Ошибка создания трансформатора:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Обновление трансформатора
    static async updateTransformer(req, res) {
        try {
            const { transformerId } = req.params;
            const updateData = req.body;

            const transformer = await PowerTransformer.update(transformerId, updateData);

            if (!transformer) {
                return res.status(404).json({
                    success: false,
                    message: 'Трансформатор не найден'
                });
            }

            // Инвалидируем кэши после обновления
            await analyticsService.invalidateTransformerCaches();

            res.json({
                success: true,
                data: transformer,
                message: 'Трансформатор обновлен успешно'
            });

        } catch (error) {
            logger.error('Ошибка обновления трансформатора:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Удаление трансформатора
    static async deleteTransformer(req, res) {
        try {
            const { transformerId } = req.params;

            const deleted = await PowerTransformer.delete(transformerId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Трансформатор не найден'
                });
            }

            // Инвалидируем кэши после удаления
            await analyticsService.invalidateTransformerCaches();

            res.json({
                success: true,
                message: 'Трансформатор удален успешно'
            });

        } catch (error) {
            logger.error('Ошибка удаления трансформатора:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }
}

module.exports = AnalyticsController;