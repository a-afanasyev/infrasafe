jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const { validateEnv } = require('../../../src/config/env');

// Shared valid-production fixture. PR-6 (security audit 2026-07-11) promoted
// INFRASAFE_WEBHOOK_SECRET / TELEMETRY_HMAC_SECRET / UK_INVENTORY_TOKEN from
// warn-only to PRODUCTION_REQUIRED_VARS, so every "valid prod env" fixture
// across this file must set them or unrelated tests fail on the new
// missing-vars check rather than exercising what they mean to test.
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
    process.env.INFRASAFE_WEBHOOK_SECRET = 'infrasafe-webhook-secret-0123456789';
    process.env.TELEMETRY_HMAC_SECRET = 'telemetry-secret-0123456789abcdef-XY';
    process.env.UK_INVENTORY_TOKEN = 'uk-inventory-token-0123456789abcdef';
    // [M-7/M-11] Redis повышен до обязательного в production: на нём лимитер,
    // кэш и дедуп вебхуков, и их тихая деградация в per-process Map опаснее
    // явного отказа старта.
    process.env.REDIS_URL = 'redis://redis:6379/0';
}

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

    const nudged = () =>
        logger.warn.mock.calls.some(
            (c) => typeof c[0] === 'string' && c[0].includes('UK_API_ALLOWED_HOSTS is not set')
        );

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('warns when UK_API_URL is set but UK_API_ALLOWED_HOSTS is not (sender off)', () => {
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

// [PR-6] UK_API_ALLOWED_HOSTS becomes a HARD requirement once the outbound
// webhook sender is actually enabled (UK_USE_WEBHOOK_SENDER=true) — an SSRF
// mitigation that matters more once the outbound path is live.
describe('validateEnv — PR-6 UK_API_ALLOWED_HOSTS hard-fail when sender enabled', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('throws when UK_USE_WEBHOOK_SENDER=true and UK_API_ALLOWED_HOSTS is unset', () => {
        setValidProdEnv();
        process.env.UK_USE_WEBHOOK_SENDER = 'true';
        process.env.UK_WEBHOOK_SECRET = 'uk-outbound-webhook-secret-0123456';
        process.env.UK_API_URL = 'https://infrasafe.uz/uk';
        delete process.env.UK_API_ALLOWED_HOSTS;
        expect(() => validateEnv()).toThrow(/UK_API_ALLOWED_HOSTS is required/);
    });

    it('does not throw when UK_USE_WEBHOOK_SENDER=true and UK_API_ALLOWED_HOSTS is set', () => {
        setValidProdEnv();
        process.env.UK_USE_WEBHOOK_SENDER = 'true';
        process.env.UK_WEBHOOK_SECRET = 'uk-outbound-webhook-secret-0123456';
        process.env.UK_API_URL = 'https://infrasafe.uz/uk';
        process.env.UK_API_ALLOWED_HOSTS = 'infrasafe.uz';
        expect(() => validateEnv()).not.toThrow();
    });

    it('does not throw when the sender is off, even without UK_API_ALLOWED_HOSTS', () => {
        setValidProdEnv();
        delete process.env.UK_USE_WEBHOOK_SENDER;
        delete process.env.UK_API_URL;
        delete process.env.UK_API_ALLOWED_HOSTS;
        expect(() => validateEnv()).not.toThrow();
    });
});

// [PR-6] Enforce phase: TELEMETRY_HMAC_SECRET (H-3) is now a hard production
// requirement (PRODUCTION_REQUIRED_VARS), not a dormant warn.
describe('validateEnv — PR-6 TELEMETRY_HMAC_SECRET hard requirement (H-3 enforce)', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('throws in production when TELEMETRY_HMAC_SECRET is missing', () => {
        setValidProdEnv();
        delete process.env.TELEMETRY_HMAC_SECRET;
        expect(() => validateEnv()).toThrow(/TELEMETRY_HMAC_SECRET/);
    });

    it('passes when TELEMETRY_HMAC_SECRET is present and long enough', () => {
        setValidProdEnv();
        expect(() => validateEnv()).not.toThrow();
    });

    it('throws when TELEMETRY_HMAC_SECRET is shorter than 32 chars (R2-26)', () => {
        setValidProdEnv();
        process.env.TELEMETRY_HMAC_SECRET = 'too-short';
        expect(() => validateEnv()).toThrow(/Weak secrets/);
    });
});

// [PR-6] Enforce phase: UK_INVENTORY_TOKEN (H-4) is now a hard production
// requirement, not a dormant warn.
describe('validateEnv — PR-6 UK_INVENTORY_TOKEN hard requirement (H-4 enforce)', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('throws in production when UK_INVENTORY_TOKEN is missing', () => {
        setValidProdEnv();
        delete process.env.UK_INVENTORY_TOKEN;
        expect(() => validateEnv()).toThrow(/UK_INVENTORY_TOKEN/);
    });

    it('passes when UK_INVENTORY_TOKEN is present and long enough', () => {
        setValidProdEnv();
        expect(() => validateEnv()).not.toThrow();
    });

    it('throws when UK_INVENTORY_TOKEN is shorter than 32 chars (R2-26)', () => {
        setValidProdEnv();
        process.env.UK_INVENTORY_TOKEN = 'too-short';
        expect(() => validateEnv()).toThrow(/Weak secrets/);
    });
});

// [PR-6] Enforce phase: INFRASAFE_WEBHOOK_SECRET (previously warn-only per
// R2-18) is now a hard production requirement too.
describe('validateEnv — PR-6 INFRASAFE_WEBHOOK_SECRET hard requirement', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.clearAllMocks();
    });

    it('throws in production when INFRASAFE_WEBHOOK_SECRET is missing', () => {
        setValidProdEnv();
        delete process.env.INFRASAFE_WEBHOOK_SECRET;
        expect(() => validateEnv()).toThrow(/INFRASAFE_WEBHOOK_SECRET/);
    });

    it('passes when INFRASAFE_WEBHOOK_SECRET is present and long enough', () => {
        setValidProdEnv();
        expect(() => validateEnv()).not.toThrow();
    });
});

// [EN-1] Drift-guard между `.env.example` и env.js.
//
// PR-6 повысил TELEMETRY_HMAC_SECRET / UK_INVENTORY_TOKEN до
// PRODUCTION_REQUIRED_VARS, но в шаблоне они остались закомментированными с
// пометкой «dormant». Оператор, собравший .env.prod по шаблону, получал не
// «тихую деградацию», а краш-петлю на старте. Тест не даёт разойтись снова.
describe('.env.example покрывает обязательные переменные (EN-1)', () => {
    const fs = require('fs');
    const path = require('path');
    const { REQUIRED_VARS, PRODUCTION_REQUIRED_VARS } = require('../../../src/config/env');

    const declaredKeys = (() => {
        const raw = fs.readFileSync(path.join(__dirname, '../../../.env.example'), 'utf8');
        return new Set(
            raw.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#') && line.includes('='))
                .map(line => line.slice(0, line.indexOf('=')).trim())
        );
    })();

    test.each([...REQUIRED_VARS, ...PRODUCTION_REQUIRED_VARS])(
        '%s объявлена в .env.example и НЕ закомментирована',
        (name) => {
            expect(declaredKeys.has(name)).toBe(true);
        }
    );
});
