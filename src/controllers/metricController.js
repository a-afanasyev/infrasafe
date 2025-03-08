const Metric = require('../models/Metric');
const Controller = require('../models/Controller');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

// Получить все метрики
const getAllMetrics = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, sort = 'timestamp', order = 'desc' } = req.query;
        const result = await Metric.findAll(parseInt(page), parseInt(limit), sort, order);
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
        const metric = await Metric.findById(id);
        
        if (!metric) {
            return res.status(404).json({ error: 'Metric not found' });
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
        const metrics = await Metric.findLastForAllControllers();
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
        
        // Проверяем существование контроллера
        const controller = await Controller.findById(controllerId);
        if (!controller) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        const metrics = await Metric.findByControllerId(controllerId, startDate, endDate);
        return res.status(200).json(metrics);
    } catch (error) {
        logger.error(`Error in getMetricsByControllerId: ${error.message}`);
        next(error);
    }
};

// Создать новую метрику
const createMetric = async (req, res, next) => {
    try {
        // Проверяем существование контроллера
        const controllerId = req.body.controller_id;
        if (controllerId) {
            const controller = await Controller.findById(controllerId);
            if (!controller) {
                return res.status(404).json({ error: 'Controller not found' });
            }
        }
        
        const newMetric = await Metric.create(req.body);
        
        // После создания метрики, может потребоваться обновить статус контроллера
        if (controllerId) {
            try {
                await Controller.updateStatus(controllerId, 'online');
            } catch (statusError) {
                logger.warn(`Failed to update controller status: ${statusError.message}`);
                // Не прерываем выполнение, т.к. метрика создана успешно
            }
        }
        
        return res.status(201).json(newMetric);
    } catch (error) {
        logger.error(`Error in createMetric: ${error.message}`);
        next(error);
    }
};

// Получение телеметрии от контроллеров
const receiveTelementry = async (req, res, next) => {
    try {
        const { serial_number, timestamp, metrics } = req.body;
        
        // Проверяем существование контроллера по серийному номеру
        const controller = await Controller.findBySerialNumber(serial_number);
        if (!controller) {
            return res.status(404).json({ error: 'Controller not found' });
        }
        
        // Создаем метрику с данными из телеметрии
        const metricData = {
            controller_id: controller.controller_id,
            timestamp: timestamp || new Date().toISOString(),
            ...metrics
        };
        
        const newMetric = await Metric.create(metricData);
        
        // Обновляем статус контроллера
        await Controller.updateStatus(controller.controller_id, 'online');
        
        return res.status(201).json({
            message: 'Telemetry received successfully',
            metric: newMetric
        });
    } catch (error) {
        logger.error(`Error in receiveTelementry: ${error.message}`);
        next(error);
    }
};

// Удалить метрику
const deleteMetric = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const result = await Metric.delete(id);
        
        if (!result) {
            return res.status(404).json({ error: 'Metric not found' });
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

module.exports = {
    getAllMetrics,
    getMetricById,
    getLastMetricsForAllControllers,
    getMetricsByControllerId,
    createMetric,
    receiveTelementry,
    deleteMetric
}; 