const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { createError } = require('../utils/helpers');

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
router.get('/', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const sort = req.query.sort || 'id';
        const order = req.query.order || 'asc';

        // Получаем общее количество записей
        const countResult = await query('SELECT COUNT(*) FROM cold_water_sources');
        const total = parseInt(countResult.rows[0].count);

        // Получаем данные с пагинацией
        const result = await query(
            `SELECT * FROM cold_water_sources 
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
        console.error('Error fetching water sources:', error);
        next(createError('Failed to fetch water sources: ' + error.message, 500));
    }
});

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
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('SELECT * FROM cold_water_sources WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return next(createError('Water source not found', 404));
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching water source:', error);
        next(createError('Failed to fetch water source: ' + error.message, 500));
    }
});

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
router.post('/', async (req, res, next) => {
    try {
        const {
            id, name, address, latitude, longitude, source_type,
            capacity_m3_per_hour, operating_pressure_bar, installation_date,
            status, maintenance_contact, notes
        } = req.body;

        const result = await query(
            `INSERT INTO cold_water_sources 
             (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour, 
              operating_pressure_bar, installation_date, status, maintenance_contact, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [id, name, address, latitude, longitude, source_type, capacity_m3_per_hour,
             operating_pressure_bar, installation_date, status || 'active', maintenance_contact, notes]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating water source:', error);
        next(createError('Failed to create water source: ' + error.message, 500));
    }
});

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
router.put('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            name, address, latitude, longitude, source_type,
            capacity_m3_per_hour, operating_pressure_bar, installation_date,
            status, maintenance_contact, notes
        } = req.body;

        const result = await query(
            `UPDATE cold_water_sources 
             SET name = $2, address = $3, latitude = $4, longitude = $5, 
                 source_type = $6, capacity_m3_per_hour = $7, operating_pressure_bar = $8,
                 installation_date = $9, status = $10, maintenance_contact = $11, 
                 notes = $12, updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [id, name, address, latitude, longitude, source_type, capacity_m3_per_hour,
             operating_pressure_bar, installation_date, status, maintenance_contact, notes]
        );

        if (result.rows.length === 0) {
            return next(createError('Water source not found', 404));
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating water source:', error);
        next(createError('Failed to update water source: ' + error.message, 500));
    }
});

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
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await query('DELETE FROM cold_water_sources WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(createError('Water source not found', 404));
        }

        res.json({ message: 'Water source deleted successfully', deleted: result.rows[0] });
    } catch (error) {
        console.error('Error deleting water source:', error);
        next(createError('Failed to delete water source: ' + error.message, 500));
    }
});

module.exports = router; 