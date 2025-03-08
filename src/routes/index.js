const express = require('express');
const buildingRoutes = require('./buildingRoutes');
const controllerRoutes = require('./controllerRoutes');
const metricRoutes = require('./metricRoutes');
const { createError } = require('../utils/helpers');

const router = express.Router();

// Маршруты API
router.use('/buildings', buildingRoutes);
router.use('/controllers', controllerRoutes);
router.use('/metrics', metricRoutes);

// Обработка 404 для API
router.use((req, res, next) => {
    next(createError(404, `Route ${req.originalUrl} not found`));
});

module.exports = router;