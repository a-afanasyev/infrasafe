/**
 * [AR-4 / AR-10] Терминальное звено любой цепочки валидации.
 *
 * Живёт отдельным модулем, а не в `validators.js`, из-за направления зависимостей:
 * `entityValidators.js` нужен этот обработчик, а `validators.js` нужны схемы из
 * `entityValidators.js`. Пока обработчик лежал в `validators.js`, между ними был
 * цикл, который работал лишь потому, что первым всегда загружался `validators.js`;
 * первый же модуль, потребовавший `entityValidators` напрямую, ронял приложение
 * на старте — схемы приходили в маршруты как `undefined`. Общая зависимость
 * вынесена вниз, и цикла больше нет.
 */

const { validationResult } = require('express-validator');
const { sendError } = require('../utils/apiResponse');

// [AR-4] Ошибки валидации в КАНОНИЧЕСКОМ конверте.
//
// Раньше отсюда уходило `{errors:[…]}` — без `success`, то есть форма, которую
// потребителю приходилось узнавать по наличию ключа. Теперь это обычная ошибка
// 400, а по-полевые сообщения переезжают в `error.details`: без них остаётся
// «Ошибка валидации» без указания поля, и пользователю нечего исправлять.
//
// Имя поля берём из `path` (express-validator 7) с откатом на `param`
// (версия 6) — библиотека переименовала ключ, и молча потерять его нельзя.
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const details = errors.array().map(e => ({
            field: e.path || e.param || null,
            message: e.msg
        }));
        return sendError(res, 400, 'Ошибка валидации', { details });
    }
    next();
};

module.exports = { handleValidationErrors };
