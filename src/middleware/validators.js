const { body, param, query } = require('express-validator');
const { sendError } = require('../utils/apiResponse');
const { metricsQuery } = require('../config/thresholds');
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
// [S-INJ-5] max — предел int4: /buildings/99999999999 раньше доходил до pg и
// давал 22003 → 500.
const PG_INT4_MAX = 2147483647;
const validateIntParam = (name = 'id') => [
    param(name).isInt({ min: 1, max: PG_INT4_MAX }).withMessage(`Параметр ${name} должен быть целым числом`),
    handleValidationErrors
];

// [C-3 / S-INJ-5, аудит 05.11.2026] Общая проверка `ids` для batch-маршрутов
// админки. У buildings/controllers/metrics она была inline в контроллерах, у
// transformers/lines/water-lines — не было: `['x']` → ANY($1::int[]) → 22P02 → 500.
const BATCH_IDS_MAX = 1000;
const validateBatchIds = [
    body('ids')
        .isArray({ min: 1, max: BATCH_IDS_MAX })
        .withMessage(`ids: непустой массив не длиннее ${BATCH_IDS_MAX}`),
    body('ids.*')
        .isInt({ min: 1, max: PG_INT4_MAX })
        .withMessage('ids: только положительные целые'),
    handleValidationErrors
];

// Валидация ID параметра (`:id`). Kept as a named export for existing call sites.
const validateIdParam = validateIntParam('id');

// [N-01] Для таблиц со СТРОКОВЫМ ключом (`heat_sources`, `cold_water_sources`:
// `varchar(50)`, сиды 'HS-FARABI-01', новые записи — randomUUID()). R2-16 навесил
// на них validateIntParam, и админка получила 400 на любой источник. Здесь
// проверяется только длина колонки: запрос параметризован, так что строковое
// значение до Postgres доходит безопасно и 500 не даёт, а более строгий набор
// символов мог бы запереть уже существующие записи — id можно было задать
// в теле POST без ограничений до этой правки.
const { STRING_ID_MAX_LENGTH } = require('./validatorFields');
const validateStringIdParam = (name = 'id') => [
    param(name)
        .isLength({ min: 1, max: STRING_ID_MAX_LENGTH })
        .withMessage(`Параметр ${name} должен быть строкой длиной от 1 до ${STRING_ID_MAX_LENGTH} символов`)
        .bail()
        // NUL Postgres в тексте не хранит — такой id не может существовать, а
        // запрос с ним отвечал 500 (22021) вместо 400.
        .not().contains('\u0000')
        .withMessage(`Параметр ${name} содержит недопустимый символ`),
    handleValidationErrors
];

// [S-INJ-2, аудит 05.11.2026] Контракт диапазона для выборки метрик контроллера.
// До этого startDate/endDate из query шли в SQL и в ключ кэша как есть, а без
// дат отдавалась ВСЯ история. Теперь:
//   обе даты      → start ≤ end и end − start ≤ rangeMaxDays, иначе 400;
//   только start  → end = min(start + rangeMaxDays, now);
//   только end    → start = end − rangeMaxDays;
//   ни одной      → последние rangeDefaultHours часов.
// Канонические ISO-границы кладутся в req.metricsRange — контроллеры берут их
// оттуда, а не из req.query. timeFrame — только из закрытого списка.
const DAY_MS = 24 * 60 * 60 * 1000;
const normalizeMetricsRange = (req, res, next) => {
    const maxMs = metricsQuery.rangeMaxDays * DAY_MS;
    const now = Date.now();
    const startIn = req.query.startDate ? Date.parse(req.query.startDate) : null;
    const endIn = req.query.endDate ? Date.parse(req.query.endDate) : null;

    let start;
    let end;
    if (startIn !== null && endIn !== null) {
        if (startIn > endIn) {
            return sendError(res, 400, 'startDate must not be later than endDate');
        }
        if (endIn - startIn > maxMs) {
            return sendError(res, 400, `Date range must not exceed ${metricsQuery.rangeMaxDays} days`);
        }
        start = startIn;
        end = endIn;
    } else if (startIn !== null) {
        start = startIn;
        end = Math.min(startIn + maxMs, now);
        if (end < start) end = start;
    } else if (endIn !== null) {
        end = endIn;
        start = endIn - maxMs;
    } else {
        end = now;
        start = now - metricsQuery.rangeDefaultHours * 60 * 60 * 1000;
    }
    req.metricsRange = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    next();
};

const validateMetricsRange = [
    query('startDate').optional().isISO8601().withMessage('startDate must be ISO 8601'),
    query('endDate').optional().isISO8601().withMessage('endDate must be ISO 8601'),
    query('timeFrame').optional().isIn([...metricsQuery.timeFrames])
        .withMessage(`timeFrame must be one of ${metricsQuery.timeFrames.join(', ')}`),
    handleValidationErrors,
    normalizeMetricsRange
];

module.exports = {
    validateBuildingCreate,
    validateControllerCreate,
    validateIdParam,
    validateIntParam,
    validateStringIdParam,
    validateMetricsRange,
    validateBatchIds,
    STRING_ID_MAX_LENGTH,
    handleValidationErrors,
    isXSSFree,
    ...entityValidators
};
