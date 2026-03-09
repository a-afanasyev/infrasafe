const buildingService = require('../services/buildingService');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');
const { sendError, sendNotFound } = require('../utils/apiResponse');

// Получить все здания
const getAllBuildings = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'building_id', order = 'asc' } = req.query;
        const result = await buildingService.getAllBuildings(parseInt(page), parseInt(limit), sort, order);
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in getAllBuildings: ${error.message}`);
        next(error);
    }
};

// Получить здание по ID
const getBuildingById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const building = await buildingService.getBuildingById(id);

        if (!building) {
            return sendNotFound(res, 'Building not found');
        }

        return res.status(200).json(building);
    } catch (error) {
        logger.error(`Error in getBuildingById: ${error.message}`);
        next(error);
    }
};

// Создать новое здание
const createBuilding = async (req, res, next) => {
    try {
        const newBuilding = await buildingService.createBuilding(req.body);
        return res.status(201).json(newBuilding);
    } catch (error) {
        logger.error(`Error in createBuilding: ${error.message}`);
        next(error);
    }
};

// Обновить здание
const updateBuilding = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updatedBuilding = await buildingService.updateBuilding(id, req.body);

        if (!updatedBuilding) {
            return sendNotFound(res, 'Building not found');
        }

        return res.status(200).json(updatedBuilding);
    } catch (error) {
        logger.error(`Error in updateBuilding: ${error.message}`);
        next(error);
    }
};

// Удалить здание
const deleteBuilding = async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await buildingService.deleteBuilding(id);

        if (!result) {
            return sendNotFound(res, 'Building not found');
        }

        return res.status(200).json({
            message: 'Building deleted successfully',
            deleted: result
        });
    } catch (error) {
        // Обрабатываем специфичные ошибки сервиса
        if (error.code === 'BUILDING_HAS_CONTROLLERS') {
            return sendError(res, 400, error.message);
        }

        logger.error(`Error in deleteBuilding: ${error.message}`);
        next(error);
    }
};

// Поиск зданий в радиусе
const findBuildingsInRadius = async (req, res, next) => {
    try {
        const { latitude, longitude, radius = 1000 } = req.query;

        if (!latitude || !longitude) {
            return sendError(res, 400, 'Latitude and longitude are required');
        }

        const result = await buildingService.findBuildingsInRadius(
            parseFloat(latitude),
            parseFloat(longitude),
            parseInt(radius)
        );

        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in findBuildingsInRadius: ${error.message}`);
        next(error);
    }
};

// Получить статистику зданий
const getBuildingsStatistics = async (req, res, next) => {
    try {
        const statistics = await buildingService.getBuildingsStatistics();
        return res.status(200).json(statistics);
    } catch (error) {
        logger.error(`Error in getBuildingsStatistics: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getAllBuildings,
    getBuildingById,
    createBuilding,
    updateBuilding,
    deleteBuilding,
    findBuildingsInRadius,
    getBuildingsStatistics
};