const logger = require('../utils/logger');

// [Sprint 5 / P2-4] Case-insensitive dev check — the previous
// `process.env.NODE_ENV === 'development'` would miss `Development`,
// `DEVELOPMENT`, or stray whitespace. Re-read per call instead of caching
// at module load so tests that mutate NODE_ENV continue to work.
const isDev = () => (process.env.NODE_ENV || '').trim().toLowerCase() === 'development';

/**
 * Middleware для обработки ошибок
 */
const errorHandler = (err, req, res, next) => {
    // Логируем ошибку с correlation ID для трейсинга
    const correlationId = req.correlationId || 'unknown';
    logger.error(`[${correlationId}] Error: ${err.message}`);
    if (err.stack) {
        logger.debug(`[${correlationId}] ${err.stack}`);
    }

    // Устанавливаем статус ответа
    const statusCode = err.statusCode || 500;

    // Формируем ответ — для 500 ошибок никогда не раскрываем внутренние детали клиенту.
    // [N-52] Исключение — ошибка, явно помеченная `expose` (так делает отказ
    // открытого circuit breaker): её текст написан для клиента.
    const clientMessage = statusCode >= 500 && err.expose !== true
        ? 'Внутренняя ошибка сервера'
        : (err.message || 'Внутренняя ошибка сервера');

    if (Number.isFinite(err.retryAfterSeconds) && err.retryAfterSeconds > 0) {
        res.set('Retry-After', String(Math.ceil(err.retryAfterSeconds)));
    }

    const errorResponse = {
        success: false,
        error: {
            message: clientMessage,
            status: statusCode
        }
    };

    // В режиме разработки добавляем стек ошибки
    if (isDev() && err.stack) {
        errorResponse.error.stack = err.stack;
    }

    // Отправляем ответ
    res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;