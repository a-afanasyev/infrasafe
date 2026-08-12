const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const logger = require('../utils/logger');
const authService = require('../services/authService');
// [P1-2] Read access/refresh tokens from cookies if header/body absent.
const { extractAccessToken, extractRefreshToken, extractTempToken } = require('../utils/authCookies');
const { sendError } = require('../utils/apiResponse');

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

// H-5: the blacklist DB is unavailable (production, no fail-open override) —
// distinct from an invalid/expired token. 503 (not 401/500) so clients know
// to retry rather than treat this as an auth failure or a bug.
function sendBlacklistUnavailable(res) {
    res.set('Retry-After', '30');
    return sendError(res, 503, 'Service temporarily unavailable');
}

// Проверка JWT токена с проверкой черного списка
const authenticateJWT = async (req, res, next) => {
    try {
        // [P1-2] Pull from Authorization header OR access_token cookie.
        const token = extractAccessToken(req);

        if (!token) {
            return sendError(res, 401, 'Access token is missing');
        }

        // Проверка токена на черном списке
        const isBlacklisted = await authService.isTokenBlacklisted(token);
        if (isBlacklisted) {
            logger.warn(`Попытка использования токена из черного списка`);
            return sendError(res, 401, 'Token has been revoked');
        }

        if (!process.env.JWT_SECRET) {
            logger.error('JWT_SECRET is not defined in environment variables');
            return sendError(res, 500, 'Internal server configuration error');
        }

        const decoded = await verifyJwt(token, process.env.JWT_SECRET, {
            algorithms: ['HS256'],
            issuer: 'infrasafe-api',
            audience: 'infrasafe-client'
        });

        // SEC-1: reject scoped tokens (e.g. the 2FA temp-token, scope:'2fa') on
        // normal routes. Even though the 2FA temp-token is now signed with a
        // dedicated secret (SEC-34h: JWT_2FA_SECRET), in dev/test that secret
        // falls back to JWT_SECRET, so a pre-2FA temp-token could still verify
        // here and be accepted as a full access token, bypassing 2FA. The scope
        // guard is the real defense. Normal access tokens (generateTokens) carry
        // NO scope.
        if (decoded.scope) {
            logger.warn(`Scoped token (scope=${decoded.scope}) rejected on access-token route`);
            return sendError(res, 401, 'Invalid or expired token');
        }

        // H-1/H-2: uncached PK read — a lockout or deactivation must be
        // enforced on the very next request, not masked by findUserById's
        // 5-min cache.
        const user = await authService.getUserForAuth(decoded.user_id);
        if (!user) {
            return sendError(res, 401, 'User not found');
        }

        // H-2: deactivated user — generic message, do not leak account state.
        if (user.is_active === false) {
            return sendError(res, 401, 'Invalid or expired token');
        }

        // Phase 13: reject tokens issued before the user's most recent password change
        if (authService._isIssuedBeforeCutoff(decoded, user)) {
            logger.warn(`Stale token rejected for user ${user.user_id} — issued before password change`);
            return sendError(res, 401, 'Invalid or expired token');
        }

        if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
            return sendError(res, 401, 'Account is locked');
        }

        req.user = mapUserToReqUser(user);
        req.token = token;
        next();
    } catch (error) {
        if (error.code === 'BLACKLIST_UNAVAILABLE') {
            return sendBlacklistUnavailable(res);
        }
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            logger.warn(`Неудачная попытка аутентификации: ${error.message}`);
            return sendError(res, 401, 'Invalid or expired token');
        }
        logger.error(`Ошибка middleware аутентификации: ${error.message}`);
        return sendError(res, 500, 'Internal server error');
    }
};

// Проверка наличия прав администратора
const isAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        logger.warn(`Попытка доступа к админ-ресурсу без достаточных прав: ${req.originalUrl}, пользователь: ${req.user?.username || 'anonymous'}`);
        return sendError(res, 403, 'Requires admin privileges');
    }
    next();
};

// Проверка refresh токена
const authenticateRefresh = async (req, res, next) => {
    try {
        // [P1-2] Pull from req.body.refreshToken OR refresh_token cookie.
        const refreshToken = extractRefreshToken(req);

        if (!refreshToken) {
            return sendError(res, 400, 'Refresh token is required');
        }

        const isBlacklisted = await authService.isTokenBlacklisted(refreshToken);
        if (isBlacklisted) {
            logger.warn(`Попытка использования refresh токена из черного списка`);
            return sendError(res, 401, 'Refresh token has been revoked');
        }

        if (!process.env.JWT_REFRESH_SECRET) {
            logger.error('JWT_REFRESH_SECRET is not defined in environment variables');
            return sendError(res, 500, 'Internal server configuration error');
        }

        const decoded = await verifyJwt(refreshToken, process.env.JWT_REFRESH_SECRET, {
            algorithms: ['HS256'],
            issuer: 'infrasafe-api',
            audience: 'infrasafe-client'
        });

        // Defense-in-depth: refresh tokens (generateTokens) always carry
        // type:'refresh'; reject anything else verified with this secret.
        if (decoded.type !== 'refresh') {
            logger.warn(`Refresh token missing type:'refresh' claim rejected`);
            return sendError(res, 401, 'Invalid or expired refresh token');
        }

        // H-1/H-2: uncached PK read — see authenticateJWT.
        const user = await authService.getUserForAuth(decoded.user_id);
        if (!user) {
            return sendError(res, 401, 'User not found');
        }

        // H-2: deactivated user — generic message, do not leak account state.
        if (user.is_active === false) {
            return sendError(res, 401, 'Invalid or expired refresh token');
        }

        // Phase 13: reject refresh tokens issued before the user's password change
        if (authService._isIssuedBeforeCutoff(decoded, user)) {
            logger.warn(`Stale refresh token rejected for user ${user.user_id}`);
            return sendError(res, 401, 'Invalid or expired refresh token');
        }

        if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
            return sendError(res, 401, 'Account is locked');
        }

        req.user = mapUserToReqUser(user);
        req.refreshToken = refreshToken;
        next();
    } catch (error) {
        if (error.code === 'BLACKLIST_UNAVAILABLE') {
            return sendBlacklistUnavailable(res);
        }
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            logger.warn(`Неудачная попытка обновления токена: ${error.message}`);
            return sendError(res, 401, 'Invalid or expired refresh token');
        }
        logger.error(`Ошибка middleware refresh токена: ${error.message}`);
        return sendError(res, 500, 'Internal server error');
    }
};

// Опциональная аутентификация
const optionalAuth = async (req, res, next) => {
    try {
        // [P1-2] Pull from Authorization header OR access_token cookie.
        const token = extractAccessToken(req);

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

        const decoded = await verifyJwt(token, process.env.JWT_SECRET, {
            algorithms: ['HS256'],
            issuer: 'infrasafe-api',
            audience: 'infrasafe-client'
        });

        // SEC-1 (consistency): mirror authenticateJWT's scope guard. A scoped
        // token (e.g. the 2FA temp-token, scope:'2fa') must never grant req.user
        // here either — degrade gracefully to the anonymous path like an invalid
        // token does. Normal access tokens (generateTokens) carry NO scope.
        if (decoded.scope) {
            req.user = null;
            return next();
        }

        // H-1/H-2/M-1: uncached PK read + is_active + password-cutoff check —
        // previously optionalAuth only checked lockout, unlike authenticateJWT.
        const user = await authService.getUserForAuth(decoded.user_id);
        const isLocked = !!(user && user.account_locked_until && new Date(user.account_locked_until) > new Date());
        const isStale = !!(user && authService._isIssuedBeforeCutoff(decoded, user));
        if (user && user.is_active !== false && !isLocked && !isStale) {
            req.user = mapUserToReqUser(user);
        } else {
            req.user = null;
        }
        next();
    } catch (error) {
        // H-5: on a blacklist-DB outage, degrade to anonymous rather than
        // 503 — optionalAuth only ever enriches public routes, so denying
        // nothing privileged is a strictly safe fallback and keeps public
        // endpoints (e.g. the map) up during a DB blip.
        // Optional auth — log unexpected (non-JWT) errors for observability
        if (error.code !== 'BLACKLIST_UNAVAILABLE' && error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError') {
            logger.warn(`optionalAuth unexpected error: ${error.message}`);
        }
        req.user = null;
        next();
    }
};

// Проверка временного токена 2FA (scope: '2fa', TTL 5 мин)
// SEC-101: check blacklist to prevent tempToken reuse after successful 2FA verification
const authenticateTempToken = async (req, res, next) => {
    try {
        // [M-4] Кука вперёд, тело — запасной путь на время выкладки.
        const tempToken = extractTempToken(req);

        if (!tempToken) {
            return sendError(res, 400, 'Temporary token is required');
        }

        // Check if tempToken has already been used
        const isBlacklisted = await authService.isTokenBlacklisted(tempToken);
        if (isBlacklisted) {
            return sendError(res, 401, 'Temporary token has already been used');
        }

        const decoded = await authService.verifyTempToken(tempToken);
        req.tempUser = decoded;
        req.tempToken = tempToken; // Pass to controller for blacklisting after use
        next();
    } catch (error) {
        if (error.code === 'BLACKLIST_UNAVAILABLE') {
            return sendBlacklistUnavailable(res);
        }
        logger.warn(`Invalid temp token: ${error.message}`);
        return sendError(res, 401, 'Invalid or expired temporary token');
    }
};

module.exports = {
    authenticateJWT,
    isAdmin,
    authenticateRefresh,
    optionalAuth,
    authenticateTempToken
};
