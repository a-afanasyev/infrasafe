const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const authService = require('../services/authService');

// Проверка JWT токена с проверкой черного списка
const authenticateJWT = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Access token is missing'
            });
        }

        const token = authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Invalid token format'
            });
        }

        // Проверка токена на черном списке
        const isBlacklisted = await authService.isTokenBlacklisted(token);
        if (isBlacklisted) {
            logger.warn(`Попытка использования токена из черного списка`);
            return res.status(401).json({
                success: false,
                message: 'Token has been revoked'
            });
        }

        // Проверка токена
        if (!process.env.JWT_SECRET) {
            logger.error('JWT_SECRET is not defined in environment variables');
            return res.status(500).json({
                success: false,
                message: 'Internal server configuration error'
            });
        }
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                logger.warn(`Неудачная попытка аутентификации: ${err.message}`);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }

            // Проверка существования пользователя
            try {
                const user = await authService.findUserById(decoded.user_id);
                if (!user) {
                    return res.status(401).json({
                        success: false,
                        message: 'User not found'
                    });
                }

                // Проверка заблокированного аккаунта
                if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
                    return res.status(401).json({
                        success: false,
                        message: 'Account is locked'
                    });
                }

                req.user = {
                    user_id: user.user_id,
                    id: user.user_id, // Для обратной совместимости
                    username: user.username,
                    role: user.role,
                    email: user.email
                };
                req.token = token; // Сохраняем токен для возможного добавления в blacklist
                next();
            } catch (userError) {
                logger.error(`Ошибка при проверке пользователя: ${userError.message}`);
                return res.status(500).json({
                    success: false,
                    message: 'Internal server error'
                });
            }
        });
    } catch (error) {
        logger.error(`Ошибка middleware аутентификации: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Проверка наличия прав администратора
const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        logger.warn(`Попытка доступа к админ-ресурсу без достаточных прав: ${req.originalUrl}, пользователь: ${req.user?.username || 'anonymous'}`);
        return res.status(403).json({
            success: false,
            message: 'Requires admin privileges'
        });
    }
    next();
};

// Проверка refresh токена
const authenticateRefresh = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token is required'
            });
        }

        // Проверка токена на черном списке
        const isBlacklisted = await authService.isTokenBlacklisted(refreshToken);
        if (isBlacklisted) {
            logger.warn(`Попытка использования refresh токена из черного списка`);
            return res.status(401).json({
                success: false,
                message: 'Refresh token has been revoked'
            });
        }

        if (!process.env.JWT_REFRESH_SECRET) {
            logger.error('JWT_REFRESH_SECRET is not defined in environment variables');
            return res.status(500).json({
                success: false,
                message: 'Internal server configuration error'
            });
        }

        // Проверка refresh токена
        jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
            if (err) {
                logger.warn(`Неудачная попытка обновления токена: ${err.message}`);
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired refresh token'
                });
            }

            // Проверка существования пользователя
            try {
                const user = await authService.findUserById(decoded.user_id);
                if (!user) {
                    return res.status(401).json({
                        success: false,
                        message: 'User not found'
                    });
                }

                // Проверка заблокированного аккаунта
                if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
                    return res.status(401).json({
                        success: false,
                        message: 'Account is locked'
                    });
                }

                req.user = {
                    user_id: user.user_id,
                    id: user.user_id, // Для обратной совместимости
                    username: user.username,
                    role: user.role,
                    email: user.email
                };
                req.refreshToken = refreshToken; // Сохраняем для добавления в blacklist
                next();
            } catch (userError) {
                logger.error(`Ошибка при проверке пользователя для refresh: ${userError.message}`);
                return res.status(500).json({
                    success: false,
                    message: 'Internal server error'
                });
            }
        });
    } catch (error) {
        logger.error(`Ошибка middleware refresh токена: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Опциональная аутентификация (для публичных endpoint с дополнительной функциональностью для авторизованных пользователей)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            // Продолжаем без аутентификации
            req.user = null;
            return next();
        }

        const token = authHeader.split(' ')[1];

        if (!token) {
            req.user = null;
            return next();
        }

        // Проверка токена на черном списке
        const isBlacklisted = await authService.isTokenBlacklisted(token);
        if (isBlacklisted) {
            req.user = null;
            return next();
        }

        // Проверка токена
        if (!process.env.JWT_SECRET) {
            req.user = null;
            return next();
        }
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                req.user = null;
                return next();
            }

            try {
                const user = await authService.findUserById(decoded.user_id);
                if (user && !(user.account_locked_until && new Date(user.account_locked_until) > new Date())) {
                    req.user = {
                        user_id: user.user_id,
                        id: user.user_id, // Для обратной совместимости
                        username: user.username,
                        role: user.role,
                        email: user.email
                    };
                } else {
                    req.user = null;
                }
                next();
            } catch (userError) {
                req.user = null;
                next();
            }
        });
    } catch (error) {
        req.user = null;
        next();
    }
};

module.exports = {
    authenticateJWT,
    isAdmin,
    authenticateRefresh,
    optionalAuth
};