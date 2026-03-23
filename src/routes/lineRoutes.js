const express = require('express');
const router = express.Router();
const lineController = require('../controllers/lineController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');

// Маршруты для линий
router.get('/', lineController.getAllLines);
router.get('/:id', lineController.getLineById);
router.post('/', applyCrudRateLimit, lineController.createLine);
router.put('/:id', applyCrudRateLimit, lineController.updateLine);
router.delete('/:id', applyCrudRateLimit, lineController.deleteLine);

// Дополнительные маршруты
router.get('/transformer/:transformerId', lineController.getLinesByTransformer);

module.exports = router;