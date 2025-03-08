const express = require('express');
const metricController = require('../controllers/metricController');
const router = express.Router();

/**
 * @swagger
 * /api/metrics:
 *   get:
 *     summary: Получить список всех метрик
 *     description: Возвращает список всех метрик с пагинацией
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Номер страницы
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Количество элементов на странице
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: timestamp
 *         description: Поле для сортировки
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Порядок сортировки
 *     responses:
 *       200:
 *         description: Успешный ответ со списком метрик
 */
router.get('/', metricController.getAllMetrics);

/**
 * @swagger
 * /api/metrics/latest:
 *   get:
 *     summary: Получить последние метрики для всех контроллеров
 *     description: Возвращает последние записанные метрики для каждого контроллера
 *     responses:
 *       200:
 *         description: Успешный ответ со списком последних метрик
 */
router.get('/latest', metricController.getLastMetricsForAllControllers);

/**
 * @swagger
 * /api/metrics/controller/{controllerId}:
 *   get:
 *     summary: Получить метрики по ID контроллера
 *     description: Возвращает список метрик для конкретного контроллера с возможностью фильтрации по дате
 *     parameters:
 *       - in: path
 *         name: controllerId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID контроллера
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Начальная дата (ISO формат)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Конечная дата (ISO формат)
 *     responses:
 *       200:
 *         description: Успешный ответ со списком метрик
 *       404:
 *         description: Контроллер не найден
 */
router.get('/controller/:controllerId', metricController.getMetricsByControllerId);

/**
 * @swagger
 * /api/metrics/{id}:
 *   get:
 *     summary: Получить метрику по ID
 *     description: Возвращает одну метрику по ее ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID метрики
 *     responses:
 *       200:
 *         description: Успешный ответ с информацией о метрике
 *       404:
 *         description: Метрика не найдена
 */
router.get('/:id', metricController.getMetricById);

/**
 * @swagger
 * /api/metrics:
 *   post:
 *     summary: Создать новую метрику
 *     description: Создает новую запись метрики
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - controller_id
 *             properties:
 *               controller_id:
 *                 type: integer
 *               temperature:
 *                 type: number
 *               humidity:
 *                 type: number
 *               pressure:
 *                 type: number
 *               co2_level:
 *                 type: number
 *               voltage:
 *                 type: number
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Метрика успешно создана
 *       400:
 *         description: Ошибка валидации данных
 *       404:
 *         description: Контроллер не найден
 */
router.post('/', metricController.createMetric);

/**
 * @swagger
 * /api/metrics/telemetry:
 *   post:
 *     summary: Получить телеметрию от устройства
 *     description: Принимает данные телеметрии от контроллера и сохраняет их как метрику
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - controller_id
 *             properties:
 *               controller_id:
 *                 type: integer
 *               temperature:
 *                 type: number
 *               humidity:
 *                 type: number
 *               pressure:
 *                 type: number
 *               co2_level:
 *                 type: number
 *               voltage:
 *                 type: number
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Телеметрия успешно получена и сохранена
 *       400:
 *         description: Ошибка валидации данных
 *       404:
 *         description: Контроллер не найден
 */
router.post('/telemetry', metricController.receiveTelementry);

/**
 * @swagger
 * /api/metrics/{id}:
 *   delete:
 *     summary: Удалить метрику
 *     description: Удаляет метрику по ее ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID метрики
 *     responses:
 *       200:
 *         description: Метрика успешно удалена
 *       404:
 *         description: Метрика не найдена
 */
router.delete('/:id', metricController.deleteMetric);

module.exports = router; 