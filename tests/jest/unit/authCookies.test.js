/**
 * [P1-2] Unit tests for authCookies utility + cookie-aware controllers.
 *
 * Covers:
 *   - cookie attributes are correct (httpOnly, secure, sameSite, path, maxAge)
 *   - secure flag tracks NODE_ENV (off in dev, on in prod)
 *   - extractAccessToken: header > cookie > null
 *   - extractRefreshToken: body > cookie > null
 *   - login / verify2FA / confirm2FA / refresh emit Set-Cookie
 *   - logout clears all three cookies (access/refresh + [M-4] temp)
 *   - middleware accepts a token delivered via cookie alone
 */

'use strict';

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const {
    COOKIE_NAMES,
    COOKIE_PATH,
    LEGACY_COOKIE_PATH,
    setAuthCookies,
    setTempCookie,
    clearAuthCookies,
    extractAccessToken,
    extractRefreshToken
} = require('../../../src/utils/authCookies');

describe('[P1-2] authCookies utility', () => {
    let res;
    const originalEnv = process.env;

    beforeEach(() => {
        res = { cookie: jest.fn(), clearCookie: jest.fn() };
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('setAuthCookies', () => {
        test('emits both access_token and refresh_token with secure attrs in production', () => {
            process.env.NODE_ENV = 'production';

            setAuthCookies(res, { accessToken: 'A', refreshToken: 'R' });

            expect(res.cookie).toHaveBeenCalledTimes(2);
            expect(res.cookie).toHaveBeenCalledWith(
                COOKIE_NAMES.access, 'A',
                expect.objectContaining({
                    httpOnly: true,
                    secure: true,
                    sameSite: 'strict',
                    path: '/api',
                    maxAge: expect.any(Number)
                })
            );
            expect(res.cookie).toHaveBeenCalledWith(
                COOKIE_NAMES.refresh, 'R',
                expect.objectContaining({
                    httpOnly: true,
                    secure: true,
                    sameSite: 'strict',
                    path: '/api'
                })
            );
        });

        // [S-PERIM-2] Path=/api: браузер не шлёт куки на /uk/* (чужой стек за
        // тем же edge), на /map и статику. Приложение читает их только под /api.
        test('[S-PERIM-2] cookies are scoped to /api and legacy Path=/ copies are cleared on every issue', () => {
            setAuthCookies(res, { accessToken: 'A', refreshToken: 'R' });

            for (const [, , opts] of res.cookie.mock.calls) {
                expect(opts.path).toBe(COOKIE_PATH);
                expect(opts.path).toBe('/api');
            }
            // Старые куки с Path=/ удаляются только Set-Cookie с тем же Path
            // (RFC 6265) — иначе они жили бы до 7 дней и продолжали утекать.
            for (const name of [COOKIE_NAMES.access, COOKIE_NAMES.refresh, COOKIE_NAMES.temp]) {
                expect(res.clearCookie).toHaveBeenCalledWith(
                    name, expect.objectContaining({ path: LEGACY_COOKIE_PATH })
                );
            }
        });

        test('[S-PERIM-2] setTempCookie also clears legacy-path cookies', () => {
            setTempCookie(res, 'T');
            expect(res.cookie).toHaveBeenCalledWith(
                COOKIE_NAMES.temp, 'T', expect.objectContaining({ path: '/api' })
            );
            expect(res.clearCookie).toHaveBeenCalledWith(
                COOKIE_NAMES.access, expect.objectContaining({ path: '/' })
            );
        });

        test('secure flag is false outside production by default', () => {
            process.env.NODE_ENV = 'development';
            delete process.env.SECURE_COOKIES;

            setAuthCookies(res, { accessToken: 'A' });

            const [, , opts] = res.cookie.mock.calls[0];
            expect(opts.secure).toBe(false);
            // httpOnly + sameSite must NOT relax in dev — those are
            // unrelated to the HTTPS-vs-HTTP distinction.
            expect(opts.httpOnly).toBe(true);
            expect(opts.sameSite).toBe('strict');
        });

        // [1A-FU-C-L1] staging override: TLS terminates at nginx but
        // NODE_ENV stays "development" — operator opts into Secure=true
        // with SECURE_COOKIES=true.
        test('secure flag honors SECURE_COOKIES=true even when NODE_ENV !== production', () => {
            process.env.NODE_ENV = 'staging';
            process.env.SECURE_COOKIES = 'true';

            setAuthCookies(res, { accessToken: 'A' });

            const [, , opts] = res.cookie.mock.calls[0];
            expect(opts.secure).toBe(true);
        });

        // [A-18] Этот тест закреплял ДЕФЕКТ как правильное поведение: «'1' —
        // не каноническая строка, Secure не включаем». Между тем валидатор
        // окружения принимает `true|false|1|0`, то есть `SECURE_COOKIES=1`
        // проходит проверку на старте и — по прежней логике — молча ничего не
        // делает. Ровно та же форма, что у A-16 с TOTP-тестом: тест объяснял,
        // почему дефект — это норма.
        test('[A-18] SECURE_COOKIES=1 ВКЛЮЧАЕТ secure — валидатор принимает эту форму', () => {
            process.env.NODE_ENV = 'development';
            process.env.SECURE_COOKIES = '1';

            setAuthCookies(res, { accessToken: 'A' });

            const [, , opts] = res.cookie.mock.calls[0];
            expect(opts.secure).toBe(true);
        });

        test('[A-18] мусорное значение НЕ включает secure', () => {
            // Верная половина прежнего намерения: опечатка не должна менять
            // поведение безопасности.
            process.env.NODE_ENV = 'development';
            process.env.SECURE_COOKIES = 'ture';

            setAuthCookies(res, { accessToken: 'A' });

            const [, , opts] = res.cookie.mock.calls[0];
            expect(opts.secure).toBe(false);
        });

        test('skips refresh cookie when refreshToken is absent', () => {
            setAuthCookies(res, { accessToken: 'A' });
            expect(res.cookie).toHaveBeenCalledTimes(1);
            expect(res.cookie).toHaveBeenCalledWith(
                COOKIE_NAMES.access, 'A', expect.any(Object)
            );
        });

        test('refresh cookie maxAge is much larger than access (7d vs 1h)', () => {
            setAuthCookies(res, { accessToken: 'A', refreshToken: 'R' });
            const accessOpts = res.cookie.mock.calls.find(c => c[0] === COOKIE_NAMES.access)[2];
            const refreshOpts = res.cookie.mock.calls.find(c => c[0] === COOKIE_NAMES.refresh)[2];
            expect(refreshOpts.maxAge).toBeGreaterThan(accessOpts.maxAge);
            // 7d is ~168x 1h
            expect(refreshOpts.maxAge / accessOpts.maxAge).toBeGreaterThan(100);
        });
    });

    describe('clearAuthCookies', () => {
        test('clears all three names with matching attributes (browser-accept condition)', () => {
            clearAuthCookies(res);
            // [M-4] Третья кука — temp_token: выход обязан снимать и её,
            // иначе брошенный на полпути 2FA-поток оставлял бы живой
            // предъявительский токен ещё на пять минут.
            // [S-PERIM-2] ×2: текущий путь /api и старый Path=/ — иначе кука,
            // выданная до перехода, переживает logout и снова попадает в /api.
            expect(res.clearCookie).toHaveBeenCalledTimes(6);
            // path + sameSite + secure + httpOnly must match the SET to clear
            const accessClears = res.clearCookie.mock.calls.filter(c => c[0] === COOKIE_NAMES.access).map(c => c[1]);
            expect(accessClears).toEqual(expect.arrayContaining([
                expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/api' }),
                expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' })
            ]));
        });
    });

    describe('extractAccessToken', () => {
        // [1A-FU-S-L4] cookie-first precedence — browser-set HttpOnly
        // cookie is the trusted source; Authorization header is only
        // for programmatic API clients (curl, service-to-service).
        test('returns cookie token when BOTH cookie and header present (cookie wins)', () => {
            const req = {
                headers: { authorization: 'Bearer header-tok' },
                cookies: { [COOKIE_NAMES.access]: 'cookie-tok' }
            };
            expect(extractAccessToken(req)).toBe('cookie-tok');
        });

        test('returns header token when cookie is missing', () => {
            const req = { headers: { authorization: 'Bearer header-tok' }, cookies: {} };
            expect(extractAccessToken(req)).toBe('header-tok');
        });

        test('returns cookie token when header is missing', () => {
            const req = { headers: {}, cookies: { [COOKIE_NAMES.access]: 'cookie-tok' } };
            expect(extractAccessToken(req)).toBe('cookie-tok');
        });

        test('returns null when neither source is present', () => {
            expect(extractAccessToken({ headers: {}, cookies: {} })).toBeNull();
            expect(extractAccessToken({ headers: {} })).toBeNull();
            expect(extractAccessToken({})).toBeNull();
        });

        test('empty-string cookie value falls through to header', () => {
            const req = {
                headers: { authorization: 'Bearer header-tok' },
                cookies: { [COOKIE_NAMES.access]: '' }
            };
            expect(extractAccessToken(req)).toBe('header-tok');
        });

        test('returns null for "Bearer " with empty token (falls through, no cookie)', () => {
            const req = { headers: { authorization: 'Bearer ' }, cookies: {} };
            expect(extractAccessToken(req)).toBeNull();
        });

        test('is case-insensitive on the "Bearer" scheme (header path)', () => {
            const req = { headers: { authorization: 'bearer header-tok' }, cookies: {} };
            expect(extractAccessToken(req)).toBe('header-tok');
        });
    });

    describe('extractRefreshToken', () => {
        // [1A-FU-S-L4] cookie-first precedence — same rationale.
        test('returns cookie value when BOTH cookie and body present (cookie wins)', () => {
            const req = {
                body: { refreshToken: 'body-tok' },
                cookies: { [COOKIE_NAMES.refresh]: 'cookie-tok' }
            };
            expect(extractRefreshToken(req)).toBe('cookie-tok');
        });

        test('returns body refreshToken when cookie missing', () => {
            const req = { body: { refreshToken: 'body-tok' }, cookies: {} };
            expect(extractRefreshToken(req)).toBe('body-tok');
        });

        test('returns cookie value when body is missing', () => {
            const req = { body: {}, cookies: { [COOKIE_NAMES.refresh]: 'cookie-tok' } };
            expect(extractRefreshToken(req)).toBe('cookie-tok');
        });

        test('returns null when both sources are missing', () => {
            expect(extractRefreshToken({ body: {}, cookies: {} })).toBeNull();
            expect(extractRefreshToken({})).toBeNull();
        });

        test('ignores non-string body.refreshToken values (defensive)', () => {
            const req = { body: { refreshToken: { malicious: 1 } }, cookies: { [COOKIE_NAMES.refresh]: 'cookie-tok' } };
            expect(extractRefreshToken(req)).toBe('cookie-tok');
        });
    });
});

// -----------------------------------------------------------------------------
// Controller-level integration: confirm controllers emit cookies on success
// -----------------------------------------------------------------------------

jest.mock('../../../src/services/authService', () => ({
    authenticateUser: jest.fn(),
    generateTokens: jest.fn(),
    generateTempToken: jest.fn(),
    registerUser: jest.fn(),
    findUserById: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    changePassword: jest.fn(),
    blacklistToken: jest.fn(),
    // [N-03] verify2FA ведёт счётчик промахов второго фактора.
    recordFailed2FA: jest.fn().mockResolvedValue(undefined),
    clearFailed2FA: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/services/totpService', () => ({
    verifyCode: jest.fn(),
    generateSetup: jest.fn(),
    confirmSetup: jest.fn(),
    disable: jest.fn()
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

describe('[P1-2] controllers emit cookies on token-issuing endpoints', () => {
    beforeEach(() => jest.clearAllMocks());

    test('login (no 2FA branch) sets BOTH access + refresh cookies', async () => {
        authService.authenticateUser.mockResolvedValue({
            user_id: 5, username: 'u', role: 'user', totp_enabled: false
        });
        authService.generateTokens.mockReturnValue({ accessToken: 'A', refreshToken: 'R' });
        const req = { body: { username: 'u', password: 'p' }, headers: {}, cookies: {} };
        const res = makeRes();

        await authController.login(req, res, jest.fn());

        const names = res.cookie.mock.calls.map(c => c[0]);
        expect(names).toContain(COOKIE_NAMES.access);
        expect(names).toContain(COOKIE_NAMES.refresh);
        // [1A-FU2-S-M2] Tokens are NOT echoed in the body — cookies are
        // the sole delivery mechanism.
        const body = res.json.mock.calls[0][0];
        expect(body.accessToken).toBeUndefined();
        expect(body.refreshToken).toBeUndefined();
        expect(body).toMatchObject({ success: true });
    });

    test('verify2FA sets BOTH cookies', async () => {
        totpService.verifyCode.mockResolvedValue({ valid: true, method: 'totp' });
        authService.generateTokens.mockReturnValue({ accessToken: 'A', refreshToken: 'R' });
        const req = {
            body: { code: '123456' },
            headers: {},
            cookies: {},
            tempUser: { user_id: 9, username: 'admin', role: 'admin' }
        };
        const res = makeRes();

        await authController.verify2FA(req, res, jest.fn());

        const names = res.cookie.mock.calls.map(c => c[0]);
        expect(names).toEqual(
            expect.arrayContaining([COOKIE_NAMES.access, COOKIE_NAMES.refresh])
        );
    });

    test('confirm2FA sets BOTH cookies', async () => {
        totpService.confirmSetup.mockResolvedValue();
        authService.generateTokens.mockReturnValue({ accessToken: 'A', refreshToken: 'R' });
        const req = {
            body: { code: '123456' },
            headers: {},
            cookies: {},
            tempUser: { user_id: 9, username: 'admin', role: 'admin' }
        };
        const res = makeRes();

        await authController.confirm2FA(req, res, jest.fn());

        expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    test('refreshToken (body source) rotates cookies', async () => {
        authService.refreshToken.mockResolvedValue({ accessToken: 'A2', refreshToken: 'R2' });
        const req = { body: { refreshToken: 'R-old' }, headers: {}, cookies: {} };
        const res = makeRes();

        await authController.refreshToken(req, res, jest.fn());

        expect(res.cookie).toHaveBeenCalledWith(
            COOKIE_NAMES.access, 'A2', expect.any(Object)
        );
        expect(res.cookie).toHaveBeenCalledWith(
            COOKIE_NAMES.refresh, 'R2', expect.any(Object)
        );
    });

    test('refreshToken (cookie source — body empty) still rotates cookies', async () => {
        authService.refreshToken.mockResolvedValue({ accessToken: 'A2', refreshToken: 'R2' });
        const req = {
            body: {},
            headers: {},
            cookies: { [COOKIE_NAMES.refresh]: 'R-cookie' }
        };
        const res = makeRes();

        await authController.refreshToken(req, res, jest.fn());

        // Was the service called with the value from the cookie?
        expect(authService.refreshToken).toHaveBeenCalledWith('R-cookie');
        expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    test('logout always clears BOTH cookies (success path)', async () => {
        authService.logout.mockResolvedValue({ message: 'ok' });
        const req = {
            headers: { authorization: 'Bearer access-tok' },
            body: {},
            cookies: {},
            user: { user_id: 1 }
        };
        const res = makeRes();

        await authController.logout(req, res, jest.fn());

        expect(res.clearCookie).toHaveBeenCalledWith(COOKIE_NAMES.access, expect.any(Object));
        expect(res.clearCookie).toHaveBeenCalledWith(COOKIE_NAMES.refresh, expect.any(Object));
    });

    test('logout clears cookies even when no token is provided (400 path)', async () => {
        const req = { headers: {}, body: {}, cookies: {}, user: { user_id: 1 } };
        const res = makeRes();

        await authController.logout(req, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        // [M-4] +temp_token, [S-PERIM-2] ×2 пути: см. clearAuthCookies.
        expect(res.clearCookie).toHaveBeenCalledTimes(6);
    });

    test('logout accepts access token from cookie when header missing', async () => {
        authService.logout.mockResolvedValue({ message: 'ok' });
        const req = {
            headers: {},
            body: {},
            cookies: { [COOKIE_NAMES.access]: 'cookie-access-tok' },
            user: { user_id: 1 }
        };
        const res = makeRes();

        await authController.logout(req, res, jest.fn());

        expect(authService.logout).toHaveBeenCalledWith('cookie-access-tok');
        // [M-4] +temp_token, [S-PERIM-2] ×2 пути: см. clearAuthCookies.
        expect(res.clearCookie).toHaveBeenCalledTimes(6);
    });
});

// -----------------------------------------------------------------------------
// [S-PERIM-2] Переход Path=/ → /api сквозь настоящий Express + cookie jar:
// старая сессия → новый вход → logout → ни одной куки ни на одном пути.
// -----------------------------------------------------------------------------
describe('[S-PERIM-2] cookie path migration through a real response', () => {
    const express = require('express');
    const supertest = require('supertest');
    const { setAuthCookies: setCookies, clearAuthCookies: clearCookies } = require('../../../src/utils/authCookies');

    const parseSetCookie = (res) => (res.headers['set-cookie'] || []).map((line) => {
        const [pair, ...attrs] = line.split(';').map((s) => s.trim());
        const [name, value] = pair.split('=');
        const path = (attrs.find((a) => /^Path=/i.test(a)) || 'Path=').slice(5);
        const expired = attrs.some((a) => /^Expires=Thu, 01 Jan 1970/i.test(a) || /^Max-Age=0$/i.test(a));
        return { name, value, path, expired };
    });

    const app = express();
    app.post('/api/auth/login', (req, res) => { setCookies(res, { accessToken: 'A2', refreshToken: 'R2' }); res.json({ ok: true }); });
    app.post('/api/auth/logout', (req, res) => { clearCookies(res); res.json({ ok: true }); });

    test('new login clears the legacy Path=/ copies and sets Path=/api ones', async () => {
        const res = await supertest(app).post('/api/auth/login');
        const cookies = parseSetCookie(res);

        const live = cookies.filter((c) => !c.expired);
        expect(live.map((c) => [c.name, c.path])).toEqual(expect.arrayContaining([
            ['access_token', '/api'], ['refresh_token', '/api']
        ]));
        expect(live.every((c) => c.path === '/api')).toBe(true);

        const legacyClears = cookies.filter((c) => c.expired && c.path === '/').map((c) => c.name);
        expect(legacyClears).toEqual(expect.arrayContaining(['access_token', 'refresh_token', 'temp_token']));
    });

    test('logout expires every name on BOTH paths', async () => {
        const res = await supertest(app).post('/api/auth/logout');
        const cookies = parseSetCookie(res);
        expect(cookies.every((c) => c.expired)).toBe(true);
        for (const name of ['access_token', 'refresh_token', 'temp_token']) {
            expect(cookies.filter((c) => c.name === name).map((c) => c.path).sort()).toEqual(['/', '/api']);
        }
    });
});
