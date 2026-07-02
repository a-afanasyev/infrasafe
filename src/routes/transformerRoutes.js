const express = require('express');
const router = express.Router();
const transformerController = require('../controllers/transformerController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validators');

// Маршруты для трансформаторов
router.get('/', transformerController.getAllTransformers);
router.get('/:id', validateIntParam('id'), transformerController.getTransformerById);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
// [R2-16] validateIntParam → non-numeric :id yields 400, not a pg-500.
router.post('/', applyCrudRateLimit, isAdmin, transformerController.createTransformer);
router.put('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), transformerController.updateTransformer);
router.delete('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), transformerController.deleteTransformer);

// Дополнительные маршруты
router.get('/building/:buildingId', transformerController.getTransformersByBuilding);

module.exports = router;