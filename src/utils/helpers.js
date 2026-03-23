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
 * Форматирование даты для SQL запросов
 * @param {Date} date Объект даты
 * @returns {string} Отформатированная строка даты
 */
const formatDateForDB = (date = new Date()) => {
    return date.toISOString().slice(0, 19).replace('T', ' ');
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

/**
 * Проверка статуса здания на основе метрик
 * @param {Object} metrics Объект с метриками
 * @returns {string} Статус здания
 */
const calculateBuildingStatus = (metrics) => {
    const {
        electricity_ph1,
        electricity_ph2,
        electricity_ph3,
        cold_water_pressure,
        hot_water_in_pressure
    } = metrics;

    // Проверка критического состояния
    if (electricity_ph1 === 0 && electricity_ph2 === 0 && electricity_ph3 === 0) {
        return 'critical';
    }

    // Проверка предупреждений
    const isPhase1Ok = electricity_ph1 >= 210 && electricity_ph1 <= 230;
    const isPhase2Ok = electricity_ph2 >= 210 && electricity_ph2 <= 230;
    const isPhase3Ok = electricity_ph3 >= 210 && electricity_ph3 <= 230;
    const isWaterPressureOk = cold_water_pressure > 0 && hot_water_in_pressure > 0;

    if (!isPhase1Ok || !isPhase2Ok || !isPhase3Ok || !isWaterPressureOk) {
        return 'warning';
    }

    // Все показатели в норме
    return 'ok';
};

module.exports = {
    createError,
    formatDateForDB,
    validateCoordinates,
    calculateBuildingStatus
};