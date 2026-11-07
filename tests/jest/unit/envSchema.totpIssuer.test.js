'use strict';

/**
 * [C-7] TOTP_ISSUER проверяется на старте вместе с остальными переменными,
 * а не при первой настройке 2FA (там был warn и тихий fallback).
 */

const { validate } = require('../../../src/config/envSchema');

describe('[C-7] envSchema: TOTP_ISSUER', () => {
    test('обычное имя — без ошибок', () => {
        expect(validate({ TOTP_ISSUER: 'InfraSafe ProFK' })).toEqual([]);
    });

    test('двоеточие ломает otpauth-URI — ошибка на старте', () => {
        expect(validate({ TOTP_ISSUER: 'InfraSafe: prod' })).toEqual([expect.stringContaining('TOTP_ISSUER')]);
    });

    test('длиннее 64 символов — ошибка', () => {
        expect(validate({ TOTP_ISSUER: 'x'.repeat(65) })).toEqual([expect.stringContaining('TOTP_ISSUER')]);
        expect(validate({ TOTP_ISSUER: 'x'.repeat(64) })).toEqual([]);
    });

    test('не задана — не проверяется (умолчание подставляет totpService)', () => {
        expect(validate({})).toEqual([]);
    });
});
