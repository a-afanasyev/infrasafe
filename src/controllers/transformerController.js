const Transformer = require('../models/Transformer');
const logger = require('../utils/logger');

// Получить все трансформаторы
const getAllTransformers = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        // Фильтры
        const filters = {};
        if (req.query.name) filters.name = req.query.name;
        if (req.query.power_kva) filters.power_kva = parseFloat(req.query.power_kva);
        if (req.query.voltage_kv) filters.voltage_kv = parseFloat(req.query.voltage_kv);
        if (req.query.building_id) filters.building_id = parseInt(req.query.building_id);

        const result = await Transformer.findAll(page, limit, filters);
        
        return res.status(200).json({
            success: true,
            data: result.data,
            pagination: result.pagination
        });
    } catch (error) {
        logger.error(`Error in getAllTransformers: ${error.message}`);
        next(error);
    }
};

// Получить трансформатор по ID
const getTransformerById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const transformer = await Transformer.findById(id);
        
        if (!transformer) {
            return res.status(404).json({ 
                success: false,
                error: 'Transformer not found' 
            });
        }
        
        return res.status(200).json({
            success: true,
            data: transformer
        });
    } catch (error) {
        logger.error(`Error in getTransformerById: ${error.message}`);
        next(error);
    }
};

// Создать новый трансформатор
const createTransformer = async (req, res, next) => {
    try {
        const transformer = await Transformer.create(req.body);
        
        return res.status(201).json({
            success: true,
            data: transformer,
            message: 'Transformer created successfully'
        });
    } catch (error) {
        logger.error(`Error in createTransformer: ${error.message}`);
        next(error);
    }
};

// Обновить трансформатор
const updateTransformer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const transformer = await Transformer.update(id, req.body);
        
        if (!transformer) {
            return res.status(404).json({ 
                success: false,
                error: 'Transformer not found' 
            });
        }
        
        return res.status(200).json({
            success: true,
            data: transformer,
            message: 'Transformer updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateTransformer: ${error.message}`);
        next(error);
    }
};

// Удалить трансформатор
const deleteTransformer = async (req, res, next) => {
    try {
        const { id } = req.params;
        const transformer = await Transformer.delete(id);
        
        if (!transformer) {
            return res.status(404).json({ 
                success: false,
                error: 'Transformer not found' 
            });
        }
        
        return res.status(200).json({
            success: true,
            data: transformer,
            message: 'Transformer deleted successfully'
        });
    } catch (error) {
        logger.error(`Error in deleteTransformer: ${error.message}`);
        next(error);
    }
};

// Получить трансформаторы по building_id
const getTransformersByBuilding = async (req, res, next) => {
    try {
        const { buildingId } = req.params;
        const transformers = await Transformer.findByBuildingId(buildingId);
        
        return res.status(200).json({
            success: true,
            data: transformers
        });
    } catch (error) {
        logger.error(`Error in getTransformersByBuilding: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getAllTransformers,
    getTransformerById,
    createTransformer,
    updateTransformer,
    deleteTransformer,
    getTransformersByBuilding
}; 