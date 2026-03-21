const db = require('../config/database');
const logger = require('../utils/logger');

const POWER_FACTOR = 0.95;

const calculatePower = (voltage, amperage) => {
    return (voltage * amperage * POWER_FACTOR) / 1000;
};

const mapBuildingPowerRow = (row) => {
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
};

const BUILDINGS_POWER_QUERY = `
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
`;

const getBuildingsPower = async () => {
    const result = await db.query(BUILDINGS_POWER_QUERY + ' ORDER BY b.building_id');
    return result.rows.map(mapBuildingPowerRow);
};

const getBuildingPower = async (buildingId) => {
    const wrappedQuery = `SELECT * FROM (${BUILDINGS_POWER_QUERY}) AS buildings_power WHERE building_id = $1`;
    const result = await db.query(wrappedQuery, [buildingId]);

    if (result.rows.length === 0) {
        return null;
    }

    return mapBuildingPowerRow(result.rows[0]);
};

const TRANSFORMERS_POWER_QUERY = `
    WITH latest_metrics AS (
        SELECT DISTINCT ON (m.controller_id)
            m.controller_id,
            c.building_id,
            m.electricity_ph1,
            m.electricity_ph2,
            m.electricity_ph3,
            m.amperage_ph1,
            m.amperage_ph2,
            m.amperage_ph3,
            m.timestamp
        FROM metrics m
        JOIN controllers c ON c.controller_id = m.controller_id
        WHERE m.timestamp > NOW() - INTERVAL '5 minutes'
        ORDER BY m.controller_id, m.timestamp DESC
    )
    SELECT
        t.transformer_id as id,
        t.name,
        t.power_kva as capacity_kva,
        COUNT(DISTINCT b.building_id) as buildings_count,
        COUNT(DISTINCT c.controller_id) as controllers_count,
        AVG(lm.electricity_ph1) as avg_voltage_ph1,
        AVG(lm.electricity_ph2) as avg_voltage_ph2,
        AVG(lm.electricity_ph3) as avg_voltage_ph3,
        SUM(lm.amperage_ph1) as total_amperage_ph1,
        SUM(lm.amperage_ph2) as total_amperage_ph2,
        SUM(lm.amperage_ph3) as total_amperage_ph3,
        MAX(lm.timestamp) as last_measurement_time
    FROM transformers t
    LEFT JOIN buildings b ON b.primary_transformer_id = t.transformer_id OR b.backup_transformer_id = t.transformer_id
    LEFT JOIN controllers c ON c.building_id = b.building_id
    LEFT JOIN latest_metrics lm ON lm.controller_id = c.controller_id
    GROUP BY t.transformer_id, t.name, t.power_kva
`;

const mapTransformerPowerRow = (row) => {
    const power_ph1_kw = calculatePower(row.avg_voltage_ph1 || 0, row.total_amperage_ph1 || 0);
    const power_ph2_kw = calculatePower(row.avg_voltage_ph2 || 0, row.total_amperage_ph2 || 0);
    const power_ph3_kw = calculatePower(row.avg_voltage_ph3 || 0, row.total_amperage_ph3 || 0);
    const total_power_kw = power_ph1_kw + power_ph2_kw + power_ph3_kw;

    const capacity_kva = parseFloat(row.capacity_kva) || 0;
    const load_percent = capacity_kva > 0 ? (total_power_kw / capacity_kva) * 100 : 0;

    const capacity_per_phase = capacity_kva / 3;
    const load_percent_ph1 = capacity_per_phase > 0 ? (power_ph1_kw / capacity_per_phase) * 100 : 0;
    const load_percent_ph2 = capacity_per_phase > 0 ? (power_ph2_kw / capacity_per_phase) * 100 : 0;
    const load_percent_ph3 = capacity_per_phase > 0 ? (power_ph3_kw / capacity_per_phase) * 100 : 0;

    return {
        id: row.id,
        name: row.name,
        capacity_kva: capacity_kva.toFixed(0),
        buildings_count: parseInt(row.buildings_count) || 0,
        controllers_count: parseInt(row.controllers_count) || 0,
        power_ph1_kw: power_ph1_kw.toFixed(2),
        power_ph2_kw: power_ph2_kw.toFixed(2),
        power_ph3_kw: power_ph3_kw.toFixed(2),
        total_power_kw: total_power_kw.toFixed(2),
        load_percent: load_percent.toFixed(1),
        load_percent_ph1: load_percent_ph1.toFixed(1),
        load_percent_ph2: load_percent_ph2.toFixed(1),
        load_percent_ph3: load_percent_ph3.toFixed(1),
        active_controllers_count: parseInt(row.controllers_count) || 0,
        lines_count: 0,
        last_measurement_time: row.last_measurement_time
    };
};

const getTransformersPower = async () => {
    const result = await db.query(TRANSFORMERS_POWER_QUERY + ' ORDER BY t.transformer_id');
    return result.rows.map(mapTransformerPowerRow);
};

const getTransformerPower = async (transformerId) => {
    const wrappedQuery = `SELECT * FROM (${TRANSFORMERS_POWER_QUERY}) AS transformers_power WHERE transformer_id = $1`;
    const result = await db.query(wrappedQuery, [transformerId]);

    if (result.rows.length === 0) {
        return null;
    }

    return mapTransformerPowerRow(result.rows[0]);
};

module.exports = {
    calculatePower,
    getBuildingsPower,
    getBuildingPower,
    getTransformersPower,
    getTransformerPower
};
