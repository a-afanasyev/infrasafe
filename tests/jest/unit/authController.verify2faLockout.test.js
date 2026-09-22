/**
 * [N-03] verify2FA записывает каждый промах второго фактора и снимает счётчик
 * на успехе. Механика блокировки — в authService (authService.twoFaLockout.test.js);
 * здесь — что контроллер её действительно зовёт: рубеж, подключённый в сервисе,
 * но не вызванный из маршрута, — ровно то, чем однажды стал AUD-001.
 */
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/authService', () => ({
    generateTokens: jest.fn(),
    blacklistToken: jest.fn(),
    recordFailed2FA: jest.fn(),
    clearFailed2FA: jest.fn(),
}));
jest.mock('../../../src/services/totpService', () => ({
    verifyCode: jest.fn(),
}));

const authController = require('../../../src/controllers/authController');
const authService = require('../../../src/services/authService');
const totpService = require('../../../src/services/totpService');
const logger = require('../../../src/utils/logger');

const makeRes = () => {
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};
const makeReq = (code) => ({
    body: { code },
    headers: {},
    cookies: {},
    tempToken: 'temp-token',
    tempUser: { user_id: 9, username: 'admin', role: 'admin' },
});

beforeEach(() => {
    jest.clearAllMocks();
    authService.generateTokens.mockReturnValue({ accessToken: 'A', refreshToken: 'R' });
    authService.recordFailed2FA.mockResolvedValue(undefined);
    authService.clearFailed2FA.mockResolvedValue(undefined);
    authService.blacklistToken.mockResolvedValue(undefined);
});

describe('[N-03] verify2FA и счётчик промахов', () => {
    test('неверный код — 401 и промах записан на пользователя', async () => {
        totpService.verifyCode.mockResolvedValue({ valid: false });
        const res = makeRes();

        await authController.verify2FA(makeReq('000000'), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(authService.recordFailed2FA).toHaveBeenCalledWith(9);
        expect(authService.clearFailed2FA).not.toHaveBeenCalled();
    });

    test('повтор уже использованного кода — тоже промах', async () => {
        totpService.verifyCode.mockResolvedValue({ valid: false, reason: 'code_already_used' });

        await authController.verify2FA(makeReq('123456'), makeRes(), jest.fn());

        expect(authService.recordFailed2FA).toHaveBeenCalledWith(9);
    });

    test('верный код — счётчик снят, промах не записан', async () => {
        totpService.verifyCode.mockResolvedValue({ valid: true, method: 'totp' });

        await authController.verify2FA(makeReq('123456'), makeRes(), jest.fn());

        expect(authService.clearFailed2FA).toHaveBeenCalledWith(9);
        expect(authService.recordFailed2FA).not.toHaveBeenCalled();
    });

    test('сбой записи промаха не превращает отказ в успех и не молчит', async () => {
        totpService.verifyCode.mockResolvedValue({ valid: false });
        authService.recordFailed2FA.mockRejectedValue(new Error('db down'));
        const res = makeRes();

        await authController.verify2FA(makeReq('000000'), res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });
});
