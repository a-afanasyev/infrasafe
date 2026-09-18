'use strict';

/**
 * [A-19] Формат консольного транспорта — отдельным модулем.
 *
 * Базовый формат логгера — JSON с вычисткой секретов, но транспорт консоли
 * ПЕРЕКРЫВАЛ его строкой `timestamp level: message`. Всё остальное — стек,
 * endpoint, correlationId, коды ошибок — печаталось в никуда. Пока рядом
 * работали файловые транспорты, JSON-копия существовала хотя бы в файле; при
 * `LOG_CONSOLE_ONLY=true` их нет, и метаданные исчезали СОВСЕМ — ровно в том
 * режиме, в котором ведут расследование.
 *
 * Режимов два, и это не украшательство:
 *   - `consoleOnly` (контейнер, 12-factor) — чистый JSON в stdout: его разбирает
 *     сборщик логов, ради этого режим и заводился;
 *   - обычный (разработка) — прежняя читаемая строка, но метаданные
 *     дописываются хвостом, а стек — отдельной строкой.
 *
 * Вынесено из `logger.js` не ради чистоты: внутри логгера это можно было
 * проверить только перехватом `process.stdout.write`, а такой тест разваливается,
 * как только jest запускает рядом другой файл и сам управляет потоком вывода
 * (проверено — 4 из 4 падали). Формат же проверяется напрямую вызовом
 * `transform()`, без единого допущения о том, куда пишет winston.
 */

const winston = require('winston');

/** Поля, которые уже показаны в самой строке и в хвост не дублируются. */
const SERVICE_KEYS = new Set(['timestamp', 'level', 'message', 'service', 'stack']);

/**
 * Хвост с метаданными для человекочитаемого вывода.
 * @returns {string} пустая строка, если метаданных нет
 */
function metaSuffix(info) {
    const meta = {};
    for (const key of Object.keys(info)) {
        if (!SERVICE_KEYS.has(key)) meta[key] = info[key];
    }

    const parts = [];
    if (Object.keys(meta).length > 0) {
        try {
            parts.push(JSON.stringify(meta));
        } catch {
            // Циклическая ссылка в метаданных — не повод потерять запись.
            parts.push('[метаданные не сериализуются]');
        }
    }
    // Стек — отдельной строкой: он и длинный, и самый нужный.
    if (info.stack) parts.push(`\n${info.stack}`);

    return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Собрать формат консольного транспорта.
 * @param {boolean} consoleOnly — режим 12-factor (stdout как единственный sink)
 */
function buildConsoleFormat(consoleOnly, { colorize } = {}) {
    if (consoleOnly) {
        return winston.format.json();
    }

    // Цвет — только в терминале. Прежде colorize стоял безусловно, и когда
    // вывод уходил в файл или в сборщик логов, туда же уезжали
    // escape-последовательности. Заодно это снимает зависимость формата от
    // глобальной таблицы цветов winston, которой вне логгера может не быть.
    const useColor = colorize === undefined ? Boolean(process.stdout.isTTY) : colorize;
    const line = winston.format.printf(
        (info) => `${info.timestamp} ${info.level}: ${info.message}${metaSuffix(info)}`
    );

    return useColor
        ? winston.format.combine(winston.format.colorize(), line)
        : line;
}

module.exports = { buildConsoleFormat, metaSuffix, SERVICE_KEYS };
