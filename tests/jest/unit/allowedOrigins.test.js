// [SEC-23] getAllowedOrigins() — single source of truth for the CORS/CSRF
// allowlist. Contract: ALWAYS returns string[] (never a bare string), so a
// caller doing `allowed.includes(origin)` gets exact-match, not a substring
// match against a string fallback.

const getAllowedOrigins = require('../../../src/utils/allowedOrigins');

describe('getAllowedOrigins (SEC-23)', () => {
    const ORIG = process.env.CORS_ORIGINS;
    afterEach(() => {
        if (ORIG === undefined) delete process.env.CORS_ORIGINS;
        else process.env.CORS_ORIGINS = ORIG;
    });

    test('unset env → array fallback (NOT a string)', () => {
        delete process.env.CORS_ORIGINS;
        const out = getAllowedOrigins();
        expect(Array.isArray(out)).toBe(true);
        expect(out).toEqual(['http://localhost:8080']);
    });

    test('empty string env → array fallback', () => {
        process.env.CORS_ORIGINS = '';
        expect(getAllowedOrigins()).toEqual(['http://localhost:8080']);
    });

    test('CSV is split, trimmed, empties filtered', () => {
        process.env.CORS_ORIGINS = 'https://a.com, https://b.com ,,https://c.com,';
        expect(getAllowedOrigins()).toEqual(['https://a.com', 'https://b.com', 'https://c.com']);
    });

    test('exact entries — NOT substring-matchable', () => {
        process.env.CORS_ORIGINS = 'https://infrasafe.uz';
        const out = getAllowedOrigins();
        expect(out).toEqual(['https://infrasafe.uz']);
        // The whole point: an attacker origin that merely contains a substring
        // must not match.
        expect(out.includes('infrasafe.uz')).toBe(false);
        expect(out.includes('https://infrasafe.uz.evil.com')).toBe(false);
        expect(out.includes('https://infrasafe.uz')).toBe(true);
    });

    test('reads env at call-time (not frozen at import)', () => {
        process.env.CORS_ORIGINS = 'https://x.com';
        expect(getAllowedOrigins()).toEqual(['https://x.com']);
        process.env.CORS_ORIGINS = 'https://y.com';
        expect(getAllowedOrigins()).toEqual(['https://y.com']);
    });
});
