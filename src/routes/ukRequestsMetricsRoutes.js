// [ARCH-114] Public inventory route for UK reconciliation.
// Mounted under /api/uk-requests-metrics in src/routes/index.js and
// explicitly added to the default-deny public allowlist there.

'use strict';

const express = require('express');
const { getRequestsInventory } = require('../controllers/ukRequestsMetricsController');
const { applyUkInventoryRateLimit } = require('../middleware/rateLimiter');
const { requireServiceToken } = require('../middleware/serviceToken');

const router = express.Router();

// [H-4] requireServiceToken is dormant until UK_INVENTORY_TOKEN is set — see
// src/middleware/serviceToken.js for the rollout contract (UK must confirm
// the header BEFORE the operator sets the env var).
const requireUkInventoryToken = requireServiceToken({
    envVar: 'UK_INVENTORY_TOKEN',
    header: 'x-service-token'
});

/**
 * @swagger
 * /uk-requests-metrics:
 *   get:
 *     summary: UK reconciliation inventory — every uk_request_number on file
 *     description: |
 *       Returns the inventory of uk_request_number values that InfraSafe has
 *       recorded in alert_request_map. UK's reconciliation worker uses this
 *       to set-diff against its local `requests` table and replay any
 *       missing rows via webhook. Includes both terminal (resolved /
 *       cancelled) and non-terminal entries. Rows without a
 *       uk_request_number (sender race / failed sends) are excluded.
 *     security: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5000, minimum: 1, maximum: 10000 }
 *         required: false
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       uk_request_number:    { type: string }
 *                       status:               { type: string, enum: [pending, active, sent, resolved, cancelled] }
 *                       building_external_id: { type: string, format: uuid }
 *                       updated_at:           { type: string, format: date-time }
 *                 total: { type: integer }
 *                 limit: { type: integer }
 */
router.get('/', applyUkInventoryRateLimit, requireUkInventoryToken, getRequestsInventory);

module.exports = router;
