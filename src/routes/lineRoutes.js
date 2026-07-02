const express = require('express');
const router = express.Router();
const lineController = require('../controllers/lineController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');

// Маршруты для линий
router.get('/', lineController.getAllLines);
router.get('/:id', lineController.getLineById);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
router.post('/', applyCrudRateLimit, isAdmin, lineController.createLine);
router.put('/:id', applyCrudRateLimit, isAdmin, lineController.updateLine);
router.delete('/:id', applyCrudRateLimit, isAdmin, lineController.deleteLine);

// Дополнительные маршруты
router.get('/transformer/:transformerId', lineController.getLinesByTransformer);

module.exports = router;