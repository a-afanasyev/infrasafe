const db = require('../config/database');
const logger = require('../utils/logger');
const { CircuitBreakerFactory } = require('../utils/circuitBreaker');
const sharedThresholds = require('../config/thresholds');
const alertEvents = require('../events/alertEvents');
// Phase 7: top-level require is now safe. analyticsService no longer
// requires alertService — the feedback edge goes through `transformer.check`
// events instead. We still need analyticsService to PULL data (load numbers,
// overloaded transformer list), which is a plain function call.
const analyticsService = require('./analyticsService');

class InfrastructureAlertService {
    constructor() {
        // Circuit breaker для операций с БД
        this.dbBreaker = CircuitBreakerFactory.createDatabaseBreaker('AlertsDB');

        // Phase 4.2 (KISS-008): thresholds come from the shared config module.
        // Local copy kept for updateThresholds() compatibility (runtime overrides).
        this.thresholds = {
            transformer_overload: sharedThresholds.transformer.overload,
            transformer_critical: sharedThresholds.transformer.critical,
            water_pressure_low: sharedThresholds.water.pressure_low,
            water_pressure_critical: sharedThresholds.water.pressure_critical,
            heating_temp_delta_low: sharedThresholds.heating.temp_delta_low,
            heating_temp_delta_critical: sharedThresholds.heating.temp_delta_critical,
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

            // Phase 4.3 (ARCH-109): restore cooldown timestamps from active alert
            // created_at values so a process restart does not cause an alert burst.
            // checkTransformerLoad et al. use a per-infrastructure cooldown keyed as
            // `${infra_type}:${infra_id}:load_check`; we project active alerts onto
            // the same key shape and keep the most recent timestamp.
            for (const [alertKey, alertInfo] of this.activeAlerts.entries()) {
                const parts = alertKey.split(':');
                if (parts.length < 2) continue;
                const checkKey = `${parts[0]}:${parts[1]}:load_check`;
                const alertTime = new Date(alertInfo.created_at).getTime();
                const existing = this.lastChecks.get(checkKey);
                if (!existing || alertTime > existing) {
                    this.lastChecks.set(checkKey, alertTime);
                }
            }

            logger.info(
                `Загружено ${this.activeAlerts.size} активных алертов; восстановлено ${this.lastChecks.size} cooldown-меток`
            );
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
            // Phase 7: analyticsService now top-level required (no cycle).
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

            // Phase 4.1 (ARCH-106): DB-level dedup via partial UNIQUE index
            // idx_active_alert_dedup. Catch the UNIQUE violation and return
            // null instead of throwing — caller treats it as "already active".
            let result;
            try {
                result = await db.query(query, values);
            } catch (err) {
                if (err.code === '23505') {
                    logger.info(
                        `Duplicate alert suppressed by DB (UNIQUE): ${alertData.type} for ${alertData.infrastructure_type}:${alertData.infrastructure_id}`
                    );
                    return null;
                }
                throw err;
            }
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
    // Phase 4.4 (ARCH-112): per-channel try/catch + persist failures into
    // infrastructure_alerts.data.notification_failures for monitoring/retry.
    async sendNotifications(alertData, alertId) {
        const failures = [];

        // Критические алерты - немедленные уведомления
        if (alertData.severity === 'CRITICAL') {
            try {
                await this.sendImmediateNotification(alertData, alertId);
            } catch (notifError) {
                logger.error(`Alert ${alertId} immediate notification failed: ${notifError.message}`);
                failures.push({
                    channel: 'immediate',
                    error: notifError.message,
                    at: new Date().toISOString(),
                });
            }
        }

        // Phase 9.3 (YAGNI-010): the WebSocket broadcastAlert stub was
        // removed. Re-add a real channel through alertEvents here when
        // the WebSocket transport lands.

        // UK Integration: publish `alert.created` and let ukIntegrationService
        // (subscribed at module load) forward to UK. Failure-recording for
        // this channel now lives inside the listener (it appends its own
        // entry to infrastructure_alerts.data.notification_failures) so
        // alertService.sendNotifications stays fire-and-forget.
        alertEvents.emit(alertEvents.EVENTS.ALERT_CREATED, { alertData, alertId });

        // Persist failures so operators can see them in the alert detail view.
        // Best-effort — a failure here is logged but never re-thrown so the
        // caller's main flow (alert creation) is not affected.
        if (failures.length > 0) {
            try {
                await db.query(
                    `UPDATE infrastructure_alerts
                     SET data = jsonb_set(
                         COALESCE(data::jsonb, '{}'::jsonb),
                         '{notification_failures}',
                         $1::jsonb,
                         true
                     )
                     WHERE alert_id = $2`,
                    [JSON.stringify(failures), alertId]
                );
            } catch (updateError) {
                logger.error(
                    `Failed to record notification_failures for alert ${alertId}: ${updateError.message}`
                );
            }
        }
    }

    // Немедленные уведомления для критических алертов.
    // Phase 9.5: dropped emoji prefix to keep log aggregators happy (SEC-004).
    async sendImmediateNotification(alertData, alertId) {
        const notificationData = {
            alert_id: alertId,
            type: alertData.type,
            severity: alertData.severity,
            message: alertData.message,
            infrastructure: `${alertData.infrastructure_type}:${alertData.infrastructure_id}`,
            affected_buildings: alertData.affected_buildings,
            timestamp: new Date().toISOString(),
        };

        // Phase 9.3 (YAGNI-004): getCriticalAlertRecipients returned a
        // hardcoded `[{type:'log'}]` with no consumer. Removed — when
        // email/SMS/Telegram notification channels land, they should read
        // recipients from a users table or notification_preferences.
        logger.warn(`CRITICAL ALERT: ${alertData.message}`, notificationData);
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
    async getActiveAlerts(filters = {}, pagination = {}) {
        await this.ensureInitialized();

        const { page = 1, limit = 10, sort = 'created_at', order = 'desc' } = pagination;
        const offset = (page - 1) * limit;

        const conditions = [];
        const values = [];
        let paramIdx = 1;

        conditions.push(`ia.status = $${paramIdx++}`);
        values.push(filters.status || 'active');

        if (filters.severity) {
            conditions.push(`ia.severity = $${paramIdx++}`);
            values.push(filters.severity);
        }
        if (filters.infrastructure_type) {
            conditions.push(`ia.infrastructure_type = $${paramIdx++}`);
            values.push(filters.infrastructure_type);
        }

        const whereClause = conditions.join(' AND ');

        const validSortColumns = ['created_at', 'severity', 'status', 'infrastructure_type'];
        const sortColumn = validSortColumns.includes(sort) ? sort : 'created_at';
        const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const countQuery = `
            SELECT COUNT(*) as total
            FROM infrastructure_alerts ia
            WHERE ${whereClause}
        `;
        const countResult = await db.query(countQuery, values);
        const total = parseInt(countResult.rows[0].total);

        const dataQuery = `
            SELECT ia.*, u1.username as acknowledged_by_name, u2.username as resolved_by_name
            FROM infrastructure_alerts ia
            LEFT JOIN users u1 ON ia.acknowledged_by = u1.user_id
            LEFT JOIN users u2 ON ia.resolved_by = u2.user_id
            WHERE ${whereClause}
            ORDER BY ia.${sortColumn} ${sortOrder}
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}
        `;
        values.push(limit, offset);

        const result = await db.query(dataQuery, values);
        return { data: result.rows, total };
    }

    // PERF-002: Bounded concurrency replaces sequential for...of loop
    async checkAllTransformers() {
        await this.ensureInitialized();

        try {
            // Phase 7: analyticsService top-level required (no more cycle).
            const transformers = await analyticsService.getAllTransformersWithAnalytics();

            const CONCURRENCY = 5;
            const alerts = [];

            for (let i = 0; i < transformers.length; i += CONCURRENCY) {
                const batch = transformers.slice(i, i + CONCURRENCY);
                const results = await Promise.allSettled(
                    batch.map(t => this.checkTransformerLoad(t.id))
                );
                for (const result of results) {
                    if (result.status === 'fulfilled' && result.value) {
                        alerts.push(result.value);
                    } else if (result.status === 'rejected') {
                        logger.error(`Ошибка проверки трансформатора: ${result.reason?.message}`);
                    }
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

const singleton = new InfrastructureAlertService();

// Phase 7 event subscriptions — registered once at module load.
// These replace former inbound require() calls from analyticsService /
// ukIntegrationService.
alertEvents.on(alertEvents.EVENTS.TRANSFORMER_CHECK, (payload) => {
    const { transformerId } = payload || {};
    if (transformerId == null) return;
    // Mirror the old fire-and-forget contract: background check, do not
    // block the emitter. Errors are logged inside checkTransformerLoad.
    Promise.resolve()
        .then(() => singleton.checkTransformerLoad(transformerId))
        .catch(err => logger.error(
            `alertEvents transformer.check handler: ${err.message}`
        ));
});

alertEvents.on(alertEvents.EVENTS.UK_REQUEST_RESOLVED, (payload) => {
    const { alertId } = payload || {};
    if (alertId == null) return;
    singleton.resolveAlert(alertId, null)
        .then(() => logger.info(
            `alertEvents uk.request.resolved: auto-resolved alert ${alertId}`
        ))
        .catch(err => logger.error(
            `alertEvents uk.request.resolved handler: failed to resolve alert ${alertId}: ${err.message}`
        ));
});

module.exports = singleton;