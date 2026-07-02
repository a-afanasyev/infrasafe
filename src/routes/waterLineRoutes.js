const express = require('express');
const router = express.Router();
const waterLineController = require('../controllers/waterLineController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');

// Маршруты для линий водоснабжения (AUD-010: thin delegation to controller)
router.get('/', waterLineController.getAllWaterLines);
router.get('/:id', waterLineController.getWaterLineById);
router.get('/:id/supplier', waterLineController.getWaterLineSuppliers);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
router.post('/', applyCrudRateLimit, isAdmin, waterLineController.createWaterLine);
router.put('/:id', applyCrudRateLimit, isAdmin, waterLineController.updateWaterLine);
router.delete('/:id', applyCrudRateLimit, isAdmin, waterLineController.deleteWaterLine);

module.exports = router;
