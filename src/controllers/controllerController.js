const controllerService = require('../services/controllerService');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

// Получить все контроллеры
const getAllControllers = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'controller_id', order = 'asc' } = req.query;
        const result = await controllerService.getAllControllers(parseInt(page), parseInt(limit), sort, order);
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in getAllControllers: ${error.message}`);
        next(error);
    }
};

// Получить контроллер по ID
const getControllerById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const controller = await controllerService.getControllerById(id);
        
        if (!controller) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        return res.status(200).json(controller);
    } catch (error) {
        logger.error(`Error in getControllerById: ${error.message}`);
        next(error);
    }
};

// Получить контроллеры для здания
const getControllersByBuildingId = async (req, res, next) => {
    try {
        const { buildingId } = req.params;
        const controllers = await controllerService.getControllersByBuildingId(buildingId);
        
        return res.status(200).json(controllers);
    } catch (error) {
        logger.error(`Error in getControllersByBuildingId: ${error.message}`);
        next(error);
    }
};

// Получить последние метрики для контроллера
const getControllerMetrics = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { startDate, endDate } = req.query;
        
        const metrics = await controllerService.getControllerMetrics(id, startDate, endDate);
        
        return res.status(200).json(metrics);
    } catch (error) {
        if (error.code === 'CONTROLLER_NOT_FOUND') {
            return res.status(404).json({ error: error.message });
        }
        
        logger.error(`Error in getControllerMetrics: ${error.message}`);
        next(error);
    }
};

// Создать новый контроллер
const createController = async (req, res, next) => {
    try {
        const newController = await controllerService.createController(req.body);
        return res.status(201).json(newController);
    } catch (error) {
        logger.error(`Error in createController: ${error.message}`);
        next(error);
    }
};

// Обновить контроллер
const updateController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updatedController = await controllerService.updateController(id, req.body);
        
        if (!updatedController) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        return res.status(200).json(updatedController);
    } catch (error) {
        logger.error(`Error in updateController: ${error.message}`);
        next(error);
    }
};

// Обновить статус контроллера
const updateControllerStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const updatedController = await controllerService.updateControllerStatus(id, status);
        
        if (!updatedController) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        return res.status(200).json(updatedController);
    } catch (error) {
        if (error.code === 'INVALID_STATUS') {
            return res.status(400).json({ error: error.message });
        }
        
        logger.error(`Error in updateControllerStatus: ${error.message}`);
        next(error);
    }
};

// Удалить контроллер
const deleteController = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const result = await controllerService.deleteController(id);
        
        if (!result) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        return res.status(200).json({ 
            message: 'Controller deleted successfully', 
            deleted: result 
        });
    } catch (error) {
        if (error.code === 'CONTROLLER_HAS_METRICS') {
            return res.status(400).json({ 
                error: error.message,
                metricCount: error.metricCount
            });
        }
        
        logger.error(`Error in deleteController: ${error.message}`);
        next(error);
    }
};

// Автоматическое обновление статусов контроллеров
const updateControllersStatusByActivity = async (req, res, next) => {
    try {
        const result = await controllerService.updateControllersStatusByActivity();
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in updateControllersStatusByActivity: ${error.message}`);
        next(error);
    }
};

// Получить статистику контроллеров
const getControllersStatistics = async (req, res, next) => {
    try {
        const statistics = await controllerService.getControllersStatistics();
        return res.status(200).json(statistics);
    } catch (error) {
        logger.error(`Error in getControllersStatistics: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getAllControllers,
    getControllerById,
    getControllersByBuildingId,
    getControllerMetrics,
    createController,
    updateController,
    updateControllerStatus,
    deleteController,
    updateControllersStatusByActivity,
    getControllersStatistics
}; 