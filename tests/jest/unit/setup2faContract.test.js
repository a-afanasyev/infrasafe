/**
 * [M-4-contract] Контракт ответов 2FA-настройки.
 *
 * Коды восстановления выдаются ровно один раз — на `confirm-2fa`, в момент,
 * когда 2FA действительно включилась. Ответ `setup-2fa` их содержать НЕ должен:
 * до 12.08.2026 они показывались до подтверждения и, из-за идемпотентности
 * setup, повторялись при каждом обновлении QR-страницы (M-4). Поле держали ещё
 * одну выкладку под старый закэшированный бандл (expand/contract); бандлы
 * отдаются с `Cache-Control: no-cache`, окно закрылось — поле снято.
 *
 * Тест нарочно скармливает контроллеру сервисный ответ СО старым полем:
 * контроллер — рубеж контракта и не должен пробрасывать лишнее, даже если
 * сервис однажды снова начнёт его отдавать.
 */

'use strict';

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
jest.mock('../../../src/services/authService', () => ({
    generateTokens: jest.fn(),
    blacklistToken: jest.fn()
}));
jest.mock('../../../src/services/totpService', () => ({
    generateSetup: jest.fn(),
    confirmSetup: jest.fn()
}));

const authController = require('../../../src/controllers/authController');
const authService = require('../../../src/services/authService');
const totpService = require('../../../src/services/totpService');

function makeRes() {
    return {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
        cookie: jest.fn(),
        clearCookie: jest.fn()
    };
}

const TEMP_USER = { user_id: 9, username: 'admin', role: 'admin' };

describe('[M-4-contract] setup-2fa / confirm-2fa response contract', () => {
    beforeEach(() => jest.clearAllMocks());

    test('setup-2fa отдаёт QR и секрет, но НЕ recoveryCodes — даже если сервис их вернул', async () => {
        totpService.generateSetup.mockResolvedValue({
            qrCodeUrl: 'data:image/png;base64,QR',
            secret: 'BASE32SECRET',
            recoveryCodes: ['AAAA-1111', 'BBBB-2222']
        });
        const req = { tempUser: TEMP_USER, headers: {}, cookies: {} };
        const res = makeRes();

        await authController.setup2FA(req, res, jest.fn());

        const body = res.json.mock.calls[0][0];
        expect(body).toMatchObject({
            success: true,
            qrCodeUrl: 'data:image/png;base64,QR',
            secret: 'BASE32SECRET'
        });
        // Именно отсутствие КЛЮЧА: `recoveryCodes: undefined` — тоже утечка
        // контракта (сериализуется в «поле было и опустело», а не «поля нет»).
        expect('recoveryCodes' in body).toBe(false);
    });

    test('confirm-2fa по-прежнему отдаёт recoveryCodes — единственная точка выдачи', async () => {
        const codes = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333'];
        totpService.confirmSetup.mockResolvedValue(codes);
        authService.generateTokens.mockReturnValue({ accessToken: 'A', refreshToken: 'R' });
        const req = {
            body: { code: '123456' },
            tempUser: TEMP_USER,
            tempToken: 'tmp',
            headers: {},
            cookies: {}
        };
        const res = makeRes();

        await authController.confirm2FA(req, res, jest.fn());

        const body = res.json.mock.calls[0][0];
        expect(body.success).toBe(true);
        expect(body.recoveryCodes).toEqual(codes);
    });
});
