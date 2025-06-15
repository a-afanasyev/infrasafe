const authService = require('../services/authService');
const logger = require('../utils/logger');
const { createError } = require('../utils/helpers');

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

        // Генерация токенов
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
        const { username, email, password, role = 'user' } = req.body;

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

module.exports = {
    login,
    register,
    getProfile,
    logout,
    refreshToken,
    changePassword
};