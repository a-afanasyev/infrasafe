'use strict';

/**
 * [N-56] Строка вторым аргументом логгера не раскладывается посимвольно.
 *
 * `logger.error('Unexpected error on idle database client:', err.message)` —
 * форма, привычная по console.log, — в winston уходила так: `splat()` не
 * находил в сообщении плейсхолдера и сливал «лишний» аргумент в метаданные
 * через Object.assign, а строка при этом разворачивается по индексам. В логе
 * прода 27.09 стояло {"0":"t","1":"e","2":"r",…}, и сам текст ошибки из записи
 * пропадал. Таких вызовов в src — два десятка, плюс формы, которые поиском не
 * найти, поэтому правка в формате логгера, а не по местам.
 *
 * Логгер настоящий, со всей цепочкой форматов; перехватывается только
 * транспорт — поток вывода держит сам jest.
 */

const Transport = require('winston-transport');
const logger = require('../../../src/utils/logger');

class Capture extends Transport {
    constructor() {
        super({ level: 'debug' });
        this.entries = [];
    }

    log(info, callback) {
        this.entries.push(info);
        callback();
    }
}

let capture;
beforeEach(() => {
    capture = new Capture();
    logger.add(capture);
});
afterEach(() => logger.remove(capture));

const last = () => capture.entries[capture.entries.length - 1];
const indexKeys = (info) => Object.keys(info).filter((k) => /^\d+$/.test(k));

describe('[N-56] примитивы после сообщения', () => {
    test('строка дописывается к сообщению, а не разворачивается по индексам', () => {
        logger.error('Unexpected error on idle database client:', 'terminating connection');

        expect(last().message).toBe('Unexpected error on idle database client: terminating connection');
        expect(indexKeys(last())).toEqual([]);
    });

    test('числа и несколько аргументов тоже', () => {
        logger.warn('попыток:', 3, 'из', 5);
        expect(last().message).toBe('попыток: 3 из 5');
    });

    test('объект по-прежнему уходит в метаданные', () => {
        logger.error('сбой:', { code: 'E42' });
        expect(last().message).toBe('сбой:');
        expect(last().code).toBe('E42');
    });

    test('смешанный вызов: строка — в текст, объект — в метаданные', () => {
        logger.error('сбой:', 'detail', { code: 'E43' });
        expect(last().message).toBe('сбой: detail');
        expect(last().code).toBe('E43');
        expect(indexKeys(last())).toEqual([]);
    });

    test('настоящий формат-плейсхолдер работает как раньше', () => {
        logger.info('здание %s: %d метрик', 'A-1', 7);
        expect(last().message).toBe('здание A-1: 7 метрик');
    });

    test('%c и %% — тоже формат splat, аргументы не дописываются вторично', () => {
        logger.info('загрузка 50%% %s', 'готово');
        expect(last().message).toBe('загрузка 50% готово');
    });

    test('секрет в метаданных по-прежнему вычищается', () => {
        logger.error('вход:', { password: 'hunter2' });
        expect(JSON.stringify(last())).not.toContain('hunter2');
    });
});
