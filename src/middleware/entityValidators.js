/**
 * [AR-10] Схемы тел admin-CRUD для сущностей, у которых их не было.
 *
 * Поля взяты из writable-колонок моделей, а не выдуманы:
 *   - Line            → LINE_WRITABLE_COLUMNS
 *   - WaterLine       → WATER_LINE_WRITABLE_COLUMNS + домен статуса
 *   - ColdWaterSource / HeatSource → FIELDS
 *   - Transformer     → колонки, консолидированные миграцией 036 (AUD-039)
 *
 * Валидатор — не единственный рубеж, а САМЫЙ РАННИЙ. Домен статуса водной линии,
 * например, уже закреплён CHECK-ограничением в БД (миграция 040) и проверкой в
 * модели; здесь он повторён, чтобы отказ приходил клиенту как понятная 400 с
 * указанием поля, а не как 500 от нарушения ограничения.
 *
 * Все поля, кроме имени, необязательные: формы админки шлют только заполненное,
 * а пустые приходят как null. Требовать больше — значит сделать включение
 * валидации ломающим изменением для UI.
 */

const {
    requiredText,
    optionalText,
    optionalCoordinates,
    optionalEndpointCoordinates,
    optionalNonNegativeNumber,
    optionalIntInRange,
    optionalEnum,
    optionalDate,
} = require('./validatorFields');
const { handleValidationErrors } = require('./validationResultHandler');

// Домен статуса водной линии — источник истины тот же, что у модели и
// миграции 040. Продублирован строками намеренно: импорт модели в middleware
// потянул бы за собой пул соединений в слой, которому БД не нужна.
const WATER_LINE_STATUSES = ['active', 'maintenance', 'inactive'];
const SOURCE_STATUSES = ['active', 'maintenance', 'inactive'];

// Год: нижняя граница — эпоха электрификации, верхняя — «не из будущего».
// Смысл не в исторической точности, а в отсечении опечаток вроде 202 и 20255.
const YEAR_RANGE = { min: 1900, max: 2100 };

const validateTransformerCreate = [
    ...requiredText('name', 'Название трансформатора'),
    ...optionalCoordinates(),
    ...optionalText('address', 'Адрес'),
    ...optionalNonNegativeNumber('voltage_primary', 'Первичное напряжение'),
    ...optionalNonNegativeNumber('voltage_secondary', 'Вторичное напряжение'),
    ...optionalNonNegativeNumber('power_rating', 'Номинальная мощность'),
    ...optionalDate('installation_date', 'Дата установки'),
    ...optionalText('maintenance_contact', 'Контакт обслуживания'),
    handleValidationErrors,
];

const validateLineCreate = [
    ...requiredText('name', 'Название линии'),
    ...optionalNonNegativeNumber('voltage_kv', 'Напряжение'),
    ...optionalNonNegativeNumber('length_km', 'Длина'),
    ...optionalIntInRange('commissioning_year', 'Год ввода в эксплуатацию', YEAR_RANGE),
    ...optionalText('cable_type', 'Тип кабеля'),
    ...optionalEndpointCoordinates(),
    handleValidationErrors,
];

const validateWaterLineCreate = [
    ...requiredText('name', 'Название линии'),
    ...optionalText('description', 'Описание'),
    ...optionalNonNegativeNumber('diameter_mm', 'Диаметр'),
    ...optionalNonNegativeNumber('pressure_bar', 'Давление'),
    ...optionalText('material', 'Материал'),
    ...optionalEnum('status', 'Статус', WATER_LINE_STATUSES),
    ...optionalDate('installation_date', 'Дата установки'),
    ...optionalEndpointCoordinates(),
    handleValidationErrors,
];

const validateColdWaterSourceCreate = [
    ...requiredText('name', 'Название источника'),
    ...optionalText('address', 'Адрес'),
    ...optionalCoordinates(),
    ...optionalText('source_type', 'Тип источника'),
    ...optionalNonNegativeNumber('capacity_m3_per_hour', 'Производительность'),
    ...optionalNonNegativeNumber('operating_pressure_bar', 'Рабочее давление'),
    ...optionalDate('installation_date', 'Дата установки'),
    ...optionalEnum('status', 'Статус', SOURCE_STATUSES),
    ...optionalText('maintenance_contact', 'Контакт обслуживания'),
    ...optionalText('notes', 'Примечания'),
    handleValidationErrors,
];

const validateHeatSourceCreate = [
    ...requiredText('name', 'Название источника'),
    ...optionalText('address', 'Адрес'),
    ...optionalCoordinates(),
    ...optionalText('source_type', 'Тип источника'),
    ...optionalNonNegativeNumber('capacity_mw', 'Мощность'),
    ...optionalText('fuel_type', 'Вид топлива'),
    ...optionalDate('installation_date', 'Дата установки'),
    ...optionalEnum('status', 'Статус', SOURCE_STATUSES),
    ...optionalText('maintenance_contact', 'Контакт обслуживания'),
    ...optionalText('notes', 'Примечания'),
    handleValidationErrors,
];

module.exports = {
    validateTransformerCreate,
    validateLineCreate,
    validateWaterLineCreate,
    validateColdWaterSourceCreate,
    validateHeatSourceCreate,
    WATER_LINE_STATUSES,
};
