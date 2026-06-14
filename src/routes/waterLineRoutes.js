const express = require('express');
const router = express.Router();
const waterLineController = require('../controllers/waterLineController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');

// Маршруты для линий водоснабжения (AUD-010: thin delegation to controller)
router.get('/', waterLineController.getAllWaterLines);
router.get('/:id', waterLineController.getWaterLineById);
router.get('/:id/supplier', waterLineController.getWaterLineSuppliers);
router.post('/', applyCrudRateLimit, waterLineController.createWaterLine);
router.put('/:id', applyCrudRateLimit, waterLineController.updateWaterLine);
router.delete('/:id', applyCrudRateLimit, waterLineController.deleteWaterLine);

module.exports = router;
