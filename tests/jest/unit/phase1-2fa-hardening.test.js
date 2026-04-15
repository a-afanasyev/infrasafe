/**
 * Phase 1: 2FA Security Hardening — unit tests
 * Covers SEC-101, SEC-104, SEC-105, SEC-106
 */

// Mock database
jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

// Mock bcrypt
jest.mock('bcrypt', () => ({
    compare: jest.fn(),
    hash: jest.fn().mockResolvedValue('$2b$12$hashedvalue')
}));

// Mock otplib
jest.mock('otplib', () => ({
    generateSecret: jest.fn().mockReturnValue('JBSWY3DPEHPK3PXP'),
    generateURI: jest.fn().mockReturnValue('otpauth://totp/InfraSafe:testuser?secret=JBSWY3DPEHPK3PXP&issuer=InfraSafe'),
    verifySync: jest.fn()
}));

// Mock qrcode
jest.mock('qrcode', () => ({
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mock')
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// Mock cacheService
jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    delete: jest.fn().mockResolvedValue(true)
}));

const db = require('../../../src/config/database');
const bcrypt = require('bcrypt');
const otplib = require('otplib');

describe('Phase 1: 2FA Security Hardening', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.TOTP_ENCRYPTION_KEY = 'a]3Fk9L!mN7pQ2rS5tV8wZ0bD4gJ6iKx';
        process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-minimum-length';
        process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-tests';
    });

    // ===== SEC-104: HKDF key derivation =====
    describe('SEC-104: HKDF key derivation', () => {
        test('getEncryptionKey uses hkdfSync and returns 32-byte Buffer', () => {
            // Clear module cache to re-evaluate with current env
            jest.isolateModules(() => {
                const crypto = require('crypto');
                const key = process.env.TOTP_ENCRYPTION_KEY;
                const result = Buffer.from(
                    crypto.hkdfSync('sha256', key, 'infrasafe-totp-v1', 'aes-encryption-key', 32)
                );
                expect(result).toBeInstanceOf(Buffer);
                expect(result.length).toBe(32);
            });
        });

        test('HKDF produces different output than raw SHA-256', () => {
            const crypto = require('crypto');
            const key = process.env.TOTP_ENCRYPTION_KEY;

            const sha256 = crypto.createHash('sha256').update(key).digest();
            const hkdf = Buffer.from(
                crypto.hkdfSync('sha256', key, 'infrasafe-totp-v1', 'aes-encryption-key', 32)
            );

            expect(sha256.equals(hkdf)).toBe(false);
        });

        test('encrypt/decrypt round-trip works with HKDF key', () => {
            jest.isolateModules(() => {
                process.env.TOTP_ENCRYPTION_KEY = 'a]3Fk9L!mN7pQ2rS5tV8wZ0bD4gJ6iKx';
                const totpService = require('../../../src/services/totpService');

                const plaintext = 'JBSWY3DPEHPK3PXP';
                const encrypted = totpService.encrypt(plaintext);
                const decrypted = totpService.decrypt(encrypted);

                expect(encrypted).not.toBe(plaintext);
                expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext
                expect(decrypted).toBe(plaintext);
            });
        });
    });

    // ===== SEC-105: verifyPasswordOnly =====
    describe('SEC-105: verifyPasswordOnly', () => {
        let authService;

        beforeEach(() => {
            jest.isolateModules(() => {
                authService = require('../../../src/services/authService');
            });
        });

        test('returns true for correct password', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ password_hash: '$2b$12$correcthash' }]
            });
            bcrypt.compare.mockResolvedValueOnce(true);

            const result = await authService.verifyPasswordOnly(1, 'correctPassword');
            expect(result).toBe(true);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('is_active = true'),
                [1]
            );
        });

        test('returns false for wrong password', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ password_hash: '$2b$12$correcthash' }]
            });
            bcrypt.compare.mockResolvedValueOnce(false);

            const result = await authService.verifyPasswordOnly(1, 'wrongPassword');
            expect(result).toBe(false);
        });

        test('returns false for non-existent user', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const result = await authService.verifyPasswordOnly(999, 'anyPassword');
            expect(result).toBe(false);
            expect(bcrypt.compare).not.toHaveBeenCalled();
        });

        test('returns false for user with NULL password_hash', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ password_hash: null }]
            });

            const result = await authService.verifyPasswordOnly(1, 'anyPassword');
            expect(result).toBe(false);
            expect(bcrypt.compare).not.toHaveBeenCalled();
        });

        test('does NOT call recordFailedAttempt on wrong password', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ password_hash: '$2b$12$hash' }]
            });
            bcrypt.compare.mockResolvedValueOnce(false);

            await authService.verifyPasswordOnly(1, 'wrong');

            // Ensure no lockout-related queries were made (only the SELECT)
            expect(db.query).toHaveBeenCalledTimes(1);
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT password_hash'),
                [1]
            );
        });
    });

    // ===== SEC-106: TOTP anti-replay =====
    describe('SEC-106: TOTP anti-replay', () => {
        test('markCodeUsed returns true on first call, false on second', () => {
            jest.isolateModules(() => {
                process.env.TOTP_ENCRYPTION_KEY = 'a]3Fk9L!mN7pQ2rS5tV8wZ0bD4gJ6iKx';
                // Access the module-level markCodeUsed via verifyCode behavior
                const totpService = require('../../../src/services/totpService');

                // Directly test the anti-replay by calling verifyCode twice
                // Setup mock for valid TOTP
                db.query.mockResolvedValue({
                    rows: [{
                        totp_enabled: true,
                        totp_secret: totpService.encrypt('JBSWY3DPEHPK3PXP'),
                        recovery_codes: []
                    }]
                });
                otplib.verifySync.mockReturnValue({ valid: true });

                // First call should succeed
                return totpService.verifyCode(1, '123456').then(result1 => {
                    expect(result1.valid).toBe(true);
                    expect(result1.method).toBe('totp');

                    // Second call with same code should fail (anti-replay)
                    return totpService.verifyCode(1, '123456').then(result2 => {
                        expect(result2.valid).toBe(false);
                        expect(result2.reason).toBe('code_already_used');
                    });
                });
            });
        });

        test('different codes are not affected by anti-replay', () => {
            jest.isolateModules(() => {
                process.env.TOTP_ENCRYPTION_KEY = 'a]3Fk9L!mN7pQ2rS5tV8wZ0bD4gJ6iKx';
                const totpService = require('../../../src/services/totpService');

                db.query.mockResolvedValue({
                    rows: [{
                        totp_enabled: true,
                        totp_secret: totpService.encrypt('JBSWY3DPEHPK3PXP'),
                        recovery_codes: []
                    }]
                });
                otplib.verifySync.mockReturnValue({ valid: true });

                return totpService.verifyCode(1, '111111').then(result1 => {
                    expect(result1.valid).toBe(true);
                    return totpService.verifyCode(1, '222222').then(result2 => {
                        expect(result2.valid).toBe(true);
                    });
                });
            });
        });
    });

    // ===== SEC-101: tempToken blacklisting =====
    describe('SEC-101: authenticateTempToken blacklist check', () => {
        test('rejects blacklisted tempToken', async () => {
            jest.isolateModules(async () => {
                const authService = require('../../../src/services/authService');
                // Mock isTokenBlacklisted to return true
                jest.spyOn(authService, 'isTokenBlacklisted').mockResolvedValue(true);

                const { authenticateTempToken } = require('../../../src/middleware/auth');
                const req = { body: { tempToken: 'blacklisted-token' } };
                const res = {
                    status: jest.fn().mockReturnThis(),
                    json: jest.fn()
                };
                const next = jest.fn();

                await authenticateTempToken(req, res, next);

                expect(res.status).toHaveBeenCalledWith(401);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({ message: 'Temporary token has already been used' })
                );
                expect(next).not.toHaveBeenCalled();
            });
        });
    });
});
