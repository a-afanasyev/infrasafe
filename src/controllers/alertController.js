const alertService = require('../services/alertService');
const logger = require('../utils/logger');

class AlertController {

    // Получение всех активных алертов
    static async getActiveAlerts(req, res) {
        try {
            const { severity, infrastructure_type, limit, status, page, sort, order } = req.query;

            // Whitelist validation for enum params
            const validStatuses = ['active', 'acknowledged', 'resolved'];
            if (status && !validStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Недопустимый статус' });
            }
            const validSeverities = ['INFO', 'WARNING', 'CRITICAL'];
            if (severity && !validSeverities.includes(severity.toUpperCase())) {
                return res.status(400).json({ success: false, message: 'Недопустимый уровень важности' });
            }
            const validInfraTypes = ['transformer', 'controller', 'water_source', 'heat_source'];
            if (infrastructure_type && !validInfraTypes.includes(infrastructure_type.toLowerCase())) {
                return res.status(400).json({ success: false, message: 'Недопустимый тип инфраструктуры' });
            }

            const filters = {};
            if (status) filters.status = status;
            if (severity) filters.severity = severity.toUpperCase();
            if (infrastructure_type) filters.infrastructure_type = infrastructure_type.toLowerCase();

            const pageNum = Math.max(parseInt(page) || 1, 1);
            const pageSize = limit ? Math.min(parseInt(limit) || 10, 200) : 10;
            const validSortColumns = ['created_at', 'severity', 'status', 'infrastructure_type'];
            const sortCol = validSortColumns.includes(sort) ? sort : 'created_at';
            const sortDir = order === 'asc' ? 'ASC' : 'DESC';

            const result = await alertService.getActiveAlerts(filters, {
                page: pageNum,
                limit: pageSize,
                sort: sortCol,
                order: sortDir
            });

            res.json({
                success: true,
                data: result.data,
                pagination: {
                    page: pageNum,
                    limit: pageSize,
                    total: result.total
                },
                filters
            });

        } catch (error) {
            logger.error('Ошибка получения активных алертов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Подтверждение алерта (acknowledge)
    static async acknowledgeAlert(req, res) {
        try {
            const { alertId } = req.params;
            const userId = req.user?.user_id; // Из JWT токена

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Требуется авторизация для подтверждения алертов'
                });
            }

            const alert = await alertService.acknowledgeAlert(parseInt(alertId), userId);

            res.json({
                success: true,
                message: 'Алерт успешно подтвержден',
                data: alert
            });

        } catch (error) {
            logger.error('Ошибка подтверждения алерта:', error);
            if (error.message && error.message.includes('не найден')) {
                return res.status(404).json({
                    success: false,
                    message: 'Алерт не найден или уже обработан'
                });
            }
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Закрытие алерта (resolve)
    static async resolveAlert(req, res) {
        try {
            const { alertId } = req.params;
            const userId = req.user?.user_id; // Из JWT токена

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Требуется авторизация для закрытия алертов'
                });
            }

            const alert = await alertService.resolveAlert(parseInt(alertId), userId);

            res.json({
                success: true,
                message: 'Алерт успешно закрыт',
                data: alert
            });

        } catch (error) {
            logger.error('Ошибка закрытия алерта:', error);
            if (error.message && error.message.includes('не найден')) {
                return res.status(404).json({
                    success: false,
                    message: 'Алерт не найден или уже обработан'
                });
            }
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Создание алерта вручную
    static async createAlert(req, res) {
        try {
            const {
                type,
                infrastructure_id,
                infrastructure_type,
                severity,
                message,
                affected_buildings,
                data
            } = req.body;

            // Валидация обязательных полей
            if (!type || !infrastructure_id || !infrastructure_type || !severity || !message) {
                return res.status(400).json({
                    success: false,
                    message: 'Обязательные поля: type, infrastructure_id, infrastructure_type, severity, message'
                });
            }

            // Валидация severity
            const validSeverities = ['INFO', 'WARNING', 'CRITICAL'];
            if (!validSeverities.includes(severity.toUpperCase())) {
                return res.status(400).json({
                    success: false,
                    message: `Недопустимый уровень severity. Разрешены: ${validSeverities.join(', ')}`
                });
            }

            const alertData = {
                type,
                infrastructure_id,
                infrastructure_type: infrastructure_type.toLowerCase(),
                severity: severity.toUpperCase(),
                message,
                affected_buildings: affected_buildings || 0,
                data: data || {}
            };

            const alert = await alertService.createAlert(alertData);

            res.status(201).json({
                success: true,
                message: 'Алерт успешно создан',
                data: alert
            });

        } catch (error) {
            logger.error('Ошибка создания алерта:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Проверка конкретного трансформатора
    static async checkTransformer(req, res) {
        try {
            const { transformerId } = req.params;

            if (!transformerId) {
                return res.status(400).json({
                    success: false,
                    message: 'ID трансформатора обязателен'
                });
            }

            const alert = await alertService.checkTransformerLoad(transformerId);

            if (alert) {
                res.json({
                    success: true,
                    message: 'Создан новый алерт',
                    data: alert
                });
            } else {
                res.json({
                    success: true,
                    message: 'Алерт не требуется или уже существует',
                    data: null
                });
            }

        } catch (error) {
            logger.error('Ошибка проверки трансформатора:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Массовая проверка всех трансформаторов
    static async checkAllTransformers(req, res) {
        try {
            const result = await alertService.checkAllTransformers();

            res.json({
                success: true,
                message: `Проверено ${result.checked} трансформаторов, создано ${result.alerts_created} алертов`,
                data: result
            });

        } catch (error) {
            logger.error('Ошибка массовой проверки трансформаторов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Получение статистики алертов
    static async getAlertStatistics(req, res) {
        try {
            const { days } = req.query;
            const period = days ? parseInt(days) : 7;

            if (period < 1 || period > 365) {
                return res.status(400).json({
                    success: false,
                    message: 'Период должен быть от 1 до 365 дней'
                });
            }

            const statistics = await alertService.getAlertStatistics(period);

            res.json({
                success: true,
                data: statistics
            });

        } catch (error) {
            logger.error('Ошибка получения статистики алертов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Получение и обновление порогов алертов
    static async getThresholds(req, res) {
        try {
            const thresholds = alertService.getThresholds();

            res.json({
                success: true,
                data: thresholds
            });

        } catch (error) {
            logger.error('Ошибка получения порогов алертов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    static async updateThresholds(req, res) {
        try {
            const newThresholds = req.body;

            // Валидация входящих данных
            const validKeys = [
                'transformer_overload',
                'transformer_critical',
                'water_pressure_low',
                'water_pressure_critical',
                'heating_temp_delta_low',
                'heating_temp_delta_critical'
            ];

            const invalidKeys = Object.keys(newThresholds).filter(key => !validKeys.includes(key));
            if (invalidKeys.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Недопустимые ключи: ${invalidKeys.join(', ')}. Разрешены: ${validKeys.join(', ')}`
                });
            }

            // Проверяем, что значения числовые и положительные
            for (const [key, value] of Object.entries(newThresholds)) {
                if (typeof value !== 'number' || value <= 0) {
                    return res.status(400).json({
                        success: false,
                        message: `Значение ${key} должно быть положительным числом`
                    });
                }
            }

            alertService.updateThresholds(newThresholds);

            res.json({
                success: true,
                message: 'Пороги алертов обновлены',
                data: alertService.getThresholds()
            });

        } catch (error) {
            logger.error('Ошибка обновления порогов алертов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }

    // Статус системы алертов
    static async getSystemStatus(req, res) {
        try {
            const status = alertService.getStatus();

            res.json({
                success: true,
                data: status
            });

        } catch (error) {
            logger.error('Ошибка получения статуса системы алертов:', error);
            res.status(500).json({
                success: false,
                message: 'Внутренняя ошибка сервера'
            });
        }
    }
}

module.exports = AlertController;