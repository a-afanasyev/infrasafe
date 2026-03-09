/**
 * Стандартизированные утилиты API-ответов
 */

const sendSuccess = (res, data, { status = 200, pagination, message } = {}) => {
    const response = { success: true, data };
    if (pagination) response.pagination = pagination;
    if (message) response.message = message;
    return res.status(status).json(response);
};

const sendError = (res, statusCode, message) => {
    return res.status(statusCode).json({
        success: false,
        error: { message, status: statusCode }
    });
};

const sendCreated = (res, data, message) => sendSuccess(res, data, { status: 201, message });

const sendNotFound = (res, message = 'Ресурс не найден') => sendError(res, 404, message);

module.exports = { sendSuccess, sendError, sendCreated, sendNotFound };
