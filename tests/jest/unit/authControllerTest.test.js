jest.mock('../../../src/services/authService', () => ({
    authenticateUser: jest.fn(),
    generateTokens: jest.fn(),
    registerUser: jest.fn(),
    findUserById: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    changePassword: jest.fn()
}));

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/utils/helpers', () => ({
    createError: jest.fn((msg, code) => {
        const err = new Error(msg);
        err.statusCode = code;
        return err;
    })
}));

const authController = require('../../../src/controllers/authController');
const authService = require('../../../src/services/authService');

describe('AuthController', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            body: {},
            headers: {},
            user: { user_id: 1, userId: 1 }
        };
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('login', () => {
        test('returns 400 when username is missing', async () => {
            req.body = { password: 'pass' };
            await authController.login(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: expect.any(String) })
            );
        });

        test('returns 400 when password is missing', async () => {
            req.body = { username: 'user' };
            await authController.login(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns tokens and user on successful login', async () => {
            req.body = { username: 'admin', password: 'StrongPass1' };
            const mockUser = {
                user_id: 1,
                username: 'admin',
                role: 'admin',
                last_login: '2025-01-01'
            };
            const mockTokens = {
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                tokenType: 'Bearer',
                expiresIn: '24h'
            };

            authService.authenticateUser.mockResolvedValue(mockUser);
            authService.generateTokens.mockReturnValue(mockTokens);

            await authController.login(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Login successful',
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                    user: expect.objectContaining({
                        id: 1,
                        username: 'admin',
                        role: 'admin'
                    })
                })
            );
        });

        test('returns 401 for INVALID_CREDENTIALS error', async () => {
            req.body = { username: 'admin', password: 'wrong' };
            const error = new Error('Bad credentials');
            error.code = 'INVALID_CREDENTIALS';
            authService.authenticateUser.mockRejectedValue(error);

            await authController.login(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('returns 403 for ACCOUNT_DISABLED error', async () => {
            req.body = { username: 'disabled', password: 'pass' };
            const error = new Error('Account disabled');
            error.code = 'ACCOUNT_DISABLED';
            authService.authenticateUser.mockRejectedValue(error);

            await authController.login(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
        });

        test('returns 423 for ACCOUNT_LOCKED error', async () => {
            req.body = { username: 'locked', password: 'pass' };
            const error = new Error('Account locked');
            error.code = 'ACCOUNT_LOCKED';
            authService.authenticateUser.mockRejectedValue(error);

            await authController.login(req, res, next);

            expect(res.status).toHaveBeenCalledWith(423);
        });

        test('calls next with error for unexpected errors', async () => {
            req.body = { username: 'admin', password: 'pass' };
            const error = new Error('Unexpected');
            authService.authenticateUser.mockRejectedValue(error);

            await authController.login(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('register', () => {
        test('returns 400 when username is missing', async () => {
            req.body = { password: 'pass' };
            await authController.register(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 when password is missing', async () => {
            req.body = { username: 'user' };
            await authController.register(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 201 on successful registration', async () => {
            req.body = {
                username: 'newuser',
                email: 'new@test.com',
                password: 'StrongPass1'
            };
            const mockUser = {
                user_id: 5,
                username: 'newuser',
                email: 'new@test.com',
                role: 'user'
            };
            authService.registerUser.mockResolvedValue(mockUser);

            await authController.register(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'User registered successfully',
                    user: mockUser
                })
            );
        });

        test('returns 409 for USER_EXISTS error', async () => {
            req.body = { username: 'existing', email: 'e@t.com', password: 'StrongPass1' };
            const error = new Error('User exists');
            error.code = 'USER_EXISTS';
            authService.registerUser.mockRejectedValue(error);

            await authController.register(req, res, next);

            expect(res.status).toHaveBeenCalledWith(409);
        });

        test('calls next for unexpected errors', async () => {
            req.body = { username: 'user', email: 'u@t.com', password: 'StrongPass1' };
            const error = new Error('Unexpected');
            authService.registerUser.mockRejectedValue(error);

            await authController.register(req, res, next);

            expect(next).toHaveBeenCalledWith(error);
        });
    });

    describe('getProfile', () => {
        test('returns user profile successfully', async () => {
            const mockUser = {
                user_id: 1,
                username: 'admin',
                email: 'admin@test.com',
                role: 'admin',
                created_at: '2025-01-01',
                last_login: '2025-01-15',
                is_active: true
            };
            authService.findUserById.mockResolvedValue(mockUser);

            await authController.getProfile(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    user: expect.objectContaining({
                        id: 1,
                        username: 'admin',
                        email: 'admin@test.com'
                    })
                })
            );
        });

        test('returns 404 when user not found', async () => {
            authService.findUserById.mockResolvedValue(null);

            await authController.getProfile(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'User not found' })
            );
        });

        test('calls next on error', async () => {
            authService.findUserById.mockRejectedValue(new Error('DB error'));

            await authController.getProfile(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('supports userId from req.user.userId', async () => {
            req.user = { userId: 42 };
            authService.findUserById.mockResolvedValue({
                user_id: 42, username: 'test', email: 'test@t.com',
                role: 'user', created_at: '2025-01-01', is_active: true
            });

            await authController.getProfile(req, res, next);

            expect(authService.findUserById).toHaveBeenCalledWith(42);
        });
    });

    describe('logout', () => {
        test('returns 400 when no token in headers', async () => {
            req.headers = {};
            await authController.logout(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Token required' })
            );
        });

        test('returns success on successful logout', async () => {
            req.headers = { authorization: 'Bearer some-token-123' };
            authService.logout.mockResolvedValue({ message: 'OK' });

            await authController.logout(req, res, next);

            expect(authService.logout).toHaveBeenCalledWith('some-token-123');
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Logout successful'
                })
            );
        });

        test('calls next on error', async () => {
            req.headers = { authorization: 'Bearer token' };
            authService.logout.mockRejectedValue(new Error('fail'));

            await authController.logout(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('refreshToken', () => {
        test('returns 400 when refresh token is missing', async () => {
            req.body = {};
            await authController.refreshToken(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Refresh token required' })
            );
        });

        test('returns new tokens on successful refresh', async () => {
            req.body = { refreshToken: 'valid-refresh-token' };
            const mockTokens = {
                accessToken: 'new-access',
                refreshToken: 'new-refresh',
                tokenType: 'Bearer',
                expiresIn: '24h'
            };
            authService.refreshToken.mockResolvedValue(mockTokens);

            await authController.refreshToken(req, res, next);

            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Token refreshed successfully',
                    accessToken: 'new-access',
                    refreshToken: 'new-refresh'
                })
            );
        });

        test('returns 401 for INVALID_REFRESH_TOKEN error', async () => {
            req.body = { refreshToken: 'invalid' };
            const error = new Error('Invalid refresh');
            error.code = 'INVALID_REFRESH_TOKEN';
            authService.refreshToken.mockRejectedValue(error);

            await authController.refreshToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('returns 401 for USER_NOT_FOUND error', async () => {
            req.body = { refreshToken: 'valid-but-deleted-user' };
            const error = new Error('User not found');
            error.code = 'USER_NOT_FOUND';
            authService.refreshToken.mockRejectedValue(error);

            await authController.refreshToken(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('calls next for unexpected errors', async () => {
            req.body = { refreshToken: 'token' };
            authService.refreshToken.mockRejectedValue(new Error('Unexpected'));

            await authController.refreshToken(req, res, next);

            expect(next).toHaveBeenCalled();
        });
    });

    describe('changePassword', () => {
        test('returns 400 when currentPassword is missing', async () => {
            req.body = { newPassword: 'NewPass1' };
            await authController.changePassword(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns 400 when newPassword is missing', async () => {
            req.body = { currentPassword: 'OldPass1' };
            await authController.changePassword(req, res, next);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('returns success on successful password change', async () => {
            req.body = { currentPassword: 'OldPass1', newPassword: 'NewPass1' };
            authService.changePassword.mockResolvedValue({ message: 'OK' });

            await authController.changePassword(req, res, next);

            expect(authService.changePassword).toHaveBeenCalledWith(1, 'OldPass1', 'NewPass1');
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    message: 'Password changed successfully'
                })
            );
        });

        test('returns 404 for USER_NOT_FOUND error', async () => {
            req.body = { currentPassword: 'OldPass1', newPassword: 'NewPass1' };
            const error = new Error('User not found');
            error.code = 'USER_NOT_FOUND';
            authService.changePassword.mockRejectedValue(error);

            await authController.changePassword(req, res, next);

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('returns 400 for INVALID_CURRENT_PASSWORD error', async () => {
            req.body = { currentPassword: 'WrongPass1', newPassword: 'NewPass1' };
            const error = new Error('Invalid current password');
            error.code = 'INVALID_CURRENT_PASSWORD';
            authService.changePassword.mockRejectedValue(error);

            await authController.changePassword(req, res, next);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        test('calls next for unexpected errors', async () => {
            req.body = { currentPassword: 'OldPass1', newPassword: 'NewPass1' };
            authService.changePassword.mockRejectedValue(new Error('Unexpected'));

            await authController.changePassword(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        test('supports userId from req.user.userId', async () => {
            req.user = { userId: 99 };
            req.body = { currentPassword: 'OldPass1', newPassword: 'NewPass1' };
            authService.changePassword.mockResolvedValue({ message: 'OK' });

            await authController.changePassword(req, res, next);

            expect(authService.changePassword).toHaveBeenCalledWith(99, 'OldPass1', 'NewPass1');
        });
    });
});
