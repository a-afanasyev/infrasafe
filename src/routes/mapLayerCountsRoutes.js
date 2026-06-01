// [B-024] Public route for the map layer panel object counts.
// Mounted under /api/map-layer-counts in src/routes/index.js and explicitly
// added to the default-deny public allowlist there. Returns aggregate integer
// counts only (no row detail) so anonymous map visitors see honest layer
// counts instead of (0) for auth-gated layers.

'use strict';

const express = require('express');
const { getMapLayerCounts } = require('../controllers/mapLayerCountsController');

const router = express.Router();

/**
 * @swagger
 * /map-layer-counts:
 *   get:
 *     summary: Public object counts for the map layer panel
 *     description: |
 *       Returns aggregate counts (integers only — no coordinates, names or
 *       statuses) for each map layer so anonymous visitors get honest numbers
 *       instead of (0) for layers whose detail endpoints require auth.
 *     security: []
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     buildings:     { type: integer }
 *                     controllers:   { type: integer }
 *                     transformers:  { type: integer }
 *                     power_lines:   { type: integer }
 *                     water_sources: { type: integer }
 *                     water_lines:   { type: integer }
 *                     heat_sources:  { type: integer }
 *                     alerts_active: { type: integer }
 */
router.get('/', getMapLayerCounts);

module.exports = router;
