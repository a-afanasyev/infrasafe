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
                b.has_hot_water,
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

        let buildings;

        if (req.user) {
            // Authenticated: return full data with metrics
            buildings = result.rows.map(row => ({
                building_id: row.building_id,
                building_name: row.building_name,
                address: row.address,
                town: row.town,
                latitude: row.latitude ? parseFloat(row.latitude) : null,
                longitude: row.longitude ? parseFloat(row.longitude) : null,
                region: row.region,
                management_company: row.management_company,
                has_hot_water: row.has_hot_water,
                controller_id: row.controller_id,
                controller_serial: row.controller_serial,
                controller_status: row.controller_status,
                timestamp: row.timestamp,
                electricity_ph1: row.electricity_ph1 ? parseFloat(row.electricity_ph1) : null,
                electricity_ph2: row.electricity_ph2 ? parseFloat(row.electricity_ph2) : null,
                electricity_ph3: row.electricity_ph3 ? parseFloat(row.electricity_ph3) : null,
                amperage_ph1: row.amperage_ph1 ? parseFloat(row.amperage_ph1) : null,
                amperage_ph2: row.amperage_ph2 ? parseFloat(row.amperage_ph2) : null,
                amperage_ph3: row.amperage_ph3 ? parseFloat(row.amperage_ph3) : null,
                cold_water_pressure: row.cold_water_pressure ? parseFloat(row.cold_water_pressure) : null,
                cold_water_temp: row.cold_water_temp ? parseFloat(row.cold_water_temp) : null,
                hot_water_in_pressure: row.hot_water_in_pressure ? parseFloat(row.hot_water_in_pressure) : null,
                hot_water_out_pressure: row.hot_water_out_pressure ? parseFloat(row.hot_water_out_pressure) : null,
                hot_water_in_temp: row.hot_water_in_temp ? parseFloat(row.hot_water_in_temp) : null,
                hot_water_out_temp: row.hot_water_out_temp ? parseFloat(row.hot_water_out_temp) : null,
                air_temp: row.air_temp ? parseFloat(row.air_temp) : null,
                humidity: row.humidity ? parseFloat(row.humidity) : null,
                leak_sensor: row.leak_sensor
            }));
        } else {
            // Anonymous: return truncated data (location + has_controller only)
            buildings = result.rows.map(row => ({
                building_id: row.building_id,
                building_name: row.building_name,
                address: row.address,
                town: row.town,
                latitude: row.latitude ? parseFloat(row.latitude) : null,
                longitude: row.longitude ? parseFloat(row.longitude) : null,
                has_controller: !!row.controller_id
            }));
        }

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