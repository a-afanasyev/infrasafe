const powerAnalyticsService = require('../services/powerAnalyticsService');
const logger = require('../utils/logger');

const getBuildingsPower = async (req, res, next) => {
    try {
        const buildings = await powerAnalyticsService.getBuildingsPower();
        return res.status(200).json({
            success: true,
            data: buildings,
            count: buildings.length
        });
    } catch (error) {
        logger.error(`Error in getBuildingsPower: ${error.message}`);
        next(error);
    }
};

const getBuildingPower = async (req, res, next) => {
    try {
        const { buildingId } = req.params;
        const buildingPower = await powerAnalyticsService.getBuildingPower(buildingId);

        if (!buildingPower) {
            return res.status(404).json({
                success: false,
                error: 'Building power data not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: buildingPower
        });
    } catch (error) {
        logger.error(`Error in getBuildingPower: ${error.message}`);
        next(error);
    }
};

const getLinesPower = async (req, res, next) => {
    try {
        return res.status(200).json({
            success: true,
            data: [],
            count: 0
        });
    } catch (error) {
        logger.error(`Error in getLinesPower: ${error.message}`);
        next(error);
    }
};

const getLinePower = async (req, res, next) => {
    try {
        return res.status(404).json({
            success: false,
            error: 'Line power data not found'
        });
    } catch (error) {
        logger.error(`Error in getLinePower: ${error.message}`);
        next(error);
    }
};

const getTransformersPower = async (req, res, next) => {
    try {
        const transformers = await powerAnalyticsService.getTransformersPower();
        return res.status(200).json({
            success: true,
            data: transformers,
            count: transformers.length
        });
    } catch (error) {
        logger.error(`Error in getTransformersPower: ${error.message}`);
        next(error);
    }
};

const getTransformerPower = async (req, res, next) => {
    try {
        const { transformerId } = req.params;
        const transformerPower = await powerAnalyticsService.getTransformerPower(transformerId);

        if (!transformerPower) {
            return res.status(404).json({
                success: false,
                error: 'Transformer power data not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: transformerPower
        });
    } catch (error) {
        logger.error(`Error in getTransformerPower: ${error.message}`);
        next(error);
    }
};

const getPhaseImbalanceAnalysis = async (req, res, next) => {
    try {
        return res.status(200).json({
            success: true,
            data: [],
            count: 0
        });
    } catch (error) {
        logger.error(`Error in getPhaseImbalanceAnalysis: ${error.message}`);
        next(error);
    }
};

const refreshPowerViews = async (req, res, next) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Power calculation is performed in real-time, no refresh needed'
        });
    } catch (error) {
        logger.error(`Error in refreshPowerViews: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getBuildingsPower,
    getBuildingPower,
    getLinesPower,
    getLinePower,
    getTransformersPower,
    getTransformerPower,
    getPhaseImbalanceAnalysis,
    refreshPowerViews
};
