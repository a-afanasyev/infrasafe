'use strict';

/**
 * [AR-12] Только карта маршрутов. Логика — в controllers/integrationController.js.
 */

const express = require('express');
const router = express.Router();
const { isAdmin } = require('../middleware/auth');
// [R2-16] non-numeric :id → 400, а не pg-500. `:externalId` не трогаем — он
// UUID и валидируется отдельно прямо в обработчике.
const { validateIntParam } = require('../middleware/validators');
const integrationController = require('../controllers/integrationController');

// --- Routes accessible to any authenticated user (JWT, no admin) ---
router.get('/request-counts', integrationController.getRequestCounts);
router.get('/building-requests/:externalId', integrationController.getBuildingRequests);

// All remaining integration routes require admin access
router.use(isAdmin);

// Route definitions
router.get('/config', integrationController.getConfig);
router.put('/config', integrationController.updateConfig);
router.get('/logs', integrationController.getLogs);
// [R2-16] БЕЗ validateIntParam: getLogById/retryLog валидируют id сами
// (parseInt + isNaN + id < 1) и отдают собственный 400 с внятным сообщением.
// Guard тут ничего не чинил бы, а только подменил форму ответа на конверт
// express-validator — сломав контракт, на который уже опираются тесты.
router.get('/logs/:id', integrationController.getLogById);
router.post('/logs/retry/:id', integrationController.retryLog);
router.get('/rules', integrationController.getRules);

// [Sprint 10 PR-5] Rules admin endpoints — all admin-only via the
// `router.use(isAdmin)` mounted earlier in this file.
router.get('/rules/stats', integrationController.getRulesStats);
router.patch('/rules/:id', validateIntParam('id'), integrationController.updateRule);
router.post('/rules/:id/toggle', validateIntParam('id'), integrationController.toggleRule);
router.get('/rules/:id/history', validateIntParam('id'), integrationController.getRuleHistory);

module.exports = router;
// [AR-12] handlers больше не реэкспортируются отсюда:
// потребители берут их из controllers/integrationController.

