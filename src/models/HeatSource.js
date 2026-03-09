const db = require('../config/database');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');
const { validateSortOrder } = require('../utils/queryValidation');

class HeatSource {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.address = data.address;
        this.latitude = data.latitude;
        this.longitude = data.longitude;
        this.source_type = data.source_type;
        this.capacity_mw = data.capacity_mw;
        this.fuel_type = data.fuel_type;
        this.installation_date = data.installation_date;
        this.status = data.status;
        this.maintenance_contact = data.maintenance_contact;
        this.notes = data.notes;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    static async findAll(page = 1, limit = 10, sort = 'id', order = 'asc') {
        try {
            const offset = (page - 1) * limit;

            const countResult = await db.query('SELECT COUNT(*) FROM heat_sources');
            const total = parseInt(countResult.rows[0].count);

            const { validSort, validOrder } = validateSortOrder('heat_sources', sort, order);

            const { rows } = await db.query(
                `SELECT * FROM heat_sources
                 ORDER BY ${validSort} ${validOrder}
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            );

            return {
                data: rows.map(row => new HeatSource(row)),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            logger.error(`Error in HeatSource.findAll: ${error.message}`);
            throw createError(`Failed to fetch heat sources: ${error.message}`, 500);
        }
    }

    static async findById(id) {
        try {
            const { rows } = await db.query(
                'SELECT * FROM heat_sources WHERE id = $1',
                [id]
            );

            if (!rows.length) {
                return null;
            }

            return new HeatSource(rows[0]);
        } catch (error) {
            logger.error(`Error in HeatSource.findById: ${error.message}`);
            throw createError(`Failed to fetch heat source: ${error.message}`, 500);
        }
    }

    static async create(data) {
        try {
            const {
                id, name, address, latitude, longitude, source_type,
                capacity_mw, fuel_type, installation_date,
                status, maintenance_contact, notes
            } = data;

            const { rows } = await db.query(
                `INSERT INTO heat_sources
                 (id, name, address, latitude, longitude, source_type, capacity_mw,
                  fuel_type, installation_date, status, maintenance_contact, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING *`,
                [id, name, address, latitude, longitude, source_type, capacity_mw,
                 fuel_type, installation_date, status || 'active', maintenance_contact, notes]
            );

            logger.info(`Created heat source: ${name}`);
            return new HeatSource(rows[0]);
        } catch (error) {
            logger.error(`Error in HeatSource.create: ${error.message}`);
            throw createError(`Failed to create heat source: ${error.message}`, 500);
        }
    }

    static async update(id, data) {
        try {
            const {
                name, address, latitude, longitude, source_type,
                capacity_mw, fuel_type, installation_date,
                status, maintenance_contact, notes
            } = data;

            const { rows } = await db.query(
                `UPDATE heat_sources
                 SET name = $2, address = $3, latitude = $4, longitude = $5,
                     source_type = $6, capacity_mw = $7, fuel_type = $8,
                     installation_date = $9, status = $10, maintenance_contact = $11,
                     notes = $12, updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [id, name, address, latitude, longitude, source_type, capacity_mw,
                 fuel_type, installation_date, status, maintenance_contact, notes]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Updated heat source with ID: ${id}`);
            return new HeatSource(rows[0]);
        } catch (error) {
            logger.error(`Error in HeatSource.update: ${error.message}`);
            throw createError(`Failed to update heat source: ${error.message}`, 500);
        }
    }

    static async delete(id) {
        try {
            const { rows } = await db.query(
                'DELETE FROM heat_sources WHERE id = $1 RETURNING *',
                [id]
            );

            if (!rows.length) {
                return null;
            }

            logger.info(`Deleted heat source with ID: ${id}`);
            return new HeatSource(rows[0]);
        } catch (error) {
            logger.error(`Error in HeatSource.delete: ${error.message}`);
            throw createError(`Failed to delete heat source: ${error.message}`, 500);
        }
    }
}

module.exports = HeatSource;
