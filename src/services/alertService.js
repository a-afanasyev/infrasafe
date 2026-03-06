const db = require('../config/database');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');
const { CircuitBreakerFactory } = require('../utils/circuitBreaker');

class InfrastructureAlertService {
    constructor() {
        // Circuit breaker для операций с БД
        this.dbBreaker = CircuitBreakerFactory.createDatabaseBreaker('AlertsDB');

        // Пороги для алертов (можно выносить в конфигурацию)
        this.thresholds = {
            transformer_overload: 85, // % загрузки
            transformer_critical: 95,
            water_pressure_low: 2.0, // бар
            water_pressure_critical: 1.5,
            heating_temp_delta_low: 15, // °C разность температур
            heating_temp_delta_critical: 10
        };

        // Активные алерты в памяти для быстрого доступа
        this.activeAlerts = new Map();

        // Последние проверки (чтобы не спамить)
        this.lastChecks = new Map();

        // Минимальный интервал между одинаковыми алертами (минуты)
        this.alertCooldown = 15;

        // Флаг инициализации
        this.initialized = false;
    }

    // Инициализация сервиса (вызывается после готовности БД)
    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            // Проверяем готовность БД
            await this.waitForDatabase();

            // Загружаем активные алерты
            await this.loadActiveAlerts();

            this.initialized = true;
            logger.info('AlertService успешно инициализирован');
        } catch (error) {
            logger.error('Ошибка инициализации AlertService:', error);
            throw error;
        }
    }

    // Ожидание готовности БД
    async waitForDatabase() {
        const maxRetries = 30;
        const retryDelay = 1000; // 1 секунда

        for (let i = 0; i < maxRetries; i++) {
            try {
                // Пробуем выполнить простой запрос
                await db.query('SELECT 1');
                logger.info('База данных готова для AlertService');
                return;
            } catch (error) {
                logger.warn(`Попытка ${i + 1}/${maxRetries}: БД не готова, ожидание...`);
                if (i === maxRetries - 1) {
                    throw new Error('Превышено максимальное время ожидания готовности БД');
                }
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    // Проверка инициализации перед операциями
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    // Загрузка активных алертов при старте
    async loadActiveAlerts() {
        try {
            const query = `
                SELECT alert_id, type, infrastructure_id, infrastructure_type, severity, created_at
                FROM infrastructure_alerts
                WHERE status = 'active'
                ORDER BY created_at DESC
            `;

            const result = await db.query(query);

            for (const alert of result.rows) {
                const key = `${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`;
                this.activeAlerts.set(key, {
                    alert_id: alert.alert_id,
                    created_at: alert.created_at,
                    severity: alert.severity
                });
            }

            logger.info(`Загружено ${this.activeAlerts.size} активных алертов`);
        } catch (error) {
            logger.error('Ошибка загрузки активных алертов:', error);
            // Не бросаем ошибку, чтобы не ломать инициализацию
        }
    }

    // Основной метод для проверки трансформатора и создания алертов
    async checkTransformerLoad(transformerId) {
        await this.ensureInitialized();

        const checkKey = `transformer:${transformerId}:load_check`;
        const now = Date.now();

        // Проверяем cooldown
        if (this.lastChecks.has(checkKey)) {
            const lastCheck = this.lastChecks.get(checkKey);
            if (now - lastCheck < this.alertCooldown * 60 * 1000) {
                return null; // Слишком рано для повторной проверки
            }
        }

        try {
            // Получаем данные загрузки трансформатора
            const analyticsService = require('./analyticsService');
            const loadData = await analyticsService.getTransformerLoad(transformerId);

            if (!loadData || typeof loadData.load_percent !== 'number') {
                logger.warn(`Нет данных загрузки для трансформатора ${transformerId}`);
                return null;
            }

            const loadPercent = loadData.load_percent;
            let alertType = null;
            let severity = null;
            let message = null;

            // Определяем тип алерта
            if (loadPercent >= this.thresholds.transformer_critical) {
                alertType = 'TRANSFORMER_CRITICAL_OVERLOAD';
                severity = 'CRITICAL';
                message = `Критическая перегрузка трансформатора ${loadData.name}: ${loadPercent.toFixed(1)}%`;
            } else if (loadPercent >= this.thresholds.transformer_overload) {
                alertType = 'TRANSFORMER_OVERLOAD';
                severity = 'WARNING';
                message = `Высокая загрузка трансформатора ${loadData.name}: ${loadPercent.toFixed(1)}%`;
            }

            // Если алерт не нужен, помечаем время проверки и выходим
            if (!alertType) {
                this.lastChecks.set(checkKey, now);
                return null;
            }

            // Проверяем, не создавали ли уже такой алерт
            const alertKey = `transformer:${transformerId}:${alertType}`;
            if (this.activeAlerts.has(alertKey)) {
                logger.debug(`Алерт ${alertType} для трансформатора ${transformerId} уже активен`);
                return null;
            }

            // Создаем алерт
            const alertData = {
                type: alertType,
                infrastructure_id: transformerId,
                infrastructure_type: 'transformer',
                severity: severity,
                message: message,
                affected_buildings: loadData.buildings_count || 0,
                data: {
                    load_percent: loadPercent,
                    capacity_kva: loadData.capacity_kva,
                    active_controllers: loadData.active_controllers_count,
                    last_metric_time: loadData.last_metric_time,
                    threshold_used: alertType.includes('CRITICAL') ?
                        this.thresholds.transformer_critical :
                        this.thresholds.transformer_overload
                }
            };

            const createdAlert = await this.createAlert(alertData);
            this.lastChecks.set(checkKey, now);

            return createdAlert;

        } catch (error) {
            logger.error(`Ошибка проверки трансформатора ${transformerId}:`, error);
            return null;
        }
    }

    // Создание нового алерта
    async createAlert(alertData) {
        await this.ensureInitialized();

        return await this.dbBreaker.execute(async () => {
            const query = `
                INSERT INTO infrastructure_alerts
                (type, infrastructure_id, infrastructure_type, severity, message,
                 affected_buildings, data, status, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
                RETURNING alert_id, created_at
            `;

            const values = [
                alertData.type,
                alertData.infrastructure_id,
                alertData.infrastructure_type,
                alertData.severity,
                alertData.message,
                alertData.affected_buildings || 0,
                JSON.stringify(alertData.data)
            ];

            const result = await db.query(query, values);
            const alertId = result.rows[0].alert_id;
            const createdAt = result.rows[0].created_at;

            // Добавляем в активные алерты
            const alertKey = `${alertData.infrastructure_type}:${alertData.infrastructure_id}:${alertData.type}`;
            this.activeAlerts.set(alertKey, {
                alert_id: alertId,
                created_at: createdAt,
                severity: alertData.severity
            });

            // Отправляем уведомления
            await this.sendNotifications(alertData, alertId);

            // Логируем создание алерта
            logger.info(`Создан алерт ${alertData.type} для ${alertData.infrastructure_type} ${alertData.infrastructure_id}, severity: ${alertData.severity}`);

            return {
                alert_id: alertId,
                ...alertData,
                created_at: createdAt,
                status: 'active'
            };
        });
    }

    // Отправка уведомлений (базовая реализация)
    async sendNotifications(alertData, alertId) {
        try {
            // Критические алерты - немедленные уведомления
            if (alertData.severity === 'CRITICAL') {
                await this.sendImmediateNotification(alertData, alertId);
            }

            // WebSocket уведомления для активных пользователей (если реализован)
            this.broadcastAlert(alertData, alertId);

        } catch (error) {
            logger.error('Ошибка отправки уведомлений:', error);
        }
    }

    // Немедленные уведомления для критических алертов
    async sendImmediateNotification(alertData, alertId) {
        // Получаем список получателей критических уведомлений
        const recipients = await this.getCriticalAlertRecipients();

        const notificationData = {
            alert_id: alertId,
            type: alertData.type,
            severity: alertData.severity,
            message: alertData.message,
            infrastructure: `${alertData.infrastructure_type}:${alertData.infrastructure_id}`,
            affected_buildings: alertData.affected_buildings,
            timestamp: new Date().toISOString()
        };

        // Пока реализуем только логирование
        // В будущем здесь будет отправка email, SMS, Telegram
        logger.warn(`🚨 КРИТИЧЕСКИЙ АЛЕРТ: ${alertData.message}`, notificationData);

        // Можно добавить webhook уведомления
        // await this.sendWebhookNotification(notificationData);
    }

    // WebSocket broadcast (заглушка для будущей реализации)
    broadcastAlert(alertData, alertId) {
        // TODO: Реализовать WebSocket broadcast
        logger.info(`📡 Broadcast alert ${alertId}: ${alertData.type}`);
    }

    // Получение списка получателей критических уведомлений
    async getCriticalAlertRecipients() {
        try {
            // В будущем здесь будет запрос к БД пользователей с настройками уведомлений
            return [
                { type: 'log', level: 'critical' },
                // { type: 'email', address: 'admin@infrasafe.com' },
                // { type: 'telegram', chat_id: '123456789' }
            ];
        } catch (error) {
            logger.error('Ошибка получения получателей уведомлений:', error);
            return [];
        }
    }

    // Подтверждение алерта
    async acknowledgeAlert(alertId, userId) {
        await this.ensureInitialized();

        return await this.dbBreaker.execute(async () => {
            const query = `
                UPDATE infrastructure_alerts
                SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2
                WHERE alert_id = $1 AND status = 'active'
                RETURNING *
            `;

            const result = await db.query(query, [alertId, userId]);

            if (result.rows.length === 0) {
                throw new Error(`Алерт ${alertId} не найден или уже обработан`);
            }

            const alert = result.rows[0];

            // Удаляем из активных алертов
            const alertKey = `${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`;
            this.activeAlerts.delete(alertKey);

            logger.info(`Алерт ${alertId} подтвержден пользователем ${userId}`);

            return alert;
        });
    }

    // Закрытие алерта
    async resolveAlert(alertId, userId) {
        await this.ensureInitialized();

        return await this.dbBreaker.execute(async () => {
            const query = `
                UPDATE infrastructure_alerts
                SET status = 'resolved', resolved_at = NOW(), resolved_by = $2
                WHERE alert_id = $1 AND status IN ('active', 'acknowledged')
                RETURNING *
            `;

            const result = await db.query(query, [alertId, userId]);

            if (result.rows.length === 0) {
                throw new Error(`Алерт ${alertId} не найден или уже закрыт`);
            }

            const alert = result.rows[0];

            // Удаляем из активных алертов
            const alertKey = `${alert.infrastructure_type}:${alert.infrastructure_id}:${alert.type}`;
            this.activeAlerts.delete(alertKey);

            logger.info(`Алерт ${alertId} закрыт пользователем ${userId}`);

            return alert;
        });
    }

    // Получение активных алертов
    async getActiveAlerts(filters = {}) {
        await this.ensureInitialized();

        const query = `
            SELECT ia.*, u1.username as acknowledged_by_name, u2.username as resolved_by_name
            FROM infrastructure_alerts ia
            LEFT JOIN users u1 ON ia.acknowledged_by = u1.user_id
            LEFT JOIN users u2 ON ia.resolved_by = u2.user_id
            WHERE ia.status = $1
            ${filters.severity ? 'AND ia.severity = $2' : ''}
            ${filters.infrastructure_type ? `AND ia.infrastructure_type = $${filters.severity ? 3 : 2}` : ''}
            ORDER BY ia.created_at DESC
            LIMIT $${filters.severity ? (filters.infrastructure_type ? 4 : 3) : (filters.infrastructure_type ? 3 : 2)}
        `;

        const values = ['active'];
        if (filters.severity) values.push(filters.severity);
        if (filters.infrastructure_type) values.push(filters.infrastructure_type);
        values.push(filters.limit || 100);

        const result = await db.query(query, values);
        return result.rows;
    }

    // Массовая проверка всех трансформаторов
    async checkAllTransformers() {
        await this.ensureInitialized();

        try {
            const analyticsService = require('./analyticsService');
            const transformers = await analyticsService.getAllTransformersWithAnalytics();

            const alerts = [];

            for (const transformer of transformers) {
                try {
                    const alert = await this.checkTransformerLoad(transformer.id);
                    if (alert) {
                        alerts.push(alert);
                    }
                } catch (error) {
                    logger.error(`Ошибка проверки трансформатора ${transformer.id}:`, error);
                }
            }

            logger.info(`Проверено ${transformers.length} трансформаторов, создано ${alerts.length} алертов`);

            return {
                checked: transformers.length,
                alerts_created: alerts.length,
                alerts: alerts
            };

        } catch (error) {
            logger.error('Ошибка массовой проверки трансформаторов:', error);
            throw error;
        }
    }

    // Получение статистики алертов
    async getAlertStatistics(days = 7) {
        await this.ensureInitialized();

        const safeDays = Math.max(1, Math.min(365, parseInt(days, 10) || 7));

        const query = `
            SELECT
                severity,
                infrastructure_type,
                status,
                COUNT(*) as count,
                DATE(created_at) as date
            FROM infrastructure_alerts
            WHERE created_at >= NOW() - INTERVAL '1 day' * $1
            GROUP BY severity, infrastructure_type, status, DATE(created_at)
            ORDER BY date DESC, severity, infrastructure_type
        `;

        const result = await db.query(query, [safeDays]);

        return {
            period_days: safeDays,
            statistics: result.rows,
            active_alerts_count: this.activeAlerts.size
        };
    }

    // Обновление порогов алертов
    updateThresholds(newThresholds) {
        this.thresholds = { ...this.thresholds, ...newThresholds };
        logger.info('Обновлены пороги алертов:', newThresholds);
    }

    // Получение текущих порогов
    getThresholds() {
        return { ...this.thresholds };
    }

    // Статус сервиса алертов
    getStatus() {
        return {
            active_alerts: this.activeAlerts.size,
            last_checks: this.lastChecks.size,
            cooldown_minutes: this.alertCooldown,
            thresholds: this.thresholds,
            circuit_breaker_state: this.dbBreaker.getState()
        };
    }
}

module.exports = new InfrastructureAlertService();