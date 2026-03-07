const { body, param, validationResult } = require('express-validator');

// Обработка результатов валидации
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

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

// Функция для проверки XSS
const isXSSFree = (value) => {
    const xssPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<iframe/gi,
        /<object/gi,
        /<embed/gi
    ];
    return !xssPatterns.some(pattern => pattern.test(value));
};

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

// Валидация для создания/обновления метрики
const validateMetricCreate = [
    body('controller_id').isInt().withMessage('ID контроллера должен быть целым числом'),
    body('timestamp').optional().isISO8601().withMessage('Метка времени должна быть в формате ISO 8601'),
    body('electricity_ph1').isFloat().withMessage('Электричество фаза 1 должно быть числом'),
    body('electricity_ph2').isFloat().withMessage('Электричество фаза 2 должно быть числом'),
    body('electricity_ph3').isFloat().withMessage('Электричество фаза 3 должно быть числом'),
    body('cold_water_pressure').isFloat().withMessage('Давление холодной воды должно быть числом'),
    body('hot_water_in_pressure').isFloat().withMessage('Давление горячей воды (вход) должно быть числом'),
    body('hot_water_out_pressure').isFloat().withMessage('Давление горячей воды (выход) должно быть числом'),
    handleValidationErrors
];

// Валидация ID параметра
const validateIdParam = [
    param('id').isInt().withMessage('ID должен быть целым числом'),
    handleValidationErrors
];

module.exports = {
    validateBuildingCreate,
    validateControllerCreate,
    validateMetricCreate,
    validateIdParam
};