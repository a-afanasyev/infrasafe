const express = require('express');
const router = express.Router();
const waterSupplierController = require('../controllers/waterSupplierController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');

// Маршруты для поставщиков воды (AUD-010: thin delegation to controller)
router.get('/', waterSupplierController.getAllWaterSuppliers);
router.get('/:id', waterSupplierController.getWaterSupplierById);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
router.post('/', applyCrudRateLimit, isAdmin, waterSupplierController.createWaterSupplier);
router.put('/:id', applyCrudRateLimit, isAdmin, waterSupplierController.updateWaterSupplier);
router.delete('/:id', applyCrudRateLimit, isAdmin, waterSupplierController.deleteWaterSupplier);

module.exports = router;
