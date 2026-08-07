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
    requiredCoordinates,
    requiredPositiveNumber,
    requiredNonNegativeNumber,
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

// [доработка 2] Поля сверены с `\d transformers`, а не взяты по памяти: первая
// редакция описывала `power_rating` / `voltage_primary` / `address` /
// `maintenance_contact`, которых в таблице нет, и молчала про `power_kva` и
// `voltage_kv` — NOT NULL с CHECK > 0. Схема была декоративной, а отказ
// приходил пятисоткой из БД.
const validateTransformerCreate = [
    ...requiredText('name', 'Название трансформатора'),
    ...requiredPositiveNumber('power_kva', 'Мощность (кВА)'),
    ...requiredPositiveNumber('voltage_kv', 'Напряжение (кВ)'),
    ...optionalCoordinates(),
    ...optionalText('location', 'Расположение'),
    ...optionalText('manufacturer', 'Производитель'),
    ...optionalText('model', 'Модель'),
    ...optionalEnum('status', 'Статус', SOURCE_STATUSES),
    ...optionalDate('installation_date', 'Дата установки'),
    handleValidationErrors,
];

// `voltage_kv` и `length_km` — NOT NULL в `lines`; без них запрос доезжал до БД.
const validateLineCreate = [
    ...requiredText('name', 'Название линии'),
    ...requiredNonNegativeNumber('voltage_kv', 'Напряжение (кВ)'),
    ...requiredNonNegativeNumber('length_km', 'Длина (км)'),
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

// У обоих источников `address`, `source_type`, `latitude`, `longitude` — NOT NULL.
const validateColdWaterSourceCreate = [
    ...requiredText('name', 'Название источника'),
    ...requiredText('address', 'Адрес'),
    ...requiredText('source_type', 'Тип источника'),
    ...requiredCoordinates(),
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
    ...requiredText('address', 'Адрес'),
    ...requiredText('source_type', 'Тип источника'),
    ...requiredCoordinates(),
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
