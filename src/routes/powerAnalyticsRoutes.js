const express = require('express');
const router = express.Router();
const powerAnalyticsController = require('../controllers/powerAnalyticsController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');

/**
 * @swagger
 * /api/power-analytics/buildings:
 *   get:
 *     summary: Получить потребляемую мощность всех зданий
 *     tags: [Power Analytics]
 *     responses:
 *       200:
 *         description: Список зданий с детализацией мощности по фазам
 */
router.get('/buildings', powerAnalyticsController.getBuildingsPower);

/**
 * @swagger
 * /api/power-analytics/buildings/{buildingId}:
 *   get:
 *     summary: Получить мощность конкретного здания
 *     tags: [Power Analytics]
 *     parameters:
 *       - in: path
 *         name: buildingId
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/buildings/:buildingId', powerAnalyticsController.getBuildingPower);

/**
 * @swagger
 * /api/power-analytics/lines:
 *   get:
 *     summary: Получить суммарную мощность всех линий
 *     tags: [Power Analytics]
 *     responses:
 *       200:
 *         description: Список линий с детализацией мощности по фазам
 */
router.get('/lines', powerAnalyticsController.getLinesPower);

/**
 * @swagger
 * /api/power-analytics/lines/{lineId}:
 *   get:
 *     summary: Получить мощность конкретной линии
 *     tags: [Power Analytics]
 *     parameters:
 *       - in: path
 *         name: lineId
 *         required: true
 *         schema:
 *           type: integer
 */
router.get('/lines/:lineId', powerAnalyticsController.getLinePower);

/**
 * @swagger
 * /api/power-analytics/transformers:
 *   get:
 *     summary: Получить загрузку всех трансформаторов
 *     tags: [Power Analytics]
 *     responses:
 *       200:
 *         description: Список трансформаторов с загрузкой по фазам
 */
router.get('/transformers', powerAnalyticsController.getTransformersPower);

/**
 * @swagger
 * /api/power-analytics/transformers/{transformerId}:
 *   get:
 *     summary: Получить загрузку конкретного трансформатора
 *     tags: [Power Analytics]
 *     parameters:
 *       - in: path
 *         name: transformerId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/transformers/:transformerId', powerAnalyticsController.getTransformerPower);

/**
 * @swagger
 * /api/power-analytics/phase-imbalance:
 *   get:
 *     summary: Анализ дисбаланса фаз
 *     tags: [Power Analytics]
 *     responses:
 *       200:
 *         description: Трансформаторы с анализом дисбаланса нагрузки по фазам
 */
router.get('/phase-imbalance', powerAnalyticsController.getPhaseImbalanceAnalysis);

/**
 * @swagger
 * /api/power-analytics/refresh:
 *   post:
 *     summary: Обновить данные о мощности
 *     tags: [Power Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Данные успешно обновлены
 */
router.post('/refresh', applyCrudRateLimit, isAdmin, powerAnalyticsController.refreshPowerViews);

module.exports = router;
