const Building = require('../models/Building');
const Controller = require('../models/Controller');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

// Получить все здания
const getAllBuildings = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'building_id', order = 'asc' } = req.query;
        const result = await Building.findAll(parseInt(page), parseInt(limit), sort, order);
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
        const building = await Building.findById(id);
        
        if (!building) {
            return res.status(404).json({ error: 'Building not found' });
        }
        
        // Получаем также все контроллеры для этого здания
        const controllers = await Controller.findByBuildingId(id);
        
        return res.status(200).json({
            ...building,
            controllers
        });
    } catch (error) {
        logger.error(`Error in getBuildingById: ${error.message}`);
        next(error);
    }
};

// Создать новое здание
const createBuilding = async (req, res, next) => {
    try {
        const newBuilding = await Building.create(req.body);
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
        const updatedBuilding = await Building.update(id, req.body);
        
        if (!updatedBuilding) {
            return res.status(404).json({ error: 'Building not found' });
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
        
        // Проверяем, есть ли контроллеры, привязанные к этому зданию
        const controllers = await Controller.findByBuildingId(id);
        if (controllers.length > 0) {
            return res.status(400).json({ 
                error: 'Cannot delete building with associated controllers',
                controllers
            });
        }
        
        const result = await Building.delete(id);
        
        if (!result) {
            return res.status(404).json({ error: 'Building not found' });
        }
        
        return res.status(200).json({ 
            message: 'Building deleted successfully', 
            deleted: result 
        });
    } catch (error) {
        logger.error(`Error in deleteBuilding: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getAllBuildings,
    getBuildingById,
    createBuilding,
    updateBuilding,
    deleteBuilding
}; 