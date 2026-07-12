jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const { validateEnv } = require('../../../src/config/env');

describe('validateEnv — NODE_ENV assertion (SEC-12)', () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = ORIGINAL_NODE_ENV;
        jest.clearAllMocks();
    });

    it('rejects an unknown NODE_ENV value', () => {
        process.env.NODE_ENV = 'staging';
        expect(() => validateEnv()).toThrow(/NODE_ENV/);
    });

    it('rejects an empty/unset NODE_ENV value', () => {
        delete process.env.NODE_ENV;
        expect(() => validateEnv()).toThrow(/NODE_ENV/);
    });

    it('accepts NODE_ENV=test without throwing', () => {
        process.env.NODE_ENV = 'test';
        expect(() => validateEnv()).not.toThrow();
    });
});

describe('validateEnv — JWT_2FA_SECRET production requirement (SEC-34h)', () => {
    const ORIGINAL_ENV = { ...process.env };

    // A complete, valid production env. Individual tests mutate only the
    // JWT_2FA_SECRET pieces under test.
    function setValidProdEnv() {
        process.env.NODE_ENV = 'production';
        process.env.DB_HOST = 'db';
        process.env.DB_PORT = '5432';
        process.env.DB_NAME = 'infrasafe';
        process.env.DB_USER = 'infrasafe_runtime';
        process.env.DB_PASSWORD = 'pw';
        // [R2-26] Secrets must be >=32 chars in production.
        process.env.JWT_SECRET = 'access-secret-0123456789abcdef-XYZ';
        process.env.JWT_REFRESH_SECRET = 'refresh-secret-0123456789abcdef-XY';
        process.env.TOTP_ENCRYPTION_KEY = 'totp-key-0123456789abcdefghij-ZZZZ';
        process.env.CORS_ORIGINS = 'https://infrasafe.uz';
        process.env.JWT_2FA_SECRET = 'distinct-2fa-secret-0123456789abcd';
    }

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('throws in production when JWT_2FA_SECRET is missing', () => {
        setValidProdEnv();
        delete process.env.JWT_2FA_SECRET;
        expect(() => validateEnv()).toThrow(/JWT_2FA_SECRET/);
    });

    it('throws in production when JWT_2FA_SECRET equals JWT_SECRET', () => {
        setValidProdEnv();
        process.env.JWT_2FA_SECRET = process.env.JWT_SECRET;
        expect(() => validateEnv()).toThrow(/JWT_2FA_SECRET/);
    });

    it('passes in production when JWT_2FA_SECRET is present and differs from JWT_SECRET', () => {
        setValidProdEnv();
        expect(() => validateEnv()).not.toThrow();
    });

    it('[R2-26] throws in production when a crypto secret is shorter than 32 chars', () => {
        setValidProdEnv();
        process.env.JWT_SECRET = 'short';
        expect(() => validateEnv()).toThrow(/Weak secrets/);
    });

    it('does not require JWT_2FA_SECRET outside production (dev/test fallback)', () => {
        process.env.NODE_ENV = 'development';
        process.env.DB_HOST = 'db';
        process.env.DB_PORT = '5432';
        process.env.DB_NAME = 'infrasafe';
        process.env.DB_USER = 'infrasafe_runtime';
        process.env.DB_PASSWORD = 'pw';
        process.env.JWT_SECRET = 'access-secret';
        process.env.JWT_REFRESH_SECRET = 'refresh-secret';
        process.env.TOTP_ENCRYPTION_KEY = 'totp-key';
        delete process.env.JWT_2FA_SECRET;
        expect(() => validateEnv()).not.toThrow();
    });
});

// [R2-19] Allowlist-only SSRF mitigation: env.js nudges operators to set
// UK_API_ALLOWED_HOSTS in production when an outbound UK target exists.
describe('validateEnv — R2-19 UK_API_ALLOWED_HOSTS SSRF nudge', () => {
    const ORIGINAL_ENV = { ...process.env };
    const logger = require('../../../src/utils/logger');

    function setValidProdEnv() {
        process.env.NODE_ENV = 'production';
        process.env.DB_HOST = 'db';
        process.env.DB_PORT = '5432';
        process.env.DB_NAME = 'infrasafe';
        process.env.DB_USER = 'infrasafe_runtime';
        process.env.DB_PASSWORD = 'pw';
        process.env.JWT_SECRET = 'access-secret-0123456789abcdef-XYZ';
        process.env.JWT_REFRESH_SECRET = 'refresh-secret-0123456789abcdef-XY';
        process.env.TOTP_ENCRYPTION_KEY = 'totp-key-0123456789abcdefghij-ZZZZ';
        process.env.CORS_ORIGINS = 'https://infrasafe.uz';
        process.env.JWT_2FA_SECRET = 'distinct-2fa-secret-0123456789abcd';
    }

    const nudged = () =>
        logger.warn.mock.calls.some(
            (c) => typeof c[0] === 'string' && c[0].includes('UK_API_ALLOWED_HOSTS is not set')
        );

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('warns when UK_API_URL is set but UK_API_ALLOWED_HOSTS is not', () => {
        setValidProdEnv();
        process.env.UK_API_URL = 'https://infrasafe.uz/uk';
        delete process.env.UK_API_ALLOWED_HOSTS;
        validateEnv();
        expect(nudged()).toBe(true);
    });

    it('does NOT warn when UK_API_ALLOWED_HOSTS is set', () => {
        setValidProdEnv();
        process.env.UK_API_URL = 'https://infrasafe.uz/uk';
        process.env.UK_API_ALLOWED_HOSTS = 'infrasafe.uz';
        validateEnv();
        expect(nudged()).toBe(false);
    });

    it('does NOT warn when there is no outbound target (UK_API_URL unset)', () => {
        setValidProdEnv();
        delete process.env.UK_API_URL;
        delete process.env.UK_API_ALLOWED_HOSTS;
        validateEnv();
        expect(nudged()).toBe(false);
    });
});

describe('validateEnv — H-3 TELEMETRY_HMAC_SECRET (dormant-until-set)', () => {
    const ORIGINAL_ENV = { ...process.env };
    const logger = require('../../../src/utils/logger');

    function setValidProdEnv() {
        process.env.NODE_ENV = 'production';
        process.env.DB_HOST = 'db';
        process.env.DB_PORT = '5432';
        process.env.DB_NAME = 'infrasafe';
        process.env.DB_USER = 'infrasafe_runtime';
        process.env.DB_PASSWORD = 'pw';
        process.env.JWT_SECRET = 'access-secret-0123456789abcdef-XYZ';
        process.env.JWT_REFRESH_SECRET = 'refresh-secret-0123456789abcdef-XY';
        process.env.TOTP_ENCRYPTION_KEY = 'totp-key-0123456789abcdefghij-ZZZZ';
        process.env.CORS_ORIGINS = 'https://infrasafe.uz';
        process.env.JWT_2FA_SECRET = 'distinct-2fa-secret-0123456789abcd';
    }

    const warnedUnset = () =>
        logger.warn.mock.calls.some(
            (c) => typeof c[0] === 'string' && c[0].includes('TELEMETRY_HMAC_SECRET is not set')
        );

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('warns (does not throw) in production when unset', () => {
        setValidProdEnv();
        delete process.env.TELEMETRY_HMAC_SECRET;
        expect(() => validateEnv()).not.toThrow();
        expect(warnedUnset()).toBe(true);
    });

    it('does not warn when set', () => {
        setValidProdEnv();
        process.env.TELEMETRY_HMAC_SECRET = 'telemetry-secret-0123456789abcdef-XY';
        validateEnv();
        expect(warnedUnset()).toBe(false);
    });

    it('throws when set but shorter than 32 chars (R2-26 weak-secret check applies)', () => {
        setValidProdEnv();
        process.env.TELEMETRY_HMAC_SECRET = 'too-short';
        expect(() => validateEnv()).toThrow(/Weak secrets/);
    });
});
