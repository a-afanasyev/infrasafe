const express = require('express');
const router = express.Router();
const waterSupplierController = require('../controllers/waterSupplierController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');

// Маршруты для поставщиков воды (AUD-010: thin delegation to controller)
router.get('/', waterSupplierController.getAllWaterSuppliers);
router.get('/:id', waterSupplierController.getWaterSupplierById);
router.post('/', applyCrudRateLimit, waterSupplierController.createWaterSupplier);
router.put('/:id', applyCrudRateLimit, waterSupplierController.updateWaterSupplier);
router.delete('/:id', applyCrudRateLimit, waterSupplierController.deleteWaterSupplier);

module.exports = router;
