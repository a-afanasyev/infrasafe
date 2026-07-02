// [B-024] Public controller for the map layer panel object counts.
// Mounted at GET /api/map-layer-counts (no auth — see PUBLIC_ROUTES in
// src/routes/index.js). Returns ONLY aggregate integers so anonymous map
// visitors get honest layer counts instead of (0); no row detail is exposed.

'use strict';

const MapLayerCounts = require('../models/MapLayerCounts');
const logger = require('../utils/logger');

async function getMapLayerCounts(req, res, next) {
    try {
        const data = await MapLayerCounts.getCounts();
        res.json({ data });
    } catch (error) {
        // [R2-05] Route through errorHandler for the canonical envelope
        // { success:false, error:{ message, status } } — which also hides the
        // 500 detail from the client (the old inline JSON leaked it).
        logger.error(`getMapLayerCounts error: ${error.message}`);
        next(error);
    }
}

module.exports = { getMapLayerCounts };
