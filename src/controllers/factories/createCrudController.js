/**
 * Phase 6 DRY factory for simple CRUD HTTP controllers.
 *
 * Pairs with src/models/factories/createCrudModel.js. Generates a
 * { getAll, getById, create, update, remove } object that any Express
 * router can plug in directly. Collapses two 71-line controllers
 * (coldWaterSourceController, heatSourceController) that differ only
 * in the model reference and the not-found error wording.
 *
 * The factory intentionally does NOT add auth or rate-limit middleware
 * — those remain the router layer's responsibility (see adminRoutes.js
 * / coldWaterSourceRoutes.js for the existing patterns).
 */

const logger = require('../../utils/logger');
const { sendNotFound } = require('../../utils/apiResponse');

/**
 * @param {object} config
 * @param {object} config.Model         CRUD model with findAll/findById/create/update/delete
 * @param {string} config.notFoundMessage  e.g. 'Water source not found'
 * @param {string} config.logLabel      label used in error logs, e.g. 'cold water source'
 * @param {string} [config.deletedMessage] message on successful delete (default "<Entity> deleted successfully")
 * @returns {{ getAll, getById, create, update, remove }}
 */
function createCrudController({ Model, notFoundMessage, logLabel, deletedMessage }) {
    if (!Model || typeof Model.findAll !== 'function') {
        throw new Error('createCrudController: Model with static CRUD methods is required');
    }
    const doneMsg = deletedMessage || `${notFoundMessage.replace(/ not found$/, '')} deleted successfully`;

    async function getAll(req, res, next) {
        try {
            const { page = 1, limit = 10, sort = 'id', order = 'asc' } = req.query;
            const result = await Model.findAll(parseInt(page, 10), parseInt(limit, 10), sort, order);
            return res.status(200).json(result);
        } catch (error) {
            logger.error(`Error in getAll ${logLabel}: ${error.message}`);
            next(error);
        }
    }

    async function getById(req, res, next) {
        try {
            const entity = await Model.findById(req.params.id);
            if (!entity) return sendNotFound(res, notFoundMessage);
            return res.status(200).json(entity);
        } catch (error) {
            logger.error(`Error in getById ${logLabel}: ${error.message}`);
            next(error);
        }
    }

    async function create(req, res, next) {
        try {
            const entity = await Model.create(req.body);
            return res.status(201).json(entity);
        } catch (error) {
            logger.error(`Error in create ${logLabel}: ${error.message}`);
            next(error);
        }
    }

    async function update(req, res, next) {
        try {
            const entity = await Model.update(req.params.id, req.body);
            if (!entity) return sendNotFound(res, notFoundMessage);
            return res.status(200).json(entity);
        } catch (error) {
            logger.error(`Error in update ${logLabel}: ${error.message}`);
            next(error);
        }
    }

    async function remove(req, res, next) {
        try {
            const result = await Model.delete(req.params.id);
            if (!result) return sendNotFound(res, notFoundMessage);
            return res.status(200).json({ message: doneMsg, deleted: result });
        } catch (error) {
            logger.error(`Error in delete ${logLabel}: ${error.message}`);
            next(error);
        }
    }

    return { getAll, getById, create, update, remove };
}

module.exports = { createCrudController };
