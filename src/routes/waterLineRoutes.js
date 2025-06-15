const express = require('express');
const WaterLine = require('../models/WaterLine');
const { createError } = require('../utils/helpers');

const router = express.Router();

// GET /api/water-lines - Получить все водные линии
router.get('/', async (req, res, next) => {
    try {
        const waterLines = await WaterLine.findAll();
        res.json(waterLines);
    } catch (error) {
        console.error('Error fetching water lines:', error);
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
        console.error('Error fetching water line:', error);
        next(createError('Ошибка получения водной линии', 500));
    }
});

// GET /api/water-lines/:id/supplier - Получить поставщика для водной линии
router.get('/:id/supplier', async (req, res, next) => {
    try {
        const waterLine = await WaterLine.findById(req.params.id);
        if (!waterLine) {
            return next(createError('Водная линия не найдена', 404));
        }

        if (!waterLine.supplier_id) {
            return res.json({ supplier: null, message: 'К линии не привязан поставщик' });
        }

        const WaterSupplier = require('../models/WaterSupplier');
        const supplier = await WaterSupplier.findById(waterLine.supplier_id);

        res.json({
            supplier: supplier,
            line: {
                id: waterLine.line_id,
                name: waterLine.name,
                type: waterLine.line_type
            }
        });
    } catch (error) {
        console.error('Error fetching water line supplier:', error);
        next(createError('Ошибка получения поставщика линии', 500));
    }
});

// POST /api/water-lines - Создать новую водную линию
router.post('/', async (req, res, next) => {
    try {
        const waterLine = await WaterLine.create(req.body);
        res.status(201).json(waterLine);
    } catch (error) {
        console.error('Error creating water line:', error);
        next(createError('Ошибка создания водной линии', 500));
    }
});

// PUT /api/water-lines/:id - Обновить водную линию
router.put('/:id', async (req, res, next) => {
    try {
        const waterLine = await WaterLine.update(req.params.id, req.body);
        if (!waterLine) {
            return next(createError('Водная линия не найдена', 404));
        }
        res.json(waterLine);
    } catch (error) {
        console.error('Error updating water line:', error);
        next(createError('Ошибка обновления водной линии', 500));
    }
});

// DELETE /api/water-lines/:id - Удалить водную линию
router.delete('/:id', async (req, res, next) => {
    try {
        const result = await WaterLine.delete(req.params.id);
        if (!result) {
            return next(createError('Водная линия не найдена', 404));
        }
        res.json({ message: 'Водная линия успешно удалена' });
    } catch (error) {
        console.error('Error deleting water line:', error);
        next(createError('Ошибка удаления водной линии', 500));
    }
});

module.exports = router;