/**
 * [N-03] Промахи второго фактора считаются на аккаунт.
 *
 * Неверный 2FA-код давал 401, но промах не записывался никуда: единственным
 * ограничителем был лимит 10 попыток за 15 минут НА IP, а каждый вход с верным
 * паролем выдавал свежий temp-токен. Злоумышленнику с паролем админа хватало
 * N адресов, чтобы перебирать второй фактор без счётчика на аккаунт.
 *
 * Счётчик — отдельный ключ `account_lockout`, привязанный к ПОЛЬЗОВАТЕЛЮ, а не
 * к введённому логину: успешный вход по паролю сбрасывает счётчик логина
 * (clearFailedAttempts), и общий счётчик обнулялся бы перед каждой серией. На
 * пороге блокировка зеркалится в `users.account_locked_until` (H-1), а его
 * проверяют и вход — до сравнения пароля, — и verifyTempToken.
 */
jest.mock('../../../src/models/AccountLockout', () => ({
    get: jest.fn(),
    recordFailedAttempt: jest.fn(),
    clearAttempts: jest.fn(),
    cleanup: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
}));

const AccountLockout = require('../../../src/models/AccountLockout');
const authService = require('../../../src/services/authService');

beforeEach(() => {
    jest.clearAllMocks();
    AccountLockout.get.mockResolvedValue(null);
    AccountLockout.recordFailedAttempt.mockResolvedValue({ failed_attempts: 1, locked_until: null });
    AccountLockout.clearAttempts.mockResolvedValue(undefined);
});

describe('[N-03] recordFailed2FA', () => {
    test('промах пишется под ключом пользователя с зеркалом в users', async () => {
        await authService.recordFailed2FA(7);

        expect(AccountLockout.recordFailedAttempt).toHaveBeenCalledWith(
            '2fa:user:7', authService.maxLoginAttempts, expect.any(Number), 7
        );
    });

    // Истёкшая блокировка сбрасывается внутри атомарного UPSERT модели
    // (accountLockout.db.test.js). Сервис не должен делать это сам отдельным
    // «прочитать → очистить»: между шагами параллельный промах успевал выставить
    // свежую блокировку, и устаревшая очистка её стирала (ревью N-03).
    test('ровно одна атомарная запись — без отдельного чтения и очистки', async () => {
        AccountLockout.get.mockResolvedValue({
            failed_attempts: 5, locked_until: new Date(Date.now() - 1000),
        });

        await authService.recordFailed2FA(7);

        expect(AccountLockout.recordFailedAttempt).toHaveBeenCalledTimes(1);
        expect(AccountLockout.get).not.toHaveBeenCalled();
        expect(AccountLockout.clearAttempts).not.toHaveBeenCalled();
    });
});

describe('[N-03] clearFailed2FA', () => {
    test('успех второго фактора снимает только счётчик 2FA', async () => {
        await authService.clearFailed2FA(7);

        expect(AccountLockout.clearAttempts).toHaveBeenCalledWith('2fa:user:7');
    });
});

describe('[N-03] ключ 2FA нельзя подделать через форму входа', () => {
    // account_lockout — одна таблица для логинов и ключей 2FA. Аноним, набравший
    // `2fa:user:7` как логин, иначе накручивал бы счётчик второго фактора чужого
    // аккаунта: после этого один промах самого владельца запирал бы его.
    test('логин с зарезервированным префиксом отвергается, не касаясь блокировок', async () => {
        await expect(authService.authenticateUser('2fa:user:7', 'whatever'))
            .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

        expect(AccountLockout.get).not.toHaveBeenCalled();
        expect(AccountLockout.recordFailedAttempt).not.toHaveBeenCalled();
    });
});

describe('[N-03] зарезервированный префикс нельзя занять при создании пользователя', () => {
    test('validateUserData отвергает имя с префиксом ключа 2FA', () => {
        expect(() => authService.validateUserData({
            username: '2fa:user:1', email: 'x@example.com', password: 'Str0ngPassw0rd!',
        })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });

    test('обычное имя проходит', () => {
        expect(() => authService.validateUserData({
            username: 'operator', email: 'x@example.com', password: 'Str0ngPassw0rd!',
        })).not.toThrow();
    });
});
