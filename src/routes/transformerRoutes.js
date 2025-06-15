const express = require('express');
const router = express.Router();
const transformerController = require('../controllers/transformerController');

// Маршруты для трансформаторов
router.get('/', transformerController.getAllTransformers);
router.get('/:id', transformerController.getTransformerById);
router.post('/', transformerController.createTransformer);
router.put('/:id', transformerController.updateTransformer);
router.delete('/:id', transformerController.deleteTransformer);

// Дополнительные маршруты
router.get('/building/:buildingId', transformerController.getTransformersByBuilding);

module.exports = router;