const express = require('express');
const WaterSupplier = require('../models/WaterSupplier');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/water-suppliers - Получить всех поставщиков воды
router.get('/', async (req, res, next) => {
    try {
        const { page = 1, limit = 100, type, line_id } = req.query;
        const filters = {};

        if (type) {
            filters.type = type;
        }

        const waterSuppliers = await WaterSupplier.findAll(page, limit, filters);
        res.json(waterSuppliers);
    } catch (error) {
        logger.error(`Error fetching water suppliers: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-suppliers',
            method: 'GET',
            query: req.query
        });
        next(createError('Ошибка получения поставщиков воды', 500));
    }
});

// GET /api/water-suppliers/:id - Получить поставщика воды по ID
router.get('/:id', async (req, res, next) => {
    try {
        const waterSupplier = await WaterSupplier.findById(req.params.id);
        if (!waterSupplier) {
            return next(createError('Поставщик воды не найден', 404));
        }
        res.json(waterSupplier);
    } catch (error) {
        logger.error(`Error fetching water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-suppliers/${req.params.id}`,
            method: 'GET',
            id: req.params.id
        });
        next(createError('Ошибка получения поставщика воды', 500));
    }
});

// POST /api/water-suppliers - Создать нового поставщика воды
router.post('/', async (req, res, next) => {
    try {
        const waterSupplier = await WaterSupplier.create(req.body);
        res.status(201).json(waterSupplier);
    } catch (error) {
        logger.error(`Error creating water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-suppliers',
            method: 'POST',
            body: req.body
        });
        next(createError('Ошибка создания поставщика воды', 500));
    }
});

// PUT /api/water-suppliers/:id - Обновить поставщика воды
router.put('/:id', async (req, res, next) => {
    try {
        const waterSupplier = await WaterSupplier.update(req.params.id, req.body);
        if (!waterSupplier) {
            return next(createError('Поставщик воды не найден', 404));
        }
        res.json(waterSupplier);
    } catch (error) {
        logger.error(`Error updating water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-suppliers/${req.params.id}`,
            method: 'PUT',
            id: req.params.id,
            body: req.body
        });
        next(createError('Ошибка обновления поставщика воды', 500));
    }
});

// DELETE /api/water-suppliers/:id - Удалить поставщика воды
router.delete('/:id', async (req, res, next) => {
    try {
        const result = await WaterSupplier.delete(req.params.id);
        if (!result) {
            return next(createError('Поставщик воды не найден', 404));
        }
        res.json({ message: 'Поставщик воды успешно удален' });
    } catch (error) {
        logger.error(`Error deleting water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-suppliers/${req.params.id}`,
            method: 'DELETE',
            id: req.params.id
        });
        next(createError('Ошибка удаления поставщика воды', 500));
    }
});

module.exports = router;