const express = require('express');
const router = express.Router();
const waterLineController = require('../controllers/waterLineController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { isAdmin } = require('../middleware/auth');
const { validateIntParam, validateWaterLineCreate } = require('../middleware/validators');

// Маршруты для линий водоснабжения (AUD-010: thin delegation to controller)
router.get('/', waterLineController.getAllWaterLines);
router.get('/:id', validateIntParam('id'), waterLineController.getWaterLineById);
router.get('/:id/supplier', validateIntParam('id'), waterLineController.getWaterLineSuppliers);
// [R2-02] Infrastructure writes require admin (API_AUTH_MATRIX.md JWT→JWT+Admin). GET stays any-auth.
// [R2-16] validateIntParam → non-numeric :id yields 400, not a pg-500.
// [AR-10, доработка] Схема тела стоит здесь, а не только на `/api/admin/*`:
// админка создаёт эти сущности именно через этот маршрут — проверено в браузере,
// где трансформатор с именем `<script>…` создавался с кодом 201.
router.post('/', applyCrudRateLimit, isAdmin, validateWaterLineCreate, waterLineController.createWaterLine);
router.put('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), waterLineController.updateWaterLine);
router.delete('/:id', applyCrudRateLimit, isAdmin, validateIntParam('id'), waterLineController.deleteWaterLine);

module.exports = router;
