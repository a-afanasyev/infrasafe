/**
 * @jest-environment jsdom
 *
 * AUD-015: behavioral coverage for public/utils/safeJsonParser.js — the DoS
 * guard around untrusted JSON the frontend parses from API responses.
 */

const SafeJsonParser = require('../../../../public/utils/safeJsonParser');

describe('SafeJsonParser.parseString', () => {
    const parser = new SafeJsonParser(100);

    test('parses valid JSON', () => {
        expect(parser.parseString('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
    });

    test('throws on invalid JSON without leaking parser internals', () => {
        expect(() => parser.parseString('not json')).toThrow('Ошибка парсинга JSON строки');
    });

    test('rejects non-string / empty input', () => {
        expect(() => parser.parseString(null)).toThrow('Ожидается строка');
        expect(() => parser.parseString('')).toThrow('Ожидается строка');
    });

    test('rejects payloads larger than maxSize', () => {
        const big = '"' + 'x'.repeat(200) + '"';
        expect(() => parser.parseString(big)).toThrow('слишком большой');
    });
});

describe('SafeJsonParser.formatBytes', () => {
    const parser = new SafeJsonParser();

    test('formats common sizes', () => {
        expect(parser.formatBytes(0)).toBe('0 Bytes');
        expect(parser.formatBytes(1024)).toBe('1 KB');
        expect(parser.formatBytes(1024 * 1024)).toBe('1 MB');
    });
});

describe('module load', () => {
    test('registers a 1MB global instance on window', () => {
        expect(window.safeJsonParser).toBeInstanceOf(SafeJsonParser);
        expect(window.safeJsonParser.maxSize).toBe(1024 * 1024);
    });
});
