/**
 * [M-5] Повторная проверка пароля обязана считаться в блокировке аккаунта.
 *
 * Что было не так
 * ---------------
 * `verifyPasswordOnly` (SEC-105) намеренно не трогал счётчик неудачных попыток:
 * «во вторичных потоках аутентификации промах не должен блокировать аккаунт».
 * В результате `/auth/disable-2fa` и `/auth/change-password` — два оракула
 * пароля, где перебор не стоит ничего: единственный тормоз — per-IP лимитер,
 * а он снимается сменой адреса.
 *
 * Предусловие атаки честно ограничивает серьёзность: оба эндпоинта закрыты
 * default-deny JWT, то есть нападающий уже держит валидную сессию. Но именно
 * поэтому подбор там ценен — он превращает украденный (временный) токен в
 * знание пароля, то есть в постоянный доступ, и заодно снимает 2FA.
 *
 * Исходное опасение SEC-105 — «пользователь заблокирует сам себя» — остаётся
 * верным, но цена ошибки несимметрична: самоблокировка на 15 минут против
 * неограниченного перебора пароля. Меняем решение осознанно, тесты SEC-105 в
 * phase1-2fa-hardening.test.js переписаны тем же PR.
 *
 * Ключ блокировки — `username`, тот же, что у формы входа: иначе счётчики
 * разъехались бы на два независимых ведра и лимит по сути удвоился.
 */

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    invalidate: jest.fn().mockResolvedValue(true)
}));
jest.mock('bcrypt', () => ({
    compare: jest.fn(),
    hash: jest.fn().mockResolvedValue('$2b$12$newhash')
}));
jest.mock('../../../src/models/AccountLockout', () => ({
    get: jest.fn().mockResolvedValue(null),
    recordFailedAttempt: jest.fn().mockResolvedValue({ failed_attempts: 1, locked_until: null }),
    clearAttempts: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(0)
}));
jest.mock('../../../src/models/User', () => ({
    findAuthProjection: jest.fn(),
    getActivePasswordHash: jest.fn(),
    getPasswordHash: jest.fn(),
    updatePassword: jest.fn().mockResolvedValue(undefined)
}));

const bcrypt = require('bcrypt');
const AccountLockout = require('../../../src/models/AccountLockout');
const User = require('../../../src/models/User');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-reauth-lockout';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-reauth';

const authService = require('../../../src/services/authService');

const ACTIVE_USER = {
    user_id: 7,
    username: 'operator',
    email: 'operator@example.com',
    role: 'user',
    is_active: true,
    account_locked_until: null
};

beforeEach(() => {
    jest.clearAllMocks();
    User.findAuthProjection.mockResolvedValue({ ...ACTIVE_USER });
    User.getActivePasswordHash.mockResolvedValue('$2b$12$storedhash');
    User.getPasswordHash.mockResolvedValue('$2b$12$storedhash');
    AccountLockout.get.mockResolvedValue(null);
    AccountLockout.recordFailedAttempt.mockResolvedValue({ failed_attempts: 1, locked_until: null });
});

describe('[M-5] verifyReauthPassword считается в блокировке', () => {
    test('промах записывается в счётчик по username И по user_id', async () => {
        bcrypt.compare.mockResolvedValueOnce(false);

        const result = await authService.verifyReauthPassword(7, 'guess');

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('bad_password');
        // user_id обязателен: именно он переносит блокировку на
        // users.account_locked_until, а её и проверяет auth-middleware.
        expect(AccountLockout.recordFailedAttempt).toHaveBeenCalledWith(
            'operator', expect.any(Number), expect.any(Number), 7
        );
    });

    test('успешная проверка сбрасывает счётчик', async () => {
        bcrypt.compare.mockResolvedValueOnce(true);

        const result = await authService.verifyReauthPassword(7, 'correct');

        expect(result.ok).toBe(true);
        expect(AccountLockout.clearAttempts).toHaveBeenCalledWith('operator', 7);
        expect(AccountLockout.recordFailedAttempt).not.toHaveBeenCalled();
    });

    test('заблокированный аккаунт отвергается ДО сравнения пароля', async () => {
        User.findAuthProjection.mockResolvedValue({
            ...ACTIVE_USER,
            account_locked_until: new Date(Date.now() + 10 * 60 * 1000)
        });

        await expect(authService.verifyReauthPassword(7, 'guess'))
            .rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });

        // Иначе блокировка не мешала бы перебору: попытки продолжали бы
        // проверяться, просто с уже взведённым счётчиком.
        expect(bcrypt.compare).not.toHaveBeenCalledWith('guess', expect.anything());
    });

    test('истёкшая блокировка не мешает', async () => {
        User.findAuthProjection.mockResolvedValue({
            ...ACTIVE_USER,
            account_locked_until: new Date(Date.now() - 1000)
        });
        bcrypt.compare.mockResolvedValueOnce(true);

        await expect(authService.verifyReauthPassword(7, 'correct'))
            .resolves.toMatchObject({ ok: true });
    });

    test('решение о блокировке читается НЕ из кэша', async () => {
        bcrypt.compare.mockResolvedValueOnce(true);

        await authService.verifyReauthPassword(7, 'correct');

        // findUserById кэширует строку на 5 минут и поэтому непригоден для
        // решений об аутентификации (H-1/H-2). Здесь обязан быть прямой
        // uncached-чтение через findAuthProjection.
        expect(User.findAuthProjection).toHaveBeenCalledWith(7);
    });

    test('несуществующий или отключённый пользователь — no_user, без записи попытки', async () => {
        User.findAuthProjection.mockResolvedValue(null);

        const result = await authService.verifyReauthPassword(999, 'anything');

        expect(result).toMatchObject({ ok: false, reason: 'no_user' });
        // Ключа блокировки нет — писать попытку некуда, а придумывать ключ
        // из user_id значило бы завести второе ведро счётчиков.
        expect(AccountLockout.recordFailedAttempt).not.toHaveBeenCalled();
    });

    test('пользователь без пароля — no_user, без сравнения', async () => {
        User.getActivePasswordHash.mockResolvedValue(null);

        const result = await authService.verifyReauthPassword(7, 'anything');

        expect(result).toMatchObject({ ok: false, reason: 'no_user' });
        expect(bcrypt.compare).not.toHaveBeenCalled();
    });
});

describe('[M-5] changePassword — тот же оракул, та же защита', () => {
    test('неверный текущий пароль записывается в счётчик', async () => {
        bcrypt.compare.mockResolvedValueOnce(false);

        await expect(authService.changePassword(7, 'guess', 'NewPass123!'))
            .rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });

        expect(AccountLockout.recordFailedAttempt).toHaveBeenCalledWith(
            'operator', expect.any(Number), expect.any(Number), 7
        );
    });

    test('заблокированный аккаунт не может сменить пароль', async () => {
        User.findAuthProjection.mockResolvedValue({
            ...ACTIVE_USER,
            account_locked_until: new Date(Date.now() + 10 * 60 * 1000)
        });

        await expect(authService.changePassword(7, 'guess', 'NewPass123!'))
            .rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });

        expect(User.updatePassword).not.toHaveBeenCalled();
    });

    test('успешная смена пароля сбрасывает счётчик', async () => {
        bcrypt.compare.mockResolvedValueOnce(true);

        await authService.changePassword(7, 'correct', 'NewPass123!');

        expect(AccountLockout.clearAttempts).toHaveBeenCalledWith('operator', 7);
        expect(User.updatePassword).toHaveBeenCalled();
    });
});
