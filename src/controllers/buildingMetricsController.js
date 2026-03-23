const buildingMetricsService = require('../services/buildingMetricsService');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

const getBuildingsWithMetrics = async (req, res, next) => {
    try {
        const result = await buildingMetricsService.getBuildingsWithMetrics(!!req.user);
        res.json(result);
    } catch (error) {
        logger.error(`Error in getBuildingsWithMetrics: ${error.message}`);
        next(createError(`Failed to get buildings with metrics: ${error.message}`, 500));
    }
};

module.exports = {
    getBuildingsWithMetrics
};
