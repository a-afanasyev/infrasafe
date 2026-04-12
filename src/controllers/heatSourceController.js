const HeatSource = require('../models/HeatSource');
const logger = require('../utils/logger');
const { sendNotFound } = require('../utils/apiResponse');

const getAll = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'id', order = 'asc' } = req.query;
        const result = await HeatSource.findAll(parseInt(page), parseInt(limit), sort, order);
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in getAll heat sources: ${error.message}`);
        next(error);
    }
};

const getById = async (req, res, next) => {
    try {
        const source = await HeatSource.findById(req.params.id);

        if (!source) {
            return sendNotFound(res, 'Heat source not found');
        }

        return res.status(200).json(source);
    } catch (error) {
        logger.error(`Error in getById heat source: ${error.message}`);
        next(error);
    }
};

const create = async (req, res, next) => {
    try {
        const source = await HeatSource.create(req.body);
        return res.status(201).json(source);
    } catch (error) {
        logger.error(`Error in create heat source: ${error.message}`);
        next(error);
    }
};

const update = async (req, res, next) => {
    try {
        const source = await HeatSource.update(req.params.id, req.body);

        if (!source) {
            return sendNotFound(res, 'Heat source not found');
        }

        return res.status(200).json(source);
    } catch (error) {
        logger.error(`Error in update heat source: ${error.message}`);
        next(error);
    }
};

const remove = async (req, res, next) => {
    try {
        const result = await HeatSource.delete(req.params.id);

        if (!result) {
            return sendNotFound(res, 'Heat source not found');
        }

        return res.status(200).json({ message: 'Heat source deleted successfully', deleted: result });
    } catch (error) {
        logger.error(`Error in delete heat source: ${error.message}`);
        next(error);
    }
};

module.exports = { getAll, getById, create, update, remove };
