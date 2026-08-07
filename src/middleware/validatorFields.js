/**
 * [AR-10] Переиспользуемые описания полей для схемной валидации.
 *
 * Валидация тел admin-CRUD была только у 2 сущностей из ~15: координаты,
 * диаметры и напряжения принимались любыми и доезжали до БД как есть.
 *
 * Новую схемную библиотеку намеренно НЕ добавляли: `express-validator` уже в
 * зависимостях, уже подключён к маршрутам и после AR-4 отдаёт канонический
 * конверт с `error.details`. Вторая библиотека рядом с ней — это ровно те «две
 * параллельные реализации одного и того же», которые отчёт велит устранять.
 *
 * Здесь только общие ПОЛЯ, а не мини-фреймворк: сущности собираются из них
 * обычными массивами, как и прежние валидаторы в validators.js.
 *
 * Соглашение по необязательным полям: `.optional({ nullable: true })`. Формы
 * админки шлют только заполненные поля, а незаполненные приходят как `null` —
 * без этого включение валидации стало бы ломающим изменением для UI.
 */

const { body } = require('express-validator');

// Совпадает с проверкой в validators.js — импортируем оттуда, чтобы правило
// XSS жило в одном месте, а не в двух похожих.
const { isXSSFree } = require('./xssGuard');

/**
 * Обязательный текст без XSS-токенов.
 *
 * `.trim()` до `.notEmpty()` — иначе имя из одних пробелов считается
 * заполненным и доезжает до БД: в списке появляется строка без названия,
 * которую потом не найти поиском. Проверено в браузере на живом стенде.
 */
const requiredText = (field, label) => [
    body(field)
        .trim()
        .notEmpty().withMessage(`${label} обязательно`)
        .bail()
        .custom((value) => {
            if (!isXSSFree(value)) throw new Error(`${label} содержит недопустимые символы`);
            return true;
        }),
];

/** Необязательный текст без XSS-токенов. */
const optionalText = (field, label) => [
    body(field).optional({ nullable: true })
        .custom((value) => {
            if (value === '' || value === null || value === undefined) return true;
            if (!isXSSFree(value)) throw new Error(`${label} содержит недопустимые символы`);
            return true;
        }),
];

/**
 * Географические координаты. Диапазон проверяется явно: без него в БД
 * попадала любая пара чисел, а карта потом рисовала здание в океане.
 */
const optionalCoordinates = () => [
    body('latitude').optional({ nullable: true })
        .isFloat({ min: -90, max: 90 }).withMessage('Широта должна быть числом от -90 до 90'),
    body('longitude').optional({ nullable: true })
        .isFloat({ min: -180, max: 180 }).withMessage('Долгота должна быть числом от -180 до 180'),
];

/** Пара координат начала и конца — для линейных объектов. */
const optionalEndpointCoordinates = () => [
    body('latitude_start').optional({ nullable: true })
        .isFloat({ min: -90, max: 90 }).withMessage('Широта начала должна быть от -90 до 90'),
    body('longitude_start').optional({ nullable: true })
        .isFloat({ min: -180, max: 180 }).withMessage('Долгота начала должна быть от -180 до 180'),
    body('latitude_end').optional({ nullable: true })
        .isFloat({ min: -90, max: 90 }).withMessage('Широта конца должна быть от -90 до 90'),
    body('longitude_end').optional({ nullable: true })
        .isFloat({ min: -180, max: 180 }).withMessage('Долгота конца должна быть от -180 до 180'),
];

/** Неотрицательное число — для физических величин, где минус бессмыслен. */
const optionalNonNegativeNumber = (field, label) => [
    body(field).optional({ nullable: true })
        .isFloat({ min: 0 }).withMessage(`Поле «${label}»: допустимы только неотрицательные числа`),
];

/** Целое в диапазоне — для годов, количеств. */
const optionalIntInRange = (field, label, { min, max }) => [
    body(field).optional({ nullable: true })
        .isInt({ min, max }).withMessage(`Поле «${label}»: ожидается целое число от ${min} до ${max}`),
];

/** Значение из закрытого списка. */
const optionalEnum = (field, label, allowed) => [
    body(field).optional({ nullable: true })
        .isIn(allowed).withMessage(`Поле «${label}»: допустимые значения — ${allowed.join(', ')}`),
];

/** Дата в формате ISO. */
const optionalDate = (field, label) => [
    body(field).optional({ nullable: true })
        .isISO8601().withMessage(`Поле «${label}»: ожидается дата в формате ISO`),
];

module.exports = {
    requiredText,
    optionalText,
    optionalCoordinates,
    optionalEndpointCoordinates,
    optionalNonNegativeNumber,
    optionalIntInRange,
    optionalEnum,
    optionalDate,
};
