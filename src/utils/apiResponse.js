/**
 * Стандартизированные утилиты API-ответов
 */

/**
 * [AR-4] Канонический конверт успеха: `{ success: true, data }`.
 *
 * Здесь отменено решение PR-3 (AUD-011) «ошибки в конверте, успех — сырым
 * телом». Оно продержалось до волны 3 и было снято сознательно: пока успех
 * возвращался в произвольной форме, фронт не мог написать одну распаковку
 * ответа и писал её заново на каждом вызове. `CO-8`-соседний пункт `CO-9`
 * («эти экспорты никем не вызываются») закрылся именно так — не удалением,
 * а введением конверта, которого раньше решили не вводить.
 *
 * Отмечено явно, потому что описание PR-3 в истории репозитория всё ещё
 * говорит про RAW success и без этой пометки противоречит коду.
 */
const sendSuccess = (res, data, { status = 200, pagination, message } = {}) => {
    const response = { success: true, data };
    if (pagination) response.pagination = pagination;
    if (message) response.message = message;
    return res.status(status).json(response);
};

/**
 * [AR-4] Канонический конверт ошибки: `error` — ВСЕГДА объект.
 *
 * Необязательные поля добавлены под две формы, которые иначе невозможно
 * выразить без потери смысла:
 *   - `details` — по-полевые ошибки валидации. Без них остаётся «Ошибка
 *     валидации» без указания поля, и пользователю нечего исправлять;
 *   - `code` — машинный код (RATE_LIMIT_EXCEEDED и т.п.). Именно отдельным
 *     полем, а НЕ перегрузкой ключа `error` строкой, как делал лимитер: один
 *     ключ в двух формах — это то, из-за чего фронт двадцатью способами гадал,
 *     что ему прислали;
 *   - `meta` — машинные подробности (лимит, retryAfter). Не для показа человеку.
 *
 * Пустые значения не добавляются: `details: []` в ответе — шум, который
 * потребителю приходится отличать от «деталей нет».
 */
const sendError = (res, statusCode, message, { details, code, meta } = {}) => {
    const error = { message, status: statusCode };
    if (code) error.code = code;
    if (Array.isArray(details) && details.length > 0) error.details = details;
    if (meta && Object.keys(meta).length > 0) error.meta = meta;

    return res.status(statusCode).json({ success: false, error });
};

const sendCreated = (res, data, message) => sendSuccess(res, data, { status: 201, message });

const sendNotFound = (res, message = 'Ресурс не найден') => sendError(res, 404, message);

module.exports = { sendSuccess, sendError, sendCreated, sendNotFound };
