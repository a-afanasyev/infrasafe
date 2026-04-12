const ColdWaterSource = require('../models/ColdWaterSource');
const logger = require('../utils/logger');
const { sendNotFound } = require('../utils/apiResponse');

const getAll = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'id', order = 'asc' } = req.query;
        const result = await ColdWaterSource.findAll(parseInt(page), parseInt(limit), sort, order);
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in getAll cold water sources: ${error.message}`);
        next(error);
    }
};

const getById = async (req, res, next) => {
    try {
        const source = await ColdWaterSource.findById(req.params.id);

        if (!source) {
            return sendNotFound(res, 'Water source not found');
        }

        return res.status(200).json(source);
    } catch (error) {
        logger.error(`Error in getById cold water source: ${error.message}`);
        next(error);
    }
};

const create = async (req, res, next) => {
    try {
        const source = await ColdWaterSource.create(req.body);
        return res.status(201).json(source);
    } catch (error) {
        logger.error(`Error in create cold water source: ${error.message}`);
        next(error);
    }
};

const update = async (req, res, next) => {
    try {
        const source = await ColdWaterSource.update(req.params.id, req.body);

        if (!source) {
            return sendNotFound(res, 'Water source not found');
        }

        return res.status(200).json(source);
    } catch (error) {
        logger.error(`Error in update cold water source: ${error.message}`);
        next(error);
    }
};

const remove = async (req, res, next) => {
    try {
        const result = await ColdWaterSource.delete(req.params.id);

        if (!result) {
            return sendNotFound(res, 'Water source not found');
        }

        return res.status(200).json({ message: 'Water source deleted successfully', deleted: result });
    } catch (error) {
        logger.error(`Error in delete cold water source: ${error.message}`);
        next(error);
    }
};

module.exports = { getAll, getById, create, update, remove };
