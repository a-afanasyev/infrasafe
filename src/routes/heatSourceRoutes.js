const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { createError } = require('../utils/helpers');

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
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const sort = req.query.sort || 'id';
        const order = req.query.order || 'asc';

        // Получаем общее количество записей
        const countResult = await query('SELECT COUNT(*) FROM heat_sources');
        const total = parseInt(countResult.rows[0].count);

        // Получаем данные с пагинацией
        const result = await query(
            `SELECT * FROM heat_sources
             ORDER BY ${sort} ${order}
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        res.json({
            data: result.rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching heat sources:', error);
        next(createError('Failed to fetch heat sources: ' + error.message, 500));
    }
});

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
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('SELECT * FROM heat_sources WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return next(createError('Heat source not found', 404));
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching heat source:', error);
        next(createError('Failed to fetch heat source: ' + error.message, 500));
    }
});

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
router.post('/', async (req, res, next) => {
    try {
        const {
            id, name, address, latitude, longitude, source_type,
            capacity_mw, fuel_type, installation_date,
            status, maintenance_contact, notes
        } = req.body;

        const result = await query(
            `INSERT INTO heat_sources
             (id, name, address, latitude, longitude, source_type, capacity_mw,
              fuel_type, installation_date, status, maintenance_contact, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [id, name, address, latitude, longitude, source_type, capacity_mw,
             fuel_type, installation_date, status || 'active', maintenance_contact, notes]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating heat source:', error);
        next(createError('Failed to create heat source: ' + error.message, 500));
    }
});

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
router.put('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            name, address, latitude, longitude, source_type,
            capacity_mw, fuel_type, installation_date,
            status, maintenance_contact, notes
        } = req.body;

        const result = await query(
            `UPDATE heat_sources
             SET name = $2, address = $3, latitude = $4, longitude = $5,
                 source_type = $6, capacity_mw = $7, fuel_type = $8,
                 installation_date = $9, status = $10, maintenance_contact = $11,
                 notes = $12, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, name, address, latitude, longitude, source_type, capacity_mw,
             fuel_type, installation_date, status, maintenance_contact, notes]
        );

        if (result.rows.length === 0) {
            return next(createError('Heat source not found', 404));
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating heat source:', error);
        next(createError('Failed to update heat source: ' + error.message, 500));
    }
});

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
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('DELETE FROM heat_sources WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(createError('Heat source not found', 404));
        }

        res.json({ message: 'Heat source deleted successfully', deleted: result.rows[0] });
    } catch (error) {
        console.error('Error deleting heat source:', error);
        next(createError('Failed to delete heat source: ' + error.message, 500));
    }
});

module.exports = router;