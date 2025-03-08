const Controller = require('../models/Controller');
const Metric = require('../models/Metric');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

// Получить все контроллеры
const getAllControllers = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'controller_id', order = 'asc' } = req.query;
        const result = await Controller.findAll(parseInt(page), parseInt(limit), sort, order);
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
        const controller = await Controller.findById(id);
        
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
        const controllers = await Controller.findByBuildingId(buildingId);
        
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
        
        // Проверяем существование контроллера
        const controller = await Controller.findById(id);
        if (!controller) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        // Получаем метрики
        const metrics = await Metric.findByControllerId(id, startDate, endDate);
        
        return res.status(200).json(metrics);
    } catch (error) {
        logger.error(`Error in getControllerMetrics: ${error.message}`);
        next(error);
    }
};

// Создать новый контроллер
const createController = async (req, res, next) => {
    try {
        const newController = await Controller.create(req.body);
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
        const updatedController = await Controller.update(id, req.body);
        
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
        
        if (!status || !['online', 'offline', 'maintenance'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value' });
        }
        
        const updatedController = await Controller.updateStatus(id, status);
        
        if (!updatedController) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        return res.status(200).json(updatedController);
    } catch (error) {
        logger.error(`Error in updateControllerStatus: ${error.message}`);
        next(error);
    }
};

// Удалить контроллер
const deleteController = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Проверяем, есть ли метрики, привязанные к этому контроллеру
        const metrics = await Metric.findByControllerId(id);
        if (metrics.length > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete controller with associated metrics. Delete metrics first.',
                metricCount: metrics.length
            });
        }
        
        const result = await Controller.delete(id);
        
        if (!result) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        return res.status(200).json({ 
            message: 'Controller deleted successfully', 
            deleted: result 
        });
    } catch (error) {
        logger.error(`Error in deleteController: ${error.message}`);
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
    deleteController
}; 