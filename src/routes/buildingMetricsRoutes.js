const express = require('express');
const buildingMetricsController = require('../controllers/buildingMetricsController');
const { optionalAuth } = require('../middleware/auth');
const router = express.Router();

/**
 * @swagger
 * /buildings-metrics:
 *   get:
 *     summary: Получить здания с последними метриками
 *     description: Возвращает список всех зданий с последними данными метрик для отображения на карте
 *     security: [] # Без авторизации
 *     responses:
 *       200:
 *         description: Успешный ответ со списком зданий и метрик
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   building_id:
 *                     type: integer
 *                   building_name:
 *                     type: string
 *                   address:
 *                     type: string
 *                   town:
 *                     type: string
 *                   latitude:
 *                     type: string
 *                   longitude:
 *                     type: string
 *                   region:
 *                     type: string
 *                   management_company:
 *                     type: string
 *                   has_hot_water:
 *                     type: boolean
 *                   controller_id:
 *                     type: integer
 *                   controller_serial:
 *                     type: string
 *                   controller_status:
 *                     type: string
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *                   electricity_ph1:
 *                     type: number
 *                   electricity_ph2:
 *                     type: number
 *                   electricity_ph3:
 *                     type: number
 *                   cold_water_pressure:
 *                     type: number
 *                   cold_water_temp:
 *                     type: number
 *                   hot_water_in_pressure:
 *                     type: number
 *                   hot_water_out_pressure:
 *                     type: number
 *                   hot_water_in_temp:
 *                     type: number
 *                   hot_water_out_temp:
 *                     type: number
 *                   air_temp:
 *                     type: number
 *                   humidity:
 *                     type: number
 *                   leak_sensor:
 *                     type: boolean
 */
router.get('/', optionalAuth, buildingMetricsController.getBuildingsWithMetrics);

module.exports = router;