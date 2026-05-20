jest.mock('jsonwebtoken');
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));
jest.mock('../../../src/services/authService', () => ({
    isTokenBlacklisted: jest.fn(),
    findUserById: jest.fn(),
    _isIssuedBeforeCutoff: jest.fn()
}));

const jwt = require('jsonwebtoken');
const authService = require('../../../src/services/authService');
const { authenticateJWT, isAdmin, authenticateRefresh, optionalAuth } = require('../../../src/middleware/auth');

describe('Auth Middleware', () => {
    let req, res, next;
    const originalEnv = process.env;

    const mockUser = {
        user_id: 1,
        username: 'testuser',
        role: 'user',
        email: 'test@example.com',
        account_locked_until: null
    };

    const mockAdminUser = {
        user_id: 2,
        username: 'admin',
        role: 'admin',
        email: 'admin@example.com',
        account_locked_until: null
    };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, JWT_SECRET: 'test-secret', JWT_REFRESH_SECRET: 'test-refresh-secret' };
        req = {
            headers: {},
            body: {},
            // [P1-2] cookie-parser populates this in the real app;
            // mocked empty so extractAccessToken / extractRefreshToken
            // don't blow up on `req.cookies` access.
            cookies: {},
            originalUrl: '/api/test'
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('authenticateJWT', () => {
        test('returns 401 when authorization header is missing', async () => {
            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    message: 'Access token is missing'
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('returns 401 when "Bearer " has no token after it and no cookie fallback', async () => {
            req.headers.authorization = 'Bearer ';
            // [P1-2] cookie fallback consolidation — "Bearer " with an
            // empty token now drops through to the cookie path. With no
            // cookie either, the response is the unified "Access token
            // is missing" rather than the old "Invalid token format".

            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('Access token is missing')
                })
            );
        });

        test('returns 401 when token is blacklisted', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(true);

            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Token has been revoked'
                })
            );
        });

        test('returns 500 when JWT_SECRET is not defined', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            delete process.env.JWT_SECRET;

            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Internal server configuration error'
                })
            );
        });

        test('returns 401 when token is invalid or expired', async () => {
            req.headers.authorization = 'Bearer invalid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                const err = new Error('jwt expired');
                err.name = 'TokenExpiredError';
                cb(err, null);
            });

            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Invalid or expired token'
                })
            );
        });

        test('returns 401 when user is not found', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 999 });
            });
            authService.findUserById.mockResolvedValue(null);

            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'User not found'
                })
            );
        });

        test('returns 401 when account is locked', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            const lockedUser = {
                ...mockUser,
                account_locked_until: new Date(Date.now() + 60 * 60 * 1000).toISOString()
            };
            authService.findUserById.mockResolvedValue(lockedUser);

            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Account is locked'
                })
            );
        });

        test('sets req.user and calls next on valid token', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            authService.findUserById.mockResolvedValue(mockUser);

            await authenticateJWT(req, res, next);

            expect(req.user).toEqual(expect.objectContaining({
                user_id: 1,
                username: 'testuser',
                role: 'user'
            }));
            expect(req.token).toBe('valid-token');
            expect(next).toHaveBeenCalled();
        });

        test('returns 500 when findUserById throws', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            authService.findUserById.mockRejectedValue(new Error('DB error'));

            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Internal server error'
                })
            );
        });
    });

    describe('isAdmin', () => {
        test('returns 403 when req.user is not set', () => {
            isAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    message: 'Requires admin privileges'
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('returns 403 when user is not admin', () => {
            req.user = { user_id: 1, username: 'testuser', role: 'user' };

            isAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });

        test('calls next when user is admin', () => {
            req.user = { user_id: 2, username: 'admin', role: 'admin' };

            isAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
    });

    describe('authenticateRefresh', () => {
        test('returns 400 when refreshToken is missing', async () => {
            req.body = {};

            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Refresh token is required'
                })
            );
        });

        test('returns 401 when refresh token is blacklisted', async () => {
            req.body = { refreshToken: 'blacklisted-token' };
            authService.isTokenBlacklisted.mockResolvedValue(true);

            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Refresh token has been revoked'
                })
            );
        });

        test('returns 500 when JWT_REFRESH_SECRET is not defined', async () => {
            req.body = { refreshToken: 'some-token' };
            authService.isTokenBlacklisted.mockResolvedValue(false);
            delete process.env.JWT_REFRESH_SECRET;

            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Internal server configuration error'
                })
            );
        });

        test('returns 401 when refresh token is invalid', async () => {
            req.body = { refreshToken: 'invalid-token' };
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                const err = new Error('invalid token');
                err.name = 'JsonWebTokenError';
                cb(err, null);
            });

            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Invalid or expired refresh token'
                })
            );
        });

        test('returns 401 when user is not found', async () => {
            req.body = { refreshToken: 'valid-refresh' };
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 999 });
            });
            authService.findUserById.mockResolvedValue(null);

            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'User not found'
                })
            );
        });

        test('returns 401 when account is locked', async () => {
            req.body = { refreshToken: 'valid-refresh' };
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            const lockedUser = {
                ...mockUser,
                account_locked_until: new Date(Date.now() + 60 * 60 * 1000).toISOString()
            };
            authService.findUserById.mockResolvedValue(lockedUser);

            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Account is locked'
                })
            );
        });

        test('sets req.user and calls next on valid refresh token', async () => {
            req.body = { refreshToken: 'valid-refresh' };
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            authService.findUserById.mockResolvedValue(mockUser);

            await authenticateRefresh(req, res, next);

            expect(req.user).toEqual(expect.objectContaining({
                user_id: 1,
                username: 'testuser',
                role: 'user'
            }));
            expect(req.refreshToken).toBe('valid-refresh');
            expect(next).toHaveBeenCalled();
        });

        test('returns 500 when findUserById throws', async () => {
            req.body = { refreshToken: 'valid-refresh' };
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            authService.findUserById.mockRejectedValue(new Error('DB error'));

            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Internal server error'
                })
            );
        });
    });

    describe('optionalAuth', () => {
        test('sets req.user to null and calls next when no auth header', async () => {
            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user to null when token is empty', async () => {
            req.headers.authorization = 'Bearer ';

            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user to null when token is blacklisted', async () => {
            req.headers.authorization = 'Bearer blacklisted-token';
            authService.isTokenBlacklisted.mockResolvedValue(true);

            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user to null when JWT_SECRET is missing', async () => {
            req.headers.authorization = 'Bearer some-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            delete process.env.JWT_SECRET;

            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user to null when token is invalid', async () => {
            req.headers.authorization = 'Bearer invalid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(new Error('invalid'), null);
            });

            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user when token is valid', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            authService.findUserById.mockResolvedValue(mockUser);

            await optionalAuth(req, res, next);

            expect(req.user).toEqual(expect.objectContaining({
                user_id: 1,
                username: 'testuser',
                role: 'user'
            }));
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user to null when user not found', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 999 });
            });
            authService.findUserById.mockResolvedValue(null);

            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user to null when account is locked', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            const lockedUser = {
                ...mockUser,
                account_locked_until: new Date(Date.now() + 60 * 60 * 1000).toISOString()
            };
            authService.findUserById.mockResolvedValue(lockedUser);

            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });

        test('sets req.user to null when findUserById throws', async () => {
            req.headers.authorization = 'Bearer valid-token';
            authService.isTokenBlacklisted.mockResolvedValue(false);
            jwt.verify.mockImplementation((token, secret, opts, cb) => {
                cb(null, { user_id: 1 });
            });
            authService.findUserById.mockRejectedValue(new Error('DB error'));

            await optionalAuth(req, res, next);

            expect(req.user).toBeNull();
            expect(next).toHaveBeenCalled();
        });
    });

    describe('authenticateJWT — password_changed_at cutoff', () => {
        const NOW = Math.floor(Date.now() / 1000);

        function makeReq(token = 'eyJraW...stub.token') {
            return { headers: { authorization: `Bearer ${token}` } };
        }
        function makeRes() {
            return { status: jest.fn().mockReturnThis(), json: jest.fn() };
        }

        beforeEach(() => {
            authService.isTokenBlacklisted.mockResolvedValue(false);
            process.env.JWT_SECRET = 'test-secret';
        });

        test('rejects token whose iat is before password_changed_at', async () => {
            const userPca = new Date().toISOString();
            const decoded = { user_id: 1, iat: NOW - 3600 };  // 1h ago
            jwt.verify.mockImplementation((tok, sec, opts, cb) => cb(null, decoded));
            authService.findUserById.mockResolvedValue({
                user_id: 1, username: 'admin', role: 'admin',
                email: 'a@b.com', is_active: true, password_changed_at: userPca
            });
            authService._isIssuedBeforeCutoff.mockReturnValue(true);

            const req = makeReq();
            const res = makeRes();
            const next = jest.fn();
            await authenticateJWT(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid or expired token' });
            expect(next).not.toHaveBeenCalled();
        });

        test('passes when password_changed_at is null (legacy user)', async () => {
            const decoded = { user_id: 1, iat: NOW };
            jwt.verify.mockImplementation((tok, sec, opts, cb) => cb(null, decoded));
            authService.findUserById.mockResolvedValue({
                user_id: 1, username: 'admin', role: 'admin',
                email: 'a@b.com', is_active: true, password_changed_at: null
            });
            authService._isIssuedBeforeCutoff.mockReturnValue(false);

            const req = makeReq();
            const res = makeRes();
            const next = jest.fn();
            await authenticateJWT(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('authenticateRefresh — password_changed_at cutoff', () => {
        test('rejects refresh token whose iat is before password_changed_at', async () => {
            authService.isTokenBlacklisted.mockResolvedValue(false);
            process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

            const decoded = { user_id: 1, iat: Math.floor(Date.now() / 1000) - 3600 };
            jwt.verify.mockImplementation((tok, sec, opts, cb) => cb(null, decoded));
            authService.findUserById.mockResolvedValue({
                user_id: 1, username: 'admin', role: 'admin', email: 'a@b.com',
                is_active: true, password_changed_at: new Date().toISOString()
            });
            authService._isIssuedBeforeCutoff.mockReturnValue(true);

            const req = { body: { refreshToken: 'stub.refresh.token' } };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
            const next = jest.fn();
            await authenticateRefresh(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Invalid or expired refresh token' });
            expect(next).not.toHaveBeenCalled();
        });
    });
});
