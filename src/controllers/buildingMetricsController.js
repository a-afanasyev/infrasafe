const db = require('../config/database');
const { createError } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Получить здания с последними метриками для карты
 */
const getBuildingsWithMetrics = async (req, res, next) => {
    try {
        const query = `
            SELECT 
                b.building_id,
                b.name as building_name,
                b.address,
                b.town,
                b.latitude,
                b.longitude,
                b.region,
                b.management_company,
                b.hot_water,
                c.controller_id,
                c.serial_number as controller_serial,
                c.status as controller_status,
                m.timestamp,
                m.electricity_ph1,
                m.electricity_ph2,
                m.electricity_ph3,
                m.amperage_ph1,
                m.amperage_ph2,
                m.amperage_ph3,
                m.cold_water_pressure,
                m.cold_water_temp,
                m.hot_water_in_pressure,
                m.hot_water_out_pressure,
                m.hot_water_in_temp,
                m.hot_water_out_temp,
                m.air_temp,
                m.humidity,
                m.leak_sensor
            FROM buildings b
            LEFT JOIN controllers c ON b.building_id = c.building_id
            LEFT JOIN LATERAL (
                SELECT *
                FROM metrics m2
                WHERE m2.controller_id = c.controller_id
                ORDER BY m2.timestamp DESC
                LIMIT 1
            ) m ON true
            ORDER BY b.building_id
        `;

        const result = await db.query(query);
        
        const buildings = result.rows.map(row => ({
            building_id: row.building_id,
            building_name: row.building_name,
            address: row.address,
            town: row.town,
            latitude: row.latitude,
            longitude: row.longitude,
            region: row.region,
            management_company: row.management_company,
            hot_water: row.hot_water,
            controller_id: row.controller_id,
            controller_serial: row.controller_serial,
            controller_status: row.controller_status,
            timestamp: row.timestamp,
            electricity_ph1: row.electricity_ph1,
            electricity_ph2: row.electricity_ph2,
            electricity_ph3: row.electricity_ph3,
            amperage_ph1: row.amperage_ph1,
            amperage_ph2: row.amperage_ph2,
            amperage_ph3: row.amperage_ph3,
            cold_water_pressure: row.cold_water_pressure,
            cold_water_temp: row.cold_water_temp,
            hot_water_in_pressure: row.hot_water_in_pressure,
            hot_water_out_pressure: row.hot_water_out_pressure,
            hot_water_in_temp: row.hot_water_in_temp,
            hot_water_out_temp: row.hot_water_out_temp,
            air_temp: row.air_temp,
            humidity: row.humidity,
            leak_sensor: row.leak_sensor
        }));

        logger.info(`Retrieved ${buildings.length} buildings with metrics for map`);
        
        res.json({
            data: buildings,
            pagination: {
                total: buildings.length,
                page: 1,
                limit: buildings.length,
                totalPages: 1
            }
        });

    } catch (error) {
        logger.error(`Error in getBuildingsWithMetrics: ${error.message}`);
        next(createError(`Failed to get buildings with metrics: ${error.message}`, 500));
    }
};

module.exports = {
    getBuildingsWithMetrics
}; 