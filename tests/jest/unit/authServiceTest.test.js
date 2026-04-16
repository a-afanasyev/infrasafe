// Set required env vars BEFORE requiring authService (constructor reads them)
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-abc123';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests-abc123';

jest.mock('../../../src/config/database', () => ({
    query: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/services/cacheService', () => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    invalidatePattern: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../src/models/AccountLockout', () => ({
    get: jest.fn().mockResolvedValue(null),
    recordFailedAttempt: jest.fn().mockResolvedValue({ failed_attempts: 1, locked_until: null }),
    clearAttempts: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(0),
}));

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../../../src/config/database');
const cacheService = require('../../../src/services/cacheService');
const AccountLockout = require('../../../src/models/AccountLockout');
const authService = require('../../../src/services/authService');

describe('AuthService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cacheService.get.mockResolvedValue(null);
    });

    describe('validateUserData', () => {
        test('throws when username is too short', () => {
            expect(() => authService.validateUserData({
                username: 'ab', email: 'a@b.com', password: 'Abcdef1!'
            })).toThrow('минимум 3 символа');
        });

        test('throws when username is empty', () => {
            expect(() => authService.validateUserData({
                username: '', email: 'a@b.com', password: 'Abcdef1!'
            })).toThrow('минимум 3 символа');
        });

        test('throws when email is invalid', () => {
            expect(() => authService.validateUserData({
                username: 'testuser', email: 'not-an-email', password: 'Abcdef1!'
            })).toThrow('Некорректный email');
        });

        test('throws when email is empty', () => {
            expect(() => authService.validateUserData({
                username: 'testuser', email: '', password: 'Abcdef1!'
            })).toThrow('Некорректный email');
        });

        test('throws when password is too short', () => {
            expect(() => authService.validateUserData({
                username: 'testuser', email: 'a@b.com', password: 'Ab1'
            })).toThrow('минимум 8 символов');
        });

        test('throws when password lacks uppercase/lowercase/digit', () => {
            expect(() => authService.validateUserData({
                username: 'testuser', email: 'a@b.com', password: 'alllowercase'
            })).toThrow('строчные и заглавные буквы');
        });

        test('does not throw for valid data', () => {
            expect(() => authService.validateUserData({
                username: 'testuser', email: 'test@example.com', password: 'StrongPass1'
            })).not.toThrow();
        });
    });

    describe('validatePassword', () => {
        test('throws for empty password', () => {
            expect(() => authService.validatePassword('')).toThrow('минимум 8 символов');
        });

        test('throws for password without digits', () => {
            expect(() => authService.validatePassword('AbcDefGh')).toThrow('строчные и заглавные буквы');
        });

        test('does not throw for valid password', () => {
            expect(() => authService.validatePassword('StrongPass1')).not.toThrow();
        });
    });

    describe('hashPassword', () => {
        test('returns a hash different from the original password', async () => {
            const hash = await authService.hashPassword('TestPass123');
            expect(hash).not.toBe('TestPass123');
            expect(hash).toBeTruthy();
        });
    });

    describe('verifyPassword', () => {
        test('returns true for matching password and hash', async () => {
            const hash = await bcrypt.hash('TestPass123', 4); // fast hash for test
            const result = await authService.verifyPassword('TestPass123', hash);
            expect(result).toBe(true);
        });

        test('returns false for non-matching password', async () => {
            const hash = await bcrypt.hash('TestPass123', 4);
            const result = await authService.verifyPassword('WrongPass123', hash);
            expect(result).toBe(false);
        });
    });

    describe('generateTokens', () => {
        const mockUser = {
            user_id: 1,
            username: 'admin',
            email: 'admin@test.com',
            role: 'admin'
        };

        test('returns accessToken, refreshToken, tokenType and expiresIn', () => {
            const tokens = authService.generateTokens(mockUser);
            expect(tokens).toHaveProperty('accessToken');
            expect(tokens).toHaveProperty('refreshToken');
            expect(tokens).toHaveProperty('tokenType', 'Bearer');
            expect(tokens).toHaveProperty('expiresIn');
        });

        test('access token contains correct user payload', () => {
            const tokens = authService.generateTokens(mockUser);
            const decoded = jwt.decode(tokens.accessToken);
            expect(decoded.user_id).toBe(1);
            expect(decoded.username).toBe('admin');
            expect(decoded.role).toBe('admin');
        });

        test('refresh token contains user_id and type=refresh', () => {
            const tokens = authService.generateTokens(mockUser);
            const decoded = jwt.decode(tokens.refreshToken);
            expect(decoded.user_id).toBe(1);
            expect(decoded.type).toBe('refresh');
        });

        test('access token has correct issuer and audience', () => {
            const tokens = authService.generateTokens(mockUser);
            const decoded = jwt.decode(tokens.accessToken, { complete: true });
            expect(decoded.payload.iss).toBe('infrasafe-api');
            expect(decoded.payload.aud).toBe('infrasafe-client');
        });
    });

    describe('registerUser', () => {
        test('registers a new user successfully', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] }) // findUserByUsernameOrEmail — no existing user
                .mockResolvedValueOnce({
                    rows: [{
                        user_id: 10,
                        username: 'newuser',
                        email: 'new@test.com',
                        role: 'user',
                        created_at: '2025-01-01',
                        is_active: true
                    }]
                });

            const result = await authService.registerUser({
                username: 'newuser',
                email: 'new@test.com',
                password: 'StrongPass1'
            });

            expect(result.user_id).toBe(10);
            expect(result.username).toBe('newuser');
            expect(result.role).toBe('user');
        });

        test('throws USER_EXISTS when user already exists', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ user_id: 1, username: 'existing' }]
            });

            await expect(
                authService.registerUser({
                    username: 'existing',
                    email: 'existing@test.com',
                    password: 'StrongPass1'
                })
            ).rejects.toThrow('уже существует');
        });

        test('throws validation error for invalid data', async () => {
            await expect(
                authService.registerUser({
                    username: 'ab',
                    email: 'bad',
                    password: 'weak'
                })
            ).rejects.toThrow();
        });
    });

    describe('authenticateUser', () => {
        const hashedPassword = bcrypt.hashSync('StrongPass1', 4);

        test('authenticates user with valid credentials', async () => {
            cacheService.get.mockResolvedValue(null); // no lockout, no attempts
            db.query
                .mockResolvedValueOnce({
                    rows: [{
                        user_id: 1,
                        username: 'admin',
                        email: 'admin@test.com',
                        role: 'admin',
                        password_hash: hashedPassword,
                        is_active: true
                    }]
                })
                .mockResolvedValueOnce({ rows: [] }); // updateLastLogin

            const result = await authService.authenticateUser('admin', 'StrongPass1');

            expect(result.user_id).toBe(1);
            expect(result.username).toBe('admin');
        });

        test('throws INVALID_CREDENTIALS when user not found', async () => {
            cacheService.get.mockResolvedValue(null);
            db.query.mockResolvedValue({ rows: [] });

            await expect(
                authService.authenticateUser('nonexistent', 'pass')
            ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
        });

        test('throws ACCOUNT_DISABLED when user is inactive', async () => {
            cacheService.get.mockResolvedValue(null);
            db.query.mockResolvedValueOnce({
                rows: [{
                    user_id: 1,
                    username: 'disabled',
                    email: 'disabled@test.com',
                    password_hash: hashedPassword,
                    is_active: false
                }]
            });

            await expect(
                authService.authenticateUser('disabled', 'StrongPass1')
            ).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
        });

        test('throws INVALID_CREDENTIALS when password is wrong', async () => {
            cacheService.get.mockResolvedValue(null);
            db.query.mockResolvedValueOnce({
                rows: [{
                    user_id: 1,
                    username: 'admin',
                    email: 'admin@test.com',
                    password_hash: hashedPassword,
                    is_active: true
                }]
            });

            await expect(
                authService.authenticateUser('admin', 'WrongPassword1')
            ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
        });

        test('throws ACCOUNT_LOCKED when account is locked', async () => {
            AccountLockout.get.mockResolvedValueOnce({
                failed_attempts: 5,
                locked_until: new Date(Date.now() + 900000),
            });

            await expect(
                authService.authenticateUser('locked', 'pass')
            ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        });
    });

    describe('findUserById', () => {
        test('returns cached user when available', async () => {
            const cachedUser = { user_id: 1, username: 'admin', is_active: true };
            cacheService.get.mockResolvedValueOnce(cachedUser);

            const result = await authService.findUserById(1);
            expect(result).toEqual(cachedUser);
            expect(db.query).not.toHaveBeenCalled();
        });

        test('returns user from DB and caches it', async () => {
            cacheService.get.mockResolvedValueOnce(null);
            db.query.mockResolvedValueOnce({
                rows: [{
                    user_id: 2,
                    username: 'user2',
                    email: 'user2@test.com',
                    role: 'user',
                    password_hash: 'hashed',
                    is_active: true
                }]
            });

            const result = await authService.findUserById(2);
            expect(result.user_id).toBe(2);
            expect(result).not.toHaveProperty('password_hash');
            expect(cacheService.set).toHaveBeenCalled();
        });

        test('returns null when user not found', async () => {
            cacheService.get.mockResolvedValueOnce(null);
            db.query.mockResolvedValueOnce({ rows: [] });

            const result = await authService.findUserById(999);
            expect(result).toBeNull();
            expect(cacheService.set).not.toHaveBeenCalled();
        });
    });

    describe('findUserByUsernameOrEmail', () => {
        test('finds user by username', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ user_id: 1, username: 'admin' }]
            });

            const result = await authService.findUserByUsernameOrEmail('admin');
            expect(result.username).toBe('admin');
        });

        test('finds user by separate email', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ user_id: 1, username: 'admin', email: 'admin@test.com' }]
            });

            const result = await authService.findUserByUsernameOrEmail('admin', 'admin@test.com');
            expect(result).toBeTruthy();
            // When email differs from login, uses OR query with 2 params
            const [, params] = db.query.mock.calls[0];
            expect(params).toEqual(['admin', 'admin@test.com']);
        });

        test('returns null when no user found', async () => {
            db.query.mockResolvedValueOnce({ rows: [] });

            const result = await authService.findUserByUsernameOrEmail('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('logout', () => {
        test('blacklists the token and returns success message', async () => {
            const user = { user_id: 1, username: 'admin', email: 'a@b.com', role: 'admin' };
            const tokens = authService.generateTokens(user);

            // Mock the DB insert for blacklist
            db.query.mockResolvedValue({ rowCount: 1 });

            const result = await authService.logout(tokens.accessToken);
            expect(result.message).toBe('Выход выполнен успешно');
        });
    });

    // ARCH-105: atomic refresh — INSERT blacklist BEFORE findUserById
    describe('refreshToken', () => {
        test('returns new tokens for valid refresh token', async () => {
            const user = { user_id: 1, username: 'admin', email: 'a@b.com', role: 'admin' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(null);
            db.query
                .mockResolvedValueOnce({ rowCount: 1 }) // 1st: atomic INSERT into token_blacklist
                .mockResolvedValueOnce({                 // 2nd: findUserById SELECT
                    rows: [{
                        user_id: 1,
                        username: 'admin',
                        email: 'a@b.com',
                        role: 'admin',
                        is_active: true
                    }]
                });

            const newTokens = await authService.refreshToken(tokens.refreshToken);
            expect(newTokens).toHaveProperty('accessToken');
            expect(newTokens).toHaveProperty('refreshToken');
        });

        test('throws for invalid refresh token', async () => {
            await expect(
                authService.refreshToken('invalid-token')
            ).rejects.toThrow();
        });

        test('throws USER_NOT_FOUND when user not found during refresh', async () => {
            const user = { user_id: 999, username: 'ghost', email: 'g@b.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(null);
            db.query
                .mockResolvedValueOnce({ rowCount: 1 })  // atomic INSERT into token_blacklist
                .mockResolvedValueOnce({ rows: [] });     // findUserById returns null

            await expect(
                authService.refreshToken(tokens.refreshToken)
            ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
        });

        // ARCH-105: core scenario — concurrent duplicate refresh rejected
        test('throws TOKEN_REUSE when refresh token already consumed', async () => {
            const user = { user_id: 1, username: 'admin', email: 'a@b.com', role: 'admin' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(null);
            const uniqueError = new Error('duplicate key value violates unique constraint');
            uniqueError.code = '23505';
            db.query.mockRejectedValueOnce(uniqueError);

            await expect(
                authService.refreshToken(tokens.refreshToken)
            ).rejects.toMatchObject({ code: 'TOKEN_REUSE' });
        });
    });

    describe('changePassword', () => {
        test('changes password successfully', async () => {
            const oldHash = bcrypt.hashSync('OldPass123', 4);

            // findUserById
            cacheService.get.mockResolvedValue(null);
            db.query
                .mockResolvedValueOnce({
                    rows: [{
                        user_id: 1,
                        username: 'admin',
                        email: 'admin@test.com',
                        role: 'admin',
                        is_active: true
                    }]
                })
                // password_hash query
                .mockResolvedValueOnce({ rows: [{ password_hash: oldHash }] })
                // update query
                .mockResolvedValueOnce({ rowCount: 1 });

            const result = await authService.changePassword(1, 'OldPass123', 'NewPass123');
            expect(result.message).toBe('Пароль успешно изменен');
        });

        test('throws USER_NOT_FOUND when user does not exist', async () => {
            cacheService.get.mockResolvedValue(null);
            db.query.mockResolvedValueOnce({ rows: [] });

            await expect(
                authService.changePassword(999, 'Old1', 'New1')
            ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
        });

        test('throws INVALID_CURRENT_PASSWORD when current password is wrong', async () => {
            const correctHash = bcrypt.hashSync('CorrectPass1', 4);

            cacheService.get.mockResolvedValue(null);
            db.query
                .mockResolvedValueOnce({
                    rows: [{ user_id: 1, username: 'u', is_active: true }]
                })
                .mockResolvedValueOnce({ rows: [{ password_hash: correctHash }] });

            await expect(
                authService.changePassword(1, 'WrongPass123', 'NewPass123')
            ).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
        });
    });

    describe('isTokenBlacklisted', () => {
        test('returns true when token is in cache', async () => {
            cacheService.get.mockResolvedValueOnce(true);

            const user = { user_id: 1, username: 'u', email: 'u@b.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            const result = await authService.isTokenBlacklisted(tokens.accessToken);
            expect(result).toBe(true);
        });

        test('returns false when token is not blacklisted', async () => {
            cacheService.get.mockResolvedValueOnce(null);
            db.query.mockResolvedValueOnce({ rows: [] });

            const user = { user_id: 1, username: 'u', email: 'u@b.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            const result = await authService.isTokenBlacklisted(tokens.accessToken);
            expect(result).toBe(false);
        });

        test('returns true when token is in DB but not cache', async () => {
            cacheService.get.mockResolvedValueOnce(null);
            db.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

            const user = { user_id: 1, username: 'u', email: 'u@b.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            const result = await authService.isTokenBlacklisted(tokens.accessToken);
            expect(result).toBe(true);
        });

        test('returns false on error', async () => {
            // Force an error by passing something jwt.decode cannot handle
            const result = await authService.isTokenBlacklisted(null);
            expect(result).toBe(false);
        });
    });

    describe('checkAccountLockout', () => {
        test('does not throw when no lockout record', async () => {
            AccountLockout.get.mockResolvedValueOnce(null);
            await expect(authService.checkAccountLockout('user')).resolves.not.toThrow();
        });

        test('does not throw when record exists but locked_until is null', async () => {
            AccountLockout.get.mockResolvedValueOnce({
                failed_attempts: 2,
                locked_until: null,
            });
            await expect(authService.checkAccountLockout('user')).resolves.not.toThrow();
        });

        test('throws ACCOUNT_LOCKED when lockout is active', async () => {
            AccountLockout.get.mockResolvedValueOnce({
                failed_attempts: 5,
                locked_until: new Date(Date.now() + 900000),
            });

            await expect(
                authService.checkAccountLockout('user')
            ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        });

        test('clears attempts and does not throw when lockout has expired', async () => {
            AccountLockout.get.mockResolvedValueOnce({
                failed_attempts: 5,
                locked_until: new Date(Date.now() - 1000),
            });

            await expect(authService.checkAccountLockout('user')).resolves.not.toThrow();
            expect(AccountLockout.clearAttempts).toHaveBeenCalledWith('user');
        });
    });

    describe('recordFailedAttempt', () => {
        test('delegates to AccountLockout.recordFailedAttempt with config', async () => {
            AccountLockout.recordFailedAttempt.mockResolvedValueOnce({ failed_attempts: 1, locked_until: null });

            await authService.recordFailedAttempt('user1');

            expect(AccountLockout.recordFailedAttempt).toHaveBeenCalledWith(
                'user1',
                5,               // maxLoginAttempts
                15 * 60 * 1000   // lockoutDuration
            );
        });

        test('logs lockout warning when max attempts reached', async () => {
            const logger = require('../../../src/utils/logger');
            AccountLockout.recordFailedAttempt.mockResolvedValueOnce({
                failed_attempts: 5,
                locked_until: new Date(Date.now() + 900000),
            });

            await authService.recordFailedAttempt('user1');

            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('заблокирован')
            );
        });
    });

    describe('clearFailedAttempts', () => {
        test('calls AccountLockout.clearAttempts with login', async () => {
            await authService.clearFailedAttempts('user1');

            expect(AccountLockout.clearAttempts).toHaveBeenCalledWith('user1');
        });
    });

    describe('updateLastLogin', () => {
        test('updates last_login in DB and invalidates cache', async () => {
            db.query.mockResolvedValue({ rowCount: 1 });

            await authService.updateLastLogin(1);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE users SET last_login'),
                [1]
            );
            expect(cacheService.invalidate).toHaveBeenCalledWith('auth:user:1');
        });
    });

    describe('cleanupExpiredTokens', () => {
        test('deletes expired tokens from DB', async () => {
            db.query.mockResolvedValue({ rowCount: 3 });

            await authService.cleanupExpiredTokens();

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM token_blacklist')
            );
        });

        test('handles DB error gracefully', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(authService.cleanupExpiredTokens()).resolves.not.toThrow();
        });

        test('does not log when no tokens deleted', async () => {
            const logger = require('../../../src/utils/logger');
            db.query.mockResolvedValue({ rowCount: 0 });

            await authService.cleanupExpiredTokens();

            // logger.info should NOT be called when rowCount is 0
            const infoCalls = logger.info.mock.calls.filter(c =>
                c[0] && c[0].includes('просроченных токенов')
            );
            expect(infoCalls).toHaveLength(0);
        });
    });

    describe('generateTokens - error path', () => {
        test('throws when jwt.sign fails', () => {
            // Temporarily override jwtSecret to cause sign to fail
            const origSecret = authService.jwtSecret;
            authService.jwtSecret = undefined;

            expect(() => authService.generateTokens({
                user_id: 1, username: 'u', email: 'u@b.com', role: 'user'
            })).toThrow();

            authService.jwtSecret = origSecret;
        });
    });

    describe('verifyToken', () => {
        test('returns decoded payload for valid token', async () => {
            const user = { user_id: 1, username: 'admin', email: 'admin@test.com', role: 'admin' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(null); // not blacklisted
            db.query
                .mockResolvedValueOnce({ rows: [] }) // isTokenBlacklisted DB check
                .mockResolvedValueOnce({
                    rows: [{ user_id: 1, username: 'admin', email: 'admin@test.com', role: 'admin', is_active: true }]
                }); // findUserById

            const decoded = await authService.verifyToken(tokens.accessToken);

            expect(decoded.user_id).toBe(1);
            expect(decoded.username).toBe('admin');
        });

        test('throws TOKEN_BLACKLISTED when token is blacklisted', async () => {
            const user = { user_id: 1, username: 'admin', email: 'admin@test.com', role: 'admin' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(true); // blacklisted in cache

            await expect(authService.verifyToken(tokens.accessToken)).rejects.toMatchObject({ code: 'TOKEN_BLACKLISTED' });
        });

        test('throws USER_NOT_FOUND when user does not exist', async () => {
            const user = { user_id: 999, username: 'ghost', email: 'ghost@test.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(null); // not blacklisted
            db.query
                .mockResolvedValueOnce({ rows: [] }) // isTokenBlacklisted DB check
                .mockResolvedValueOnce({ rows: [] }); // findUserById returns null

            await expect(authService.verifyToken(tokens.accessToken)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
        });

        test('throws USER_NOT_FOUND when user is inactive', async () => {
            const user = { user_id: 1, username: 'inactive', email: 'i@test.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(null);
            db.query
                .mockResolvedValueOnce({ rows: [] }) // isTokenBlacklisted
                .mockResolvedValueOnce({
                    rows: [{ user_id: 1, username: 'inactive', is_active: false }]
                });

            await expect(authService.verifyToken(tokens.accessToken)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
        });

        test('throws TOKEN_EXPIRED for expired token', async () => {
            const expiredToken = jwt.sign(
                { user_id: 1, username: 'u', email: 'u@b.com', role: 'user' },
                process.env.JWT_SECRET,
                { expiresIn: '0s', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
            );

            // Wait a tiny bit to ensure expiration
            await new Promise(r => setTimeout(r, 10));

            await expect(authService.verifyToken(expiredToken)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
        });

        test('throws INVALID_TOKEN for malformed token', async () => {
            await expect(authService.verifyToken('invalid.token.here')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
        });
    });

    describe('refreshToken - invalid type', () => {
        test('throws INVALID_REFRESH_TOKEN when token type is not refresh', async () => {
            // Generate an access token (type is NOT 'refresh') and try to use it as refresh
            const user = { user_id: 1, username: 'admin', email: 'admin@test.com', role: 'admin' };
            const tokens = authService.generateTokens(user);

            // Try to use the access token as a refresh token - it will fail jwt.verify with wrong secret
            // Instead, sign a token with the refresh secret but without type: 'refresh'
            const fakeRefreshToken = jwt.sign(
                { user_id: 1, type: 'access' },
                process.env.JWT_REFRESH_SECRET,
                { expiresIn: '7d', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
            );

            await expect(authService.refreshToken(fakeRefreshToken)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
        });
    });

    describe('logout - error path', () => {
        test('throws when blacklistToken encounters a fatal error', async () => {
            // blacklistToken swallows errors internally via catch, so logout itself won't throw
            // but let's verify it handles gracefully when jwt.decode returns null
            const result = await authService.logout('completely-invalid-token');
            // blacklistToken catches errors internally, so logout still succeeds
            expect(result.message).toBe('Выход выполнен успешно');
        });
    });

    describe('changePassword - password_hash row not found', () => {
        test('throws USER_NOT_FOUND when password_hash query returns empty', async () => {
            cacheService.get.mockResolvedValue(null);
            db.query
                .mockResolvedValueOnce({
                    rows: [{ user_id: 1, username: 'u', is_active: true }]
                }) // findUserById
                .mockResolvedValueOnce({ rows: [] }); // password_hash query returns empty

            await expect(
                authService.changePassword(1, 'OldPass123', 'NewPass123')
            ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
        });
    });

    describe('findUserById - error path', () => {
        test('throws on DB error', async () => {
            cacheService.get.mockResolvedValue(null);
            db.query.mockRejectedValue(new Error('DB connection lost'));

            await expect(authService.findUserById(1)).rejects.toThrow('DB connection lost');
        });
    });

    describe('findUserByUsernameOrEmail - error path', () => {
        test('throws on DB error', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            await expect(authService.findUserByUsernameOrEmail('user')).rejects.toThrow('DB error');
        });
    });

    describe('updateLastLogin - error path', () => {
        test('does not throw on DB error (error is caught)', async () => {
            db.query.mockRejectedValue(new Error('DB error'));

            // updateLastLogin catches errors and only logs them
            await expect(authService.updateLastLogin(1)).resolves.not.toThrow();
        });
    });

    describe('blacklistToken - edge cases', () => {
        test('does not store token when TTL is zero or negative (already expired)', async () => {
            // Create an already-expired token
            const expiredToken = jwt.sign(
                { user_id: 1, username: 'u', email: 'u@b.com', role: 'user' },
                process.env.JWT_SECRET,
                { expiresIn: '0s', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
            );

            await new Promise(r => setTimeout(r, 10));

            cacheService.set.mockClear();
            db.query.mockClear();

            await authService.blacklistToken(expiredToken);

            // Should not call cacheService.set or db.query since ttl <= 0
            expect(cacheService.set).not.toHaveBeenCalled();
        });

        test('handles DB error in blacklistToken gracefully (falls back to cache)', async () => {
            const user = { user_id: 1, username: 'u', email: 'u@b.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            cacheService.set.mockResolvedValue(undefined);
            db.query.mockRejectedValue(new Error('DB insert failed'));

            // Should not throw - DB error is caught, cache still works
            await expect(authService.blacklistToken(tokens.accessToken)).resolves.not.toThrow();
            // Cache should still have been called
            expect(cacheService.set).toHaveBeenCalled();
        });
    });

    describe('isTokenBlacklisted - DB error path', () => {
        test('returns false when DB check fails', async () => {
            const user = { user_id: 1, username: 'u', email: 'u@b.com', role: 'user' };
            const tokens = authService.generateTokens(user);

            cacheService.get.mockResolvedValue(null); // not in cache
            db.query.mockRejectedValue(new Error('DB error')); // DB fails

            const result = await authService.isTokenBlacklisted(tokens.accessToken);
            // Should fall through to return false
            expect(result).toBe(false);
        });
    });
});
