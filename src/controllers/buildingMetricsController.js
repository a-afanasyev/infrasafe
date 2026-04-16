const buildingMetricsService = require('../services/buildingMetricsService');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

const getBuildingsWithMetrics = async (req, res, next) => {
    try {
        let bbox = null;
        let limit;

        try {
            bbox = buildingMetricsService.parseBbox(req.query.bbox);
        } catch (e) {
            return next(createError(`Invalid bbox: ${e.message}`, 400));
        }

        limit = buildingMetricsService.parseLimit(req.query.limit);

        const result = await buildingMetricsService.getBuildingsWithMetrics(
            !!req.user,
            { bbox, limit }
        );
        res.json(result);
    } catch (error) {
        logger.error(`Error in getBuildingsWithMetrics: ${error.message}`);
        next(createError('Internal server error', 500));
    }
};

module.exports = {
    getBuildingsWithMetrics
};
