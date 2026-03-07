const express = require('express');
const router = express.Router();
const transformerController = require('../controllers/transformerController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');

// Маршруты для трансформаторов
router.get('/', transformerController.getAllTransformers);
router.get('/:id', transformerController.getTransformerById);
router.post('/', applyCrudRateLimit, transformerController.createTransformer);
router.put('/:id', applyCrudRateLimit, transformerController.updateTransformer);
router.delete('/:id', applyCrudRateLimit, transformerController.deleteTransformer);

// Дополнительные маршруты
router.get('/building/:buildingId', transformerController.getTransformersByBuilding);

module.exports = router;