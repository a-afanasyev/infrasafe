/**
 * Phase 8 — dedicated totpService unit tests (TEST-001, TEST-003).
 *
 * Before this file, totpService — 245 LoC of security-critical crypto and
 * state — was covered only indirectly through integration tests.
 * phase1-2fa-hardening.test.js exercises a subset of the hardening paths
 * (HKDF, anti-replay) but does not cover the module's public surface end
 * to end.
 *
 * The TOTP_ENCRYPTION_KEY is set before requiring the module so the
 * key-derivation check does not throw. `crypto` is intentionally NOT mocked
 * — we verify real HKDF + AES-256-GCM behavior, not mocks.
 */

// TOTP_ENCRYPTION_KEY must be ≥ 32 chars (HKDF check). Use a deterministic
// value so hkdfSync produces the same derived key across test runs.
process.env.TOTP_ENCRYPTION_KEY = 'totp-test-key-that-is-at-least-32-bytes-long-123456';

jest.mock('../../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../../src/services/cacheService', () => ({
    invalidate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('qrcode', () => ({
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,MOCK'),
}));

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const otplib = require('otplib');
const db = require('../../../src/config/database');
const cacheService = require('../../../src/services/cacheService');
const totpService = require('../../../src/services/totpService');

describe('totpService — encryption primitives', () => {
    beforeEach(() => jest.clearAllMocks());

    test('encrypt/decrypt round-trip preserves plaintext', () => {
        const plaintext = 'JBSWY3DPEHPK3PXPKNSWG5LNMNWGC3LPNI';
        const encrypted = totpService.encrypt(plaintext);
        const decrypted = totpService.decrypt(encrypted);
        expect(decrypted).toBe(plaintext);
    });

    test('encrypt output format is "iv:authTag:ciphertext" (hex)', () => {
        const encrypted = totpService.encrypt('secret');
        const parts = encrypted.split(':');
        expect(parts).toHaveLength(3);
        // iv: 16 bytes → 32 hex chars
        expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
        // authTag: 16 bytes → 32 hex chars
        expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
        // ciphertext: at least 1 hex pair
        expect(parts[2]).toMatch(/^[0-9a-f]+$/);
    });

    test('decrypt fails on tampered ciphertext (GCM auth check)', () => {
        const encrypted = totpService.encrypt('secret');
        const [iv, tag, ct] = encrypted.split(':');
        // Flip one ciphertext byte
        const flipped = `${iv}:${tag}:${ct.slice(0, -2)}${ct.slice(-2) === 'ff' ? '00' : 'ff'}`;
        expect(() => totpService.decrypt(flipped)).toThrow();
    });

    test('different encrypt() calls produce different IVs (non-deterministic)', () => {
        const a = totpService.encrypt('x');
        const b = totpService.encrypt('x');
        expect(a).not.toBe(b);
        expect(a.split(':')[0]).not.toBe(b.split(':')[0]);
    });
});

describe('totpService — HKDF key derivation (SEC-104)', () => {
    test('derived key differs from raw SHA-256 of TOTP_ENCRYPTION_KEY', () => {
        // Round-trip only works because encryption uses HKDF-derived key.
        // A test against the pre-hardening SHA-256 derivation should NOT
        // decrypt successfully — guards against regression back to sha256.
        const key = process.env.TOTP_ENCRYPTION_KEY;
        const encrypted = totpService.encrypt('hello');
        const [ivHex, tagHex, ctHex] = encrypted.split(':');

        const sha256Key = crypto.createHash('sha256').update(key).digest();
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', sha256Key, iv);
        decipher.setAuthTag(tag);
        expect(() => {
            decipher.update(Buffer.from(ctHex, 'hex'));
            decipher.final();
        }).toThrow();
    });
});

describe('totpService — recovery codes', () => {
    test('generateRecoveryCodes returns 8 codes in XXXX-XXXX format', () => {
        const codes = totpService.generateRecoveryCodes();
        expect(codes).toHaveLength(8);
        for (const code of codes) {
            expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
        }
    });

    test('generateRecoveryCodes produces unique codes per call', () => {
        const a = totpService.generateRecoveryCodes();
        const b = totpService.generateRecoveryCodes();
        expect(a).not.toEqual(b);
    });

    test('hashRecoveryCodes returns bcrypt hashes (60-char $2b$… strings)', async () => {
        const hashed = await totpService.hashRecoveryCodes(['ABCD-1234']);
        expect(hashed).toHaveLength(1);
        expect(hashed[0]).toMatch(/^\$2b\$/);
        await expect(bcrypt.compare('ABCD-1234', hashed[0])).resolves.toBe(true);
    });
});

describe('totpService — generateSetup', () => {
    beforeEach(() => jest.clearAllMocks());

    test('stores encrypted secret and hashed recovery codes', async () => {
        // First call: SELECT for pending-secret check (no existing row state)
        // Second call: UPDATE users SET ...
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: null, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        const result = await totpService.generateSetup(42, 'alice');

        expect(result.qrCodeUrl).toMatch(/^data:image\/png;base64,/);
        expect(result.recoveryCodes).toHaveLength(8);
        expect(typeof result.secret).toBe('string');

        const [sql, params] = db.query.mock.calls[1];
        expect(sql).toMatch(/UPDATE users SET totp_secret = \$1, recovery_codes = \$2 WHERE user_id = \$3/);
        // Encrypted secret → iv:tag:ct
        expect(params[0]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
        const recoveryHashed = JSON.parse(params[1]);
        expect(recoveryHashed).toHaveLength(8);
        expect(recoveryHashed[0]).toMatch(/^\$2b\$/);
        expect(params[2]).toBe(42);
    });

    test('invalidates auth user cache after UPDATE (Phase 7.2)', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: null, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        await totpService.generateSetup(99, 'bob');
        expect(cacheService.invalidate).toHaveBeenCalledWith('auth:user:99');
    });

    test('throws "User not found" when user row missing', async () => {
        db.query.mockResolvedValueOnce({ rows: [] });
        await expect(totpService.generateSetup(404, 'ghost'))
            .rejects.toThrow('User not found');
    });
});

describe('totpService — generateSetup idempotency', () => {
    beforeEach(() => jest.clearAllMocks());

    test('pending setup returns the SAME secret on second call (QR stable)', async () => {
        // First generateSetup: no prior secret → mint new
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: null, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        const first = await totpService.generateSetup(77, 'carol');

        // Second generateSetup: prior encrypted secret present, still not enabled
        // → must reuse the SAME plaintext secret (otherwise user-perceived "different OTPs" bug)
        const encryptedPending = totpService.encrypt(first.secret);
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: encryptedPending, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        const second = await totpService.generateSetup(77, 'carol');

        expect(second.secret).toBe(first.secret);
    });

    test('recovery codes DIFFER across calls (user must save latest set)', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: null, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        const first = await totpService.generateSetup(78, 'dave');

        const encryptedPending = totpService.encrypt(first.secret);
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: encryptedPending, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        const second = await totpService.generateSetup(78, 'dave');

        expect(second.recoveryCodes).not.toEqual(first.recoveryCodes);
        expect(second.recoveryCodes).toHaveLength(8);
    });

    test('after 2FA is enabled, a new generateSetup call mints a FRESH secret', async () => {
        // Pretend the pending secret from a previous setup has been confirmed (totp_enabled=true).
        // Calling generateSetup again (e.g. after an admin "reset 2FA" action) must NOT keep the
        // old secret — it should generate a brand-new one.
        const oldEncrypted = totpService.encrypt('OLDSECRETBASE32');
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: oldEncrypted, totp_enabled: true }] })
            .mockResolvedValueOnce({ rows: [] });
        const result = await totpService.generateSetup(79, 'erin');

        expect(result.secret).not.toBe('OLDSECRETBASE32');
        expect(typeof result.secret).toBe('string');
    });
});

describe('totpService — confirmSetup', () => {
    let realVerify;
    beforeEach(() => {
        jest.clearAllMocks();
        realVerify = otplib.verifySync;
    });
    afterEach(() => { otplib.verifySync = realVerify; });

    test('enables 2FA when code is valid and not replayed', async () => {
        const encryptedSecret = totpService.encrypt('JBSWY3DPEHPK3PXP');
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: encryptedSecret, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: true });

        await expect(totpService.confirmSetup(1, '123456')).resolves.toBe(true);

        const enableCall = db.query.mock.calls[1];
        expect(enableCall[0]).toMatch(/UPDATE users SET totp_enabled = true/);
        expect(cacheService.invalidate).toHaveBeenCalledWith('auth:user:1');
    });

    test('throws "Invalid TOTP code" on bad code', async () => {
        const encryptedSecret = totpService.encrypt('JBSWY3DPEHPK3PXP');
        db.query.mockResolvedValue({ rows: [{ totp_secret: encryptedSecret, totp_enabled: false }] });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: false });

        await expect(totpService.confirmSetup(2, '000000')).rejects.toThrow('Invalid TOTP code');
    });

    test('throws "User not found" when row missing', async () => {
        db.query.mockResolvedValue({ rows: [] });
        await expect(totpService.confirmSetup(999, '123456')).rejects.toThrow('User not found');
    });

    test('throws "2FA is already enabled" when user already set up', async () => {
        const encryptedSecret = totpService.encrypt('X');
        db.query.mockResolvedValue({ rows: [{ totp_secret: encryptedSecret, totp_enabled: true }] });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: true });

        await expect(totpService.confirmSetup(3, '111111')).rejects.toThrow('2FA is already enabled');
    });

    test('throws "2FA setup not initiated" when totp_secret null', async () => {
        db.query.mockResolvedValue({ rows: [{ totp_secret: null, totp_enabled: false }] });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: true });

        await expect(totpService.confirmSetup(4, '111111')).rejects.toThrow('2FA setup not initiated');
    });

    test('anti-replay: same (userId, code) rejected via "TOTP code already used"', async () => {
        // confirmSetup uses markCodeUsed(userId, code). Two different users
        // can present the same code, but the same user cannot within 60 s.
        // Use fresh userIds each test run to avoid polluting the in-memory map.
        const encryptedSecret = totpService.encrypt('JBSWY3DPEHPK3PXP');
        otplib.verifySync = jest.fn().mockReturnValue({ valid: true });
        const userA = 700 + Math.floor(Math.random() * 1000);
        const code = `dup-code-${Date.now()}`;

        // First call succeeds
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: encryptedSecret, totp_enabled: false }] })
            .mockResolvedValueOnce({ rows: [] });
        await expect(totpService.confirmSetup(userA, code)).resolves.toBe(true);

        // Second call: same user + same code. confirmSetup will re-read the
        // row (we return totp_enabled=false again — simulating a caller that
        // retried before the UPDATE landed). markCodeUsed should catch it.
        db.query
            .mockResolvedValueOnce({ rows: [{ totp_secret: encryptedSecret, totp_enabled: false }] });
        await expect(totpService.confirmSetup(userA, code))
            .rejects.toThrow('TOTP code already used');
    });
});

describe('totpService — verifyCode', () => {
    let realVerify;
    beforeEach(() => {
        jest.clearAllMocks();
        realVerify = otplib.verifySync;
    });
    afterEach(() => { otplib.verifySync = realVerify; });

    test('accepts valid TOTP code when 2FA enabled', async () => {
        const encryptedSecret = totpService.encrypt('JBSWY3DPEHPK3PXP');
        db.query.mockResolvedValue({
            rows: [{ totp_secret: encryptedSecret, totp_enabled: true, recovery_codes: [] }],
        });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: true });

        const result = await totpService.verifyCode(10, 'fresh-code-' + Date.now());
        expect(result).toEqual({ valid: true, method: 'totp' });
    });

    test('rejects code replay — second use returns code_already_used', async () => {
        const encryptedSecret = totpService.encrypt('JBSWY3DPEHPK3PXP');
        db.query.mockResolvedValue({
            rows: [{ totp_secret: encryptedSecret, totp_enabled: true, recovery_codes: [] }],
        });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: true });

        const uniqueCode = 'replay-' + Date.now();
        const first = await totpService.verifyCode(11, uniqueCode);
        const second = await totpService.verifyCode(11, uniqueCode);
        expect(first).toEqual({ valid: true, method: 'totp' });
        expect(second).toEqual({ valid: false, reason: 'code_already_used' });
    });

    test('accepts recovery code and removes it (single-use)', async () => {
        const encryptedSecret = totpService.encrypt('X');
        const recoveryCode = 'ABCD-EF12';
        const hashed = await bcrypt.hash(recoveryCode, 4);
        db.query
            .mockResolvedValueOnce({
                rows: [{ totp_secret: encryptedSecret, totp_enabled: true, recovery_codes: [hashed] }],
            })
            .mockResolvedValueOnce({ rows: [] });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: false });

        const result = await totpService.verifyCode(12, recoveryCode);
        expect(result).toEqual({ valid: true, method: 'recovery' });

        const updateCall = db.query.mock.calls[1];
        expect(updateCall[0]).toMatch(/UPDATE users SET recovery_codes = \$1/);
        expect(JSON.parse(updateCall[1][0])).toEqual([]);
        expect(cacheService.invalidate).toHaveBeenCalledWith('auth:user:12');
    });

    test('returns { valid: false } for bogus code', async () => {
        const encryptedSecret = totpService.encrypt('X');
        db.query.mockResolvedValue({
            rows: [{ totp_secret: encryptedSecret, totp_enabled: true, recovery_codes: [] }],
        });
        otplib.verifySync = jest.fn().mockReturnValue({ valid: false });

        const result = await totpService.verifyCode(13, 'WRONG-CODE');
        expect(result).toEqual({ valid: false });
    });

    test('throws "User not found" when row missing', async () => {
        db.query.mockResolvedValue({ rows: [] });
        await expect(totpService.verifyCode(999, '111111')).rejects.toThrow('User not found');
    });

    test('throws "2FA is not enabled" when user has no secret', async () => {
        db.query.mockResolvedValue({ rows: [{ totp_enabled: false, totp_secret: null }] });
        await expect(totpService.verifyCode(14, '111111')).rejects.toThrow('2FA is not enabled');
    });
});

describe('totpService — disable', () => {
    beforeEach(() => jest.clearAllMocks());

    test('non-admin can disable 2FA and cache is invalidated', async () => {
        db.query
            .mockResolvedValueOnce({ rows: [{ role: 'user' }] })
            .mockResolvedValueOnce({ rows: [] });

        await expect(totpService.disable(50)).resolves.toBe(true);

        const clearCall = db.query.mock.calls[1];
        expect(clearCall[0]).toMatch(/UPDATE users SET totp_enabled = false/);
        expect(cacheService.invalidate).toHaveBeenCalledWith('auth:user:50');
    });

    test('admin cannot disable 2FA via API', async () => {
        db.query.mockResolvedValue({ rows: [{ role: 'admin' }] });

        await expect(totpService.disable(1)).rejects.toThrow('Admins cannot disable 2FA');
    });

    test('throws "User not found" when row missing', async () => {
        db.query.mockResolvedValue({ rows: [] });
        await expect(totpService.disable(9999)).rejects.toThrow('User not found');
    });
});
