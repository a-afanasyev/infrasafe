const logger = require('../utils/logger');

/**
 * Middleware для обработки ошибок
 */
const errorHandler = (err, req, res, next) => {
    // Логируем ошибку
    logger.error(`Error: ${err.message}`);
    if (err.stack) {
        logger.debug(err.stack);
    }

    // Устанавливаем статус ответа
    const statusCode = err.statusCode || 500;

    // Формируем ответ — для 500 ошибок никогда не раскрываем внутренние детали клиенту
    const clientMessage = statusCode >= 500
        ? 'Внутренняя ошибка сервера'
        : (err.message || 'Внутренняя ошибка сервера');

    const errorResponse = {
        success: false,
        error: {
            message: clientMessage,
            status: statusCode
        }
    };

    // В режиме разработки добавляем стек ошибки
    if (process.env.NODE_ENV === 'development' && err.stack) {
        errorResponse.error.stack = err.stack;
    }

    // Отправляем ответ
    res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;