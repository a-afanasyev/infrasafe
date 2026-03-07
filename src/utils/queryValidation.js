/**
 * Модуль валидации запросов для предотвращения SQL Injection
 * 
 * Этот модуль обеспечивает безопасную валидацию параметров сортировки
 * и других пользовательских входных данных для предотвращения SQL-инъекций.
 * 
 * @author Security Team
 * @date 2025-01-16
 * @version 1.0.0
 */

const logger = require('./logger');

/**
 * Whitelist допустимых колонок для сортировки по типам сущностей
 * Только эти колонки могут быть использованы в ORDER BY запросах
 */
const allowedSortColumns = {
    // Здания
    buildings: [
        'building_id', 'name', 'address', 'town', 'region', 
        'management_company', 'floors', 'entrances', 'apartments',
        'construction_year', 'created_at', 'updated_at'
    ],
    
    // IoT Контроллеры
    controllers: [
        'controller_id', 'building_id', 'serial_number', 'model',
        'status', 'last_seen', 'firmware_version', 'location',
        'created_at', 'updated_at'
    ],
    
    // Метрики телеметрии
    metrics: [
        'metric_id', 'controller_id', 'timestamp', 'metric_type',
        'value', 'unit', 'status', 'created_at'
    ],
    
    // Трансформаторы
    transformers: [
        'transformer_id', 'name', 'power_kva', 'voltage_kv', 
        'building_id', 'status', 'location', 'installation_date',
        'created_at', 'updated_at', 'id'
    ],
    
    // Линии электропередач
    lines: [
        'line_id', 'name', 'voltage_kv', 'length_km', 'status', 
        'transformer_id', 'cable_type', 'installation_date',
        'created_at', 'updated_at', 'id'
    ],
    
    // Водные линии
    water_lines: [
        'line_id', 'name', 'pressure_bar', 'status',
        'diameter_mm', 'material', 'installation_date',
        'created_at', 'updated_at'
    ],
    
    // Источники воды
    water_sources: [
        'id', 'name', 'source_type', 'capacity_m3_per_hour', 'status',
        'operating_pressure_bar', 'latitude', 'longitude', 'address',
        'created_at', 'updated_at'
    ],
    
    // Источники тепла
    heat_sources: [
        'id', 'name', 'source_type', 'capacity_mw', 'status',
        'fuel_type', 'latitude', 'longitude', 'address',
        'created_at', 'updated_at'
    ],
    
    // Алерты и уведомления
    alerts: [
        'alert_id', 'severity', 'status', 'created_at', 'resolved_at',
        'alert_type_id', 'metric_id', 'message', 'acknowledged_at'
    ]
};

/**
 * Whitelist допустимых направлений сортировки
 */
const allowedOrderDirections = ['ASC', 'DESC'];

/**
 * Дефолтные параметры сортировки для каждого типа сущности
 */
const defaultSortParams = {
    buildings: { column: 'building_id', order: 'ASC' },
    controllers: { column: 'controller_id', order: 'ASC' },
    metrics: { column: 'timestamp', order: 'DESC' },
    transformers: { column: 'transformer_id', order: 'ASC' },
    lines: { column: 'line_id', order: 'ASC' },
    water_lines: { column: 'line_id', order: 'ASC' },
    water_sources: { column: 'id', order: 'ASC' },
    heat_sources: { column: 'id', order: 'ASC' },
    alerts: { column: 'created_at', order: 'DESC' }
};

/**
 * Валидирует и возвращает безопасные параметры сортировки
 * 
 * @param {string} entityType - тип сущности (buildings, controllers, etc.)
 * @param {string} sort - колонка для сортировки от пользователя
 * @param {string} order - направление сортировки от пользователя
 * @returns {Object} объект с безопасными validSort и validOrder
 * 
 * @example
 * const { validSort, validOrder } = validateSortOrder('buildings', 'name', 'desc');
 * // validSort = 'name', validOrder = 'DESC'
 * 
 * const { validSort, validOrder } = validateSortOrder('buildings', 'malicious_column', 'desc');
 * // validSort = 'building_id' (дефолтная), validOrder = 'DESC'
 */
function validateSortOrder(entityType, sort, order) {
    try {
        // Проверяем, что тип сущности поддерживается
        if (!allowedSortColumns[entityType]) {
            logger.warn(`Неподдерживаемый тип сущности: ${entityType}. Используем дефолтные параметры.`);
            return {
                validSort: 'id',
                validOrder: 'ASC'
            };
        }

        // Получаем списки допустимых значений для данного типа
        const allowedColumns = allowedSortColumns[entityType];
        const defaultParams = defaultSortParams[entityType];

        // Валидируем колонку сортировки
        let validSort;
        if (sort && allowedColumns.includes(sort)) {
            validSort = sort;
        } else {
            if (sort && sort !== defaultParams.column) {
                logger.warn(`Недопустимая колонка сортировки '${sort}' для ${entityType}. Используем '${defaultParams.column}'.`);
            }
            validSort = defaultParams.column;
        }

        // Валидируем направление сортировки
        let validOrder;
        if (order && allowedOrderDirections.includes(order.toUpperCase())) {
            validOrder = order.toUpperCase();
        } else {
            if (order && !allowedOrderDirections.includes(order.toUpperCase())) {
                logger.warn(`Недопустимое направление сортировки '${order}'. Используем '${defaultParams.order}'.`);
            }
            validOrder = defaultParams.order;
        }

        // Логируем успешную валидацию
        logger.debug(`Валидация сортировки для ${entityType}: ${validSort} ${validOrder}`);

        return {
            validSort,
            validOrder
        };

    } catch (error) {
        logger.error(`Ошибка валидации параметров сортировки: ${error.message}`);
        
        // В случае ошибки возвращаем безопасные дефолтные значения
        return {
            validSort: 'id',
            validOrder: 'ASC'
        };
    }
}

/**
 * Валидирует параметры пагинации
 * 
 * @param {number|string} page - номер страницы
 * @param {number|string} limit - количество элементов на странице
 * @returns {Object} объект с валидными pageNum и limitNum
 */
function validatePagination(page, limit) {
    try {
        // Валидация номера страницы
        const pageNum = Math.max(1, parseInt(page) || 1);
        
        // Валидация лимита с ограничением максимального значения
        let limitNum = parseInt(limit) || 50;
        limitNum = Math.min(Math.max(1, limitNum), 200); // от 1 до 200
        
        return {
            pageNum,
            limitNum,
            offset: (pageNum - 1) * limitNum
        };
        
    } catch (error) {
        logger.error(`Ошибка валидации пагинации: ${error.message}`);
        return {
            pageNum: 1,
            limitNum: 50,
            offset: 0
        };
    }
}

/**
 * Валидирует строковые параметры поиска для предотвращения XSS и SQL injection
 * 
 * @param {string} searchString - строка поиска от пользователя
 * @param {number} maxLength - максимальная длина строки (по умолчанию 100)
 * @returns {string} очищенная строка поиска
 */
function validateSearchString(searchString, maxLength = 100) {
    if (!searchString || typeof searchString !== 'string') {
        return '';
    }
    
    try {
        // Удаляем потенциально опасные символы
        let cleanString = searchString
            .replace(/[<>\"'%;()&+]/g, '') // Удаляем HTML и SQL метасимволы
            .replace(/script/gi, '') // Удаляем слово "script"
            .replace(/javascript/gi, '') // Удаляем "javascript"
            .replace(/on\w+=/gi, '') // Удаляем event handlers
            .trim();
        
        // Ограничиваем длину
        if (cleanString.length > maxLength) {
            cleanString = cleanString.substring(0, maxLength);
            logger.warn(`Строка поиска обрезана до ${maxLength} символов`);
        }
        
        return cleanString;
        
    } catch (error) {
        logger.error(`Ошибка валидации строки поиска: ${error.message}`);
        return '';
    }
}

/**
 * Создает безопасный SQL запрос с валидированными параметрами
 * 
 * @param {string} baseQuery - базовый SQL запрос
 * @param {string} entityType - тип сущности
 * @param {Object} params - параметры запроса
 * @returns {Object} объект с query и параметрами
 */
function buildSecureQuery(baseQuery, entityType, params = {}) {
    try {
        const { sort, order, page, limit } = params;
        
        // Валидируем параметры
        const { validSort, validOrder } = validateSortOrder(entityType, sort, order);
        const { pageNum, limitNum, offset } = validatePagination(page, limit);
        
        // Строим безопасный запрос
        const secureQuery = `${baseQuery} ORDER BY ${validSort} ${validOrder} LIMIT $${params.length || 1} OFFSET $${(params.length || 1) + 1}`;
        
        return {
            query: secureQuery,
            validSort,
            validOrder,
            pageNum,
            limitNum,
            offset,
            queryParams: [limitNum, offset]
        };
        
    } catch (error) {
        logger.error(`Ошибка построения безопасного запроса: ${error.message}`);
        throw new Error('Не удалось построить безопасный SQL запрос');
    }
}

module.exports = {
    validateSortOrder,
    validatePagination,
    validateSearchString,
    buildSecureQuery,
    allowedSortColumns,
    allowedOrderDirections,
    defaultSortParams
};
