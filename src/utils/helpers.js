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
 * Несёт ли ошибка клиентский статус (4xx), то есть предназначена ли она
 * пользователю, а не в лог.
 *
 * [CO-10] Этот предикат существовал в двух байт-идентичных копиях —
 * `controllers/waterLineController.js` и `controllers/admin/adminWaterLineController.js`.
 * Обе удалены в пользу этой. Два потребителя нужны разные: тот, что отвечает
 * через `sendError`, использует сам предикат, тот, что уходит в `next()`, —
 * обёртку ниже.
 *
 * @param {Error} error
 * @returns {boolean}
 */
const isClientError = (error) =>
    Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500;

/**
 * [Новое №8] Ошибка для `next()` из catch контроллера.
 *
 * Пропускает вниз ошибку, которая уже несёт клиентский статус (4xx), и
 * заменяет на глухую 500 всё остальное. До этого catch admin-контроллеров
 * звал `createError('Internal server error', 500)` без разбора, и любой
 * whitelist или guard, добавленный в модель, доходил до клиента как
 * «сервер упал»: `WaterLine.assertValidStatus` бросает 400 (M-12), а
 * `Line`/`WaterSupplier`/`createCrudModel` явно перебрасывают всё, у чего
 * есть `statusCode`, — и это терялось на последнем шаге.
 *
 * 5xx намеренно НЕ пробрасывается со своим текстом: `errorHandler` прячет
 * детали только по статусу, и внутреннее сообщение вроде «connection
 * terminated» не должно получить шанс уехать наружу из-за того, что кто-то
 * когда-нибудь поставит на него `statusCode`.
 *
 * @param {Error} error пойманная ошибка
 * @returns {Error} она же, если статус клиентский; иначе новая 500
 */
const toClientError = (error) =>
    (isClientError(error) ? error : createError('Internal server error', 500));

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
    isClientError,
    toClientError,
    validateCoordinates,
};
