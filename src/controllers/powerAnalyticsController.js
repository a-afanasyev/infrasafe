/**
 * Контроллер для аналитики потребления мощности
 * 
 * Рассчитывает мощность в реальном времени на основе данных контроллеров:
 * - По зданиям (с детализацией по фазам)
 * - По линиям электропередач (суммарная нагрузка)
 * - По трансформаторам (загрузка и дисбаланс фаз)
 */

const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Рассчитать мощность из напряжения и силы тока
 * P = U * I * cos(φ) / 1000 (для перевода в кВт)
 * cos(φ) принимаем за 0.95 (типовой коэффициент мощности)
 */
const calculatePower = (voltage, amperage) => {
    const POWER_FACTOR = 0.95;
    return (voltage * amperage * POWER_FACTOR) / 1000;
};

/**
 * Получить мощность всех зданий с детализацией по фазам
 */
const getBuildingsPower = async (req, res, next) => {
    try {
        const query = `
            WITH latest_metrics AS (
                SELECT DISTINCT ON (m.controller_id)
                    m.controller_id,
                    m.electricity_ph1,
                    m.electricity_ph2,
                    m.electricity_ph3,
                    m.amperage_ph1,
                    m.amperage_ph2,
                    m.amperage_ph3,
                    m.timestamp
                FROM metrics m
                WHERE m.timestamp > NOW() - INTERVAL '5 minutes'
                ORDER BY m.controller_id, m.timestamp DESC
            )
            SELECT 
                b.building_id,
                b.name as building_name,
                COUNT(c.controller_id) as controllers_count,
                AVG(lm.electricity_ph1) as avg_voltage_ph1,
                AVG(lm.electricity_ph2) as avg_voltage_ph2,
                AVG(lm.electricity_ph3) as avg_voltage_ph3,
                SUM(lm.amperage_ph1) as total_amperage_ph1,
                SUM(lm.amperage_ph2) as total_amperage_ph2,
                SUM(lm.amperage_ph3) as total_amperage_ph3,
                MAX(lm.timestamp) as last_measurement_time
            FROM buildings b
            LEFT JOIN controllers c ON c.building_id = b.building_id
            LEFT JOIN latest_metrics lm ON lm.controller_id = c.controller_id
            GROUP BY b.building_id, b.name
            ORDER BY b.building_id
        `;
        
        const result = await db.query(query);
        
        // Рассчитываем мощность для каждого здания
        const buildings = result.rows.map(row => {
            const power_ph1_kw = calculatePower(row.avg_voltage_ph1 || 0, row.total_amperage_ph1 || 0);
            const power_ph2_kw = calculatePower(row.avg_voltage_ph2 || 0, row.total_amperage_ph2 || 0);
            const power_ph3_kw = calculatePower(row.avg_voltage_ph3 || 0, row.total_amperage_ph3 || 0);
            
            return {
                building_id: row.building_id,
                building_name: row.building_name,
                controllers_count: parseInt(row.controllers_count) || 0,
                voltage_ph1: parseFloat(row.avg_voltage_ph1 || 0).toFixed(1),
                voltage_ph2: parseFloat(row.avg_voltage_ph2 || 0).toFixed(1),
                voltage_ph3: parseFloat(row.avg_voltage_ph3 || 0).toFixed(1),
                amperage_ph1: parseFloat(row.total_amperage_ph1 || 0).toFixed(2),
                amperage_ph2: parseFloat(row.total_amperage_ph2 || 0).toFixed(2),
                amperage_ph3: parseFloat(row.total_amperage_ph3 || 0).toFixed(2),
                power_ph1_kw: power_ph1_kw.toFixed(2),
                power_ph2_kw: power_ph2_kw.toFixed(2),
                power_ph3_kw: power_ph3_kw.toFixed(2),
                total_power_kw: (power_ph1_kw + power_ph2_kw + power_ph3_kw).toFixed(2),
                last_measurement_time: row.last_measurement_time
            };
        });
        
        return res.status(200).json({
            success: true,
            data: buildings,
            count: buildings.length
        });
    } catch (error) {
        logger.error(`Error in getBuildingsPower: ${error.message}`);
        next(error);
    }
};

/**
 * Получить мощность конкретного здания
 */
const getBuildingPower = async (req, res, next) => {
    try {
        const { buildingId } = req.params;
        
        const query = `
            WITH latest_metrics AS (
                SELECT DISTINCT ON (m.controller_id)
                    m.controller_id,
                    m.electricity_ph1,
                    m.electricity_ph2,
                    m.electricity_ph3,
                    m.amperage_ph1,
                    m.amperage_ph2,
                    m.amperage_ph3,
                    m.timestamp
                FROM metrics m
                WHERE m.timestamp > NOW() - INTERVAL '5 minutes'
                ORDER BY m.controller_id, m.timestamp DESC
            )
            SELECT 
                b.building_id,
                b.name as building_name,
                COUNT(c.controller_id) as controllers_count,
                AVG(lm.electricity_ph1) as avg_voltage_ph1,
                AVG(lm.electricity_ph2) as avg_voltage_ph2,
                AVG(lm.electricity_ph3) as avg_voltage_ph3,
                SUM(lm.amperage_ph1) as total_amperage_ph1,
                SUM(lm.amperage_ph2) as total_amperage_ph2,
                SUM(lm.amperage_ph3) as total_amperage_ph3,
                MAX(lm.timestamp) as last_measurement_time
            FROM buildings b
            LEFT JOIN controllers c ON c.building_id = b.building_id
            LEFT JOIN latest_metrics lm ON lm.controller_id = c.controller_id
            WHERE b.building_id = $1
            GROUP BY b.building_id, b.name
        `;
        
        const result = await db.query(query, [buildingId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Building power data not found'
            });
        }
        
        const row = result.rows[0];
        const power_ph1_kw = calculatePower(row.avg_voltage_ph1 || 0, row.total_amperage_ph1 || 0);
        const power_ph2_kw = calculatePower(row.avg_voltage_ph2 || 0, row.total_amperage_ph2 || 0);
        const power_ph3_kw = calculatePower(row.avg_voltage_ph3 || 0, row.total_amperage_ph3 || 0);
        
        const buildingPower = {
            building_id: row.building_id,
            building_name: row.building_name,
            controllers_count: parseInt(row.controllers_count) || 0,
            voltage_ph1: parseFloat(row.avg_voltage_ph1 || 0).toFixed(1),
            voltage_ph2: parseFloat(row.avg_voltage_ph2 || 0).toFixed(1),
            voltage_ph3: parseFloat(row.avg_voltage_ph3 || 0).toFixed(1),
            amperage_ph1: parseFloat(row.total_amperage_ph1 || 0).toFixed(2),
            amperage_ph2: parseFloat(row.total_amperage_ph2 || 0).toFixed(2),
            amperage_ph3: parseFloat(row.total_amperage_ph3 || 0).toFixed(2),
            power_ph1_kw: power_ph1_kw.toFixed(2),
            power_ph2_kw: power_ph2_kw.toFixed(2),
            power_ph3_kw: power_ph3_kw.toFixed(2),
            total_power_kw: (power_ph1_kw + power_ph2_kw + power_ph3_kw).toFixed(2),
            last_measurement_time: row.last_measurement_time
        };
        
        return res.status(200).json({
            success: true,
            data: buildingPower
        });
    } catch (error) {
        logger.error(`Error in getBuildingPower: ${error.message}`);
        next(error);
    }
};

/**
 * Получить мощность всех линий с детализацией по фазам
 */
const getLinesPower = async (req, res, next) => {
    try {
        // Для демонстрации возвращаем пустой массив
        // TODO: Реализовать расчет для линий электропередач
        return res.status(200).json({
            success: true,
            data: [],
            count: 0
        });
    } catch (error) {
        logger.error(`Error in getLinesPower: ${error.message}`);
        next(error);
    }
};

/**
 * Получить мощность конкретной линии
 */
const getLinePower = async (req, res, next) => {
    try {
        // Для демонстрации возвращаем пустой объект
        // TODO: Реализовать расчет для конкретной линии
        return res.status(404).json({
            success: false,
            error: 'Line power data not found'
        });
    } catch (error) {
        logger.error(`Error in getLinePower: ${error.message}`);
        next(error);
    }
};

/**
 * Получить загрузку всех трансформаторов с детализацией по фазам
 */
const getTransformersPower = async (req, res, next) => {
    try {
        // Для демонстрации возвращаем пустой массив
        // TODO: Реализовать расчет для трансформаторов
        return res.status(200).json({
            success: true,
            data: [],
            count: 0
        });
    } catch (error) {
        logger.error(`Error in getTransformersPower: ${error.message}`);
        next(error);
    }
};

/**
 * Получить загрузку конкретного трансформатора
 */
const getTransformerPower = async (req, res, next) => {
    try {
        // Для демонстрации возвращаем пустой объект
        // TODO: Реализовать расчет для конкретного трансформатора
        return res.status(404).json({
            success: false,
            error: 'Transformer power data not found'
        });
    } catch (error) {
        logger.error(`Error in getTransformerPower: ${error.message}`);
        next(error);
    }
};

/**
 * Получить анализ дисбаланса фаз по всем трансформаторам
 */
const getPhaseImbalanceAnalysis = async (req, res, next) => {
    try {
        // Для демонстрации возвращаем пустой массив
        // TODO: Реализовать анализ дисбаланса фаз
        return res.status(200).json({
            success: true,
            data: [],
            count: 0
        });
    } catch (error) {
        logger.error(`Error in getPhaseImbalanceAnalysis: ${error.message}`);
        next(error);
    }
};

/**
 * Функция не требуется при расчете в реальном времени
 */
const refreshPowerViews = async (req, res, next) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Power calculation is performed in real-time, no refresh needed'
        });
    } catch (error) {
        logger.error(`Error in refreshPowerViews: ${error.message}`);
        next(error);
    }
};

module.exports = {
    getBuildingsPower,
    getBuildingPower,
    getLinesPower,
    getLinePower,
    getTransformersPower,
    getTransformerPower,
    getPhaseImbalanceAnalysis,
    refreshPowerViews
};
