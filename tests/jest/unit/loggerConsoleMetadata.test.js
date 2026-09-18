'use strict';

/**
 * [A-19] Консольный вывод сохраняет метаданные.
 *
 * Базовый формат логгера — JSON с вычисткой секретов, но транспорт консоли
 * ПЕРЕКРЫВАЛ его строкой `timestamp level: message`. Стек, endpoint,
 * correlationId, коды ошибок печатались в никуда. Пока рядом работали файловые
 * транспорты, JSON-копия существовала хотя бы в файле; при
 * `LOG_CONSOLE_ONLY=true` их нет — и метаданные исчезали совсем, ровно в том
 * режиме, в котором ведут расследование.
 *
 * Первая версия этого теста перехватывала `process.stdout.write`. Она проходила
 * в одиночку и падала — все четыре теста — стоило запустить рядом ЛЮБОЙ другой
 * файл: поток вывода в этот момент держит сам jest. Поэтому проверяется
 * ФОРМАТ напрямую, через `transform()`: ни одного допущения о том, куда пишет
 * winston, и результат не зависит от соседей по прогону.
 */

const { MESSAGE } = require('triple-beam');
const { buildConsoleFormat, metaSuffix } = require('../../../src/utils/loggerConsoleFormat');

/** Прогнать запись через формат и вернуть то, что ушло бы в поток. */
const render = (format, info) => {
    // Второй аргумент обязателен: форматы winston читают из него опции
    // (json — replacer/space). Без него transform падает на undefined.
    const out = format.transform({ ...info }, format.options || {});
    return out && out[MESSAGE] !== undefined ? String(out[MESSAGE]) : String(out);
};

const baseInfo = {
    timestamp: '2026-09-18 09:00:00',
    level: 'error',
    message: 'сбой обработки',
    service: 'infrasafe-api',
};

describe('[A-19] режим 12-factor (LOG_CONSOLE_ONLY) отдаёт машинный JSON', () => {
    const format = buildConsoleFormat(true);

    test('метаданные целиком доезжают до вывода', () => {
        const line = render(format, {
            ...baseInfo,
            endpoint: '/api/metrics',
            correlationId: 'abc-123',
            code: 'E_TEST',
        });

        expect(JSON.parse(line)).toMatchObject({
            message: 'сбой обработки',
            endpoint: '/api/metrics',
            correlationId: 'abc-123',
            code: 'E_TEST',
            level: 'error',
        });
    });

    test('стек — часть записи, а не потеря', () => {
        const line = render(format, { ...baseInfo, stack: 'Error: тест\n    at x' });
        expect(JSON.parse(line).stack).toMatch(/at x/);
    });
});

describe('[A-19] обычный режим: читаемая строка И метаданные', () => {
        // Без раскраски: цвет — оформление, а проверяется содержимое строки.
    const format = buildConsoleFormat(false, { colorize: false });

    test('строка прежнего вида сохранена', () => {
        const line = render(format, baseInfo);
        expect(line).toMatch(/2026-09-18 09:00:00/);
        expect(line).toMatch(/сбой обработки/);
    });

    test('метаданные дописываются хвостом', () => {
        // Прежде этой части не было вовсе.
        const line = render(format, { ...baseInfo, correlationId: 'abc-123' });
        expect(line).toMatch(/abc-123/);
    });

    test('стек печатается отдельной строкой', () => {
        const line = render(format, { ...baseInfo, stack: 'Error: тест\n    at x' });
        expect(line).toMatch(/\n/);
        expect(line).toMatch(/at x/);
    });
});

describe('[A-19] metaSuffix — границы', () => {
    test('без метаданных хвоста нет', () => {
        expect(metaSuffix(baseInfo)).toBe('');
    });

    test('служебные поля не дублируются в хвосте', () => {
        // Иначе каждая строка несла бы message и timestamp дважды.
        const suffix = metaSuffix({ ...baseInfo, correlationId: 'x' });
        expect(suffix).not.toMatch(/сбой обработки/);
        expect(suffix).not.toMatch(/infrasafe-api/);
        expect(suffix).toMatch(/x/);
    });

    test('циклическая ссылка не роняет запись', () => {
        const cyclic = { name: 'узел' };
        cyclic.self = cyclic;

        expect(() => metaSuffix({ ...baseInfo, cyclic })).not.toThrow();
        expect(metaSuffix({ ...baseInfo, cyclic })).toMatch(/не сериализуются/);
    });
});
