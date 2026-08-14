/**
 * [L-1] Раздельные лимитер-бакеты аутентификации.
 *
 * Один IP-бакет 10/15 мин обслуживал login + refresh + три 2FA-шага +
 * disable-2fa. Итог: периодические refresh'ы офиса за одним NAT съедали
 * бюджет входа, а один полный 2FA-сетап (login → setup → confirm) тратил
 * 3-4 попытки из 10. Теперь: login — свой бакет, refresh — свой (щедрее:
 * это фоновый легитимный трафик), 2FA-шаги — свой (брутфорс кодов держит
 * тот же потолок), disable-2fa — свой узкий (парольный оракул, M-5-класс).
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const {
    authLimiter,
    refreshLimiter,
    twoFaLimiter,
    disable2faLimiter,
    resetAllRateLimits,
    destroyAllLimiters
} = require('../../../src/middleware/rateLimiter');

const REQ = (ip) => ({ ip, connection: { remoteAddress: ip } });
const run = (limiter, ip) => new Promise((resolve) => {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation(() => resolve({ limited: true })),
        set: jest.fn(),
        setHeader: jest.fn()
    };
    limiter.middleware()(REQ(ip), res, () => resolve({ limited: false }));
});

beforeEach(async () => { await resetAllRateLimits(); });
afterAll(() => { destroyAllLimiters(); });

describe('[L-1] бакеты не пересекаются', () => {
    test('исчерпанный login-бакет не трогает refresh и 2FA', async () => {
        const ip = '10.0.0.7';
        // Выжигаем login-бюджет целиком
        let loginLimited = false;
        for (let i = 0; i < 30 && !loginLimited; i++) {
            ({ limited: loginLimited } = await run(authLimiter, ip));
        }
        expect(loginLimited).toBe(true);

        expect((await run(refreshLimiter, ip)).limited).toBe(false);
        expect((await run(twoFaLimiter, ip)).limited).toBe(false);
        expect((await run(disable2faLimiter, ip)).limited).toBe(false);
    });

    test('refresh-бакет щедрее логинного (фоновый легитимный трафик)', () => {
        expect(refreshLimiter.max).toBeGreaterThan(authLimiter.max);
    });

    test('disable-2fa — узкий бакет парольного оракула', () => {
        expect(disable2faLimiter.max).toBeLessThanOrEqual(5);
    });

    test('ключи бакетов различаются по namespace', () => {
        const names = new Set([
            authLimiter.namespace ?? authLimiter.options?.namespace,
            refreshLimiter.namespace ?? refreshLimiter.options?.namespace,
            twoFaLimiter.namespace ?? twoFaLimiter.options?.namespace,
            disable2faLimiter.namespace ?? disable2faLimiter.options?.namespace
        ]);
        expect(names.size).toBe(4);
    });
});

describe('[L-1] маршруты используют свои бакеты', () => {
    test('authRoutes подключает refresh/2FA/disable к своим лимитерам', () => {
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../src/routes/authRoutes.js'), 'utf8'
        );
        expect(source).toMatch(/\/refresh',\s*refreshLimiter\.middleware\(\)/);
        expect(source).toMatch(/\/verify-2fa',\s*twoFaLimiter\.middleware\(\)/);
        expect(source).toMatch(/\/setup-2fa',\s*twoFaLimiter\.middleware\(\)/);
        expect(source).toMatch(/\/confirm-2fa',\s*twoFaLimiter\.middleware\(\)/);
        expect(source).toMatch(/\/disable-2fa',\s*disable2faLimiter\.middleware\(\)/);
        // login остаётся на историческом authLimiter
        expect(source).toMatch(/\/login',\s*authLimiter\.middleware\(\)/);
    });
});
