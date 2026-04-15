const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const logger = require('../utils/logger');
const authService = require('../services/authService');

// KISS-003: promisified jwt.verify — single try/catch catches all errors
const verifyJwt = promisify(jwt.verify);

// Helper: map user DB row to safe req.user object (never expose password_hash)
function mapUserToReqUser(user) {
    return {
        user_id: user.user_id,
        id: user.user_id, // backward compatibility
        username: user.username,
        role: user.role,
        email: user.email
    };
}

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

        if (!process.env.JWT_SECRET) {
            logger.error('JWT_SECRET is not defined in environment variables');
            return res.status(500).json({
                success: false,
                message: 'Internal server configuration error'
            });
        }

        const decoded = await verifyJwt(token, process.env.JWT_SECRET);

        const user = await authService.findUserById(decoded.user_id);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
            return res.status(401).json({
                success: false,
                message: 'Account is locked'
            });
        }

        req.user = mapUserToReqUser(user);
        req.token = token;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            logger.warn(`Неудачная попытка аутентификации: ${error.message}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token'
            });
        }
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

        const decoded = await verifyJwt(refreshToken, process.env.JWT_REFRESH_SECRET);

        const user = await authService.findUserById(decoded.user_id);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
            return res.status(401).json({
                success: false,
                message: 'Account is locked'
            });
        }

        req.user = mapUserToReqUser(user);
        req.refreshToken = refreshToken;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            logger.warn(`Неудачная попытка обновления токена: ${error.message}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired refresh token'
            });
        }
        logger.error(`Ошибка middleware refresh токена: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

// Опциональная аутентификация
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            req.user = null;
            return next();
        }

        const token = authHeader.split(' ')[1];

        if (!token) {
            req.user = null;
            return next();
        }

        const isBlacklisted = await authService.isTokenBlacklisted(token);
        if (isBlacklisted) {
            req.user = null;
            return next();
        }

        if (!process.env.JWT_SECRET) {
            req.user = null;
            return next();
        }

        const decoded = await verifyJwt(token, process.env.JWT_SECRET);

        const user = await authService.findUserById(decoded.user_id);
        if (user && !(user.account_locked_until && new Date(user.account_locked_until) > new Date())) {
            req.user = mapUserToReqUser(user);
        } else {
            req.user = null;
        }
        next();
    } catch (error) {
        // Optional auth — all errors result in unauthenticated continuation
        req.user = null;
        next();
    }
};

// Проверка временного токена 2FA (scope: '2fa', TTL 5 мин)
// SEC-101: check blacklist to prevent tempToken reuse after successful 2FA verification
const authenticateTempToken = async (req, res, next) => {
    try {
        const { tempToken } = req.body;

        if (!tempToken) {
            return res.status(400).json({
                success: false,
                message: 'Temporary token is required'
            });
        }

        // Check if tempToken has already been used
        const isBlacklisted = await authService.isTokenBlacklisted(tempToken);
        if (isBlacklisted) {
            return res.status(401).json({
                success: false,
                message: 'Temporary token has already been used'
            });
        }

        const decoded = authService.verifyTempToken(tempToken);
        req.tempUser = decoded;
        req.tempToken = tempToken; // Pass to controller for blacklisting after use
        next();
    } catch (error) {
        logger.warn(`Invalid temp token: ${error.message}`);
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired temporary token'
        });
    }
};

module.exports = {
    authenticateJWT,
    isAdmin,
    authenticateRefresh,
    optionalAuth,
    authenticateTempToken
};
