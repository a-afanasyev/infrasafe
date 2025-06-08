const Line = require('../models/Line');
const logger = require('../utils/logger');

// Получить все линии
const getAllLines = async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        // Фильтры
        const filters = {};
        if (req.query.name) filters.name = req.query.name;
        if (req.query.voltage_kv) filters.voltage_kv = parseFloat(req.query.voltage_kv);
        if (req.query.transformer_id) filters.transformer_id = parseInt(req.query.transformer_id);

        const result = await Line.findAll(page, limit, filters);
        
        return res.status(200).json({
            success: true,
            data: result.data,
            pagination: result.pagination
        });
    } catch (error) {
        logger.error(`Error in getAllLines: ${error.message}`);
        next(error);
    }
};

// Получить линию по ID
const getLineById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const line = await Line.findById(id);
        
        if (!line) {
            return res.status(404).json({ 
                success: false,
                error: 'Line not found' 
            });
        }
        
        return res.status(200).json({
            success: true,
            data: line
        });
    } catch (error) {
        logger.error(`Error in getLineById: ${error.message}`);
        next(error);
    }
};

// Создать новую линию
const createLine = async (req, res, next) => {
    try {
        const line = await Line.create(req.body);
        
        return res.status(201).json({
            success: true,
            data: line,
            message: 'Line created successfully'
        });
    } catch (error) {
        logger.error(`Error in createLine: ${error.message}`);
        next(error);
    }
};

// Обновить линию
const updateLine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const line = await Line.update(id, req.body);
        
        if (!line) {
            return res.status(404).json({ 
                success: false,
                error: 'Line not found' 
            });
        }
        
        return res.status(200).json({
            success: true,
            data: line,
            message: 'Line updated successfully'
        });
    } catch (error) {
        logger.error(`Error in updateLine: ${error.message}`);
        next(error);
    }
};

// Удалить линию
const deleteLine = async (req, res, next) => {
    try {
        const { id } = req.params;
        const line = await Line.delete(id);
        
        if (!line) {
            return res.status(404).json({ 
                success: false,
                error: 'Line not found' 
            });
        }
        
        return res.status(200).json({
            success: true,
            data: line,
            message: 'Line deleted successfully'
        });
    } catch (error) {
        logger.error(`Error in deleteLine: ${error.message}`);
        next(error);
    }
};

// Получить линии по transformer_id
const getLinesByTransformer = async (req, res, next) => {
    try {
        const { transformerId } = req.params;
        const lines = await Line.findByTransformerId(transformerId);
        
        return res.status(200).json({
            success: true,
            data: lines
        });
    } catch (error) {
        logger.error(`Error in getLinesByTransformer: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getAllLines,
    getLineById,
    createLine,
    updateLine,
    deleteLine,
    getLinesByTransformer
}; 