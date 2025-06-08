const express = require('express');
const adminController = require('../controllers/adminController');
const { rateLimitStrict } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     AdminBuildingsList:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Building'
 *         pagination:
 *           type: object
 *           properties:
 *             total:
 *               type: integer
 *             page:
 *               type: integer
 *             limit:
 *               type: integer
 *             totalPages:
 *               type: integer
 *             hasNext:
 *               type: boolean
 *             hasPrev:
 *               type: boolean
 *         performance:
 *           type: object
 *           properties:
 *             queryTime:
 *               type: number
 *             cacheHit:
 *               type: boolean
 */

/**
 * @swagger
 * /admin/buildings:
 *   get:
 *     summary: Получить здания для админки (оптимизированный)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [building_id, name, town, region, management_company]
 *           default: building_id
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Поиск по названию, адресу, городу
 *       - in: query
 *         name: town
 *         schema:
 *           type: string
 *         description: Фильтр по городу
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: Фильтр по региону
 *       - in: query
 *         name: management_company
 *         schema:
 *           type: string
 *         description: Фильтр по управляющей компании
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Выборочные поля (через запятую)
 *       - in: query
 *         name: include_stats
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Включить статистику по контроллерам
 *     responses:
 *       200:
 *         description: Список зданий с метаданными
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AdminBuildingsList'
 */
router.get('/buildings', adminController.getOptimizedBuildings);

/**
 * @swagger
 * /admin/buildings/batch:
 *   post:
 *     summary: Массовые операции с зданиями
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [delete, update, export]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               data:
 *                 type: object
 *                 description: Данные для операции update
 *     responses:
 *       200:
 *         description: Результат массовой операции
 */
router.post('/buildings/batch', rateLimitStrict, adminController.batchBuildingsOperation);

/**
 * @swagger
 * /admin/controllers:
 *   get:
 *     summary: Получить контроллеры для админки (оптимизированный)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [controller_id, serial_number, vendor, model, status, building_id]
 *           default: controller_id
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Поиск по серийному номеру, модели, производителю
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [online, offline, maintenance]
 *         description: Фильтр по статусу
 *       - in: query
 *         name: vendor
 *         schema:
 *           type: string
 *         description: Фильтр по производителю
 *       - in: query
 *         name: building_id
 *         schema:
 *           type: integer
 *         description: Фильтр по зданию
 *       - in: query
 *         name: include_building
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Включить данные здания
 *       - in: query
 *         name: include_metrics
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Включить последние метрики
 *     responses:
 *       200:
 *         description: Список контроллеров с метаданными
 */
router.get('/controllers', adminController.getOptimizedControllers);

/**
 * @swagger
 * /admin/controllers/batch:
 *   post:
 *     summary: Массовые операции с контроллерами
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [delete, update_status, restart, export]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Результат массовой операции
 */
router.post('/controllers/batch', rateLimitStrict, adminController.batchControllersOperation);

/**
 * @swagger
 * /admin/metrics:
 *   get:
 *     summary: Получить метрики для админки (оптимизированный)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 500
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [timestamp, controller_id, metric_id]
 *           default: timestamp
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: controller_id
 *         schema:
 *           type: integer
 *         description: Фильтр по контроллеру
 *       - in: query
 *         name: building_id
 *         schema:
 *           type: integer
 *         description: Фильтр по зданию
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Дата начала периода
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Дата окончания периода
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Выборочные поля метрик
 *       - in: query
 *         name: aggregation
 *         schema:
 *           type: string
 *           enum: [hour, day, none]
 *           default: none
 *         description: Агрегация данных
 *     responses:
 *       200:
 *         description: Список метрик с метаданными
 */
router.get('/metrics', adminController.getOptimizedMetrics);

/**
 * @swagger
 * /admin/metrics/batch:
 *   post:
 *     summary: Массовые операции с метриками
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [delete, cleanup_old, export]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               criteria:
 *                 type: object
 *                 properties:
 *                   older_than_days:
 *                     type: integer
 *                   controller_ids:
 *                     type: array
 *                     items:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Результат массовой операции
 */
router.post('/metrics/batch', rateLimitStrict, adminController.batchMetricsOperation);

/**
 * @swagger
 * /admin/search:
 *   get:
 *     summary: Глобальный поиск по всем сущностям
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Поисковый запрос
 *       - in: query
 *         name: types
 *         schema:
 *           type: string
 *           default: "buildings,controllers"
 *         description: Типы для поиска (через запятую)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Результаты глобального поиска
 */
router.get('/search', adminController.globalSearch);

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Статистика для дашборда админки
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Общая статистика системы
 */
router.get('/stats', adminController.getAdminStats);

/**
 * @swagger
 * /admin/export:
 *   post:
 *     summary: Экспорт данных в различных форматах
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [buildings, controllers, metrics]
 *               format:
 *                 type: string
 *                 enum: [csv, xlsx, json]
 *               filters:
 *                 type: object
 *     responses:
 *       200:
 *         description: Файл для скачивания
 */
router.post('/export', rateLimitStrict, adminController.exportData);

/**
 * @swagger
 * /admin/transformers:
 *   get:
 *     summary: Получить трансформаторы для админки (оптимизированный)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [transformer_id, name, power_kva, voltage_kv, building_id]
 *           default: transformer_id
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Поиск по названию
 *       - in: query
 *         name: power_min
 *         schema:
 *           type: number
 *         description: Минимальная мощность (кВА)
 *       - in: query
 *         name: power_max
 *         schema:
 *           type: number
 *         description: Максимальная мощность (кВА)
 *       - in: query
 *         name: voltage_kv
 *         schema:
 *           type: number
 *         description: Фильтр по напряжению (кВ)
 *       - in: query
 *         name: building_id
 *         schema:
 *           type: integer
 *         description: Фильтр по зданию
 *     responses:
 *       200:
 *         description: Список трансформаторов с метаданными
 *   post:
 *     summary: Создать новый трансформатор
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - power_kva
 *               - voltage_kv
 *             properties:
 *               name:
 *                 type: string
 *               power_kva:
 *                 type: number
 *               voltage_kv:
 *                 type: number
 *               building_id:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Трансформатор создан
 */
router.get('/transformers', adminController.getOptimizedTransformers);
router.post('/transformers', rateLimitStrict, adminController.createTransformer);

/**
 * @swagger
 * /admin/transformers/{id}:
 *   get:
 *     summary: Получить трансформатор по ID
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Данные трансформатора
 *       404:
 *         description: Трансформатор не найден
 *   put:
 *     summary: Обновить трансформатор
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               power_kva:
 *                 type: number
 *               voltage_kv:
 *                 type: number
 *               building_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Трансформатор обновлен
 *   delete:
 *     summary: Удалить трансформатор
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Трансформатор удален
 */
router.get('/transformers/:id', adminController.getTransformerById);
router.put('/transformers/:id', rateLimitStrict, adminController.updateTransformer);
router.delete('/transformers/:id', rateLimitStrict, adminController.deleteTransformer);

/**
 * @swagger
 * /admin/transformers/batch:
 *   post:
 *     summary: Массовые операции с трансформаторами
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [delete, update_voltage, update_power, export]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Результат массовой операции
 */
router.post('/transformers/batch', rateLimitStrict, adminController.batchTransformersOperation);

/**
 * @swagger
 * /admin/lines:
 *   get:
 *     summary: Получить линии электропередач для админки (оптимизированный)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [line_id, name, voltage_kv, length_km, transformer_id]
 *           default: line_id
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Поиск по названию
 *       - in: query
 *         name: voltage_min
 *         schema:
 *           type: number
 *         description: Минимальное напряжение (кВ)
 *       - in: query
 *         name: voltage_max
 *         schema:
 *           type: number
 *         description: Максимальное напряжение (кВ)
 *       - in: query
 *         name: length_min
 *         schema:
 *           type: number
 *         description: Минимальная длина (км)
 *       - in: query
 *         name: length_max
 *         schema:
 *           type: number
 *         description: Максимальная длина (км)
 *       - in: query
 *         name: transformer_id
 *         schema:
 *           type: integer
 *         description: Фильтр по трансформатору
 *     responses:
 *       200:
 *         description: Список линий с метаданными
 *   post:
 *     summary: Создать новую линию электропередач
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - voltage_kv
 *               - length_km
 *             properties:
 *               name:
 *                 type: string
 *               voltage_kv:
 *                 type: number
 *               length_km:
 *                 type: number
 *               transformer_id:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Линия создана
 */
router.get('/lines', adminController.getOptimizedLines);
router.post('/lines', rateLimitStrict, adminController.createLine);

/**
 * @swagger
 * /admin/lines/{id}:
 *   get:
 *     summary: Получить линию по ID
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Данные линии
 *       404:
 *         description: Линия не найдена
 *   put:
 *     summary: Обновить линию
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               voltage_kv:
 *                 type: number
 *               length_km:
 *                 type: number
 *               transformer_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Линия обновлена
 *   delete:
 *     summary: Удалить линию
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Линия удалена
 */
router.get('/lines/:id', adminController.getLineById);
router.put('/lines/:id', rateLimitStrict, adminController.updateLine);
router.delete('/lines/:id', rateLimitStrict, adminController.deleteLine);

/**
 * @swagger
 * /admin/lines/batch:
 *   post:
 *     summary: Массовые операции с линиями
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [delete, update_voltage, set_maintenance, export]
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               data:
 *                 type: object
 *     responses:
 *       200:
 *         description: Результат массовой операции
 */
router.post('/lines/batch', rateLimitStrict, adminController.batchLinesOperation);

module.exports = router; 