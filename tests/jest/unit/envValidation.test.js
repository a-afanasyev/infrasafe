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
        process.env.JWT_SECRET = 'access-secret';
        process.env.JWT_REFRESH_SECRET = 'refresh-secret';
        process.env.TOTP_ENCRYPTION_KEY = 'totp-key';
        process.env.CORS_ORIGINS = 'https://infrasafe.uz';
        process.env.JWT_2FA_SECRET = 'distinct-2fa-secret';
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
