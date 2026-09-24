/**
 * [N-17, N-19] Гигиена кода 2FA: одна и та же строка — один ключ дедупа,
 * мусорный формат — отказ, а не 500.
 *
 * N-17. Проверка шла по `code.trim()`, а anti-replay (SEC-106) хэшировал СЫРОЙ
 * `code`. `"123456"` и `"123456 "` давали разные ключи, а otplib одинаково
 * считал оба верными — перехваченный свежий OTP повторялся с пробелом в окне,
 * которое SEC-106 обещает закрыть.
 *
 * N-19. `confirmSetup` отдавал код в otplib без проверки формата — фикс A-11
 * стоял только в `verifyCode`. Настоящая otplib на нешестизначном значении
 * бросает, и ответ был 500 вместо 400. Мок `__mocks__/otplib.js` повторяет этот
 * контракт (см. totpService.realOtplib.test.js).
 */
process.env.TOTP_ENCRYPTION_KEY = 'totp-test-key-that-is-at-least-32-bytes-long-123456';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
// [N-38] Настоящий bcrypt, но не дороже 4 раундов: с продовыми 12 тесты
// упирались в таймаут под нагрузкой полного прогона.
jest.mock('bcrypt', () => require('../helpers/fastBcrypt'));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    invalidate: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
}));

const otplib = require('otplib');
const db = require('../../../src/config/database');
const totpService = require('../../../src/services/totpService');

const SECRET = otplib.generateSecret();

const enabledState = () => ({
    totp_secret: totpService.encrypt(SECRET),
    totp_enabled: true,
    recovery_codes: [],
});

// Незавершённая настройка: секрет выдан, 2FA ещё не включена.
const pendingState = () => ({
    totp_secret: totpService.encrypt(SECRET),
    totp_enabled: false,
});

beforeEach(() => {
    db.query.mockReset();
});

describe('[N-17] anti-replay считает по той же строке, что и проверка', () => {
    test.each([
        ['пробел в конце', (c) => `${c} `],
        ['пробел в начале', (c) => ` ${c}`],
        ['перевод строки', (c) => `${c}\n`],
    ])('тот же код с приписанным «%s» повторно не проходит', async (_label, decorate) => {
        const userId = 5101 + Math.floor(Math.random() * 1e6);
        db.query.mockResolvedValue({ rows: [enabledState()] });
        const code = String(otplib.generateSync({ secret: SECRET }));

        await expect(totpService.verifyCode(userId, code)).resolves.toEqual({ valid: true, method: 'totp' });
        await expect(totpService.verifyCode(userId, decorate(code)))
            .resolves.toEqual({ valid: false, reason: 'code_already_used' });
    });

    test('confirmSetup: тот же код с пробелом повторно не принимается', async () => {
        const userId = 6101 + Math.floor(Math.random() * 1e6);
        const code = String(otplib.generateSync({ secret: SECRET }));
        // Первый confirm: чтение состояния, включение 2FA, чтение отложенных кодов.
        db.query.mockResolvedValue({ rows: [pendingState()] });
        await totpService.confirmSetup(userId, code).catch(() => {});

        db.query.mockResolvedValue({ rows: [pendingState()] });
        await expect(totpService.confirmSetup(userId, `${code} `)).rejects.toThrow('TOTP code already used');
    });
});

describe('[N-19] confirmSetup: мусорный формат — отказ, а не исключение otplib', () => {
    test.each(['123', 'A1B2-C3D4', 'не-код', ''])('%p → Invalid TOTP code', async (garbage) => {
        db.query.mockResolvedValue({ rows: [pendingState()] });

        await expect(totpService.confirmSetup(7001, garbage)).rejects.toThrow('Invalid TOTP code');
    });

    test('верный код с пробелами по краям принимается', async () => {
        db.query.mockResolvedValue({ rows: [pendingState()] });
        const code = String(otplib.generateSync({ secret: SECRET }));

        await expect(totpService.confirmSetup(7002 + Math.floor(Math.random() * 1e6), ` ${code} `))
            .resolves.not.toThrow();
    });
});
