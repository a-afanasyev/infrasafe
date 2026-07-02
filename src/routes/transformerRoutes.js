const express = require('express');
const router = express.Router();
const transformerController = require('../controllers/transformerController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');

// Маршруты для трансформаторов
router.get('/', transformerController.getAllTransformers);
router.get('/:id', transformerController.getTransformerById);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
router.post('/', applyCrudRateLimit, isAdmin, transformerController.createTransformer);
router.put('/:id', applyCrudRateLimit, isAdmin, transformerController.updateTransformer);
router.delete('/:id', applyCrudRateLimit, isAdmin, transformerController.deleteTransformer);

// Дополнительные маршруты
router.get('/building/:buildingId', transformerController.getTransformersByBuilding);

module.exports = router;