const express = require('express');
const router = express.Router();
const heatSourceController = require('../controllers/heatSourceController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');
const { validateIntParam, validateHeatSourceCreate } = require('../middleware/validators');

/**
 * @swagger
 * components:
 *   schemas:
 *     HeatSource:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         address:
 *           type: string
 *         latitude:
 *           type: number
 *         longitude:
 *           type: number
 *         source_type:
 *           type: string
 *           enum: [boiler_house, heat_plant, chp]
 *         capacity_mw:
 *           type: number
 *         fuel_type:
 *           type: string
 *         installation_date:
 *           type: string
 *           format: date
 *         status:
 *           type: string
 *           enum: [active, inactive, maintenance]
 *         maintenance_contact:
 *           type: string
 *         notes:
 *           type: string
 */

/**
 * @swagger
 * /api/heat-sources:
 *   get:
 *     summary: Получить список источников тепла
 *     tags: [Heat Sources]
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
 *           default: 10
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: id
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *     responses:
 *       200:
 *         description: Список источников тепла
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/HeatSource'
 *                 pagination:
 *                   type: object
 */
router.get('/', heatSourceController.getAll);

/**
 * @swagger
 * /api/heat-sources/{id}:
 *   get:
 *     summary: Получить источник тепла по ID
 *     tags: [Heat Sources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Данные источника тепла
 *       404:
 *         description: Источник не найден
 */
router.get('/:id', validateIntParam('id'), heatSourceController.getById);

/**
 * @swagger
 * /api/heat-sources:
 *   post:
 *     summary: Создать новый источник тепла
 *     tags: [Heat Sources]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/HeatSource'
 *     responses:
 *       201:
 *         description: Источник тепла создан
 *       400:
 *         description: Ошибка валидации
 */
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
// [AR-10, доработка] Схема тела стоит здесь, а не только на `/api/admin/*`:
// админка создаёт эти сущности именно через этот маршрут — проверено в браузере,
// где трансформатор с именем `<script>…` создавался с кодом 201.
router.post('/', applyCrudRateLimit, isAdmin, validateHeatSourceCreate, heatSourceController.create);

/**
 * @swagger
 * /api/heat-sources/{id}:
 *   put:
 *     summary: Обновить источник тепла
 *     tags: [Heat Sources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/HeatSource'
 *     responses:
 *       200:
 *         description: Источник тепла обновлен
 *       404:
 *         description: Источник не найден
 */
router.put('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), heatSourceController.update);

/**
 * @swagger
 * /api/heat-sources/{id}:
 *   delete:
 *     summary: Удалить источник тепла
 *     tags: [Heat Sources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Источник тепла удален
 *       404:
 *         description: Источник не найден
 */
router.delete('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), heatSourceController.remove);

module.exports = router;
