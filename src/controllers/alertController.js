const alertService = require('../services/alertService');
const { validatePagination } = require('../utils/queryValidation');

class AlertController {

    // Получение всех активных алертов
    static async getActiveAlerts(req, res, next) {
        try {
            const { severity, infrastructure_type, limit, status, page, sort, order } = req.query;

            // Whitelist validation for enum params
            // [AUD-025] Sprint 10 status enum: resolved_verifying + engineer_required
            // are valid query filters so escalations surface through the API.
            const validStatuses = ['active', 'acknowledged', 'resolved', 'resolved_verifying', 'engineer_required'];
            if (status && !validStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: 'Недопустимый статус' });
            }
            // [R2-23] typeof guard: a duplicated query param (?severity=a&severity=b)
            // arrives as an array in Express → .toUpperCase() would throw → 500.
            const validSeverities = ['INFO', 'WARNING', 'CRITICAL'];
            if (severity !== undefined && (typeof severity !== 'string' || !validSeverities.includes(severity.toUpperCase()))) {
                return res.status(400).json({ success: false, message: 'Недопустимый уровень важности' });
            }
            const validInfraTypes = ['transformer', 'controller', 'water_source', 'heat_source'];
            if (infrastructure_type !== undefined && (typeof infrastructure_type !== 'string' || !validInfraTypes.includes(infrastructure_type.toLowerCase()))) {
                return res.status(400).json({ success: false, message: 'Недопустимый тип инфраструктуры' });
            }

            const filters = {};
            if (status) filters.status = status;
            if (severity) filters.severity = severity.toUpperCase();
            if (infrastructure_type) filters.infrastructure_type = infrastructure_type.toLowerCase();

            // [SEC-33] clamp via shared validator — the old Math.min lacked a
            // lower bound, so limit=-1 slipped through to SQL.
            const { pageNum, limitNum: pageSize } = validatePagination(page, limit, 10);
            const validSortColumns = ['created_at', 'severity', 'status', 'infrastructure_type'];
            const sortCol = validSortColumns.includes(sort) ? sort : 'created_at';
            const sortDir = order === 'asc' ? 'ASC' : 'DESC';

            const result = await alertService.getActiveAlerts(filters, {
                // Number() = CodeQL-recognized numeric barrier (values already clamped ints)
                page: Number(pageNum),
                limit: Number(pageSize),
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
            next(error);
        }
    }

    // Подтверждение алерта (acknowledge)
    static async acknowledgeAlert(req, res, next) {
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
            if (error.message && error.message.includes('не найден')) {
                return res.status(404).json({
                    success: false,
                    message: 'Алерт не найден или уже обработан'
                });
            }
            next(error);
        }
    }

    // Закрытие алерта (resolve)
    static async resolveAlert(req, res, next) {
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
            if (error.message && error.message.includes('не найден')) {
                return res.status(404).json({
                    success: false,
                    message: 'Алерт не найден или уже обработан'
                });
            }
            next(error);
        }
    }

    // Создание алерта вручную
    static async createAlert(req, res, next) {
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

            // [Sprint 10 PR-1] Manual operator route bypasses persistence +
            // buildings gates — operator explicitly chose to create the alert
            // and presumably knows the condition is real.
            const alert = await alertService.createAlert(alertData, { bypassGates: true });

            res.status(201).json({
                success: true,
                message: 'Алерт успешно создан',
                data: alert
            });

        } catch (error) {
            next(error);
        }
    }

    // Проверка конкретного трансформатора
    static async checkTransformer(req, res, next) {
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
            next(error);
        }
    }

    // Массовая проверка всех трансформаторов
    static async checkAllTransformers(req, res, next) {
        try {
            const result = await alertService.checkAllTransformers();

            res.json({
                success: true,
                message: `Проверено ${result.checked} трансформаторов, создано ${result.alerts_created} алертов`,
                data: result
            });

        } catch (error) {
            next(error);
        }
    }

    // Получение статистики алертов
    static async getAlertStatistics(req, res, next) {
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
            next(error);
        }
    }

    // Получение и обновление порогов алертов
    static async getThresholds(req, res, next) {
        try {
            const thresholds = alertService.getThresholds();

            res.json({
                success: true,
                data: thresholds
            });

        } catch (error) {
            next(error);
        }
    }

    static async updateThresholds(req, res, next) {
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
            next(error);
        }
    }

    // Статус системы алертов
    static async getSystemStatus(req, res, next) {
        try {
            const status = alertService.getStatus();

            res.json({
                success: true,
                data: status
            });

        } catch (error) {
            next(error);
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // [Sprint 10 PR-4] Suppression endpoints
    // ────────────────────────────────────────────────────────────────────

    /**
     * POST /api/alerts/:alertId/suppress
     * Suppress future alerts for the SAME infrastructure tuple as :alertId
     * for the given duration. Operator-driven mute: stops the verifier from
     * reopening this kind of alert. Duration capped at 24h (re-apply if
     * needed).
     *
     * Body: { duration_hours, reason, comment? }
     */
    static async suppressAlert(req, res, next) {
        try {
            const AlertSuppression = require('../models/AlertSuppression');
            const { alertId } = req.params;
            const { duration_hours, reason, comment } = req.body;

            // Lookup the alert to extract its {infra_type, infra_id, type} tuple
            const alert = await alertService.getAlertById(parseInt(alertId, 10));
            if (!alert) {
                return res.status(404).json({ success: false, message: 'Алерт не найден' });
            }

            if (!Number.isFinite(Number(duration_hours)) || Number(duration_hours) <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'duration_hours должен быть положительным числом (1..24)'
                });
            }
            if (Number(duration_hours) > AlertSuppression.MAX_SUPPRESSION_HOURS) {
                return res.status(400).json({
                    success: false,
                    message: `Максимальная длительность подавления ${AlertSuppression.MAX_SUPPRESSION_HOURS} часов`
                });
            }
            if (!reason || !AlertSuppression.VALID_REASONS.includes(reason)) {
                return res.status(400).json({
                    success: false,
                    message: `reason обязателен и должен быть одним из: ${AlertSuppression.VALID_REASONS.join(', ')}`
                });
            }

            const suppression = await AlertSuppression.create({
                infrastructure_type: alert.infrastructure_type,
                infrastructure_id: alert.infrastructure_id,
                alert_type: alert.type,
                duration_hours: Number(duration_hours),
                reason,
                comment: comment || null,
                suppressed_by: req.user ? req.user.user_id : null
            });

            return res.status(201).json({
                success: true,
                message: `Подавление активно до ${suppression.suppress_until}`,
                data: suppression
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * DELETE /api/alerts/suppressions/:id
     * End an active suppression early ("sensor fixed, resume monitoring").
     */
    static async clearSuppression(req, res, next) {
        try {
            const AlertSuppression = require('../models/AlertSuppression');
            const { id } = req.params;
            const clearedBy = req.user ? req.user.user_id : null;

            const cleared = await AlertSuppression.clear(parseInt(id, 10), clearedBy);
            if (!cleared) {
                return res.status(404).json({
                    success: false,
                    message: 'Подавление не найдено или уже снято'
                });
            }

            return res.json({
                success: true,
                message: 'Подавление снято',
                data: cleared
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /api/alerts/suppressions
     * List suppressions. Query params: active=true|false, infra_type,
     * infra_id, alert_type, limit (1..500).
     */
    static async listSuppressions(req, res, next) {
        try {
            const AlertSuppression = require('../models/AlertSuppression');
            const { active, infra_type, infra_id, alert_type, limit } = req.query;

            const filters = {};
            if (active === 'true') filters.active = true;
            else if (active === 'false') filters.active = false;
            if (infra_type) filters.infraType = infra_type;
            if (infra_id) filters.infraId = parseInt(infra_id, 10);
            if (alert_type) filters.alertType = alert_type;
            if (limit) filters.limit = parseInt(limit, 10);

            const rows = await AlertSuppression.list(filters);
            return res.json({ success: true, data: rows });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = AlertController;