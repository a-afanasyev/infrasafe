/**
 * Создает объект ошибки с указанным статус-кодом HTTP
 * @param {string} message Сообщение об ошибке
 * @param {number} statusCode HTTP статус-код
 * @returns {Error} Объект ошибки с расширенными свойствами
 */
const createError = (message, statusCode = 500) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

/**
 * Валидация координат
 * @param {number} lat Широта
 * @param {number} lng Долгота
 * @returns {boolean} Результат валидации
 */
const validateCoordinates = (lat, lng) => {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

// Phase 9.2: YAGNI-005 (formatDateForDB) and YAGNI-006 (calculateBuildingStatus)
// removed — neither had a production caller. pg timestamptz handles Date
// values natively, and building status is now derived by the frontend or
// by alertService, not by this helper.

module.exports = {
    createError,
    validateCoordinates,
};
