const logger = require('../utils/logger');

// [Sprint 5 / P2-4] Case-insensitive dev check — the previous
// `process.env.NODE_ENV === 'development'` would miss `Development`,
// `DEVELOPMENT`, or stray whitespace. Re-read per call instead of caching
// at module load so tests that mutate NODE_ENV continue to work.
// Коды Postgres «значение не подходит типу»: invalid_text_representation и
// numeric_value_out_of_range.
const PG_BAD_PARAM_CODES = new Set(['22P02', '22003']);

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
    // [проверка за авторизацией 27.11.2026] Ошибки, причина которых — запрос
    // клиента, приходили сюда без статуса и уходили как 500:
    //   * сервисы помечают «сущности нет» кодом `*_NOT_FOUND`; часть
    //     контроллеров переводит его в 404 сама, часть просто зовёт next(error);
    //   * Postgres на нечисловое значение в числовом фильтре отвечает 22P02, на
    //     число вне диапазона — 22003 (запросы параметризованы, это не инъекция,
    //     но и не сбой сервера).
    // Явный statusCode ошибки главнее; текст СУБД клиенту не отдаётся.
    const isNotFoundCode = typeof err.code === 'string' && /_NOT_FOUND$/.test(err.code);
    const isBadParamValue = PG_BAD_PARAM_CODES.has(err.code);
    let statusCode = err.statusCode || 500;
    if (!err.statusCode && isNotFoundCode) statusCode = 404;
    if (!err.statusCode && isBadParamValue) statusCode = 400;

    // Формируем ответ — для 500 ошибок никогда не раскрываем внутренние детали клиенту.
    // [N-52] Исключение — ошибка, явно помеченная `expose` (так делает отказ
    // открытого circuit breaker): её текст написан для клиента.
    // [пентест 26.11.2026] Ошибка разбора тела (body-parser): её message — текст
    // парсера с фрагментом присланного. Наружу — нейтральная фраза; подробность
    // уже ушла в лог строкой выше.
    const isBodyParseError = err.type === 'entity.parse.failed';
    let clientMessage = err.message || 'Внутренняя ошибка сервера';
    if (isBodyParseError) {
        clientMessage = 'Некорректный JSON в теле запроса';
    } else if (!err.statusCode && isBadParamValue) {
        clientMessage = 'Некорректное значение параметра запроса';
    } else if (statusCode >= 500 && err.expose !== true) {
        clientMessage = 'Внутренняя ошибка сервера';
    }

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

    // [N-63] Машинный код и подробности — только для клиентских (4xx) ошибок,
    // которые их явно несут: по ним фронт строит диалог, а не гадает по тексту.
    // У 5xx не отдаются никогда — там они были бы утечкой внутренностей.
    if (statusCode < 500) {
        if (err.apiCode) errorResponse.error.code = err.apiCode;
        if (err.apiMeta && typeof err.apiMeta === 'object') errorResponse.error.meta = err.apiMeta;
    }

    // В режиме разработки добавляем стек ошибки
    if (isDev() && err.stack) {
        errorResponse.error.stack = err.stack;
    }

    // Отправляем ответ
    res.status(statusCode).json(errorResponse);
};

module.exports = errorHandler;