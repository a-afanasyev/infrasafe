const jwt = require('jsonwebtoken');
const authService = require('../services/authService');
const totpService = require('../services/totpService');
const logger = require('../utils/logger');
// [P1-2] HttpOnly cookie helpers — emit alongside the existing body
// fields so the client transition can land in a follow-up PR.
const { setAuthCookies, clearAuthCookies, extractRefreshToken } = require('../utils/authCookies');

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

        // [P1-2] HttpOnly cookies are the auth delivery mechanism.
        setAuthCookies(res, tokens);

        // [1A-FU2-S-M2] Tokens are NOT echoed in the response body —
        // the cookies above are the source of truth. Body-echoed tokens
        // were readable by injected scripts before garbage collection,
        // partially defeating the HttpOnly defence.
        res.json({
            success: true,
            message: 'Login successful',
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
            // SEC-11: do NOT special-case locked accounts with HTTP 423 — that
            // status is a state oracle (locked vs not) an attacker can use to
            // time distributed spraying. Return the SAME 401 + generic message
            // as INVALID_CREDENTIALS so a locked account is indistinguishable
            // from a wrong password. Lockout detail is logged server-side in
            // authService.checkAccountLockout, never surfaced to the client.
            return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
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
        // AUD-005: validation failures are client errors, not 500s.
        if (error.code === 'VALIDATION_ERROR' || error.code === 'INVALID_PASSWORD') {
            return res.status(400).json({ error: error.message });
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
        // [P1-2] Read access token from Authorization header OR access_token
        // cookie. clearAuthCookies runs at the end regardless of the path
        // taken so the browser stops sending stale tokens on next request.
        const headerToken = req.headers.authorization?.replace('Bearer ', '');
        const cookieToken = req.cookies && typeof req.cookies.access_token === 'string'
            ? req.cookies.access_token
            : null;
        const token = headerToken || cookieToken;

        if (!token) {
            // Even without an access token we clear any orphan refresh
            // cookie so the client doesn't keep replaying it.
            clearAuthCookies(res);
            return res.status(400).json({ error: 'Token required' });
        }

        // [P1-V1] Blacklist the access token AND any refresh token the
        // client volunteers in the body. Without this, a stolen refresh
        // token survives the entire 7-day TTL post-logout.
        // [P1-2] extractRefreshToken also picks the value out of the
        // refresh_token cookie when the client didn't send one in the body.
        // Best-effort: refresh-token blacklist failure must not block logout.
        const refresh = extractRefreshToken(req);

        await authService.logout(token);

        if (refresh) {
            // [Sprint 0.1 / HIGH-3] Verify the refresh token belongs to the
            // authenticated user before blacklisting. Without this, any
            // authenticated user can pass an arbitrary refresh token and
            // force-blacklist it — a DoS against other users' sessions.
            // jwt.decode is non-throwing; mismatch results in a skipped
            // blacklist (logged) rather than an error response, preserving
            // the best-effort contract.
            let ownsRefresh = true;
            try {
                const decoded = jwt.decode(refresh);
                const decodedSub = decoded?.sub ?? decoded?.user_id;
                const actorId = req.user?.user_id ?? req.user?.id;
                if (decodedSub != null && actorId != null && String(decodedSub) !== String(actorId)) {
                    ownsRefresh = false;
                    logger.warn(
                        `logout: refresh token sub mismatch — skipping blacklist ` +
                        `(decoded.sub=${decodedSub}, actor=${actorId})`
                    );
                }
            } catch (decodeErr) {
                // Malformed token — let blacklistToken decide whether to accept it
                logger.warn(`logout: refresh token decode failed: ${decodeErr.message}`);
            }

            if (ownsRefresh) {
                try {
                    await authService.blacklistToken(refresh);
                } catch (refreshErr) {
                    logger.warn(`logout: refresh token blacklist failed: ${refreshErr.message}`);
                }
            }
        }

        // [P1-2] Clear both HttpOnly cookies. Browser sends a matching
        // Set-Cookie with Max-Age=0 → cookies removed immediately.
        clearAuthCookies(res);

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
        // [P1-2] Accept refresh token from cookie OR body.
        const refresh = extractRefreshToken(req);

        if (!refresh) {
            return res.status(400).json({ error: 'Refresh token required' });
        }

        const tokens = await authService.refreshToken(refresh);

        // [P1-2] Rotate cookies as part of the refresh — the new access
        // token and (rotated) refresh token become the active cookies.
        setAuthCookies(res, tokens);

        // [1A-FU2-S-M2] No token spread — cookies are the only delivery.
        res.json({
            success: true,
            message: 'Token refreshed successfully'
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
        if (error.code === 'INVALID_PASSWORD') {
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

        // [P1-2] HttpOnly cookies are the auth delivery mechanism.
        setAuthCookies(res, tokens);

        // [1A-FU2-S-M2] No token spread — cookies only.
        res.json({
            success: true,
            message: result.method === 'recovery'
                ? 'Login successful (recovery code used)'
                : 'Login successful',
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

        // NOTE: do NOT blacklist tempToken here — setup2FA is not terminal.
        // The same tempToken must remain valid for the subsequent confirm2FA call.
        // Blacklisting happens in confirm2FA and verify2FA (terminal operations).

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

        // [P1-2] HttpOnly cookies are the auth delivery mechanism.
        setAuthCookies(res, tokens);

        // [1A-FU2-S-M2] No token spread — cookies only.
        res.json({
            success: true,
            message: '2FA enabled successfully',
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