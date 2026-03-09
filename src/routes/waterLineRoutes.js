const express = require('express');
const WaterLine = require('../models/WaterLine');
const { createError } = require('../utils/helpers');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/water-lines - Получить все водные линии
router.get('/', async (req, res, next) => {
    try {
        const waterLines = await WaterLine.findAll();
        res.json(waterLines);
    } catch (error) {
        logger.error(`Error fetching water lines: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-lines',
            method: 'GET'
        });
        next(createError('Ошибка получения водных линий', 500));
    }
});

// GET /api/water-lines/:id - Получить водную линию по ID
router.get('/:id', async (req, res, next) => {
    try {
        const waterLine = await WaterLine.findById(req.params.id);
        if (!waterLine) {
            return next(createError('Водная линия не найдена', 404));
        }
        res.json(waterLine);
    } catch (error) {
        logger.error(`Error fetching water line: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}`,
            method: 'GET',
            id: req.params.id
        });
        next(createError('Ошибка получения водной линии', 500));
    }
});

// GET /api/water-lines/:id/supplier - Получить поставщиков для водной линии (через связанные здания)
router.get('/:id/supplier', async (req, res, next) => {
    try {
        const waterLine = await WaterLine.findById(req.params.id);
        if (!waterLine) {
            return next(createError('Водная линия не найдена', 404));
        }

        const suppliers = await WaterLine.findSuppliersForLine(req.params.id);

        res.json({
            suppliers,
            line: {
                id: waterLine.line_id,
                name: waterLine.name
            }
        });
    } catch (error) {
        logger.error(`Error fetching water line supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}/supplier`,
            method: 'GET',
            id: req.params.id
        });
        next(createError('Ошибка получения поставщика линии', 500));
    }
});

// POST /api/water-lines - Создать новую водную линию
router.post('/', applyCrudRateLimit, async (req, res, next) => {
    try {
        const waterLine = await WaterLine.create(req.body);
        res.status(201).json(waterLine);
    } catch (error) {
        logger.error(`Error creating water line: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-lines',
            method: 'POST',
            body: req.body
        });
        next(createError('Ошибка создания водной линии', 500));
    }
});

// PUT /api/water-lines/:id - Обновить водную линию
router.put('/:id', applyCrudRateLimit, async (req, res, next) => {
    try {
        const waterLine = await WaterLine.update(req.params.id, req.body);
        if (!waterLine) {
            return next(createError('Водная линия не найдена', 404));
        }
        res.json(waterLine);
    } catch (error) {
        logger.error(`Error updating water line: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}`,
            method: 'PUT',
            id: req.params.id,
            body: req.body
        });
        next(createError('Ошибка обновления водной линии', 500));
    }
});

// DELETE /api/water-lines/:id - Удалить водную линию
router.delete('/:id', applyCrudRateLimit, async (req, res, next) => {
    try {
        const result = await WaterLine.delete(req.params.id);
        if (!result) {
            return next(createError('Водная линия не найдена', 404));
        }
        res.json({ message: 'Водная линия успешно удалена' });
    } catch (error) {
        logger.error(`Error deleting water line: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}`,
            method: 'DELETE',
            id: req.params.id
        });
        next(createError('Ошибка удаления водной линии', 500));
    }
});

module.exports = router;