'use strict';

// [UK building reconcile — 2026-07-23] Mounted under /api/uk-buildings-metrics
// in src/routes/index.js (PUBLIC_ROUTES — no JWT; guarded by the same
// x-service-token + rate limit as /uk-requests-metrics). See
// ukBuildingsMetricsController.js for the P-PENTEST-3 rationale.

const express = require('express');
const { getBuildingsInventory } = require('../controllers/ukBuildingsMetricsController');
const { applyUkInventoryRateLimit } = require('../middleware/rateLimiter');
const { requireServiceToken } = require('../middleware/serviceToken');

const router = express.Router();

// Same env var + header as /uk-requests-metrics — one shared secret covers
// both inventory endpoints (the "SEC-115" shape the ARCH-114 spec anticipated).
const requireUkInventoryToken = requireServiceToken({
    envVar: 'UK_INVENTORY_TOKEN',
    header: 'x-service-token'
});

/**
 * @swagger
 * /uk-buildings-metrics:
 *   get:
 *     summary: UK reconciliation inventory — every building external_id on file
 *     description: |
 *       Returns every buildings.external_id InfraSafe has stored (including
 *       soft-deleted rows, flagged via uk_deleted_at) so UK's reconciliation
 *       worker can set-diff its building list without needing the
 *       authenticated /buildings-metrics projection (the anonymous one
 *       omits external_id per P-PENTEST-3).
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
 *                       external_id:   { type: string, format: uuid }
 *                       uk_deleted_at: { type: string, format: date-time, nullable: true }
 *                 total: { type: integer }
 *                 limit: { type: integer }
 */
router.get('/', applyUkInventoryRateLimit, requireUkInventoryToken, getBuildingsInventory);

module.exports = router;
