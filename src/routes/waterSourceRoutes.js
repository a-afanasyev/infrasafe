const express = require('express');
const router = express.Router();
const coldWaterSourceController = require('../controllers/coldWaterSourceController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');

/**
 * @swagger
 * components:
 *   schemas:
 *     WaterSource:
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
 *           enum: [pumping_station, well, reservoir]
 *         capacity_m3_per_hour:
 *           type: number
 *         operating_pressure_bar:
 *           type: number
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
 * /api/cold-water-sources:
 *   get:
 *     summary: Получить список источников холодной воды
 *     tags: [Water Sources]
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
 *         description: Список источников воды
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/WaterSource'
 *                 pagination:
 *                   type: object
 */
router.get('/', coldWaterSourceController.getAll);

/**
 * @swagger
 * /api/cold-water-sources/{id}:
 *   get:
 *     summary: Получить источник воды по ID
 *     tags: [Water Sources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Данные источника воды
 *       404:
 *         description: Источник не найден
 */
router.get('/:id', coldWaterSourceController.getById);

/**
 * @swagger
 * /api/cold-water-sources:
 *   post:
 *     summary: Создать новый источник воды
 *     tags: [Water Sources]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WaterSource'
 *     responses:
 *       201:
 *         description: Источник воды создан
 *       400:
 *         description: Ошибка валидации
 */
router.post('/', applyCrudRateLimit, coldWaterSourceController.create);

/**
 * @swagger
 * /api/cold-water-sources/{id}:
 *   put:
 *     summary: Обновить источник воды
 *     tags: [Water Sources]
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
 *             $ref: '#/components/schemas/WaterSource'
 *     responses:
 *       200:
 *         description: Источник воды обновлен
 *       404:
 *         description: Источник не найден
 */
router.put('/:id', applyCrudRateLimit, coldWaterSourceController.update);

/**
 * @swagger
 * /api/cold-water-sources/{id}:
 *   delete:
 *     summary: Удалить источник воды
 *     tags: [Water Sources]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Источник воды удален
 *       404:
 *         description: Источник не найден
 */
router.delete('/:id', applyCrudRateLimit, coldWaterSourceController.remove);

module.exports = router;
