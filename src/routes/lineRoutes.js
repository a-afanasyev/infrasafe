const express = require('express');
const router = express.Router();
const lineController = require('../controllers/lineController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');
const { validateIntParam } = require('../middleware/validators');

// Маршруты для линий
router.get('/', lineController.getAllLines);
router.get('/:id', validateIntParam('id'), lineController.getLineById);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
// [R2-16] validateIntParam → non-numeric :id yields 400, not a pg-500.
router.post('/', applyCrudRateLimit, isAdmin, lineController.createLine);
router.put('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), lineController.updateLine);
router.delete('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), lineController.deleteLine);

// Дополнительные маршруты
router.get('/transformer/:transformerId', validateIntParam('transformerId'), lineController.getLinesByTransformer);

module.exports = router;