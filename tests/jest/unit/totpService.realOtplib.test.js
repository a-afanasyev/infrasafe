/**
 * [A-11] Вход по коду восстановления — против ЧЕСТНОГО контракта otplib.
 *
 * Дефект: `verifyCode` сначала отдаёт введённое значение в otplib как OTP.
 * Настоящая библиотека на коде восстановления `XXXX-XXXX` не возвращает
 * «неверно», а БРОСАЕТ (`Token must be 6 digits, got 9`) — исключение улетает
 * мимо bcrypt-ветки, и вход по коду восстановления заканчивается 500-й.
 *
 * Почему это не ловилось. otplib 13 — ESM и тянет @scure/base, который Jest в
 * CJS-режиме не грузит, поэтому в юнит-тестах работает ручной мок
 * `__mocks__/otplib.js` (Jest подставляет его автоматически). Прежняя версия
 * мока возвращала `{valid:false}` на любой неподходящий токен, то есть лгала
 * о контракте — и прятала дефект при покрытии 92%. Мок приведён к настоящему
 * контракту; этот файл проверяет уже поведение СЕРВИСА под ним.
 *
 * Дополнительный рубеж, где настоящая библиотека доступна, — e2e:
 * `tests/jest/e2e/auth.e2e.test.js` (реальный стек, реальная otplib).
 */

process.env.TOTP_ENCRYPTION_KEY = 'totp-test-key-that-is-at-least-32-bytes-long-123456';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    invalidate: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
}));

const bcrypt = require('bcrypt');
const otplib = require('otplib');
const db = require('../../../src/config/database');
const totpService = require('../../../src/services/totpService');

const SECRET = otplib.generateSecret();
const USER_ID = 4211;

/** Состояние пользователя с включённой 2FA и одним кодом восстановления. */
async function stateWithRecovery(plainCode) {
    const hashed = await bcrypt.hash(plainCode.toUpperCase(), 4);
    return {
        totp_secret: totpService.encrypt(SECRET),
        totp_enabled: true,
        recovery_codes: [hashed],
    };
}

const stateWithoutRecovery = () => ({
    totp_secret: totpService.encrypt(SECRET),
    totp_enabled: true,
    recovery_codes: [],
});

beforeEach(() => {
    jest.clearAllMocks();
    // `clearAllMocks` чистит вызовы, но НЕ очередь `mockResolvedValueOnce`:
    // тест, упавший раньше, чем израсходовал очередь, сдвигает следующий, и
    // падает уже он — «User not found» вместо настоящей причины.
    db.query.mockReset();
});

describe('[A-11] мок otplib повторяет контракт настоящей библиотеки', () => {
    // Снято с otplib 13.4.1 напрямую (`node -e`, вне Jest). Если мок когда-нибудь
    // «упростят» обратно до «всегда {valid:false}», эти проверки упадут — и
    // дефект класса A-11 снова станет невидимым.
    test.each([
        ['A1B2-C3D4', 'Token must be 6 digits, got 9'],
        ['123', 'Token must be 6 digits, got 3'],
        ['', 'Token must be 6 digits, got 0'],
        ['A1B2C3D4', 'Token must be 6 digits, got 8'],
        ['не-код', 'Token must contain only digits'],
    ])('%s → исключение, а не «неверный код»', (token, message) => {
        expect(() => otplib.verifySync({ secret: SECRET, token })).toThrow(message);
    });

    test('шестизначный код исключения не вызывает', () => {
        expect(otplib.verifySync({ secret: SECRET, token: '000000' })).toMatchObject({ valid: false });
    });
});

describe('[A-11] verifyCode', () => {
    test('код восстановления принимается, а не роняет запрос', async () => {
        const code = 'A1B2-C3D4';
        db.query
            .mockResolvedValueOnce({ rows: [await stateWithRecovery(code)] })
            .mockResolvedValueOnce({ rows: [] });   // списание израсходованного кода

        await expect(totpService.verifyCode(USER_ID, code))
            .resolves.toEqual({ valid: true, method: 'recovery' });
    });

    test('регистр кода восстановления не важен', async () => {
        const code = 'A1B2-C3D4';
        db.query
            .mockResolvedValueOnce({ rows: [await stateWithRecovery(code)] })
            .mockResolvedValueOnce({ rows: [] });

        await expect(totpService.verifyCode(USER_ID, code.toLowerCase()))
            .resolves.toEqual({ valid: true, method: 'recovery' });
    });

    test('чужой код восстановления отвергается без исключения', async () => {
        db.query.mockResolvedValueOnce({ rows: [await stateWithRecovery('A1B2-C3D4')] });

        await expect(totpService.verifyCode(USER_ID, 'FFFF-FFFF'))
            .resolves.toMatchObject({ valid: false });
    });

    test('верный TOTP-код принимается', async () => {
        db.query.mockResolvedValueOnce({ rows: [stateWithoutRecovery()] });
        const token = String(otplib.generateSync({ secret: SECRET }));

        await expect(totpService.verifyCode(USER_ID, token))
            .resolves.toEqual({ valid: true, method: 'totp' });
    });

    test('неверный шестизначный код — отказ', async () => {
        db.query.mockResolvedValueOnce({ rows: [stateWithoutRecovery()] });

        await expect(totpService.verifyCode(USER_ID, '000000')).resolves.toMatchObject({ valid: false });
    });

    test.each([
        ['мусор', 'не-код'],
        ['слишком короткий', '123'],
        ['без дефиса', 'A1B2C3D4'],
        ['пустая строка', ''],
        ['null', null],
    ])('%s → отказ без исключения', async (_label, code) => {
        db.query.mockResolvedValueOnce({ rows: [stateWithoutRecovery()] });

        await expect(totpService.verifyCode(USER_ID, code)).resolves.toMatchObject({ valid: false });
    });
});
