const express = require('express');
const router = express.Router();
const lineController = require('../controllers/lineController');

// Маршруты для линий
router.get('/', lineController.getAllLines);
router.get('/:id', lineController.getLineById);
router.post('/', lineController.createLine);
router.put('/:id', lineController.updateLine);
router.delete('/:id', lineController.deleteLine);

// Дополнительные маршруты
router.get('/transformer/:transformerId', lineController.getLinesByTransformer);

module.exports = router;