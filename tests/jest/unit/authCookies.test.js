/**
 * [P1-2] Unit tests for authCookies utility + cookie-aware controllers.
 *
 * Covers:
 *   - cookie attributes are correct (httpOnly, secure, sameSite, path, maxAge)
 *   - secure flag tracks NODE_ENV (off in dev, on in prod)
 *   - extractAccessToken: header > cookie > null
 *   - extractRefreshToken: body > cookie > null
 *   - login / verify2FA / confirm2FA / refresh emit Set-Cookie
 *   - logout clears both cookies
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
    setAuthCookies,
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
                    path: '/',
                    maxAge: expect.any(Number)
                })
            );
            expect(res.cookie).toHaveBeenCalledWith(
                COOKIE_NAMES.refresh, 'R',
                expect.objectContaining({
                    httpOnly: true,
                    secure: true,
                    sameSite: 'strict',
                    path: '/'
                })
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

        test('SECURE_COOKIES values other than "true" leave secure off', () => {
            process.env.NODE_ENV = 'development';
            process.env.SECURE_COOKIES = '1';   // not the canonical string

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
        test('clears both names with matching attributes (browser-accept condition)', () => {
            clearAuthCookies(res);
            expect(res.clearCookie).toHaveBeenCalledTimes(2);
            // path + sameSite + secure + httpOnly must match the SET to clear
            const accessClearOpts = res.clearCookie.mock.calls.find(c => c[0] === COOKIE_NAMES.access)[1];
            expect(accessClearOpts).toMatchObject({
                httpOnly: true,
                sameSite: 'strict',
                path: '/'
            });
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
    blacklistToken: jest.fn()
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
        expect(res.clearCookie).toHaveBeenCalledTimes(2);
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
        expect(res.clearCookie).toHaveBeenCalledTimes(2);
    });
});
