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
    batchLinesOperation: adminController.batchLinesOperation.bind(adminController)
}; 