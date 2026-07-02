const express = require('express');
const router = express.Router();
const waterLineController = require('../controllers/waterLineController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validators');

// Маршруты для линий водоснабжения (AUD-010: thin delegation to controller)
router.get('/', waterLineController.getAllWaterLines);
router.get('/:id', validateIntParam('id'), waterLineController.getWaterLineById);
router.get('/:id/supplier', validateIntParam('id'), waterLineController.getWaterLineSuppliers);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
// [R2-16] validateIntParam → non-numeric :id yields 400, not a pg-500.
router.post('/', applyCrudRateLimit, isAdmin, waterLineController.createWaterLine);
router.put('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), waterLineController.updateWaterLine);
router.delete('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), waterLineController.deleteWaterLine);

module.exports = router;
