const WaterSupplier = require('../models/WaterSupplier');
const logger = require('../utils/logger');
const { validatePagination } = require('../utils/queryValidation');
const { sendError, sendNotFound } = require('../utils/apiResponse');

/**
 * [AUD-010] Water-supplier HTTP handlers, extracted from the inline route file.
 * [AUD-011] Error paths emit the canonical envelope via apiResponse; success
 * shapes preserved RAW (decision A). [SEC-33] page/limit clamped before SQL.
 */

async function getAllWaterSuppliers(req, res) {
    try {
        const { page, limit, type } = req.query;
        // [SEC-33] clamp page/limit (raw strings → NaN/negative reached SQL)
        const { pageNum, limitNum } = validatePagination(page, limit, 100);
        const filters = {};

        if (type) {
            filters.type = type;
        }

        // Number() = CodeQL-recognized numeric barrier (values already clamped ints)
        const waterSuppliers = await WaterSupplier.findAll(Number(pageNum), Number(limitNum), filters);
        res.json(waterSuppliers);
    } catch (error) {
        logger.error(`Error fetching water suppliers: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-suppliers',
            method: 'GET',
            query: req.query
        });
        return sendError(res, 500, 'Ошибка получения поставщиков воды');
    }
}

async function getWaterSupplierById(req, res) {
    try {
        const waterSupplier = await WaterSupplier.findById(req.params.id);
        if (!waterSupplier) {
            return sendNotFound(res, 'Поставщик воды не найден');
        }
        res.json(waterSupplier);
    } catch (error) {
        logger.error(`Error fetching water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-suppliers/${req.params.id}`,
            method: 'GET',
            id: req.params.id
        });
        return sendError(res, 500, 'Ошибка получения поставщика воды');
    }
}

async function createWaterSupplier(req, res) {
    try {
        const waterSupplier = await WaterSupplier.create(req.body);
        res.status(201).json(waterSupplier);
    } catch (error) {
        logger.error(`Error creating water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-suppliers',
            method: 'POST',
            body: req.body
        });
        return sendError(res, 500, 'Ошибка создания поставщика воды');
    }
}

async function updateWaterSupplier(req, res) {
    try {
        const waterSupplier = await WaterSupplier.update(req.params.id, req.body);
        if (!waterSupplier) {
            return sendNotFound(res, 'Поставщик воды не найден');
        }
        res.json(waterSupplier);
    } catch (error) {
        logger.error(`Error updating water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-suppliers/${req.params.id}`,
            method: 'PUT',
            id: req.params.id,
            body: req.body
        });
        return sendError(res, 500, 'Ошибка обновления поставщика воды');
    }
}

async function deleteWaterSupplier(req, res) {
    try {
        const result = await WaterSupplier.delete(req.params.id);
        if (!result) {
            return sendNotFound(res, 'Поставщик воды не найден');
        }
        res.json({ message: 'Поставщик воды успешно удален' });
    } catch (error) {
        logger.error(`Error deleting water supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-suppliers/${req.params.id}`,
            method: 'DELETE',
            id: req.params.id
        });
        return sendError(res, 500, 'Ошибка удаления поставщика воды');
    }
}

module.exports = {
    getAllWaterSuppliers,
    getWaterSupplierById,
    createWaterSupplier,
    updateWaterSupplier,
    deleteWaterSupplier
};
