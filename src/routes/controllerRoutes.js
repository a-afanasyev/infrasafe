const express = require('express');
const controllerController = require('../controllers/controllerController');
const router = express.Router();

/**
 * @swagger
 * /controllers:
 *   get:
 *     summary: Получить список всех контроллеров
 *     description: Возвращает список всех контроллеров с пагинацией
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
 *           default: controller_id
 *         description: Поле для сортировки
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Порядок сортировки
 *     responses:
 *       200:
 *         description: Успешный ответ со списком контроллеров
 */
router.get('/', controllerController.getAllControllers);

/**
 * @swagger
 * /controllers/{id}:
 *   get:
 *     summary: Получить контроллер по ID
 *     description: Возвращает один контроллер по его ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID контроллера
 *     responses:
 *       200:
 *         description: Успешный ответ с информацией о контроллере
 *       404:
 *         description: Контроллер не найден
 */
router.get('/:id', controllerController.getControllerById);

/**
 * @swagger
 * /controllers/building/{buildingId}:
 *   get:
 *     summary: Получить контроллеры по ID здания
 *     description: Возвращает список контроллеров, привязанных к зданию
 *     parameters:
 *       - in: path
 *         name: buildingId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID здания
 *     responses:
 *       200:
 *         description: Успешный ответ со списком контроллеров
 */
router.get('/building/:buildingId', controllerController.getControllersByBuildingId);

/**
 * @swagger
 * /controllers/{id}/metrics:
 *   get:
 *     summary: Получить метрики контроллера
 *     description: Возвращает список метрик для контроллера с возможностью фильтрации по дате
 *     parameters:
 *       - in: path
 *         name: id
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
router.get('/:id/metrics', controllerController.getControllerMetrics);

/**
 * @swagger
 * /controllers:
 *   post:
 *     summary: Создать новый контроллер
 *     description: Создает новый контроллер
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - building_id
 *               - serial_number
 *             properties:
 *               name:
 *                 type: string
 *               building_id:
 *                 type: integer
 *               serial_number:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [online, offline, maintenance]
 *                 default: offline
 *               firmware_version:
 *                 type: string
 *     responses:
 *       201:
 *         description: Контроллер успешно создан
 *       400:
 *         description: Ошибка валидации данных
 */
router.post('/', controllerController.createController);

/**
 * @swagger
 * /controllers/{id}:
 *   put:
 *     summary: Обновить контроллер
 *     description: Обновляет существующий контроллер по его ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID контроллера
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               building_id:
 *                 type: integer
 *               serial_number:
 *                 type: string
 *               firmware_version:
 *                 type: string
 *     responses:
 *       200:
 *         description: Контроллер успешно обновлен
 *       404:
 *         description: Контроллер не найден
 *       400:
 *         description: Ошибка валидации данных
 */
router.put('/:id', controllerController.updateController);

/**
 * @swagger
 * /controllers/{id}/status:
 *   patch:
 *     summary: Обновить статус контроллера
 *     description: Обновляет статус существующего контроллера
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID контроллера
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [online, offline, maintenance]
 *     responses:
 *       200:
 *         description: Статус контроллера успешно обновлен
 *       404:
 *         description: Контроллер не найден
 *       400:
 *         description: Неверное значение статуса
 */
router.patch('/:id/status', controllerController.updateControllerStatus);

/**
 * @swagger
 * /controllers/{id}:
 *   delete:
 *     summary: Удалить контроллер
 *     description: Удаляет контроллер по его ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID контроллера
 *     responses:
 *       200:
 *         description: Контроллер успешно удален
 *       404:
 *         description: Контроллер не найден
 *       400:
 *         description: Невозможно удалить контроллер с привязанными метриками
 */
router.delete('/:id', controllerController.deleteController);

module.exports = router; 