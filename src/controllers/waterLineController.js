const WaterLine = require('../models/WaterLine');
const logger = require('../utils/logger');
const { sendError, sendNotFound } = require('../utils/apiResponse');

/**
 * [AUD-010] Water-line HTTP handlers, extracted from the inline route file so
 * water routes match the line/controller layering convention.
 *
 * [AUD-011] Error paths emit the canonical envelope via apiResponse
 * (sendError/sendNotFound → { success:false, error:{ message, status } }).
 * Success shapes are intentionally preserved RAW (array / object / instance /
 * { message }) to stay byte-compatible with existing consumers (decision A).
 * 500 messages are generic Russian strings — no internal detail leaks.
 */

async function getAllWaterLines(req, res) {
    try {
        const waterLines = await WaterLine.findAll();
        res.json(waterLines);
    } catch (error) {
        logger.error(`Error fetching water lines: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-lines',
            method: 'GET'
        });
        return sendError(res, 500, 'Ошибка получения водных линий');
    }
}

async function getWaterLineById(req, res) {
    try {
        const waterLine = await WaterLine.findById(req.params.id);
        if (!waterLine) {
            return sendNotFound(res, 'Водная линия не найдена');
        }
        res.json(waterLine);
    } catch (error) {
        logger.error(`Error fetching water line: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}`,
            method: 'GET',
            id: req.params.id
        });
        return sendError(res, 500, 'Ошибка получения водной линии');
    }
}

// Поставщики для водной линии (через связанные здания)
async function getWaterLineSuppliers(req, res) {
    try {
        const waterLine = await WaterLine.findById(req.params.id);
        if (!waterLine) {
            return sendNotFound(res, 'Водная линия не найдена');
        }

        const suppliers = await WaterLine.findSuppliersForLine(req.params.id);

        res.json({
            suppliers,
            line: {
                id: waterLine.line_id,
                name: waterLine.name
            }
        });
    } catch (error) {
        logger.error(`Error fetching water line supplier: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}/supplier`,
            method: 'GET',
            id: req.params.id
        });
        return sendError(res, 500, 'Ошибка получения поставщика линии');
    }
}

async function createWaterLine(req, res) {
    try {
        const waterLine = await WaterLine.create(req.body);
        res.status(201).json(waterLine);
    } catch (error) {
        logger.error(`Error creating water line: ${error.message}`, {
            stack: error.stack,
            endpoint: '/api/water-lines',
            method: 'POST',
            body: req.body
        });
        return sendError(res, 500, 'Ошибка создания водной линии');
    }
}

async function updateWaterLine(req, res) {
    try {
        const waterLine = await WaterLine.update(req.params.id, req.body);
        if (!waterLine) {
            return sendNotFound(res, 'Водная линия не найдена');
        }
        res.json(waterLine);
    } catch (error) {
        logger.error(`Error updating water line: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}`,
            method: 'PUT',
            id: req.params.id,
            body: req.body
        });
        return sendError(res, 500, 'Ошибка обновления водной линии');
    }
}

async function deleteWaterLine(req, res) {
    try {
        const result = await WaterLine.delete(req.params.id);
        if (!result) {
            return sendNotFound(res, 'Водная линия не найдена');
        }
        res.json({ message: 'Водная линия успешно удалена' });
    } catch (error) {
        logger.error(`Error deleting water line: ${error.message}`, {
            stack: error.stack,
            endpoint: `/api/water-lines/${req.params.id}`,
            method: 'DELETE',
            id: req.params.id
        });
        return sendError(res, 500, 'Ошибка удаления водной линии');
    }
}

module.exports = {
    getAllWaterLines,
    getWaterLineById,
    getWaterLineSuppliers,
    createWaterLine,
    updateWaterLine,
    deleteWaterLine
};
