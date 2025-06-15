const db = require('../config/database');

class PowerTransformer {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.address = data.address;
        this.latitude = data.latitude;
        this.longitude = data.longitude;
        this.capacity_kva = data.capacity_kva;
        this.voltage_primary = data.voltage_primary;
        this.voltage_secondary = data.voltage_secondary;
        this.installation_date = data.installation_date;
        this.manufacturer = data.manufacturer;
        this.model = data.model;
        this.status = data.status || 'active';
        this.maintenance_contact = data.maintenance_contact;
        this.notes = data.notes;
        this.created_at = data.created_at;
        this.updated_at = data.updated_at;
    }

    // Создание нового трансформатора
    static async create(transformerData) {
        const query = `
            INSERT INTO power_transformers
            (id, name, address, latitude, longitude, capacity_kva, voltage_primary,
             voltage_secondary, installation_date, manufacturer, model, status,
             maintenance_contact, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `;

        const values = [
            transformerData.id,
            transformerData.name,
            transformerData.address,
            transformerData.latitude,
            transformerData.longitude,
            transformerData.capacity_kva,
            transformerData.voltage_primary,
            transformerData.voltage_secondary,
            transformerData.installation_date,
            transformerData.manufacturer,
            transformerData.model,
            transformerData.status || 'active',
            transformerData.maintenance_contact,
            transformerData.notes
        ];

        const result = await db.query(query, values);
        return new PowerTransformer(result.rows[0]);
    }

    // Получение всех трансформаторов
    static async findAll(filters = {}) {
        let query = `
            SELECT pt.*,
                   COUNT(DISTINCT b.building_id) as buildings_count,
                   COUNT(DISTINCT c.controller_id) as controllers_count
            FROM power_transformers pt
            LEFT JOIN buildings b ON pt.id = b.power_transformer_id
            LEFT JOIN controllers c ON b.building_id = c.building_id
        `;

        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (filters.status) {
            conditions.push(`pt.status = $${paramIndex}`);
            values.push(filters.status);
            paramIndex++;
        }

        if (filters.capacity_min) {
            conditions.push(`pt.capacity_kva >= $${paramIndex}`);
            values.push(filters.capacity_min);
            paramIndex++;
        }

        if (filters.capacity_max) {
            conditions.push(`pt.capacity_kva <= $${paramIndex}`);
            values.push(filters.capacity_max);
            paramIndex++;
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += `
            GROUP BY pt.id, pt.name, pt.address, pt.latitude, pt.longitude,
                     pt.capacity_kva, pt.voltage_primary, pt.voltage_secondary,
                     pt.installation_date, pt.manufacturer, pt.model, pt.status,
                     pt.maintenance_contact, pt.notes, pt.created_at, pt.updated_at
            ORDER BY pt.name
        `;

        const result = await db.query(query, values);
        return result.rows.map(row => ({
            ...new PowerTransformer(row),
            buildings_count: parseInt(row.buildings_count),
            controllers_count: parseInt(row.controllers_count)
        }));
    }

    // Получение трансформатора по ID
    static async findById(id) {
        const query = `
            SELECT pt.*,
                   COUNT(DISTINCT b.building_id) as buildings_count,
                   COUNT(DISTINCT c.controller_id) as controllers_count
            FROM power_transformers pt
            LEFT JOIN buildings b ON pt.id = b.power_transformer_id
            LEFT JOIN controllers c ON b.building_id = c.building_id
            WHERE pt.id = $1
            GROUP BY pt.id, pt.name, pt.address, pt.latitude, pt.longitude,
                     pt.capacity_kva, pt.voltage_primary, pt.voltage_secondary,
                     pt.installation_date, pt.manufacturer, pt.model, pt.status,
                     pt.maintenance_contact, pt.notes, pt.created_at, pt.updated_at
        `;

        const result = await db.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            ...new PowerTransformer(row),
            buildings_count: parseInt(row.buildings_count),
            controllers_count: parseInt(row.controllers_count)
        };
    }

    // Обновление трансформатора
    static async update(id, updateData) {
        const fields = [];
        const values = [];
        let paramIndex = 1;

        const allowedFields = [
            'name', 'address', 'latitude', 'longitude', 'capacity_kva',
            'voltage_primary', 'voltage_secondary', 'installation_date',
            'manufacturer', 'model', 'status', 'maintenance_contact', 'notes'
        ];

        for (const field of allowedFields) {
            if (updateData[field] !== undefined) {
                fields.push(`${field} = $${paramIndex}`);
                values.push(updateData[field]);
                paramIndex++;
            }
        }

        if (fields.length === 0) {
            throw new Error('Нет данных для обновления');
        }

        values.push(id);

        const query = `
            UPDATE power_transformers
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${paramIndex}
            RETURNING *
        `;

        const result = await db.query(query, values);
        if (result.rows.length === 0) {
            return null;
        }

        return new PowerTransformer(result.rows[0]);
    }

    // Удаление трансформатора
    static async delete(id) {
        // Проверяем, есть ли связанные здания
        const checkQuery = `
            SELECT COUNT(*) as count FROM buildings WHERE power_transformer_id = $1
        `;
        const checkResult = await db.query(checkQuery, [id]);

        if (parseInt(checkResult.rows[0].count) > 0) {
            throw new Error('Нельзя удалить трансформатор, к которому привязаны здания');
        }

        const query = 'DELETE FROM power_transformers WHERE id = $1 RETURNING *';
        const result = await db.query(query, [id]);

        return result.rows.length > 0;
    }

    // Получение аналитики загрузки трансформатора в реальном времени
    static async getLoadAnalytics(id) {
        const query = `
            SELECT * FROM mv_transformer_load_realtime WHERE id = $1
        `;

        const result = await db.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }

        return result.rows[0];
    }

    // Получение всех трансформаторов с аналитикой загрузки
    static async getAllWithLoadAnalytics() {
        const query = `
            SELECT * FROM mv_transformer_load_realtime
            ORDER BY load_percent DESC, name
        `;

        const result = await db.query(query);
        return result.rows;
    }

    // Поиск ближайших зданий к трансформатору
    static async findNearestBuildings(id, maxDistance = 1000, limit = 50) {
        const query = `
            SELECT * FROM find_nearest_buildings_to_transformer($1, $2, $3)
        `;

        const result = await db.query(query, [id, maxDistance, limit]);
        return result.rows;
    }

    // Получение трансформаторов с высокой загрузкой
    static async getOverloadedTransformers(threshold = 80) {
        const query = `
            SELECT * FROM mv_transformer_load_realtime
            WHERE load_percent >= $1
            ORDER BY load_percent DESC
        `;

        const result = await db.query(query, [threshold]);
        return result.rows;
    }

    // Поиск трансформаторов в радиусе от точки
    static async findInRadius(latitude, longitude, radiusMeters = 5000) {
        const query = `
            SELECT pt.*,
                   ST_Distance(
                       ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                       pt.geom::geography
                   ) as distance_meters
            FROM power_transformers pt
            WHERE ST_DWithin(
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
                pt.geom::geography,
                $3
            )
            ORDER BY distance_meters
        `;

        const result = await db.query(query, [latitude, longitude, radiusMeters]);
        return result.rows.map(row => ({
            ...new PowerTransformer(row),
            distance_meters: parseFloat(row.distance_meters)
        }));
    }

    // Получение статистики по трансформаторам
    static async getStatistics() {
        const query = `
            SELECT
                COUNT(*) as total_count,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count,
                COUNT(CASE WHEN status = 'maintenance' THEN 1 END) as maintenance_count,
                COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_count,
                AVG(capacity_kva) as avg_capacity,
                SUM(capacity_kva) as total_capacity,
                MIN(capacity_kva) as min_capacity,
                MAX(capacity_kva) as max_capacity
            FROM power_transformers
        `;

        const result = await db.query(query);
        return result.rows[0];
    }
}

module.exports = PowerTransformer;