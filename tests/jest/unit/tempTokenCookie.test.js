/**
 * [M-4] `tempToken` и коды восстановления уезжают из тела ответа.
 *
 * Разбор пункта
 * -------------
 * Бэклог сводил в один пункт две РАЗНЫЕ задачи, и обращаться с ними одинаково
 * нельзя:
 *
 * 1. `tempToken` в теле — упущение того же рода, что закрыли для access/refresh
 *    в P1-2: предъявительский токен, читаемый из JS. Масштаб скромнее, чем
 *    звучит (5 минут жизни, scope `2fa`, гасится после терминальной операции,
 *    отвергается при смене пароля / блокировке / деактивации, а с M-6 — и при
 *    отзыве сессий), но чинится тем же приёмом: HttpOnly-кука.
 *
 * 2. Секрет TOTP и коды восстановления — НЕ дефект того же рода. Их обязан
 *    увидеть человек: секрет чтобы вбить руками, если QR не читается, коды
 *    чтобы записать. В HttpOnly-куке они бессмысленны. Осмысленное здесь
 *    другое: сейчас коды выдаются на шаге `setup-2fa`, то есть ДО
 *    подтверждения, и `generateSetup` идемпотентен — при каждом обновлении
 *    страницы отдаются те же коды. Правильный момент — `confirm-2fa`, когда
 *    человек уже доказал, что аутентификатор у него в руках.
 *
 * Порядок выкладки
 * ----------------
 * Куки — сразу: старый закэшированный JS читает `data.tempToken`, получает
 * undefined, отправляет тело без него, а middleware берёт токен из куки,
 * которую браузер шлёт сам. Ничего не ломается.
 *
 * Коды — через expand/contract, как у миграций: старый JS делал
 * `data.recoveryCodes.join('\n')` на ответе `setup-2fa`, поэтому на одну
 * выкладку поле возвращалось В ОБОИХ местах, а фронт переехал на `confirm-2fa`.
 * Contract-шаг сделан 14.08.2026 (M-4-contract): из `setup-2fa` поле снято,
 * рубеж закреплён в `setup2faContract.test.js`.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const {
    COOKIE_NAMES,
    setTempCookie,
    setAuthCookies,
    clearAuthCookies,
    extractTempToken
} = require('../../../src/utils/authCookies');

/** Мини-дублёр express-ответа: запоминает выставленные и снятые куки. */
function fakeRes() {
    return {
        set: {},
        cleared: [],
        cookie(name, value, opts) { this.set[name] = { value, opts }; },
        clearCookie(name) { this.cleared.push(name); }
    };
}

describe('[M-4] кука временного токена', () => {
    test('ставится HttpOnly и живёт не дольше самого токена', () => {
        const res = fakeRes();

        setTempCookie(res, 'temp.jwt.value');

        const cookie = res.set[COOKIE_NAMES.temp];
        expect(cookie.value).toBe('temp.jwt.value');
        expect(cookie.opts.httpOnly).toBe(true);
        expect(cookie.opts.sameSite).toBe('strict');
        // Сам JWT живёт 5 минут; кука, пережившая его, — только мусор в браузере.
        expect(cookie.opts.maxAge).toBeLessThanOrEqual(5 * 60 * 1000);
    });

    test('выдача полных токенов снимает временную куку', () => {
        const res = fakeRes();

        setAuthCookies(res, { accessToken: 'a', refreshToken: 'r' });

        // Полные токены выдаются только когда 2FA-поток завершён. Снимать куку
        // здесь, а не в каждом терминальном контроллере, — чтобы её нельзя
        // было забыть снять на новом пути.
        expect(res.cleared).toContain(COOKIE_NAMES.temp);
    });

    test('выход снимает временную куку тоже', () => {
        const res = fakeRes();

        clearAuthCookies(res);

        expect(res.cleared).toContain(COOKIE_NAMES.temp);
    });
});

describe('[M-4] извлечение временного токена', () => {
    test('кука имеет приоритет над телом', () => {
        const req = {
            cookies: { [COOKIE_NAMES.temp]: 'from-cookie' },
            body: { tempToken: 'from-body' }
        };

        // Тело подконтрольно скрипту на странице, кука — нет.
        expect(extractTempToken(req)).toBe('from-cookie');
    });

    test('тело остаётся запасным путём на время выкладки', () => {
        const req = { cookies: {}, body: { tempToken: 'from-body' } };

        // Старый закэшированный JS ещё шлёт токен в теле. Убрать этот путь —
        // отдельный PR, после того как новый JS разойдётся по браузерам.
        expect(extractTempToken(req)).toBe('from-body');
    });

    test('пустая кука не считается токеном', () => {
        const req = { cookies: { [COOKIE_NAMES.temp]: '' }, body: { tempToken: 'from-body' } };

        expect(extractTempToken(req)).toBe('from-body');
    });

    test('нет ни куки, ни тела — null', () => {
        expect(extractTempToken({ cookies: {}, body: {} })).toBeNull();
    });
});

describe('[M-4] коды восстановления выдаются на подтверждении', () => {
    // Отдельный модуль: totpService тянет crypto/otplib и требует своих моков,
    // поэтому подключается изолированно от куки-хелперов выше.
    let totpService;
    let cacheService;
    let User;

    beforeEach(() => {
        jest.resetModules();
        jest.doMock('../../../src/config/database', () => ({ query: jest.fn() }));
        jest.doMock('../../../src/services/cacheService', () => ({
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(true),
            invalidate: jest.fn().mockResolvedValue(true)
        }));
        jest.doMock('../../../src/models/User', () => ({
            getTotpState: jest.fn(),
            enableTotp: jest.fn().mockResolvedValue(undefined),
            setTotpSecret: jest.fn().mockResolvedValue(undefined),
            setRecoveryCodes: jest.fn().mockResolvedValue(undefined)
        }));
        process.env.TOTP_ENCRYPTION_KEY = 'a]3Fk9L!mN7pQ2rS5tV8wZ0bD4gJ6iKx';

        cacheService = require('../../../src/services/cacheService');
        User = require('../../../src/models/User');
        totpService = require('../../../src/services/totpService');
    });

    /** Состояние «настройка начата, но не подтверждена». */
    function pendingSetup() {
        const encrypted = totpService.encrypt('JBSWY3DPEHPK3PXP');
        User.getTotpState.mockResolvedValue({ totp_secret: encrypted, totp_enabled: false });
        const otplib = require('otplib');
        jest.spyOn(otplib, 'verifySync').mockReturnValue({ valid: true });
    }

    test('возвращает набор, отложенный на шаге setup', async () => {
        pendingSetup();
        cacheService.get.mockResolvedValue(['AAAA-1111', 'BBBB-2222']);

        const codes = await totpService.confirmSetup(5, '123456');

        expect(codes).toEqual(['AAAA-1111', 'BBBB-2222']);
        // Набор уже сохранён хэшами на шаге setup — перезаписывать нечего.
        expect(User.setRecoveryCodes).not.toHaveBeenCalled();
    });

    test('кэш протух — выпускается свежий набор и перезаписываются хэши', async () => {
        pendingSetup();
        cacheService.get.mockResolvedValue(null);

        const codes = await totpService.confirmSetup(6, '123456');

        // Отдать пользователю пустоту нельзя: перевыпустить коды ему нечем, и
        // он остался бы с включённой 2FA без единого запасного ключа.
        expect(Array.isArray(codes)).toBe(true);
        expect(codes.length).toBeGreaterThan(0);
        expect(User.setRecoveryCodes).toHaveBeenCalledWith(6, expect.any(String));
    });

    test('открытый набор стирается из кэша сразу после выдачи', async () => {
        pendingSetup();
        cacheService.get.mockResolvedValue(['AAAA-1111']);

        await totpService.confirmSetup(7, '123456');

        expect(cacheService.invalidate).toHaveBeenCalledWith('totp:setup:recovery:7');
    });
});
