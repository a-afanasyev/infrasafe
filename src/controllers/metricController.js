const metricService = require('../services/metricService');
const logger = require('../utils/logger');
const { sendNotFound } = require('../utils/apiResponse');

// Получить все метрики
const getAllMetrics = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'timestamp', order = 'desc' } = req.query;
        const result = await metricService.getAllMetrics(parseInt(page), parseInt(limit), sort, order);
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in getAllMetrics: ${error.message}`);
        next(error);
    }
};

// Получить метрику по ID
const getMetricById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const metric = await metricService.getMetricById(id);

        if (!metric) {
            return sendNotFound(res, 'Metric not found');
        }

        return res.status(200).json(metric);
    } catch (error) {
        logger.error(`Error in getMetricById: ${error.message}`);
        next(error);
    }
};

// Получить последние метрики для всех контроллеров
const getLastMetricsForAllControllers = async (req, res, next) => {
    try {
        const metrics = await metricService.getLastMetricsForAllControllers();
        return res.status(200).json(metrics);
    } catch (error) {
        logger.error(`Error in getLastMetricsForAllControllers: ${error.message}`);
        next(error);
    }
};

// Получить метрики по ID контроллера
const getMetricsByControllerId = async (req, res, next) => {
    try {
        const { controllerId } = req.params;
        const { startDate, endDate } = req.query;

        const metrics = await metricService.getMetricsByControllerId(controllerId, startDate, endDate);
        return res.status(200).json(metrics);
    } catch (error) {
        if (error.code === 'CONTROLLER_NOT_FOUND') {
            return sendNotFound(res, error.message);
        }

        logger.error(`Error in getMetricsByControllerId: ${error.message}`);
        next(error);
    }
};

// Создать новую метрику
const createMetric = async (req, res, next) => {
    try {
        const newMetric = await metricService.createMetric(req.body);
        return res.status(201).json(newMetric);
    } catch (error) {
        if (error.code === 'CONTROLLER_NOT_FOUND') {
            return sendNotFound(res, error.message);
        }

        logger.error(`Error in createMetric: ${error.message}`);
        next(error);
    }
};

// Получение телеметрии от контроллеров
const receiveTelemetry = async (req, res, next) => {
    try {
        const result = await metricService.processTelemetry(req.body);
        return res.status(201).json(result);
    } catch (error) {
        if (error.code === 'CONTROLLER_NOT_FOUND') {
            return sendNotFound(res, error.message);
        }

        logger.error(`Error in receiveTelemetry: ${error.message}`);
        next(error);
    }
};

// Удалить метрику
const deleteMetric = async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await metricService.deleteMetric(id);

        if (!result) {
            return sendNotFound(res, 'Metric not found');
        }

        return res.status(200).json({
            message: 'Metric deleted successfully',
            deleted: result
        });
    } catch (error) {
        logger.error(`Error in deleteMetric: ${error.message}`);
        next(error);
    }
};

// Получить агрегированные метрики для контроллера
const getAggregatedMetrics = async (req, res, next) => {
    try {
        const { controllerId } = req.params;
        const { timeFrame = '1h' } = req.query;

        const aggregated = await metricService.getAggregatedMetrics(controllerId, timeFrame);
        return res.status(200).json(aggregated);
    } catch (error) {
        logger.error(`Error in getAggregatedMetrics: ${error.message}`);
        next(error);
    }
};

// Очистка старых метрик
const cleanupOldMetrics = async (req, res, next) => {
    try {
        const { daysToKeep = 30 } = req.query;

        const result = await metricService.cleanupOldMetrics(parseInt(daysToKeep));
        return res.status(200).json(result);
    } catch (error) {
        logger.error(`Error in cleanupOldMetrics: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getAllMetrics,
    getMetricById,
    getLastMetricsForAllControllers,
    getMetricsByControllerId,
    createMetric,
    receiveTelemetry,
    deleteMetric,
    getAggregatedMetrics,
    cleanupOldMetrics
};