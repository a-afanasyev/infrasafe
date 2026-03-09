const express = require('express');
const router = express.Router();
const heatSourceController = require('../controllers/heatSourceController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');

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
router.get('/:id', heatSourceController.getById);

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
router.post('/', applyCrudRateLimit, heatSourceController.create);

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
router.put('/:id', applyCrudRateLimit, heatSourceController.update);

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
router.delete('/:id', applyCrudRateLimit, heatSourceController.remove);

module.exports = router;
