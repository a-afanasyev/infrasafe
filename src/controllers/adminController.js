const pool = require('../config/database');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

class AdminController {

    // Оптимизированное получение зданий
    async getOptimizedBuildings(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                sort = 'building_id',
                order = 'asc',
                search,
                town,
                region,
                management_company
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
            const offset = (pageNum - 1) * limitNum;

            let query = 'SELECT * FROM buildings';
            let countQuery = 'SELECT COUNT(*) FROM buildings';
            let params = [];
            let whereConditions = [];

            if (search) {
                whereConditions.push('name ILIKE $' + (params.length + 1));
                params.push(`%${search}%`);
            }
            if (town) {
                whereConditions.push('town = $' + (params.length + 1));
                params.push(town);
            }
            if (region) {
                whereConditions.push('region = $' + (params.length + 1));
                params.push(region);
            }
            if (management_company) {
                whereConditions.push('management_company = $' + (params.length + 1));
                params.push(management_company);
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            query += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedBuildings: ${error.message}`);
            next(createError(`Failed to get buildings: ${error.message}`, 500));
        }
    }

    // Оптимизированное получение контроллеров
    async getOptimizedControllers(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                sort = 'controller_id',
                order = 'asc',
                search,
                status,
                manufacturer,
                building_id
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
            const offset = (pageNum - 1) * limitNum;

            let query = 'SELECT * FROM controllers';
            let countQuery = 'SELECT COUNT(*) FROM controllers';
            let params = [];
            let whereConditions = [];

            if (search) {
                whereConditions.push('serial_number ILIKE $' + (params.length + 1));
                params.push(`%${search}%`);
            }
            if (status) {
                whereConditions.push('status = $' + (params.length + 1));
                params.push(status);
            }
            if (manufacturer) {
                whereConditions.push('manufacturer = $' + (params.length + 1));
                params.push(manufacturer);
            }
            if (building_id) {
                whereConditions.push('building_id = $' + (params.length + 1));
                params.push(building_id);
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            query += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedControllers: ${error.message}`);
            next(createError(`Failed to get controllers: ${error.message}`, 500));
        }
    }

    // Оптимизированное получение метрик
    async getOptimizedMetrics(req, res, next) {
        try {
            const {
                page = 1,
                limit = 100,
                sort = 'timestamp',
                order = 'desc',
                controller_id,
                start_date,
                end_date
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 500);
            const offset = (pageNum - 1) * limitNum;

            let query = 'SELECT * FROM metrics';
            let countQuery = 'SELECT COUNT(*) FROM metrics';
            let params = [];
            let whereConditions = [];

            if (controller_id) {
                whereConditions.push('controller_id = $' + (params.length + 1));
                params.push(controller_id);
            }
            if (start_date) {
                whereConditions.push('timestamp >= $' + (params.length + 1));
                params.push(start_date);
            }
            if (end_date) {
                whereConditions.push('timestamp <= $' + (params.length + 1));
                params.push(end_date);
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            query += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedMetrics: ${error.message}`);
            next(createError(`Failed to get metrics: ${error.message}`, 500));
        }
    }

    // Batch операции с зданиями
    async batchBuildingsOperation(req, res, next) {
        try {
            const { action, ids } = req.body;
            res.json({
                success: true,
                message: `Batch ${action} completed (stub)`,
                affected: ids ? ids.length : 0
            });
        } catch (error) {
            next(createError('Batch operation failed', 500));
        }
    }

    // Batch операции с контроллерами
    async batchControllersOperation(req, res, next) {
        try {
            const { action, ids } = req.body;
            res.json({
                success: true,
                message: `Batch ${action} completed (stub)`,
                affected: ids ? ids.length : 0
            });
        } catch (error) {
            next(createError('Batch operation failed', 500));
        }
    }

    // Batch операции с метриками
    async batchMetricsOperation(req, res, next) {
        try {
            const { action } = req.body;
            res.json({
                success: true,
                message: `Batch ${action} completed (stub)`,
                affected: 0
            });
        } catch (error) {
            next(createError('Batch operation failed', 500));
        }
    }

    // Глобальный поиск
    async globalSearch(req, res, next) {
        try {
            const { query, type = 'all', limit = 50 } = req.query;
            res.json({
                results: [],
                total: 0,
                query,
                type,
                message: 'Search completed (stub)'
            });
        } catch (error) {
            next(createError('Search failed', 500));
        }
    }

    // Статистика админки
    async getAdminStats(req, res, next) {
        try {
            const stats = {
                buildings: { total: 17, active: 10 },
                controllers: { total: 15, active: 8, offline: 3, maintenance: 4 },
                metrics: { total: 1000, today: 50 },
                message: 'Stats generated (stub)'
            };
            res.json(stats);
        } catch (error) {
            next(createError('Failed to get stats', 500));
        }
    }

    // Экспорт данных
    async exportData(req, res, next) {
        try {
            const { type, format } = req.body;
            res.json({
                success: true,
                message: `Export ${type} in ${format} initiated (stub)`,
                downloadUrl: '/api/admin/download/export-123.csv'
            });
        } catch (error) {
            next(createError('Export failed', 500));
        }
    }

    // ===== ТРАНСФОРМАТОРЫ =====

    // Оптимизированное получение трансформаторов
    async getOptimizedTransformers(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                sort = 'transformer_id',
                order = 'asc',
                search,
                power_min,
                power_max,
                voltage_kv,
                building_id
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
            const offset = (pageNum - 1) * limitNum;

            let query = 'SELECT t.*, b.name as building_name FROM transformers t LEFT JOIN buildings b ON t.building_id = b.building_id';
            let countQuery = 'SELECT COUNT(*) FROM transformers t LEFT JOIN buildings b ON t.building_id = b.building_id';
            let params = [];
            let whereConditions = [];

            if (search) {
                whereConditions.push('t.name ILIKE $' + (params.length + 1));
                params.push(`%${search}%`);
            }
            if (power_min) {
                whereConditions.push('t.power_kva >= $' + (params.length + 1));
                params.push(power_min);
            }
            if (power_max) {
                whereConditions.push('t.power_kva <= $' + (params.length + 1));
                params.push(power_max);
            }
            if (voltage_kv) {
                whereConditions.push('t.voltage_kv = $' + (params.length + 1));
                params.push(voltage_kv);
            }
            if (building_id) {
                whereConditions.push('t.building_id = $' + (params.length + 1));
                params.push(building_id);
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            // Исправляем сортировку для transformer_id (для обратной совместимости)
            const sortField = sort === 'id' ? 'transformer_id' : sort;
            query += ` ORDER BY t.${sortField} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedTransformers: ${error.message}`);
            next(createError(`Failed to get transformers: ${error.message}`, 500));
        }
    }

    // Создание трансформатора
    async createTransformer(req, res, next) {
        try {
            const { name, power_kva, voltage_kv, building_id } = req.body;

            if (!name || !power_kva || !voltage_kv) {
                return next(createError('Name, power_kva and voltage_kv are required', 400));
            }

            const query = `
                INSERT INTO transformers (name, power_kva, voltage_kv, building_id)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;

            const result = await pool.query(query, [name, power_kva, voltage_kv, building_id]);

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Transformer created successfully'
            });

        } catch (error) {
            logger.error(`Error in createTransformer: ${error.message}`);
            next(createError(`Failed to create transformer: ${error.message}`, 500));
        }
    }

    // Получение трансформатора по ID
    async getTransformerById(req, res, next) {
        try {
            const { id } = req.params;

            const query = `
                SELECT t.*, b.name as building_name
                FROM transformers t
                LEFT JOIN buildings b ON t.building_id = b.building_id
                WHERE t.transformer_id = $1
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Transformer not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            logger.error(`Error in getTransformerById: ${error.message}`);
            next(createError(`Failed to get transformer: ${error.message}`, 500));
        }
    }

    // Обновление трансформатора
    async updateTransformer(req, res, next) {
        try {
            const { id } = req.params;
            const { name, power_kva, voltage_kv, building_id } = req.body;

            const updateFields = [];
            const params = [];
            let paramIndex = 1;

            if (name !== undefined) {
                updateFields.push(`name = $${paramIndex++}`);
                params.push(name);
            }
            if (power_kva !== undefined) {
                updateFields.push(`power_kva = $${paramIndex++}`);
                params.push(power_kva);
            }
            if (voltage_kv !== undefined) {
                updateFields.push(`voltage_kv = $${paramIndex++}`);
                params.push(voltage_kv);
            }
            if (building_id !== undefined) {
                updateFields.push(`building_id = $${paramIndex++}`);
                params.push(building_id);
            }

            if (updateFields.length === 0) {
                return next(createError('No fields to update', 400));
            }

            updateFields.push(`updated_at = NOW()`);
            params.push(id);

            const query = `
                UPDATE transformers
                SET ${updateFields.join(', ')}
                WHERE transformer_id = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return next(createError('Transformer not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Transformer updated successfully'
            });

        } catch (error) {
            logger.error(`Error in updateTransformer: ${error.message}`);
            next(createError(`Failed to update transformer: ${error.message}`, 500));
        }
    }

    // Удаление трансформатора
    async deleteTransformer(req, res, next) {
        try {
            const { id } = req.params;

            const query = 'DELETE FROM transformers WHERE transformer_id = $1 RETURNING *';
            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Transformer not found', 404));
            }

            res.json({
                success: true,
                message: 'Transformer deleted successfully'
            });

        } catch (error) {
            logger.error(`Error in deleteTransformer: ${error.message}`);
            next(createError(`Failed to delete transformer: ${error.message}`, 500));
        }
    }

    // Batch операции с трансформаторами
    async batchTransformersOperation(req, res, next) {
        try {
            const { action, ids, data } = req.body;

            if (!action || !ids || !Array.isArray(ids)) {
                return next(createError('Action and ids array are required', 400));
            }

            let result;
            switch (action) {
                case 'delete':
                    const deleteQuery = 'DELETE FROM transformers WHERE transformer_id = ANY($1) RETURNING transformer_id';
                    result = await pool.query(deleteQuery, [ids]);
                    break;

                case 'update_voltage':
                    if (!data || !data.voltage_kv) {
                        return next(createError('voltage_kv is required for update_voltage action', 400));
                    }
                    const updateVoltageQuery = 'UPDATE transformers SET voltage_kv = $1, updated_at = NOW() WHERE transformer_id = ANY($2) RETURNING transformer_id';
                    result = await pool.query(updateVoltageQuery, [data.voltage_kv, ids]);
                    break;

                case 'update_power':
                    if (!data || !data.power_kva) {
                        return next(createError('power_kva is required for update_power action', 400));
                    }
                    const updatePowerQuery = 'UPDATE transformers SET power_kva = $1, updated_at = NOW() WHERE transformer_id = ANY($2) RETURNING transformer_id';
                    result = await pool.query(updatePowerQuery, [data.power_kva, ids]);
                    break;

                default:
                    return next(createError(`Unknown action: ${action}`, 400));
            }

            res.json({
                success: true,
                message: `Batch ${action} completed`,
                affected: result.rows.length
            });

        } catch (error) {
            logger.error(`Error in batchTransformersOperation: ${error.message}`);
            next(createError(`Batch operation failed: ${error.message}`, 500));
        }
    }

    // ===== ЛИНИИ ЭЛЕКТРОПЕРЕДАЧ =====

    // Оптимизированное получение линий
    async getOptimizedLines(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                sort = 'line_id',
                order = 'asc',
                search,
                voltage_min,
                voltage_max,
                length_min,
                length_max,
                transformer_id
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
            const offset = (pageNum - 1) * limitNum;

            let query = 'SELECT l.*, t.name as transformer_name FROM lines l LEFT JOIN transformers t ON l.transformer_id = t.transformer_id';
            let countQuery = 'SELECT COUNT(*) FROM lines l LEFT JOIN transformers t ON l.transformer_id = t.transformer_id';
            let params = [];
            let whereConditions = [];

            if (search) {
                whereConditions.push('l.name ILIKE $' + (params.length + 1));
                params.push(`%${search}%`);
            }
            if (voltage_min) {
                whereConditions.push('l.voltage_kv >= $' + (params.length + 1));
                params.push(voltage_min);
            }
            if (voltage_max) {
                whereConditions.push('l.voltage_kv <= $' + (params.length + 1));
                params.push(voltage_max);
            }
            if (length_min) {
                whereConditions.push('l.length_km >= $' + (params.length + 1));
                params.push(length_min);
            }
            if (length_max) {
                whereConditions.push('l.length_km <= $' + (params.length + 1));
                params.push(length_max);
            }
            if (transformer_id) {
                whereConditions.push('l.transformer_id = $' + (params.length + 1));
                params.push(transformer_id);
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            // Исправляем сортировку для line_id (для обратной совместимости)
            const sortField = sort === 'id' ? 'line_id' : sort;
            query += ` ORDER BY l.${sortField} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedLines: ${error.message}`);
            next(createError(`Failed to get lines: ${error.message}`, 500));
        }
    }

    // Создание линии
    async createLine(req, res, next) {
        try {
            const { name, voltage_kv, length_km, transformer_id } = req.body;

            if (!name || !voltage_kv || !length_km) {
                return next(createError('Name, voltage_kv and length_km are required', 400));
            }

            const query = `
                INSERT INTO lines (name, voltage_kv, length_km, transformer_id)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;

            const result = await pool.query(query, [name, voltage_kv, length_km, transformer_id]);

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Line created successfully'
            });

        } catch (error) {
            logger.error(`Error in createLine: ${error.message}`);
            next(createError(`Failed to create line: ${error.message}`, 500));
        }
    }

    // Получение линии по ID
    async getLineById(req, res, next) {
        try {
            const { id } = req.params;

            const query = `
                SELECT l.*, t.name as transformer_name
                FROM lines l
                LEFT JOIN transformers t ON l.transformer_id = t.transformer_id
                WHERE l.line_id = $1
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Line not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            logger.error(`Error in getLineById: ${error.message}`);
            next(createError(`Failed to get line: ${error.message}`, 500));
        }
    }

    // Обновление линии
    async updateLine(req, res, next) {
        try {
            const { id } = req.params;
            const { name, voltage_kv, length_km, transformer_id } = req.body;

            const updateFields = [];
            const params = [];
            let paramIndex = 1;

            if (name !== undefined) {
                updateFields.push(`name = $${paramIndex++}`);
                params.push(name);
            }
            if (voltage_kv !== undefined) {
                updateFields.push(`voltage_kv = $${paramIndex++}`);
                params.push(voltage_kv);
            }
            if (length_km !== undefined) {
                updateFields.push(`length_km = $${paramIndex++}`);
                params.push(length_km);
            }
            if (transformer_id !== undefined) {
                updateFields.push(`transformer_id = $${paramIndex++}`);
                params.push(transformer_id);
            }

            if (updateFields.length === 0) {
                return next(createError('No fields to update', 400));
            }

            updateFields.push(`updated_at = NOW()`);
            params.push(id);

            const query = `
                UPDATE lines
                SET ${updateFields.join(', ')}
                WHERE line_id = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return next(createError('Line not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Line updated successfully'
            });

        } catch (error) {
            logger.error(`Error in updateLine: ${error.message}`);
            next(createError(`Failed to update line: ${error.message}`, 500));
        }
    }

    // Удаление линии
    async deleteLine(req, res, next) {
        try {
            const { id } = req.params;

            const query = 'DELETE FROM lines WHERE line_id = $1 RETURNING *';
            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Line not found', 404));
            }

            res.json({
                success: true,
                message: 'Line deleted successfully'
            });

        } catch (error) {
            logger.error(`Error in deleteLine: ${error.message}`);
            next(createError(`Failed to delete line: ${error.message}`, 500));
        }
    }

    // Batch операции с линиями
    async batchLinesOperation(req, res, next) {
        try {
            const { action, ids, data } = req.body;

            if (!action || !ids || !Array.isArray(ids)) {
                return next(createError('Action and ids array are required', 400));
            }

            let result;
            switch (action) {
                case 'delete':
                    const deleteQuery = 'DELETE FROM lines WHERE line_id = ANY($1) RETURNING line_id';
                    result = await pool.query(deleteQuery, [ids]);
                    break;

                case 'update_voltage':
                    if (!data || !data.voltage_kv) {
                        return next(createError('voltage_kv is required for update_voltage action', 400));
                    }
                    const updateVoltageQuery = 'UPDATE lines SET voltage_kv = $1, updated_at = NOW() WHERE line_id = ANY($2) RETURNING line_id';
                    result = await pool.query(updateVoltageQuery, [data.voltage_kv, ids]);
                    break;

                case 'set_maintenance':
                    if (!data || !data.maintenance_date) {
                        return next(createError('maintenance_date is required for set_maintenance action', 400));
                    }
                    const maintenanceQuery = 'UPDATE lines SET maintenance_date = $1, updated_at = NOW() WHERE line_id = ANY($2) RETURNING line_id';
                    result = await pool.query(maintenanceQuery, [data.maintenance_date, ids]);
                    break;

                default:
                    return next(createError(`Unknown action: ${action}`, 400));
            }

            res.json({
                success: true,
                message: `Batch ${action} completed`,
                affected: result.rows.length
            });

        } catch (error) {
            logger.error(`Error in batchLinesOperation: ${error.message}`);
            next(createError(`Batch operation failed: ${error.message}`, 500));
        }
    }

    // ===============================================
    // МЕТОДЫ ДЛЯ ЛИНИЙ ВОДОСНАБЖЕНИЯ
    // ===============================================

    // Оптимизированное получение линий водоснабжения
    async getOptimizedWaterLines(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                sort = 'line_id',
                order = 'asc',
                search,
                type,
                status,
                material,
                diameter_min,
                diameter_max
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
            const offset = (pageNum - 1) * limitNum;

            let query = `
                SELECT wl.*,
                       COUNT(DISTINCT b.building_id) as connected_buildings_count,
                       ARRAY_AGG(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as connected_buildings
                FROM water_lines wl
                LEFT JOIN buildings b ON (wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id)
            `;
            let countQuery = 'SELECT COUNT(*) FROM water_lines wl';
            let params = [];
            let whereConditions = [];

            if (search) {
                whereConditions.push('wl.name ILIKE $' + (params.length + 1));
                params.push(`%${search}%`);
            }
            if (type) {
                whereConditions.push('wl.name ILIKE $' + (params.length + 1));
                params.push(`%${type}%`);
            }
            if (status) {
                whereConditions.push('wl.status = $' + (params.length + 1));
                params.push(status);
            }
            if (material) {
                whereConditions.push('wl.material ILIKE $' + (params.length + 1));
                params.push(`%${material}%`);
            }
            if (diameter_min) {
                whereConditions.push('wl.diameter_mm >= $' + (params.length + 1));
                params.push(parseInt(diameter_min));
            }
            if (diameter_max) {
                whereConditions.push('wl.diameter_mm <= $' + (params.length + 1));
                params.push(parseInt(diameter_max));
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            query += ` GROUP BY wl.line_id ORDER BY wl.${sort} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedWaterLines: ${error.message}`);
            next(createError(`Failed to get water lines: ${error.message}`, 500));
        }
    }

    // Создание новой линии водоснабжения
    async createWaterLine(req, res, next) {
        try {
            const {
                name,
                description,
                diameter_mm,
                material,
                pressure_rating,
                installation_date,
                length_km,
                line_type,
                supplier_id,
                status = 'active'
            } = req.body;

            if (!name || !diameter_mm || !material) {
                return next(createError('Name, diameter_mm, and material are required', 400));
            }

            const query = `
                INSERT INTO water_lines (name, description, diameter_mm, material, pressure_rating, installation_date, length_km, line_type, supplier_id, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
            `;

            const result = await pool.query(query, [
                name, description, diameter_mm, material, pressure_rating, installation_date, length_km, line_type, supplier_id, status
            ]);

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Water line created successfully'
            });

        } catch (error) {
            logger.error(`Error in createWaterLine: ${error.message}`);
            next(createError(`Failed to create water line: ${error.message}`, 500));
        }
    }

    // Получение линии водоснабжения по ID
    async getWaterLineById(req, res, next) {
        try {
            const { id } = req.params;

            const query = `
                SELECT wl.*,
                       COUNT(DISTINCT b.building_id) as connected_buildings_count,
                       ARRAY_AGG(DISTINCT b.name) FILTER (WHERE b.name IS NOT NULL) as connected_buildings
                FROM water_lines wl
                LEFT JOIN buildings b ON (wl.line_id = b.cold_water_line_id OR wl.line_id = b.hot_water_line_id)
                WHERE wl.line_id = $1
                GROUP BY wl.line_id
            `;

            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Water line not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            logger.error(`Error in getWaterLineById: ${error.message}`);
            next(createError(`Failed to get water line: ${error.message}`, 500));
        }
    }

    // Обновление линии водоснабжения
    async updateWaterLine(req, res, next) {
        try {
            const { id } = req.params;
            const {
                name,
                description,
                diameter_mm,
                material,
                pressure_rating,
                installation_date,
                length_km,
                line_type,
                supplier_id,
                status
            } = req.body;

            const updateFields = [];
            const params = [];
            let paramIndex = 1;

            if (name !== undefined) {
                updateFields.push(`name = $${paramIndex++}`);
                params.push(name);
            }
            if (description !== undefined) {
                updateFields.push(`description = $${paramIndex++}`);
                params.push(description);
            }
            if (diameter_mm !== undefined) {
                updateFields.push(`diameter_mm = $${paramIndex++}`);
                params.push(diameter_mm);
            }
            if (material !== undefined) {
                updateFields.push(`material = $${paramIndex++}`);
                params.push(material);
            }
            if (pressure_rating !== undefined) {
                updateFields.push(`pressure_rating = $${paramIndex++}`);
                params.push(pressure_rating);
            }
            if (installation_date !== undefined) {
                updateFields.push(`installation_date = $${paramIndex++}`);
                params.push(installation_date);
            }
            if (length_km !== undefined) {
                updateFields.push(`length_km = $${paramIndex++}`);
                params.push(length_km);
            }
            if (line_type !== undefined) {
                updateFields.push(`line_type = $${paramIndex++}`);
                params.push(line_type);
            }
            if (supplier_id !== undefined) {
                updateFields.push(`supplier_id = $${paramIndex++}`);
                params.push(supplier_id);
            }
            if (status !== undefined) {
                updateFields.push(`status = $${paramIndex++}`);
                params.push(status);
            }

            if (updateFields.length === 0) {
                return next(createError('No fields to update', 400));
            }

            updateFields.push(`updated_at = NOW()`);
            params.push(id);

            const query = `
                UPDATE water_lines
                SET ${updateFields.join(', ')}
                WHERE line_id = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return next(createError('Water line not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Water line updated successfully'
            });

        } catch (error) {
            logger.error(`Error in updateWaterLine: ${error.message}`);
            next(createError(`Failed to update water line: ${error.message}`, 500));
        }
    }

    // Удаление линии водоснабжения
    async deleteWaterLine(req, res, next) {
        try {
            const { id } = req.params;

            // Проверяем, есть ли связанные здания
            const checkQuery = 'SELECT COUNT(*) FROM buildings WHERE cold_water_line_id = $1 OR hot_water_line_id = $1';
            const checkResult = await pool.query(checkQuery, [id]);

            if (parseInt(checkResult.rows[0].count) > 0) {
                return next(createError('Cannot delete water line: it has connected buildings', 400));
            }

            const query = 'DELETE FROM water_lines WHERE line_id = $1 RETURNING *';
            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Water line not found', 404));
            }

            res.json({
                success: true,
                message: 'Water line deleted successfully'
            });

        } catch (error) {
            logger.error(`Error in deleteWaterLine: ${error.message}`);
            next(createError(`Failed to delete water line: ${error.message}`, 500));
        }
    }

    // Batch операции с линиями водоснабжения
    async batchWaterLinesOperation(req, res, next) {
        try {
            const { action, ids, data } = req.body;

            if (!action || !ids || !Array.isArray(ids)) {
                return next(createError('Action and ids array are required', 400));
            }

            let result;
            switch (action) {
                case 'delete':
                    // Проверяем, есть ли связанные здания
                    const checkQuery = 'SELECT building_id FROM buildings WHERE cold_water_line_id = ANY($1) OR hot_water_line_id = ANY($1)';
                    const checkResult = await pool.query(checkQuery, [ids]);

                    if (checkResult.rows.length > 0) {
                        return next(createError('Cannot delete water lines: some have connected buildings', 400));
                    }

                    const deleteQuery = 'DELETE FROM water_lines WHERE line_id = ANY($1) RETURNING line_id';
                    result = await pool.query(deleteQuery, [ids]);
                    break;

                case 'update_status':
                    if (!data || !data.status) {
                        return next(createError('status is required for update_status action', 400));
                    }
                    const updateStatusQuery = 'UPDATE water_lines SET status = $1, updated_at = NOW() WHERE line_id = ANY($2) RETURNING line_id';
                    result = await pool.query(updateStatusQuery, [data.status, ids]);
                    break;

                case 'set_maintenance':
                    const maintenanceQuery = 'UPDATE water_lines SET status = \'maintenance\', updated_at = NOW() WHERE line_id = ANY($1) RETURNING line_id';
                    result = await pool.query(maintenanceQuery, [ids]);
                    break;

                default:
                    return next(createError(`Unknown action: ${action}`, 400));
            }

            res.json({
                success: true,
                message: `Batch ${action} completed`,
                affected: result.rows.length
            });

        } catch (error) {
            logger.error(`Error in batchWaterLinesOperation: ${error.message}`);
            next(createError(`Batch operation failed: ${error.message}`, 500));
        }
    }

    // ===============================================
    // CRUD МЕТОДЫ ДЛЯ ЗДАНИЙ
    // ===============================================

    async createBuilding(req, res, next) {
        const buildingController = require('./buildingController');
        return buildingController.createBuilding(req, res, next);
    }

    async getBuildingById(req, res, next) {
        const buildingController = require('./buildingController');
        return buildingController.getBuildingById(req, res, next);
    }

    async updateBuilding(req, res, next) {
        const buildingController = require('./buildingController');
        return buildingController.updateBuilding(req, res, next);
    }

    async deleteBuilding(req, res, next) {
        const buildingController = require('./buildingController');
        return buildingController.deleteBuilding(req, res, next);
    }

    // ===============================================
    // CRUD МЕТОДЫ ДЛЯ КОНТРОЛЛЕРОВ
    // ===============================================

    async createController(req, res, next) {
        const controllerController = require('./controllerController');
        return controllerController.createController(req, res, next);
    }

    async getControllerById(req, res, next) {
        const controllerController = require('./controllerController');
        return controllerController.getControllerById(req, res, next);
    }

    async updateController(req, res, next) {
        const controllerController = require('./controllerController');
        return controllerController.updateController(req, res, next);
    }

    async deleteController(req, res, next) {
        const controllerController = require('./controllerController');
        return controllerController.deleteController(req, res, next);
    }

    // ===============================================
    // CRUD МЕТОДЫ ДЛЯ МЕТРИК
    // ===============================================

    async createMetric(req, res, next) {
        const metricController = require('./metricController');
        return metricController.createMetric(req, res, next);
    }

    async getMetricById(req, res, next) {
        const metricController = require('./metricController');
        return metricController.getMetricById(req, res, next);
    }

    async updateMetric(req, res, next) {
        const metricController = require('./metricController');
        return metricController.updateMetric(req, res, next);
    }

    async deleteMetric(req, res, next) {
        const metricController = require('./metricController');
        return metricController.deleteMetric(req, res, next);
    }

    // ===============================================
    // МЕТОДЫ ДЛЯ ИСТОЧНИКОВ ХОЛОДНОЙ ВОДЫ
    // ===============================================

    async getOptimizedColdWaterSources(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                sort = 'id',
                order = 'asc',
                search,
                source_type,
                status
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
            const offset = (pageNum - 1) * limitNum;

            let query = 'SELECT * FROM cold_water_sources';
            let countQuery = 'SELECT COUNT(*) FROM cold_water_sources';
            let params = [];
            let whereConditions = [];

            if (search) {
                whereConditions.push('name ILIKE $' + (params.length + 1));
                params.push(`%${search}%`);
            }
            if (source_type) {
                whereConditions.push('source_type = $' + (params.length + 1));
                params.push(source_type);
            }
            if (status) {
                whereConditions.push('status = $' + (params.length + 1));
                params.push(status);
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            query += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedColdWaterSources: ${error.message}`);
            next(createError(`Failed to get cold water sources: ${error.message}`, 500));
        }
    }

    async createColdWaterSource(req, res, next) {
        try {
            const {
                name, address, latitude, longitude, source_type,
                capacity_m3_per_hour, operating_pressure_bar, installation_date,
                status = 'active', maintenance_contact, notes
            } = req.body;

            if (!name) {
                return next(createError('Name is required', 400));
            }

            const query = `
                INSERT INTO cold_water_sources
                (id, name, address, latitude, longitude, source_type, capacity_m3_per_hour,
                 operating_pressure_bar, installation_date, status, maintenance_contact, notes)
                VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *
            `;

            const result = await pool.query(query, [
                name, address, latitude, longitude, source_type, capacity_m3_per_hour,
                operating_pressure_bar, installation_date, status, maintenance_contact, notes
            ]);

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Cold water source created successfully'
            });

        } catch (error) {
            logger.error(`Error in createColdWaterSource: ${error.message}`);
            next(createError(`Failed to create cold water source: ${error.message}`, 500));
        }
    }

    async getColdWaterSourceById(req, res, next) {
        try {
            const { id } = req.params;
            const result = await pool.query('SELECT * FROM cold_water_sources WHERE id = $1', [id]);

            if (result.rows.length === 0) {
                return next(createError('Cold water source not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            logger.error(`Error in getColdWaterSourceById: ${error.message}`);
            next(createError(`Failed to get cold water source: ${error.message}`, 500));
        }
    }

    async updateColdWaterSource(req, res, next) {
        try {
            const { id } = req.params;
            const {
                name, address, latitude, longitude, source_type,
                capacity_m3_per_hour, operating_pressure_bar, installation_date,
                status, maintenance_contact, notes
            } = req.body;

            const updateFields = [];
            const params = [];
            let paramIndex = 1;

            if (name !== undefined) {
                updateFields.push(`name = $${paramIndex++}`);
                params.push(name);
            }
            if (address !== undefined) {
                updateFields.push(`address = $${paramIndex++}`);
                params.push(address);
            }
            if (latitude !== undefined) {
                updateFields.push(`latitude = $${paramIndex++}`);
                params.push(latitude);
            }
            if (longitude !== undefined) {
                updateFields.push(`longitude = $${paramIndex++}`);
                params.push(longitude);
            }
            if (source_type !== undefined) {
                updateFields.push(`source_type = $${paramIndex++}`);
                params.push(source_type);
            }
            if (capacity_m3_per_hour !== undefined) {
                updateFields.push(`capacity_m3_per_hour = $${paramIndex++}`);
                params.push(capacity_m3_per_hour);
            }
            if (operating_pressure_bar !== undefined) {
                updateFields.push(`operating_pressure_bar = $${paramIndex++}`);
                params.push(operating_pressure_bar);
            }
            if (installation_date !== undefined) {
                updateFields.push(`installation_date = $${paramIndex++}`);
                params.push(installation_date);
            }
            if (status !== undefined) {
                updateFields.push(`status = $${paramIndex++}`);
                params.push(status);
            }
            if (maintenance_contact !== undefined) {
                updateFields.push(`maintenance_contact = $${paramIndex++}`);
                params.push(maintenance_contact);
            }
            if (notes !== undefined) {
                updateFields.push(`notes = $${paramIndex++}`);
                params.push(notes);
            }

            if (updateFields.length === 0) {
                return next(createError('No fields to update', 400));
            }

            params.push(id);

            const query = `
                UPDATE cold_water_sources
                SET ${updateFields.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return next(createError('Cold water source not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Cold water source updated successfully'
            });

        } catch (error) {
            logger.error(`Error in updateColdWaterSource: ${error.message}`);
            next(createError(`Failed to update cold water source: ${error.message}`, 500));
        }
    }

    async deleteColdWaterSource(req, res, next) {
        try {
            const { id } = req.params;

            const query = 'DELETE FROM cold_water_sources WHERE id = $1 RETURNING *';
            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Cold water source not found', 404));
            }

            res.json({
                success: true,
                message: 'Cold water source deleted successfully'
            });

        } catch (error) {
            logger.error(`Error in deleteColdWaterSource: ${error.message}`);
            next(createError(`Failed to delete cold water source: ${error.message}`, 500));
        }
    }

    // ===============================================
    // МЕТОДЫ ДЛЯ ИСТОЧНИКОВ ТЕПЛА
    // ===============================================

    async getOptimizedHeatSources(req, res, next) {
        try {
            const {
                page = 1,
                limit = 50,
                sort = 'id',
                order = 'asc',
                search,
                source_type,
                status
            } = req.query;

            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(Math.max(1, parseInt(limit)), 200);
            const offset = (pageNum - 1) * limitNum;

            let query = 'SELECT * FROM heat_sources';
            let countQuery = 'SELECT COUNT(*) FROM heat_sources';
            let params = [];
            let whereConditions = [];

            if (search) {
                whereConditions.push('name ILIKE $' + (params.length + 1));
                params.push(`%${search}%`);
            }
            if (source_type) {
                whereConditions.push('source_type = $' + (params.length + 1));
                params.push(source_type);
            }
            if (status) {
                whereConditions.push('status = $' + (params.length + 1));
                params.push(status);
            }

            if (whereConditions.length > 0) {
                const whereClause = ' WHERE ' + whereConditions.join(' AND ');
                query += whereClause;
                countQuery += whereClause;
            }

            query += ` ORDER BY ${sort} ${order.toUpperCase()} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limitNum, offset);

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, params),
                pool.query(countQuery, params.slice(0, -2))
            ]);

            const result = {
                data: dataResult.rows,
                pagination: {
                    total: parseInt(countResult.rows[0].count),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limitNum)
                }
            };

            res.json(result);

        } catch (error) {
            logger.error(`Error in getOptimizedHeatSources: ${error.message}`);
            next(createError(`Failed to get heat sources: ${error.message}`, 500));
        }
    }

    async createHeatSource(req, res, next) {
        try {
            const {
                name, address, latitude, longitude, source_type,
                capacity_mw, fuel_type, installation_date,
                status = 'active', maintenance_contact, notes
            } = req.body;

            if (!name || !latitude || !longitude || !source_type) {
                return next(createError('Name, latitude, longitude, and source_type are required', 400));
            }

            const query = `
                INSERT INTO heat_sources
                (id, name, address, latitude, longitude, source_type, capacity_mw,
                 fuel_type, installation_date, status, maintenance_contact, notes)
                VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *
            `;

            const result = await pool.query(query, [
                name, address, latitude, longitude, source_type, capacity_mw,
                fuel_type, installation_date, status, maintenance_contact, notes
            ]);

            res.status(201).json({
                success: true,
                data: result.rows[0],
                message: 'Heat source created successfully'
            });

        } catch (error) {
            logger.error(`Error in createHeatSource: ${error.message}`);
            next(createError(`Failed to create heat source: ${error.message}`, 500));
        }
    }

    async getHeatSourceById(req, res, next) {
        try {
            const { id } = req.params;
            const result = await pool.query('SELECT * FROM heat_sources WHERE id = $1', [id]);

            if (result.rows.length === 0) {
                return next(createError('Heat source not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            logger.error(`Error in getHeatSourceById: ${error.message}`);
            next(createError(`Failed to get heat source: ${error.message}`, 500));
        }
    }

    async updateHeatSource(req, res, next) {
        try {
            const { id } = req.params;
            const {
                name, address, latitude, longitude, source_type,
                capacity_mw, fuel_type, installation_date,
                status, maintenance_contact, notes
            } = req.body;

            const updateFields = [];
            const params = [];
            let paramIndex = 1;

            if (name !== undefined) {
                updateFields.push(`name = $${paramIndex++}`);
                params.push(name);
            }
            if (address !== undefined) {
                updateFields.push(`address = $${paramIndex++}`);
                params.push(address);
            }
            if (latitude !== undefined) {
                updateFields.push(`latitude = $${paramIndex++}`);
                params.push(latitude);
            }
            if (longitude !== undefined) {
                updateFields.push(`longitude = $${paramIndex++}`);
                params.push(longitude);
            }
            if (source_type !== undefined) {
                updateFields.push(`source_type = $${paramIndex++}`);
                params.push(source_type);
            }
            if (capacity_mw !== undefined) {
                updateFields.push(`capacity_mw = $${paramIndex++}`);
                params.push(capacity_mw);
            }
            if (fuel_type !== undefined) {
                updateFields.push(`fuel_type = $${paramIndex++}`);
                params.push(fuel_type);
            }
            if (installation_date !== undefined) {
                updateFields.push(`installation_date = $${paramIndex++}`);
                params.push(installation_date);
            }
            if (status !== undefined) {
                updateFields.push(`status = $${paramIndex++}`);
                params.push(status);
            }
            if (maintenance_contact !== undefined) {
                updateFields.push(`maintenance_contact = $${paramIndex++}`);
                params.push(maintenance_contact);
            }
            if (notes !== undefined) {
                updateFields.push(`notes = $${paramIndex++}`);
                params.push(notes);
            }

            if (updateFields.length === 0) {
                return next(createError('No fields to update', 400));
            }

            params.push(id);

            const query = `
                UPDATE heat_sources
                SET ${updateFields.join(', ')}
                WHERE id = $${paramIndex}
                RETURNING *
            `;

            const result = await pool.query(query, params);

            if (result.rows.length === 0) {
                return next(createError('Heat source not found', 404));
            }

            res.json({
                success: true,
                data: result.rows[0],
                message: 'Heat source updated successfully'
            });

        } catch (error) {
            logger.error(`Error in updateHeatSource: ${error.message}`);
            next(createError(`Failed to update heat source: ${error.message}`, 500));
        }
    }

    async deleteHeatSource(req, res, next) {
        try {
            const { id } = req.params;

            const query = 'DELETE FROM heat_sources WHERE id = $1 RETURNING *';
            const result = await pool.query(query, [id]);

            if (result.rows.length === 0) {
                return next(createError('Heat source not found', 404));
            }

            res.json({
                success: true,
                message: 'Heat source deleted successfully'
            });

        } catch (error) {
            logger.error(`Error in deleteHeatSource: ${error.message}`);
            next(createError(`Failed to delete heat source: ${error.message}`, 500));
        }
    }
}

const adminController = new AdminController();

module.exports = {
    getOptimizedBuildings: adminController.getOptimizedBuildings.bind(adminController),
    getOptimizedControllers: adminController.getOptimizedControllers.bind(adminController),
    getOptimizedMetrics: adminController.getOptimizedMetrics.bind(adminController),
    batchBuildingsOperation: adminController.batchBuildingsOperation.bind(adminController),
    batchControllersOperation: adminController.batchControllersOperation.bind(adminController),
    batchMetricsOperation: adminController.batchMetricsOperation.bind(adminController),
    globalSearch: adminController.globalSearch.bind(adminController),
    getAdminStats: adminController.getAdminStats.bind(adminController),
    exportData: adminController.exportData.bind(adminController),

    // CRUD для зданий
    createBuilding: adminController.createBuilding.bind(adminController),
    getBuildingById: adminController.getBuildingById.bind(adminController),
    updateBuilding: adminController.updateBuilding.bind(adminController),
    deleteBuilding: adminController.deleteBuilding.bind(adminController),

    // CRUD для контроллеров
    createController: adminController.createController.bind(adminController),
    getControllerById: adminController.getControllerById.bind(adminController),
    updateController: adminController.updateController.bind(adminController),
    deleteController: adminController.deleteController.bind(adminController),

    // CRUD для метрик
    createMetric: adminController.createMetric.bind(adminController),
    getMetricById: adminController.getMetricById.bind(adminController),
    updateMetric: adminController.updateMetric.bind(adminController),
    deleteMetric: adminController.deleteMetric.bind(adminController),

    // Трансформаторы
    getOptimizedTransformers: adminController.getOptimizedTransformers.bind(adminController),
    createTransformer: adminController.createTransformer.bind(adminController),
    getTransformerById: adminController.getTransformerById.bind(adminController),
    updateTransformer: adminController.updateTransformer.bind(adminController),
    deleteTransformer: adminController.deleteTransformer.bind(adminController),
    batchTransformersOperation: adminController.batchTransformersOperation.bind(adminController),

    // Линии электропередач
    getOptimizedLines: adminController.getOptimizedLines.bind(adminController),
    createLine: adminController.createLine.bind(adminController),
    getLineById: adminController.getLineById.bind(adminController),
    updateLine: adminController.updateLine.bind(adminController),
    deleteLine: adminController.deleteLine.bind(adminController),
    batchLinesOperation: adminController.batchLinesOperation.bind(adminController),

    // Линии водоснабжения
    getOptimizedWaterLines: adminController.getOptimizedWaterLines.bind(adminController),
    createWaterLine: adminController.createWaterLine.bind(adminController),
    getWaterLineById: adminController.getWaterLineById.bind(adminController),
    updateWaterLine: adminController.updateWaterLine.bind(adminController),
    deleteWaterLine: adminController.deleteWaterLine.bind(adminController),
    batchWaterLinesOperation: adminController.batchWaterLinesOperation.bind(adminController),

    // Источники холодной воды
    getOptimizedColdWaterSources: adminController.getOptimizedColdWaterSources.bind(adminController),
    createColdWaterSource: adminController.createColdWaterSource.bind(adminController),
    getColdWaterSourceById: adminController.getColdWaterSourceById.bind(adminController),
    updateColdWaterSource: adminController.updateColdWaterSource.bind(adminController),
    deleteColdWaterSource: adminController.deleteColdWaterSource.bind(adminController),

    // Источники тепла
    getOptimizedHeatSources: adminController.getOptimizedHeatSources.bind(adminController),
    createHeatSource: adminController.createHeatSource.bind(adminController),
    getHeatSourceById: adminController.getHeatSourceById.bind(adminController),
    updateHeatSource: adminController.updateHeatSource.bind(adminController),
    deleteHeatSource: adminController.deleteHeatSource.bind(adminController)
};