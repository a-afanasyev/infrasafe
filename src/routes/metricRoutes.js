const express = require('express');
const metricController = require('../controllers/metricController');
const { authenticateJWT } = require('../middleware/auth');
const router = express.Router();

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: Получить список всех метрик
 *     description: Возвращает список всех метрик с пагинацией
 *     security: [] # Без авторизации
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
 * /metrics/latest:
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
 * /metrics/cleanup:
 *   delete:
 *     summary: Очистка старых метрик
 *     description: Удаляет метрики старше указанного количества дней (по умолчанию 30 дней)
 *     security:
 *       - bearerAuth: [] # Требуется авторизация
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *           minimum: 1
 *           maximum: 365
 *         description: Количество дней для хранения метрик
 *     responses:
 *       200:
 *         description: Старые метрики успешно удалены
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
 *                     deleted:
 *                       type: integer
 *                       description: Количество удаленных записей
 *                     cutoff_date:
 *                       type: string
 *                       format: date-time
 *                       description: Дата отсечения
 *       401:
 *         description: Отсутствует токен авторизации
 *       403:
 *         description: Недействительный токен
 *       400:
 *         description: Неверный параметр days
 */
router.delete('/cleanup', authenticateJWT, metricController.cleanupOldMetrics);

/**
 * @swagger
 * /metrics/controller/{controllerId}/aggregated:
 *   get:
 *     summary: Получить агрегированные метрики
 *     description: Возвращает агрегированные данные (мин/макс/среднее) для контроллера за период
 *     parameters:
 *       - in: path
 *         name: controllerId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID контроллера
 *       - in: query
 *         name: timeFrame
 *         required: true
 *         schema:
 *           type: string
 *           enum: [hour, day, week, month]
 *         description: Временной интервал для агрегации
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
 *         description: Агрегированные метрики
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
 *                     type: object
 *                     properties:
 *                       period:
 *                         type: string
 *                         format: date-time
 *                       temperature:
 *                         type: object
 *                         properties:
 *                           min:
 *                             type: number
 *                           max:
 *                             type: number
 *                           avg:
 *                             type: number
 *                       humidity:
 *                         type: object
 *                         properties:
 *                           min:
 *                             type: number
 *                           max:
 *                             type: number
 *                           avg:
 *                             type: number
 *                       voltage:
 *                         type: object
 *                         properties:
 *                           min:
 *                             type: number
 *                           max:
 *                             type: number
 *                           avg:
 *                             type: number
 *                       count:
 *                         type: integer
 *                         description: Количество записей в периоде
 *       404:
 *         description: Контроллер не найден
 *       400:
 *         description: Неверные параметры запроса
 */
router.get('/controller/:controllerId/aggregated', metricController.getAggregatedMetrics);

/**
 * @swagger
 * /metrics/controller/{controllerId}:
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
 * /metrics/{id}:
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
 * /metrics:
 *   post:
 *     summary: Создать новую метрику
 *     description: Создает новую запись метрики
 *     security:
 *       - bearerAuth: [] # Требуется авторизация
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
 *       401:
 *         description: Отсутствует токен авторизации
 *       403:
 *         description: Недействительный токен
 */
router.post('/', metricController.createMetric);

/**
 * @swagger
 * /metrics/{id}:
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