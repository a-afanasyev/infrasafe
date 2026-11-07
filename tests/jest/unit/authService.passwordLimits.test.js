'use strict';

/**
 * [S-INJ-1, аудит 05.11.2026] Границы нового пароля и email.
 *
 * Прежний `/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/` без якоря был квадратичным: строка
 * из 100 000 «a» держала event loop 6 с, тело в 1 МБ — минуты, и это мог
 * сделать любой аутентифицированный пользователь одним change-password.
 * Теперь длина и тип проверяются первыми, а классы символов — тремя линейными
 * тестами. Предел — 72 БАЙТА UTF-8 (bcrypt хэширует только их), не символы.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn(), set: jest.fn(), invalidate: jest.fn(), delete: jest.fn()
}));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-password-limits';

const { performance } = require('perf_hooks');
const authService = require('../../../src/services/authService');

const expectInvalid = (password) => {
    expect(() => authService.validatePassword(password)).toThrow(
        expect.objectContaining({ code: 'INVALID_PASSWORD' })
    );
};

describe('[S-INJ-1] validatePassword — границы до regex', () => {
    test('200 000 символов без заглавной отвергаются за миллисекунды, а не секунды', () => {
        const t0 = performance.now();
        expectInvalid('a'.repeat(200_000));
        expect(performance.now() - t0).toBeLessThan(50);
    });

    test('предел считается в байтах UTF-8: 37 кириллических символов (74 байта) — отказ', () => {
        const cyr = 'Ж'.repeat(36) + 'я1'; // 37 букв = 74 байта, 38 символов
        expect(Buffer.byteLength(cyr, 'utf8')).toBeGreaterThan(72);
        expect(cyr.length).toBeLessThan(72);
        expectInvalid(cyr);
    });

    test('ровно 72 байта с нужными классами символов — принимается', () => {
        const ok = 'Aa1' + 'x'.repeat(69);
        expect(Buffer.byteLength(ok, 'utf8')).toBe(72);
        expect(() => authService.validatePassword(ok)).not.toThrow();
    });

    test('73 байта — отказ', () => {
        expectInvalid('Aa1' + 'x'.repeat(70));
    });

    test('не строка — отказ, а не исключение другого класса', () => {
        expectInvalid(123);
        expectInvalid(['Aa1aaaaa']);
        expectInvalid({ toString: () => 'Aa1aaaaa' });
        expectInvalid(null);
        expectInvalid(undefined);
    });

    test('короче 8 символов — отказ', () => {
        expectInvalid('Aa1aaaa');
    });

    test('без цифры / без заглавной / без строчной — отказ, с ними — ok', () => {
        expectInvalid('Aaaaaaaaa');
        expectInvalid('aaaaaaaa1');
        expectInvalid('AAAAAAAA1');
        expect(() => authService.validatePassword('Aa1aaaaa')).not.toThrow();
    });
});

describe('[S-INJ-1] validateUserData — email', () => {
    const base = { username: 'validuser', password: 'Aa1aaaaa' };

    test('email длиннее 254 символов без «@» отвергается быстро', () => {
        const t0 = performance.now();
        expect(() => authService.validateUserData({ ...base, email: 'a@' + '.'.repeat(50_000) + ' ' }))
            .toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
        expect(performance.now() - t0).toBeLessThan(50);
    });

    test('email не строка — VALIDATION_ERROR', () => {
        expect(() => authService.validateUserData({ ...base, email: ['a@b.co'] }))
            .toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    test('обычный email проходит', () => {
        expect(() => authService.validateUserData({ ...base, email: 'ops@infrasafe.uz' })).not.toThrow();
    });
});
