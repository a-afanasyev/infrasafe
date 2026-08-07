const { body, param } = require('express-validator');
// [AR-4] Канонический ответ на ошибку валидации живёт отдельным модулем —
// он общий с entityValidators.js, и держать его здесь значило замкнуть цикл.
const { handleValidationErrors } = require('./validationResultHandler');
// [AR-10] Схемы остальных сущностей живут в entityValidators.js и
// реэкспортируются отсюда: точка подключения у маршрутов остаётся одна.
const entityValidators = require('./entityValidators');

// Валидация для создания/обновления здания
const validateBuildingCreate = [
    body('name').notEmpty().withMessage('Название здания обязательно'),
    body('address').notEmpty().withMessage('Адрес обязателен'),
    body('town').notEmpty().withMessage('Город обязателен'),
    body('latitude').isFloat().withMessage('Широта должна быть числом'),
    body('longitude').isFloat().withMessage('Долгота должна быть числом'),
    body('management_company').optional(),
    handleValidationErrors
];

const { isXSSFree } = require('./xssGuard');

// Валидация для создания/обновления контроллера
const validateControllerCreate = [
    body('serial_number')
        .notEmpty().withMessage('Серийный номер обязателен')
        .custom((value) => {
            if (!isXSSFree(value)) {
                throw new Error('Серийный номер содержит недопустимые символы');
            }
            return true;
        }),
    body('vendor').optional()
        .custom((value) => {
            if (value && !isXSSFree(value)) {
                throw new Error('Производитель содержит недопустимые символы');
            }
            return true;
        }),
    body('model').optional()
        .custom((value) => {
            if (value && !isXSSFree(value)) {
                throw new Error('Модель содержит недопустимые символы');
            }
            return true;
        }),
    body('building_id').isInt().withMessage('ID здания должен быть целым числом'),
    body('status').isIn(['online', 'offline', 'maintenance'])
        .withMessage('Статус должен быть одним из: online, offline, maintenance'),
    handleValidationErrors
];

// [AUD-031] validateMetricCreate removed — it was never mounted (POST /metrics
// validates in metricService, not via this chain). Dead since introduction.

// [R2-16] Generalized integer path-param validator factory. A non-integer path
// param otherwise reaches pg as-is → 22P02 → 500 instead of a clean 400. Use for
// ANY numeric route param — validateIdParam below only matches the literal `:id`,
// so routes with `:alertId` / `:transformerId` need validateIntParam('alertId').
const validateIntParam = (name = 'id') => [
    param(name).isInt().withMessage(`Параметр ${name} должен быть целым числом`),
    handleValidationErrors
];

// Валидация ID параметра (`:id`). Kept as a named export for existing call sites.
const validateIdParam = validateIntParam('id');

module.exports = {
    validateBuildingCreate,
    validateControllerCreate,
    validateIdParam,
    validateIntParam,
    handleValidationErrors,
    isXSSFree,
    ...entityValidators
};
