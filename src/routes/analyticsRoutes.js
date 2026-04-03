const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { isAdmin } = require('../middleware/auth');
const { applyAnalyticsRateLimit, applyAdminRateLimit, applyCrudRateLimit } = require('../middleware/rateLimiter');

/**
 * @swagger
 * components:
 *   schemas:
 *     TransformerAnalytics:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Уникальный идентификатор трансформатора
 *         name:
 *           type: string
 *           description: Название трансформатора
 *         capacity_kva:
 *           type: number
 *           description: Мощность в кВА
 *         load_percent:
 *           type: number
 *           description: Текущая загрузка в процентах
 *         buildings_count:
 *           type: integer
 *           description: Количество подключенных зданий
 *         latitude:
 *           type: number
 *           description: Широта
 *         longitude:
 *           type: number
 *           description: Долгота
 *         status:
 *           type: string
 *           enum: [active, maintenance, inactive]
 *           description: Статус трансформатора
 *
 *     TransformerCreate:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - address
 *         - latitude
 *         - longitude
 *         - capacity_kva
 *       properties:
 *         id:
 *           type: string
 *           description: Уникальный идентификатор
 *         name:
 *           type: string
 *           description: Название трансформатора
 *         address:
 *           type: string
 *           description: Адрес установки
 *         latitude:
 *           type: number
 *           description: Широта
 *         longitude:
 *           type: number
 *           description: Долгота
 *         capacity_kva:
 *           type: number
 *           description: Мощность в кВА
 *         voltage_primary:
 *           type: number
 *           description: Первичное напряжение
 *         voltage_secondary:
 *           type: number
 *           description: Вторичное напряжение
 *         manufacturer:
 *           type: string
 *           description: Производитель
 *         model:
 *           type: string
 *           description: Модель
 *         installation_date:
 *           type: string
 *           format: date
 *           description: Дата установки
 *         maintenance_contact:
 *           type: string
 *           description: Контакт для обслуживания
 *         notes:
 *           type: string
 *           description: Заметки
 */

// === АНАЛИТИЧЕСКИЕ ЭНДПОИНТЫ (READ-ONLY) ===

/**
 * @swagger
 * /api/analytics/transformers:
 *   get:
 *     summary: Получить все трансформаторы с аналитикой
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, maintenance, inactive]
 *         description: Фильтр по статусу
 *       - in: query
 *         name: min_load_percent
 *         schema:
 *           type: number
 *         description: Минимальная загрузка в %
 *       - in: query
 *         name: max_load_percent
 *         schema:
 *           type: number
 *         description: Максимальная загрузка в %
 *       - in: query
 *         name: overloaded_only
 *         schema:
 *           type: boolean
 *         description: Только перегруженные (>80%)
 *     responses:
 *       200:
 *         description: Список трансформаторов с аналитикой
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
 *                     $ref: '#/components/schemas/TransformerAnalytics'
 *                 count:
 *                   type: integer
 */
router.get('/transformers', applyAnalyticsRateLimit, analyticsController.getAllTransformersAnalytics);

/**
 * @swagger
 * /api/analytics/transformers/{transformerId}/load:
 *   get:
 *     summary: Получить загрузку конкретного трансформатора
 *     tags: [Analytics]
 *     parameters:
 *       - in: path
 *         name: transformerId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID трансформатора
 *     responses:
 *       200:
 *         description: Данные загрузки трансформатора
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/TransformerAnalytics'
 */
router.get('/transformers/:transformerId/load', applyAnalyticsRateLimit, analyticsController.getTransformerLoad);

/**
 * @swagger
 * /api/analytics/transformers/overloaded:
 *   get:
 *     summary: Получить перегруженные трансформаторы
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: threshold
 *         schema:
 *           type: number
 *           default: 80
 *         description: Порог загрузки в %
 *     responses:
 *       200:
 *         description: Перегруженные трансформаторы
 */
router.get('/transformers/overloaded', applyAnalyticsRateLimit, analyticsController.getOverloadedTransformers);

/**
 * @swagger
 * /api/analytics/transformers/search:
 *   get:
 *     summary: Геопространственный поиск трансформаторов
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *         description: Широта центра поиска
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *         description: Долгота центра поиска
 *       - in: query
 *         name: radius
 *         schema:
 *           type: integer
 *           default: 5000
 *         description: Радиус поиска в метрах
 *     responses:
 *       200:
 *         description: Трансформаторы в радиусе
 */
router.get('/transformers/search', applyAnalyticsRateLimit, analyticsController.findTransformersInRadius);

/**
 * @swagger
 * /api/analytics/transformers/{transformerId}/buildings:
 *   get:
 *     summary: Найти ближайшие здания к трансформатору
 *     tags: [Analytics]
 *     parameters:
 *       - in: path
 *         name: transformerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: max_distance
 *         schema:
 *           type: integer
 *           default: 1000
 *         description: Максимальное расстояние в метрах
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Максимальное количество зданий
 *     responses:
 *       200:
 *         description: Ближайшие здания
 */
router.get('/transformers/:transformerId/buildings', applyAnalyticsRateLimit, analyticsController.findNearestBuildings);

/**
 * @swagger
 * /api/analytics/transformers/{transformerId}/forecast:
 *   get:
 *     summary: Прогноз нагрузки трансформатора
 *     tags: [Analytics]
 *     parameters:
 *       - in: path
 *         name: transformerId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: hours
 *         schema:
 *           type: integer
 *           default: 24
 *           minimum: 1
 *           maximum: 168
 *         description: Количество часов для прогноза
 *     responses:
 *       200:
 *         description: Прогноз нагрузки
 */
router.get('/transformers/:transformerId/forecast', applyAnalyticsRateLimit, analyticsController.getPeakLoadForecast);

/**
 * @swagger
 * /api/analytics/zones/load:
 *   get:
 *     summary: Анализ загрузки по зонам
 *     tags: [Analytics]
 *     responses:
 *       200:
 *         description: Аналитика загрузки по зонам
 */
router.get('/zones/load', applyAnalyticsRateLimit, analyticsController.getLoadAnalyticsByZone);

/**
 * @swagger
 * /api/analytics/transformers/statistics:
 *   get:
 *     summary: Статистика по трансформаторам
 *     tags: [Analytics]
 *     responses:
 *       200:
 *         description: Общая статистика
 */
router.get('/transformers/statistics', applyAnalyticsRateLimit, analyticsController.getTransformerStatistics);

// === СИСТЕМНЫЕ ЭНДПОИНТЫ ===

/**
 * @swagger
 * /api/analytics/status:
 *   get:
 *     summary: Состояние системы мониторинга
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Состояние Circuit Breaker'ов и кэша
 */
router.get('/status', applyAnalyticsRateLimit, analyticsController.getSystemStatus);

/**
 * @swagger
 * /api/analytics/refresh:
 *   post:
 *     summary: Обновить материализованные представления
 *     tags: [System]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Аналитика обновлена
 */
router.post('/refresh', applyAdminRateLimit, isAdmin, analyticsController.refreshAnalytics);

/**
 * @swagger
 * /api/analytics/cache/invalidate:
 *   post:
 *     summary: Очистить кэши аналитики
 *     tags: [System]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Кэши очищены
 */
router.post('/cache/invalidate', applyAdminRateLimit, isAdmin, analyticsController.invalidateCaches);

/**
 * @swagger
 * /api/analytics/circuit-breakers/reset:
 *   post:
 *     summary: Сбросить Circuit Breaker'ы
 *     tags: [System]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Circuit Breaker'ы сброшены
 */
router.post('/circuit-breakers/reset', applyAdminRateLimit, isAdmin, analyticsController.resetCircuitBreakers);

/**
 * @swagger
 * /api/analytics/thresholds:
 *   put:
 *     summary: Обновить пороги алертов
 *     tags: [System]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               thresholds:
 *                 type: object
 *                 properties:
 *                   transformer_overload:
 *                     type: number
 *                   transformer_critical:
 *                     type: number
 *                   water_pressure_low:
 *                     type: number
 *                   water_pressure_critical:
 *                     type: number
 *     responses:
 *       200:
 *         description: Пороги обновлены
 */
router.put('/thresholds', applyAdminRateLimit, isAdmin, analyticsController.updateThresholds);

// === CRUD ЭНДПОИНТЫ ДЛЯ ТРАНСФОРМАТОРОВ ===

/**
 * @swagger
 * /api/analytics/transformers:
 *   post:
 *     summary: Создать новый трансформатор
 *     tags: [Transformers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransformerCreate'
 *     responses:
 *       201:
 *         description: Трансформатор создан
 *       400:
 *         description: Ошибка валидации
 */
router.post('/transformers', applyCrudRateLimit, isAdmin, analyticsController.createTransformer);

/**
 * @swagger
 * /api/analytics/transformers/{transformerId}:
 *   put:
 *     summary: Обновить трансформатор
 *     tags: [Transformers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transformerId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TransformerCreate'
 *     responses:
 *       200:
 *         description: Трансформатор обновлен
 *       404:
 *         description: Трансформатор не найден
 */
router.put('/transformers/:transformerId', applyCrudRateLimit, isAdmin, analyticsController.updateTransformer);

/**
 * @swagger
 * /api/analytics/transformers/{transformerId}:
 *   delete:
 *     summary: Удалить трансформатор
 *     tags: [Transformers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transformerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Трансформатор удален
 *       404:
 *         description: Трансформатор не найден
 *       400:
 *         description: Нельзя удалить - есть связанные здания
 */
router.delete('/transformers/:transformerId', applyCrudRateLimit, isAdmin, analyticsController.deleteTransformer);

module.exports = router;