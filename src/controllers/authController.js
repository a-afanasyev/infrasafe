const authService = require('../services/authService');
const totpService = require('../services/totpService');
const logger = require('../utils/logger');

// Логин пользователя
const login = async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: 'Username and password are required'
            });
        }

        // Аутентификация пользователя
        const user = await authService.authenticateUser(username, password);

        // Проверяем, нужна ли 2FA
        if (user.totp_enabled) {
            // 2FA включена — выдаём временный токен для второго шага
            const tempToken = authService.generateTempToken(user);
            return res.json({
                success: true,
                requires2FA: true,
                tempToken,
                message: 'Please enter your 2FA code'
            });
        }

        // Для админов без настроенного 2FA — принудительная настройка
        if (user.role === 'admin') {
            const tempToken = authService.generateTempToken(user);
            return res.json({
                success: true,
                requires2FASetup: true,
                tempToken,
                message: '2FA setup required for admin accounts'
            });
        }

        // Обычный пользователь без 2FA — стандартный JWT
        const tokens = authService.generateTokens(user);

        res.json({
            success: true,
            message: 'Login successful',
            ...tokens,
            user: {
                id: user.user_id,
                username: user.username,
                role: user.role,
                last_login: user.last_login
            }
        });

    } catch (error) {
        // Обрабатываем специфичные ошибки сервиса
        if (error.code === 'INVALID_CREDENTIALS') {
            return res.status(401).json({ error: error.message });
        }
        if (error.code === 'ACCOUNT_DISABLED') {
            return res.status(403).json({ error: error.message });
        }
        if (error.code === 'ACCOUNT_LOCKED') {
            return res.status(423).json({ error: error.message });
        }

        logger.error(`Login error: ${error.message}`);
        next(error);
    }
};

// Регистрация нового пользователя
const register = async (req, res, next) => {
    try {
        const { username, email, password } = req.body;
        const role = 'user';

        if (!username || !password) {
            return res.status(400).json({
                error: 'Username and password are required'
            });
        }

        const newUser = await authService.registerUser({
            username,
            email,
            password,
            role
        });

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: newUser
        });

    } catch (error) {
        // Обрабатываем специфичные ошибки сервиса
        if (error.code === 'USER_EXISTS') {
            return res.status(409).json({ error: error.message });
        }

        logger.error(`Registration error: ${error.message}`);
        next(error);
    }
};

// Получение информации о текущем пользователе
const getProfile = async (req, res, next) => {
    try {
        const userId = req.user.user_id || req.user.userId; // Поддержка обеих версий

        const user = await authService.findUserById(userId);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            success: true,
            user: {
                id: user.user_id,
                username: user.username,
                email: user.email,
                role: user.role,
                created_at: user.created_at,
                last_login: user.last_login,
                is_active: user.is_active
            }
        });

    } catch (error) {
        logger.error(`Get profile error: ${error.message}`);
        next(error);
    }
};

// Выход из системы
const logout = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(400).json({ error: 'Token required' });
        }

        await authService.logout(token);

        res.json({
            success: true,
            message: 'Logout successful'
        });

    } catch (error) {
        logger.error(`Logout error: ${error.message}`);
        next(error);
    }
};

// Обновление токена
const refreshToken = async (req, res, next) => {
    try {
        const { refreshToken: refresh } = req.body;

        if (!refresh) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        const tokens = await authService.refreshToken(refresh);

        res.json({
            success: true,
            message: 'Token refreshed successfully',
            ...tokens
        });

    } catch (error) {
        if (error.code === 'INVALID_REFRESH_TOKEN' || error.code === 'USER_NOT_FOUND') {
            return res.status(401).json({ error: error.message });
        }

        logger.error(`Refresh token error: ${error.message}`);
        next(error);
    }
};

// Смена пароля
const changePassword = async (req, res, next) => {
    try {
        const userId = req.user.user_id || req.user.userId;
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Current password and new password are required'
            });
        }

        await authService.changePassword(userId, currentPassword, newPassword);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        if (error.code === 'USER_NOT_FOUND') {
            return res.status(404).json({ error: error.message });
        }
        if (error.code === 'INVALID_CURRENT_PASSWORD') {
            return res.status(400).json({ error: error.message });
        }

        logger.error(`Change password error: ${error.message}`);
        next(error);
    }
};

// Верификация 2FA кода (второй шаг логина)
const verify2FA = async (req, res, next) => {
    try {
        const { code } = req.body;
        const user = req.tempUser; // set by authenticateTempToken

        if (!code) {
            return res.status(400).json({ error: '2FA code is required' });
        }

        const result = await totpService.verifyCode(user.user_id, code);

        if (!result.valid) {
            return res.status(401).json({ error: 'Invalid 2FA code' });
        }

        // SEC-101: blacklist tempToken so it cannot be reused
        if (req.tempToken) {
            await authService.blacklistToken(req.tempToken);
        }

        // Генерация полных токенов
        const tokens = authService.generateTokens(user);

        res.json({
            success: true,
            message: result.method === 'recovery'
                ? 'Login successful (recovery code used)'
                : 'Login successful',
            ...tokens,
            user: {
                id: user.user_id,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        logger.error(`Verify 2FA error: ${error.message}`);
        next(error);
    }
};

// Настройка 2FA (получение QR-кода)
const setup2FA = async (req, res, next) => {
    try {
        const user = req.tempUser;

        const setup = await totpService.generateSetup(user.user_id, user.username);

        // SEC-101: blacklist tempToken so it cannot be reused
        if (req.tempToken) {
            await authService.blacklistToken(req.tempToken);
        }

        res.json({
            success: true,
            qrCodeUrl: setup.qrCodeUrl,
            secret: setup.secret,
            recoveryCodes: setup.recoveryCodes,
            message: 'Scan QR code with your authenticator app, then confirm with a code'
        });
    } catch (error) {
        logger.error(`Setup 2FA error: ${error.message}`);
        next(error);
    }
};

// Подтверждение настройки 2FA
const confirm2FA = async (req, res, next) => {
    try {
        const { code } = req.body;
        const user = req.tempUser;

        if (!code) {
            return res.status(400).json({ error: 'TOTP code is required to confirm setup' });
        }

        await totpService.confirmSetup(user.user_id, code);

        // SEC-101: blacklist tempToken so it cannot be reused
        if (req.tempToken) {
            await authService.blacklistToken(req.tempToken);
        }

        // 2FA активирована — выдаём полные токены
        const tokens = authService.generateTokens(user);

        res.json({
            success: true,
            message: '2FA enabled successfully',
            ...tokens,
            user: {
                id: user.user_id,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        if (error.message === 'Invalid TOTP code') {
            return res.status(400).json({ error: error.message });
        }
        logger.error(`Confirm 2FA error: ${error.message}`);
        next(error);
    }
};

// Отключение 2FA (только non-admin, требует пароль)
const disable2FA = async (req, res, next) => {
    try {
        const userId = req.user.user_id || req.user.userId;
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Password is required to disable 2FA' });
        }

        // SEC-105: verify password without incrementing lockout counter
        const isPasswordValid = await authService.verifyPasswordOnly(userId, password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid password' });
        }

        await totpService.disable(userId);

        res.json({
            success: true,
            message: '2FA disabled successfully'
        });
    } catch (error) {
        if (error.message === 'Admins cannot disable 2FA') {
            return res.status(403).json({ error: error.message });
        }
        logger.error(`Disable 2FA error: ${error.message}`);
        next(error);
    }
};

module.exports = {
    login,
    register,
    getProfile,
    logout,
    refreshToken,
    changePassword,
    verify2FA,
    setup2FA,
    confirm2FA,
    disable2FA
};