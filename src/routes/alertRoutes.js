const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alertController');
const { isAdmin } = require('../middleware/auth');
const { applyAnalyticsRateLimit, applyAdminRateLimit, applyCrudRateLimit } = require('../middleware/rateLimiter');

/**
 * @swagger
 * components:
 *   schemas:
 *     Alert:
 *       type: object
 *       properties:
 *         alert_id:
 *           type: integer
 *           description: Уникальный идентификатор алерта
 *         type:
 *           type: string
 *           description: Тип алерта
 *           example: "TRANSFORMER_OVERLOAD"
 *         infrastructure_id:
 *           type: string
 *           description: ID инфраструктурного объекта
 *         infrastructure_type:
 *           type: string
 *           enum: [transformer, water_source, heat_source]
 *           description: Тип инфраструктурного объекта
 *         severity:
 *           type: string
 *           enum: [INFO, WARNING, CRITICAL]
 *           description: Уровень важности алерта
 *         status:
 *           type: string
 *           enum: [active, acknowledged, resolved]
 *           description: Статус алерта
 *         message:
 *           type: string
 *           description: Сообщение алерта
 *         affected_buildings:
 *           type: integer
 *           description: Количество затронутых зданий
 *         data:
 *           type: object
 *           description: Дополнительные данные алерта
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Время создания
 *         acknowledged_at:
 *           type: string
 *           format: date-time
 *           description: Время подтверждения
 *         resolved_at:
 *           type: string
 *           format: date-time
 *           description: Время закрытия
 *
 *     AlertCreate:
 *       type: object
 *       required:
 *         - type
 *         - infrastructure_id
 *         - infrastructure_type
 *         - severity
 *         - message
 *       properties:
 *         type:
 *           type: string
 *           description: Тип алерта
 *           example: "MANUAL_ALERT"
 *         infrastructure_id:
 *           type: string
 *           description: ID инфраструктурного объекта
 *         infrastructure_type:
 *           type: string
 *           enum: [transformer, water_source, heat_source]
 *           description: Тип инфраструктурного объекта
 *         severity:
 *           type: string
 *           enum: [INFO, WARNING, CRITICAL]
 *           description: Уровень важности алерта
 *         message:
 *           type: string
 *           description: Сообщение алерта
 *         affected_buildings:
 *           type: integer
 *           description: Количество затронутых зданий
 *         data:
 *           type: object
 *           description: Дополнительные данные алерта
 */

// === ПОЛУЧЕНИЕ АЛЕРТОВ ===

/**
 * @swagger
 * /api/alerts:
 *   get:
 *     summary: Получить активные алерты
 *     tags: [Alerts]
 *     parameters:
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [INFO, WARNING, CRITICAL]
 *         description: Фильтр по уровню важности
 *       - in: query
 *         name: infrastructure_type
 *         schema:
 *           type: string
 *           enum: [transformer, water_source, heat_source]
 *         description: Фильтр по типу инфраструктуры
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Максимальное количество результатов
 *     responses:
 *       200:
 *         description: Список активных алертов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Alert'
 *                 count:
 *                   type: integer
 */
router.get('/', applyAnalyticsRateLimit, alertController.getActiveAlerts);

/**
 * @swagger
 * /api/alerts/statistics:
 *   get:
 *     summary: Получить статистику алертов
 *     tags: [Alerts]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *           minimum: 1
 *           maximum: 365
 *         description: Период для статистики в днях
 *     responses:
 *       200:
 *         description: Статистика алертов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     period_days:
 *                       type: integer
 *                     statistics:
 *                       type: array
 *                       items:
 *                         type: object
 *                     active_alerts_count:
 *                       type: integer
 */
router.get('/statistics', applyAnalyticsRateLimit, alertController.getAlertStatistics);

/**
 * @swagger
 * /api/alerts/status:
 *   get:
 *     summary: Получить статус системы алертов
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: Статус системы алертов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     active_alerts:
 *                       type: integer
 *                     last_checks:
 *                       type: integer
 *                     cooldown_minutes:
 *                       type: integer
 *                     thresholds:
 *                       type: object
 *                     circuit_breaker_state:
 *                       type: object
 */
router.get('/status', applyAnalyticsRateLimit, alertController.getSystemStatus);

// === ПРОВЕРКИ ИНФРАСТРУКТУРЫ ===

/**
 * @swagger
 * /api/alerts/check/transformer/{transformerId}:
 *   post:
 *     summary: Проверить конкретный трансформатор
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transformerId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID трансформатора
 *     responses:
 *       200:
 *         description: Результат проверки трансформатора
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   oneOf:
 *                     - $ref: '#/components/schemas/Alert'
 *                     - type: "null"
 */
router.post('/check/transformer/:transformerId', applyAdminRateLimit, isAdmin, alertController.checkTransformer);

/**
 * @swagger
 * /api/alerts/check/all-transformers:
 *   post:
 *     summary: Проверить все трансформаторы
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Результат массовой проверки
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     checked:
 *                       type: integer
 *                     alerts_created:
 *                       type: integer
 *                     alerts:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Alert'
 */
router.post('/check/all-transformers', applyAdminRateLimit, isAdmin, alertController.checkAllTransformers);

// === УПРАВЛЕНИЕ АЛЕРТАМИ ===

/**
 * @swagger
 * /api/alerts:
 *   post:
 *     summary: Создать алерт вручную
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AlertCreate'
 *     responses:
 *       201:
 *         description: Алерт успешно создан
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Alert'
 */
router.post('/', applyCrudRateLimit, alertController.createAlert);

/**
 * @swagger
 * /api/alerts/{alertId}/acknowledge:
 *   patch:
 *     summary: Подтвердить алерт
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID алерта
 *     responses:
 *       200:
 *         description: Алерт успешно подтвержден
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Alert'
 */
router.patch('/:alertId/acknowledge', applyCrudRateLimit, isAdmin, alertController.acknowledgeAlert);

/**
 * @swagger
 * /api/alerts/{alertId}/resolve:
 *   patch:
 *     summary: Закрыть алерт
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID алерта
 *     responses:
 *       200:
 *         description: Алерт успешно закрыт
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Alert'
 */
router.patch('/:alertId/resolve', applyCrudRateLimit, isAdmin, alertController.resolveAlert);

// === НАСТРОЙКИ АЛЕРТОВ ===

/**
 * @swagger
 * /api/alerts/thresholds:
 *   get:
 *     summary: Получить пороги алертов
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: Текущие пороги алертов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     transformer_overload:
 *                       type: number
 *                     transformer_critical:
 *                       type: number
 *                     water_pressure_low:
 *                       type: number
 *                     water_pressure_critical:
 *                       type: number
 *                     heating_temp_delta_low:
 *                       type: number
 *                     heating_temp_delta_critical:
 *                       type: number
 *   put:
 *     summary: Обновить пороги алертов
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               transformer_overload:
 *                 type: number
 *                 minimum: 0
 *               transformer_critical:
 *                 type: number
 *                 minimum: 0
 *               water_pressure_low:
 *                 type: number
 *                 minimum: 0
 *               water_pressure_critical:
 *                 type: number
 *                 minimum: 0
 *               heating_temp_delta_low:
 *                 type: number
 *                 minimum: 0
 *               heating_temp_delta_critical:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Пороги успешно обновлены
 */
router.get('/thresholds', applyAnalyticsRateLimit, alertController.getThresholds);
router.put('/thresholds', isAdmin, applyAdminRateLimit, alertController.updateThresholds);

module.exports = router;