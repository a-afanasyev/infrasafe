// [B-024] Public controller for the map layer panel object counts.
// Mounted at GET /api/map-layer-counts (no auth — see PUBLIC_ROUTES in
// src/routes/index.js). Returns ONLY aggregate integers so anonymous map
// visitors get honest layer counts instead of (0); no row detail is exposed.

'use strict';

const MapLayerCounts = require('../models/MapLayerCounts');
const logger = require('../utils/logger');

async function getMapLayerCounts(req, res) {
    try {
        const data = await MapLayerCounts.getCounts();
        res.json({ data });
    } catch (error) {
        logger.error(`getMapLayerCounts error: ${error.message}`);
        res.status(500).json({ error: 'Failed to load map layer counts' });
    }
}

module.exports = { getMapLayerCounts };
