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

    // Формируем ответ
    const errorResponse = {
        error: {
            message: err.message || 'Внутренняя ошибка сервера',
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