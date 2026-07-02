/**
 * @jest-environment node
 *
 * [R2-12] Shared 2FA/auth network + validation layer. The QR validation is a
 * security check (gates img.src) that was duplicated verbatim across login.js
 * and script.js; single-sourcing it here means it cannot drift between the two
 * auth paths. postJson is the fetch+parse boilerplate both flows share.
 */

const AuthFlow = require('../../../../public/utils/authFlow.js');

describe('validateQrCodeUrl', () => {
    const good = 'data:image/png;base64,' + 'A'.repeat(1500);

    test('accepts a well-formed PNG data-URI within the size bound', () => {
        expect(AuthFlow.validateQrCodeUrl(good)).toBe(true);
    });

    test('rejects a non-PNG-data-URI scheme (injection defence)', () => {
        expect(AuthFlow.validateQrCodeUrl('https://evil.example/qr.png')).toBe(false);
        expect(AuthFlow.validateQrCodeUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
        expect(AuthFlow.validateQrCodeUrl('javascript:alert(1)')).toBe(false);
    });

    test('rejects an oversized payload (> 8KB)', () => {
        const huge = 'data:image/png;base64,' + 'A'.repeat(9 * 1024);
        expect(AuthFlow.validateQrCodeUrl(huge)).toBe(false);
    });

    test('rejects null/undefined/empty without throwing', () => {
        expect(AuthFlow.validateQrCodeUrl(null)).toBe(false);
        expect(AuthFlow.validateQrCodeUrl(undefined)).toBe(false);
        expect(AuthFlow.validateQrCodeUrl('')).toBe(false);
    });

    test('boundary: exactly QR_MAX_LEN passes, one over fails', () => {
        const atLimit = AuthFlow.QR_PREFIX + 'A'.repeat(AuthFlow.QR_MAX_LEN - AuthFlow.QR_PREFIX.length);
        expect(atLimit.length).toBe(AuthFlow.QR_MAX_LEN);
        expect(AuthFlow.validateQrCodeUrl(atLimit)).toBe(true);
        expect(AuthFlow.validateQrCodeUrl(atLimit + 'A')).toBe(false);
    });
});

describe('AUTH_ENDPOINTS', () => {
    test('canonical auth paths', () => {
        expect(AuthFlow.AUTH_ENDPOINTS).toEqual({
            login: '/api/auth/login',
            verify2fa: '/api/auth/verify-2fa',
            setup2fa: '/api/auth/setup-2fa',
            confirm2fa: '/api/auth/confirm-2fa',
        });
    });
});

describe('postJson', () => {
    afterEach(() => { delete global.fetch; });

    test('POSTs JSON with the right headers/body and returns { res, data }', async () => {
        const fake = { ok: true, status: 200, json: async () => ({ success: true, tempToken: 't' }) };
        global.fetch = jest.fn().mockResolvedValue(fake);

        const { res, data } = await AuthFlow.postJson('/api/auth/login', { username: 'u', password: 'p' });

        expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'u', password: 'p' }),
        });
        expect(res).toBe(fake);
        expect(data).toEqual({ success: true, tempToken: 't' });
    });

    test('a non-JSON/empty body degrades to data={} (no throw), res still returned', async () => {
        const fake = { ok: false, status: 401, json: async () => { throw new Error('Unexpected end of JSON input'); } };
        global.fetch = jest.fn().mockResolvedValue(fake);

        const { res, data } = await AuthFlow.postJson('/api/auth/verify-2fa', { code: '000000' });

        expect(res.status).toBe(401);
        expect(data).toEqual({});
    });

    test('defaults body to {} when omitted', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        await AuthFlow.postJson('/api/auth/setup-2fa');
        expect(global.fetch.mock.calls[0][1].body).toBe('{}');
    });
});
