const express = require('express');
const router = express.Router();
const transformerController = require('../controllers/transformerController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');
const { validateIntParam, validateTransformerCreate } = require('../middleware/validators');

// Маршруты для трансформаторов
router.get('/', transformerController.getAllTransformers);
router.get('/:id', validateIntParam('id'), transformerController.getTransformerById);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
// [R2-16] validateIntParam → non-numeric :id yields 400, not a pg-500.
// [AR-10, доработка] Схема тела стоит здесь, а не только на `/api/admin/*`:
// админка создаёт эти сущности именно через этот маршрут — проверено в браузере,
// где трансформатор с именем `<script>…` создавался с кодом 201.
router.post('/', applyCrudRateLimit, isAdmin, validateTransformerCreate, transformerController.createTransformer);
router.put('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), transformerController.updateTransformer);
router.delete('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), transformerController.deleteTransformer);

// Дополнительные маршруты
router.get('/building/:buildingId', validateIntParam('buildingId'), transformerController.getTransformersByBuilding);

module.exports = router;