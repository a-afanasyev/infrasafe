const db = require('../config/database');
const logger = require('../utils/logger');

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 5000;

/**
 * Query with optional bbox filter and hard LIMIT.
 * bbox params are nullable: when NULL the BETWEEN condition passes.
 */
const BUILDINGS_METRICS_QUERY = `
    SELECT
        b.building_id,
        b.name as building_name,
        b.address,
        b.town,
        b.latitude,
        b.longitude,
        b.region,
        b.management_company,
        b.external_id,
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
    WHERE ($1::float8 IS NULL OR b.latitude  BETWEEN $1 AND $2)
      AND ($3::float8 IS NULL OR b.longitude BETWEEN $3 AND $4)
    ORDER BY b.building_id
    LIMIT $5
`;

const mapAuthenticatedRow = (row) => ({
    building_id: row.building_id,
    building_name: row.building_name,
    address: row.address,
    town: row.town,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    region: row.region,
    management_company: row.management_company,
    external_id: row.external_id || null,
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
});

const mapAnonymousRow = (row) => ({
    building_id: row.building_id,
    building_name: row.building_name,
    address: row.address,
    town: row.town,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    has_controller: !!row.controller_id
});

/**
 * Parse a bbox string "lat_min,lng_min,lat_max,lng_max" into tuple.
 * Returns null if unset, throws Error on invalid format.
 */
const parseBbox = (raw) => {
    if (!raw) return null;
    const parts = String(raw).split(',').map(s => s.trim());
    if (parts.length !== 4) {
        throw new Error('bbox must be 4 comma-separated numbers: lat_min,lng_min,lat_max,lng_max');
    }
    const nums = parts.map(Number);
    if (nums.some(n => !Number.isFinite(n))) {
        throw new Error('bbox values must be finite numbers');
    }
    const [latMin, lngMin, latMax, lngMax] = nums;
    if (latMin < -90 || latMax > 90 || latMin > latMax) {
        throw new Error('bbox latitude out of range or inverted');
    }
    if (lngMin < -180 || lngMax > 180 || lngMin > lngMax) {
        throw new Error('bbox longitude out of range or inverted');
    }
    return { latMin, lngMin, latMax, lngMax };
};

/**
 * Clamp a limit param.
 */
const parseLimit = (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(n), MAX_LIMIT);
};

const getBuildingsWithMetrics = async (isAuthenticated, options = {}) => {
    const { bbox = null, limit = DEFAULT_LIMIT } = options;

    const params = [
        bbox ? bbox.latMin : null,
        bbox ? bbox.latMax : null,
        bbox ? bbox.lngMin : null,
        bbox ? bbox.lngMax : null,
        limit,
    ];

    const result = await db.query(BUILDINGS_METRICS_QUERY, params);

    const buildings = isAuthenticated
        ? result.rows.map(mapAuthenticatedRow)
        : result.rows.map(mapAnonymousRow);

    logger.info(`Retrieved ${buildings.length} buildings with metrics for map (limit=${limit}, bbox=${bbox ? 'set' : 'none'})`);

    return {
        data: buildings,
        pagination: {
            total: buildings.length,
            page: 1,
            limit,
            totalPages: 1
        }
    };
};

module.exports = {
    getBuildingsWithMetrics,
    parseBbox,
    parseLimit,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
