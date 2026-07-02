const express = require('express');
const router = express.Router();
const waterSupplierController = require('../controllers/waterSupplierController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validators');

// Маршруты для поставщиков воды (AUD-010: thin delegation to controller)
router.get('/', waterSupplierController.getAllWaterSuppliers);
router.get('/:id', validateIntParam('id'), waterSupplierController.getWaterSupplierById);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
// [R2-16] validateIntParam → non-numeric :id yields 400, not a pg-500.
router.post('/', applyCrudRateLimit, isAdmin, waterSupplierController.createWaterSupplier);
router.put('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), waterSupplierController.updateWaterSupplier);
router.delete('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), waterSupplierController.deleteWaterSupplier);

module.exports = router;
