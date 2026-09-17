/**
 * [A-02-jti] Каждый выпуск токена даёт УНИКАЛЬНУЮ строку.
 *
 * Найдено при живой проверке A-02. Payload refresh-токена был
 * `{ user_id, type: 'refresh' }` плюс `iat`/`exp`, которые JWT считает в
 * СЕКУНДАХ. Значит два выпуска для одного пользователя в пределах одной
 * секунды давали побайтово одинаковую строку — а чёрный список ключуется по
 * хэшу строки.
 *
 * Пока реплей ловил middleware, это было безобидной странностью: пользователь
 * получал 401 и логинился заново. После A-02 решение принимает сервис, и
 * повтор ЗА пределами окна добросовестной гонки отзывает ВСЕ сессии
 * пользователя. То есть совпадение по секунде превращалось бы в разлогин на
 * всех устройствах — без всякой кражи.
 *
 * Наблюдалось дважды вживую: два temp-токена подряд («Temporary token has
 * already been used» на честном логине) и refresh-кука, не менявшаяся после
 * успешной ротации.
 *
 * Лечится не оговоркой в документации, а `jti`: случайный идентификатор в
 * payload делает строку уникальной по построению.
 */

process.env.JWT_SECRET = 'test-secret-key-that-is-long-enough-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-long-enough-123';
process.env.JWT_2FA_SECRET = 'test-2fa-secret-that-is-long-enough-1234567';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
}));

const jwt = require('jsonwebtoken');
const authService = require('../../../src/services/authService');

const USER = { user_id: 7, username: 'racer', email: 'racer@example.com', role: 'user' };

describe('[A-02-jti] токены, выпущенные в одну секунду, различаются', () => {
    test('refresh-токен уникален при двух выпусках подряд', () => {
        const a = authService.generateTokens(USER);
        const b = authService.generateTokens(USER);

        // Именно refresh критичен: он ротируется и ключует чёрный список.
        expect(a.refreshToken).not.toBe(b.refreshToken);
    });

    test('access-токен тоже уникален — его гасит логаут', () => {
        // Совпадение access-токенов означало бы, что выход на одном устройстве
        // гасит сессию на другом.
        const a = authService.generateTokens(USER);
        const b = authService.generateTokens(USER);

        expect(a.accessToken).not.toBe(b.accessToken);
    });

    test('temp-токен 2FA уникален — иначе честный вход ловит «уже использован»', () => {
        const a = authService.generateTempToken(USER);
        const b = authService.generateTempToken(USER);

        expect(a).not.toBe(b);
    });

    test('уникальность даёт jti, а не время: iat у пары совпадает', () => {
        const a = authService.generateTokens(USER);
        const b = authService.generateTokens(USER);
        const da = jwt.decode(a.refreshToken);
        const db_ = jwt.decode(b.refreshToken);

        expect(da.iat).toBe(db_.iat);          // та же секунда
        expect(da.jti).toBeDefined();
        expect(da.jti).not.toBe(db_.jti);      // и всё же разные токены
    });

    test('прочие claims не изменились — совместимость проверок', () => {
        const { refreshToken, accessToken } = authService.generateTokens(USER);

        expect(jwt.decode(refreshToken)).toMatchObject({ user_id: 7, type: 'refresh' });
        expect(jwt.decode(accessToken)).toMatchObject({ user_id: 7, username: 'racer', role: 'user' });
        expect(jwt.decode(authService.generateTempToken(USER))).toMatchObject({ scope: '2fa' });
    });
});
