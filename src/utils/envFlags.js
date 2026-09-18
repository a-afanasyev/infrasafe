'use strict';

/**
 * [A-18] Единый разбор булевых переменных окружения.
 *
 * Валидатор (`config/envSchema.js`) принимает `true|false|1|0` — а потребители
 * сравнивали значение со строкой `'true'`. То есть `AUTH_BLACKLIST_FAIL_OPEN=1`
 * проходил проверку и НЕ ДЕЛАЛ НИЧЕГО: оператор считал аварийный клапан
 * открытым, а в production отказ базы чёрного списка продолжал закрывать вход
 * всем подряд. `UK_USE_NEXT_SECRET=1` точно так же оставлял подпись на СТАРОМ
 * ключе посреди ротации, `SECURE_COOKIES=1` вне production не включал ничего.
 *
 * Общее у всех трёх — тишина: переменная задана, валидатор доволен, поведение
 * прежнее. Поэтому парсер один и живёт отдельно: расхождение между «что принял
 * валидатор» и «что понял потребитель» иначе заводится снова при каждом новом
 * флаге.
 *
 * Набор значений шире, чем у валидатора, намеренно: `yes`/`on` не пройдут
 * проверку на старте (и правильно — единообразие в конфигурации полезно), но
 * если такое значение всё же дошло до кода, «включено» — единственное разумное
 * его прочтение. Обратное — принять `yes` за «выключено» — снова даёт молчащий
 * флаг.
 */

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

/**
 * Разобрать произвольное значение как булево.
 *
 * @param {unknown} raw
 * @param {boolean} [fallback=false] — что вернуть, если значение не задано или
 *   не опознано. Неопознанное значение НЕ трактуется как «включено»: иначе
 *   опечатка включала бы клапан.
 * @returns {boolean}
 */
function parseBoolean(raw, fallback = false) {
    if (raw === undefined || raw === null) return fallback;
    const value = String(raw).trim().toLowerCase();
    if (value === '') return fallback;
    if (TRUE_VALUES.has(value)) return true;
    if (FALSE_VALUES.has(value)) return false;
    return fallback;
}

/**
 * Включён ли флаг окружения.
 *
 * @param {string} name — имя переменной
 * @param {boolean} [fallback=false]
 * @returns {boolean}
 */
function isEnabled(name, fallback = false) {
    return parseBoolean(process.env[name], fallback);
}

module.exports = { parseBoolean, isEnabled, TRUE_VALUES, FALSE_VALUES };
