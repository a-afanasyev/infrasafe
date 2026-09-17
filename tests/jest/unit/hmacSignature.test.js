'use strict';

/**
 * [A-12] Канонизация hex-подписи.
 *
 * Проверки здесь — на ГРАНИЦАХ, потому что дефект жил именно на них: разбор
 * `Buffer.from(value, 'hex')` обрывается на первом не-hex символе и молча
 * отбрасывает остаток, из-за чего «подпись + мусор» декодировалась в правильные
 * байты нужной длины. Поэтому длина сверяется ДО декодирования, со строкой
 * ожидаемого дайджеста.
 */

const crypto = require('crypto');
const { canonicalizeHexSignature } = require('../../../src/utils/hmacSignature');

const EXPECTED = crypto.createHmac('sha256', 'k').update('payload').digest('hex');

describe('canonicalizeHexSignature', () => {
    test('точное совпадение возвращается как есть', () => {
        expect(canonicalizeHexSignature(EXPECTED, EXPECTED)).toBe(EXPECTED);
    });

    test('верхний и смешанный регистр сводятся к нижнему', () => {
        // Суть правки: разные написания дают ОДИН ключ дедупа.
        const upper = EXPECTED.toUpperCase();
        const mixed = EXPECTED.slice(0, 8).toUpperCase() + EXPECTED.slice(8);

        expect(canonicalizeHexSignature(upper, EXPECTED)).toBe(EXPECTED);
        expect(canonicalizeHexSignature(mixed, EXPECTED)).toBe(EXPECTED);
    });

    test('не-hex хвост отвергается, а не обрезается', () => {
        expect(canonicalizeHexSignature(`${EXPECTED}ZZ`, EXPECTED)).toBeNull();
    });

    test('не-hex символ ВНУТРИ строки отвергается при верной длине', () => {
        // Здесь длина совпадает, поэтому проверку не спасла бы одна лишь она.
        const corrupted = `zz${EXPECTED.slice(2)}`;
        expect(corrupted).toHaveLength(EXPECTED.length);
        expect(canonicalizeHexSignature(corrupted, EXPECTED)).toBeNull();
    });

    test('короткая и длинная подписи отвергаются', () => {
        expect(canonicalizeHexSignature(EXPECTED.slice(0, -2), EXPECTED)).toBeNull();
        expect(canonicalizeHexSignature(`${EXPECTED}ab`, EXPECTED)).toBeNull();
    });

    test('пустая строка и не-строки отвергаются', () => {
        for (const bad of ['', null, undefined, 42, {}, []]) {
            expect(canonicalizeHexSignature(bad, EXPECTED)).toBeNull();
        }
    });

    test('длина берётся из ожидаемого дайджеста, а не из литерала 64', () => {
        // Если алгоритм подписи сменится, функция обязана остаться верной.
        const sha512 = crypto.createHmac('sha512', 'k').update('payload').digest('hex');
        expect(sha512).toHaveLength(128);
        expect(canonicalizeHexSignature(sha512.toUpperCase(), sha512)).toBe(sha512);
        expect(canonicalizeHexSignature(EXPECTED, sha512)).toBeNull();
    });
});
