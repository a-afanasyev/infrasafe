const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');
const db = require('../config/database');
const { CircuitBreakerFactory } = require('../utils/circuitBreaker');
const AccountLockout = require('../models/AccountLockout');

// Phase 13: clock-skew tolerance for JWT-cutoff comparison
const JWT_CUTOFF_SKEW_MS = 5000;

// SEC-11: upper bound (exclusive) for the randomized lockout jitter added on
// top of the base 15-min window. A few minutes of crypto-random jitter makes
// the lockout window non-deterministic so it cannot be synchronized against
// by a distributed brute-force attack. crypto.randomInt is a CSPRNG — never
// use Math.random for this.
const LOCKOUT_JITTER_MAX_MS = 3 * 60 * 1000; // up to 3 minutes

// SEC-11: response-latency timing oracle defense. The locked path throws
// ACCOUNT_LOCKED *before* reaching the real verifyPassword bcrypt.compare, so a
// locked account would otherwise respond noticeably faster than a not-locked
// wrong-password attempt (which pays the full bcrypt cost at saltRounds=12). An
// attacker measuring latency could distinguish locked vs not-locked accounts.
// To equalize timing we run a dummy bcrypt.compare against this pre-computed
// hash before throwing. The hash is computed once at module load with the same
// cost factor (12) used for real password hashing. The comparison result is
// always discarded and can never influence control flow. The hash is a
// hardcoded, precomputed cost-12 bcrypt of 'infrasafe-timing-equalizer' so we
// never call bcrypt at module load (calling bcrypt.hashSync at import time
// crashes under test suites that mock bcrypt before requiring this module).
const DUMMY_BCRYPT_HASH = '$2b$12$jfn044haTXlloOeWWFxnveZDkZDp/Vj9q/KUmUy.SDnF3etQaaBTm';

class AuthService {
    constructor() {
        this.saltRounds = 12;
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET environment variable is not defined');
        }
        this.jwtSecret = process.env.JWT_SECRET;
        if (!process.env.JWT_REFRESH_SECRET) {
            throw new Error('JWT_REFRESH_SECRET environment variable is required');
        }
        this.jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
        // [SEC-34h] 2FA temp-tokens (scope:'2fa') are signed with a dedicated
        // secret so they form a distinct credential class from access tokens.
        // dev/test may leave JWT_2FA_SECRET unset → fall back to JWT_SECRET.
        // In production env.js fails fast if it is missing OR equal to JWT_SECRET.
        this.jwt2faSecret = process.env.JWT_2FA_SECRET || this.jwtSecret;
        this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';
        this.refreshTokenExpiresIn = '7d';
        this.cachePrefix = 'auth';
        this.maxLoginAttempts = 5;
        this.lockoutDuration = 15 * 60 * 1000; // 15 минут

        // ARCH-102: circuit breaker for blacklist DB lookups — fail-open on DB outage
        this.blacklistBreaker = CircuitBreakerFactory.createDatabaseBreaker('BlacklistDB');

        // Periodic cleanup of expired blacklisted tokens (every hour)
        this.cleanupIntervalId = setInterval(() => {
            this.cleanupExpiredTokens().catch(err => {
                logger.error(`Ошибка периодической очистки токенов: ${err.message}`);
            });
        }, 60 * 60 * 1000);
        // Allow the process to exit even if the interval is active
        if (this.cleanupIntervalId && this.cleanupIntervalId.unref) {
            this.cleanupIntervalId.unref();
        }

        // Phase 12B.3 follow-up: periodic cleanup of stale account_lockout rows
        // (mitigates login-flood table growth DoS noted in code review).
        this.lockoutCleanupIntervalId = setInterval(() => {
            AccountLockout.cleanup().then(deleted => {
                if (deleted > 0) {
                    logger.info(`account_lockout cleanup: removed ${deleted} stale rows`);
                }
            }).catch(err => {
                logger.error(`Ошибка очистки account_lockout: ${err.message}`);
            });
        }, 60 * 60 * 1000); // every hour
        if (this.lockoutCleanupIntervalId && this.lockoutCleanupIntervalId.unref) {
            this.lockoutCleanupIntervalId.unref();
        }
    }

    // Регистрация нового пользователя
    async registerUser(userData) {
        try {
            const { username, email, password } = userData;
            const role = 'user';

            // Валидация входных данных
            this.validateUserData({ username, email, password });

            // Проверяем, существует ли пользователь
            const existingUser = await this.findUserByUsernameOrEmail(username, email);
            if (existingUser) {
                const error = new Error('Пользователь с таким именем или email уже существует');
                error.code = 'USER_EXISTS';
                throw error;
            }

            // Хэшируем пароль
            const hashedPassword = await this.hashPassword(password);

            // Создаем пользователя в базе данных
            const query = `
                INSERT INTO users (username, email, password_hash, role, created_at, is_active)
                VALUES ($1, $2, $3, $4, NOW(), true)
                RETURNING user_id, username, email, role, created_at, is_active
            `;

            const result = await db.query(query, [username, email, hashedPassword, role]);
            const newUser = result.rows[0];

            logger.info(`Новый пользователь зарегистрирован: ${username} (${email})`);

            // Возвращаем пользователя без пароля
            return {
                user_id: newUser.user_id,
                username: newUser.username,
                email: newUser.email,
                role: newUser.role,
                created_at: newUser.created_at,
                is_active: newUser.is_active
            };
        } catch (error) {
            logger.error(`Ошибка регистрации пользователя: ${error.message}`);
            throw error;
        }
    }

    // Аутентификация пользователя
    async authenticateUser(login, password) {
        try {
            // Phase 12 follow-up: input-length guard before touching DB/PK
            if (typeof login !== 'string' || login.length === 0 || login.length > 255) {
                const error = new Error('Неверное имя пользователя или пароль');
                error.code = 'INVALID_CREDENTIALS';
                throw error;
            }

            // Проверяем блокировку аккаунта (по введённой строке login)
            await this.checkAccountLockout(login);

            // Находим пользователя
            const user = await this.findUserByUsernameOrEmail(login, login);
            if (!user) {
                await this.recordFailedAttempt(login);
                const error = new Error('Неверное имя пользователя или пароль');
                error.code = 'INVALID_CREDENTIALS';
                throw error;
            }

            // [Lockout username↔email bypass] `account_lockout` is keyed by the
            // exact string the caller typed. A lock recorded against the
            // username can otherwise be bypassed by logging in with the same
            // account's email (or vice versa) — checkAccountLockout(login)
            // above only sees the string actually submitted. Once the user
            // row is resolved, `users.account_locked_until` is the
            // authoritative, identity-keyed lock and must be checked too.
            if (user.account_locked_until && new Date(user.account_locked_until).getTime() > Date.now()) {
                logger.warn(`Account lockout active (authoritative check) for user_id=${user.user_id}`);
                await this._timingEqualizerDelay();
                const error = new Error('Аккаунт временно заблокирован. Попробуйте позже.');
                error.code = 'ACCOUNT_LOCKED';
                throw error;
            }

            if (!user.is_active) {
                const error = new Error('Аккаунт деактивирован');
                error.code = 'ACCOUNT_DISABLED';
                throw error;
            }

            // Проверяем пароль
            const isPasswordValid = await this.verifyPassword(password, user.password_hash);
            if (!isPasswordValid) {
                await this.recordFailedAttempt(login, user.user_id);
                const error = new Error('Неверное имя пользователя или пароль');
                error.code = 'INVALID_CREDENTIALS';
                throw error;
            }

            // Сбрасываем счетчик неудачных попыток
            await this.clearFailedAttempts(login, user.user_id);

            // Обновляем время последнего входа
            await this.updateLastLogin(user.user_id);

            logger.info(`Пользователь ${user.username} успешно аутентифицирован`);

            // Возвращаем пользователя без пароля
            return {
                user_id: user.user_id,
                username: user.username,
                email: user.email,
                role: user.role,
                last_login: new Date().toISOString(),
                is_active: user.is_active,
                totp_enabled: user.totp_enabled || false
            };
        } catch (error) {
            logger.error(`Ошибка аутентификации: ${error.message}`);
            throw error;
        }
    }

    // Генерация временного токена для 2FA (5 мин, scope: 2fa)
    generateTempToken(user) {
        return jwt.sign(
            { user_id: user.user_id, username: user.username, role: user.role, scope: '2fa' },
            this.jwt2faSecret,
            { expiresIn: '5m', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
        );
    }

    // Верификация временного токена для 2FA
    // SEC-4: also reject temp tokens issued before the user's most recent
    // password change so a mid-session password change invalidates any
    // outstanding 2FA temp token (mirrors the access/refresh cutoff check).
    // H-1/H-2: uses getUserForAuth (uncached) + rejects inactive/locked users —
    // previously a deactivated or locked-out user could still complete 2FA
    // with a still-valid temp token issued before the lockout/deactivation.
    async verifyTempToken(token) {
        const decoded = jwt.verify(token, this.jwt2faSecret, {
            algorithms: ['HS256'],
            issuer: 'infrasafe-api',
            audience: 'infrasafe-client'
        });
        if (decoded.scope !== '2fa') {
            throw new Error('Invalid token scope');
        }

        const user = await this.getUserForAuth(decoded.user_id);
        if (!user) {
            throw new Error('User not found');
        }
        if (user.is_active === false) {
            throw new Error('User not found');
        }
        if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
            throw new Error('Account is locked');
        }
        if (this._isIssuedBeforeCutoff(decoded, user)) {
            throw new Error('Temp token issued before password change');
        }

        return decoded;
    }

    // Генерация JWT токена
    generateTokens(user) {
        try {
            const payload = {
                user_id: user.user_id,
                username: user.username,
                email: user.email,
                role: user.role
            };

            const accessToken = jwt.sign(payload, this.jwtSecret, {
                expiresIn: this.jwtExpiresIn,
                issuer: 'infrasafe-api',
                audience: 'infrasafe-client'
            });

            const refreshToken = jwt.sign(
                { user_id: user.user_id, type: 'refresh' },
                this.jwtRefreshSecret,
                {
                    expiresIn: this.refreshTokenExpiresIn,
                    issuer: 'infrasafe-api',
                    audience: 'infrasafe-client'
                }
            );

            return {
                accessToken,
                refreshToken,
                tokenType: 'Bearer',
                expiresIn: this.jwtExpiresIn
            };
        } catch (error) {
            logger.error(`Ошибка генерации токенов: ${error.message}`);
            throw error;
        }
    }

    // Верификация JWT токена
    async verifyToken(token) {
        try {
            const decoded = jwt.verify(token, this.jwtSecret, {
                algorithms: ['HS256'],
                issuer: 'infrasafe-api',
                audience: 'infrasafe-client'
            });

            // Проверяем, не заблокирован ли токен
            const isBlacklisted = await this.isTokenBlacklisted(token);
            if (isBlacklisted) {
                const error = new Error('Токен заблокирован');
                error.code = 'TOKEN_BLACKLISTED';
                throw error;
            }

            // Проверяем актуальность пользователя
            const user = await this.findUserById(decoded.user_id);
            if (!user || !user.is_active) {
                const error = new Error('Пользователь не найден или деактивирован');
                error.code = 'USER_NOT_FOUND';
                throw error;
            }

            return decoded;
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                const expiredError = new Error('Токен истек');
                expiredError.code = 'TOKEN_EXPIRED';
                throw expiredError;
            }
            if (error.name === 'JsonWebTokenError') {
                const invalidError = new Error('Недействительный токен');
                invalidError.code = 'INVALID_TOKEN';
                throw invalidError;
            }
            throw error;
        }
    }

    // ARCH-105: Atomic refresh token rotation — blacklist BEFORE generating new tokens
    async refreshToken(refreshToken) {
        try {
            const decoded = jwt.verify(refreshToken, this.jwtRefreshSecret, {
                algorithms: ['HS256'],
                issuer: 'infrasafe-api',
                audience: 'infrasafe-client'
            });

            if (decoded.type !== 'refresh') {
                const error = new Error('Недействительный refresh токен');
                error.code = 'INVALID_REFRESH_TOKEN';
                throw error;
            }

            // Atomic consume: blacklist first, fail if already consumed (UNIQUE on token_hash)
            const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
            try {
                await db.query(
                    `INSERT INTO token_blacklist (token_hash, expires_at, blacklisted_at)
                     VALUES ($1, to_timestamp($2), NOW())`,
                    [tokenHash, decoded.exp]
                );
            } catch (dbError) {
                if (dbError.code === '23505') { // UNIQUE violation — already consumed
                    const error = new Error('Refresh token already used');
                    error.code = 'TOKEN_REUSE';
                    throw error;
                }
                throw dbError;
            }

            const user = await this.findUserById(decoded.user_id);
            if (!user || !user.is_active) {
                const error = new Error('Пользователь не найден или деактивирован');
                error.code = 'USER_NOT_FOUND';
                throw error;
            }

            // Phase 13: defense-in-depth cutoff check — generic message to avoid
            // leaking that the password was changed (middleware also enforces).
            if (this._isIssuedBeforeCutoff(decoded, user)) {
                const error = new Error('Недействительный refresh токен');
                error.code = 'INVALID_REFRESH_TOKEN';
                throw error;
            }

            // Генерируем новые токены
            const tokens = this.generateTokens(user);

            logger.info(`Токены обновлены для пользователя ${user.username}`);
            return tokens;
        } catch (error) {
            logger.error(`Ошибка обновления токена: ${error.message}`);
            throw error;
        }
    }

    // Выход из системы (добавление токена в черный список)
    async logout(token) {
        try {
            await this.blacklistToken(token);
            logger.info('Пользователь вышел из системы');
            return { message: 'Выход выполнен успешно' };
        } catch (error) {
            logger.error(`Ошибка выхода из системы: ${error.message}`);
            throw error;
        }
    }

    // Смена пароля
    async changePassword(userId, currentPassword, newPassword) {
        try {
            const user = await this.findUserById(userId);
            if (!user) {
                const error = new Error('Пользователь не найден');
                error.code = 'USER_NOT_FOUND';
                throw error;
            }

            // Fetch password_hash separately (not cached by findUserById for security)
            const hashResult = await db.query('SELECT password_hash FROM users WHERE user_id = $1', [userId]);
            if (hashResult.rows.length === 0) {
                const error = new Error('Пользователь не найден');
                error.code = 'USER_NOT_FOUND';
                throw error;
            }

            // Проверяем текущий пароль
            const isCurrentPasswordValid = await this.verifyPassword(currentPassword, hashResult.rows[0].password_hash);
            if (!isCurrentPasswordValid) {
                const error = new Error('Неверный текущий пароль');
                error.code = 'INVALID_CURRENT_PASSWORD';
                throw error;
            }

            // Валидируем новый пароль
            // Phase 13: tag validatePassword failures so controller maps them to 400
            try {
                this.validatePassword(newPassword);
            } catch (err) {
                err.code = 'INVALID_PASSWORD';
                throw err;
            }

            // Хэшируем новый пароль
            const hashedNewPassword = await this.hashPassword(newPassword);

            // Обновляем пароль в базе данных
            const query = `
                UPDATE users
                SET password_hash = $1, password_changed_at = NOW()
                WHERE user_id = $2
            `;
            await db.query(query, [hashedNewPassword, userId]);

            // Phase 13: invalidate the cached user object so the next auth
            // check sees the fresh password_changed_at (cutoff-comparison).
            await cacheService.invalidate(`${this.cachePrefix}:user:${userId}`);

            logger.info(`Пароль изменен для пользователя ID: ${userId}`);
            return { message: 'Пароль успешно изменен' };
        } catch (error) {
            logger.error(`Ошибка смены пароля: ${error.message}`);
            throw error;
        }
    }

    // Хэширование пароля
    async hashPassword(password) {
        return await bcrypt.hash(password, this.saltRounds);
    }

    /**
     * Returns true if the given token was issued strictly before the user's
     * password_changed_at (with 5 s clock-skew tolerance). Used by auth
     * middleware and refreshToken to bulk-invalidate every JWT after a
     * password change without per-token blacklisting.
     */
    _isIssuedBeforeCutoff(decoded, user) {
        if (!user.password_changed_at) return false;
        if (typeof decoded.iat !== 'number') return true;
        const issuedAtMs = decoded.iat * 1000;
        const cutoffMs = new Date(user.password_changed_at).getTime() - JWT_CUTOFF_SKEW_MS;
        return issuedAtMs < cutoffMs;
    }

    // Проверка пароля
    async verifyPassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    // Поиск пользователя по ID
    async findUserById(userId) {
        try {
            const cacheKey = `${this.cachePrefix}:user:${userId}`;

            // [SEC-27] 5-min cache. NOT used for auth-decision reads (middleware
            // calls getUserForAuth instead — H-1/H-2 fix) since a lockout or
            // deactivation must take effect immediately, not after up to 5 min.
            // Kept here for lower-criticality callers (e.g. getProfile).
            const cached = await cacheService.get(cacheKey, { ttl: 300 }); // 5 минут
            if (cached) {
                return cached;
            }

            const query = 'SELECT user_id, username, email, role, is_active, account_locked_until, created_at, updated_at, password_changed_at FROM users WHERE user_id = $1';
            const result = await db.query(query, [userId]);

            if (result.rows.length > 0) {
                // Destructure to exclude password_hash from cached/returned object
                // eslint-disable-next-line no-unused-vars
                const { password_hash, ...user } = result.rows[0];
                await cacheService.set(cacheKey, user, { ttl: 300 });
                return user;
            }

            return null;
        } catch (error) {
            logger.error(`Ошибка поиска пользователя по ID: ${error.message}`);
            throw error;
        }
    }

    // H-1/H-2: uncached PK read used by every auth-decision path (JWT/refresh/
    // temp-token middleware). A lockout or deactivation must be enforced on
    // the very next request, not masked for up to 5 min by findUserById's
    // cache. One extra PK SELECT per authenticated request — comparable cost
    // to the existing per-request token_blacklist SELECT.
    async getUserForAuth(userId) {
        const query = 'SELECT user_id, username, email, role, is_active, account_locked_until, created_at, updated_at, password_changed_at FROM users WHERE user_id = $1';
        const result = await db.query(query, [userId]);
        if (result.rows.length === 0) return null;
        // eslint-disable-next-line no-unused-vars
        const { password_hash, ...user } = result.rows[0];
        return user;
    }

    // Поиск пользователя по имени или email
    async findUserByUsernameOrEmail(login, email = null) {
        try {
            let query, params;

            if (email && email !== login) {
                // Если передан отдельный email, ищем по username ИЛИ email
                query = 'SELECT * FROM users WHERE username = $1 OR email = $2';
                params = [login, email];
            } else {
                // Если email не передан или равен login, ищем по username ИЛИ email = login
                query = 'SELECT * FROM users WHERE username = $1 OR email = $1';
                params = [login];
            }

            const result = await db.query(query, params);

            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            logger.error(`Ошибка поиска пользователя: ${error.message}`);
            throw error;
        }
    }

    // Валидация данных пользователя
    // AUD-005: tag username/email failures with VALIDATION_ERROR (and password
    // failures with INVALID_PASSWORD via validatePassword) so the register
    // controller maps them to 400 instead of a generic 500.
    validateUserData({ username, email, password }) {
        if (!username || username.trim().length < 3) {
            const err = new Error('Имя пользователя должно содержать минимум 3 символа');
            err.code = 'VALIDATION_ERROR';
            throw err;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            const err = new Error('Некорректный email адрес');
            err.code = 'VALIDATION_ERROR';
            throw err;
        }

        this.validatePassword(password);
    }

    // Валидация пароля
    validatePassword(password) {
        if (!password || password.length < 8) {
            const err = new Error('Пароль должен содержать минимум 8 символов');
            err.code = 'INVALID_PASSWORD';
            throw err;
        }

        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
            const err = new Error('Пароль должен содержать строчные и заглавные буквы, а также цифры');
            err.code = 'INVALID_PASSWORD';
            throw err;
        }
    }

    // SEC-11: equalize response latency with the unlocked wrong-password path
    // by paying the same bcrypt cost before throwing ACCOUNT_LOCKED. Result is
    // intentionally discarded — it never affects control flow. Shared by
    // checkAccountLockout (string-keyed check) and authenticateUser's
    // authoritative users.account_locked_until check.
    async _timingEqualizerDelay() {
        try {
            await bcrypt.compare('infrasafe-timing-equalizer', DUMMY_BCRYPT_HASH);
        } catch (_) {
            // A failure in the dummy compare must not change the lockout outcome.
        }
    }

    // Проверка блокировки аккаунта (SEC-NEW-004: persistent via PostgreSQL)
    async checkAccountLockout(login) {
        const record = await AccountLockout.get(login);
        if (!record || !record.locked_until) return;

        const lockedUntilMs = new Date(record.locked_until).getTime();
        if (Date.now() < lockedUntilMs) {
            // [1A-FU2-S-M1] Generic user-facing message (no ISO timestamp).
            // Previously the thrown error.message embedded the exact unlock
            // time, which an API-direct attacker (curl, script) could use to
            // time follow-up spraying. The frontend normalizer (login.js)
            // already strips it from the HTML response, but raw API consumers
            // bypassed that. Now the timestamp is only logged server-side.
            logger.warn(`Account lockout active for login=${login} until=${new Date(lockedUntilMs).toISOString()}`);
            await this._timingEqualizerDelay();
            const error = new Error('Аккаунт временно заблокирован. Попробуйте позже.');
            error.code = 'ACCOUNT_LOCKED';
            throw error;
        }

        // Lockout expired — clean up so counters reset on next attempt
        await AccountLockout.clearAttempts(login);
    }

    // Запись неудачной попытки входа (atomic UPSERT, survives restart / scale-out)
    // H-1: when `userId` is known, the model mirrors a fresh lock onto
    // `users.account_locked_until` in the SAME statement — that column (not
    // the `account_lockout` table) is what auth middleware actually enforces
    // on already-issued access tokens. Without this, a brute-force lockout
    // never revoked a still-valid JWT.
    async recordFailedAttempt(login, userId = null) {
        // SEC-11: add cryptographically-random jitter to the base lockout
        // window so the unlock time is not a fixed, predictable interval.
        const jitterMs = crypto.randomInt(LOCKOUT_JITTER_MAX_MS);
        const lockoutDuration = this.lockoutDuration + jitterMs;

        const result = await AccountLockout.recordFailedAttempt(
            login,
            this.maxLoginAttempts,
            lockoutDuration,
            userId
        );
        const failedAttempts = result?.failed_attempts ?? 0;
        const lockedUntil = result?.locked_until ?? null;
        if (lockedUntil && failedAttempts >= this.maxLoginAttempts) {
            logger.warn(`Аккаунт ${login} заблокирован из-за превышения лимита попыток входа`);
            if (userId != null) {
                // Invalidate findUserById's cache too, for any non-auth-decision
                // caller still reading through it (getUserForAuth is uncached).
                await cacheService.invalidate(`${this.cachePrefix}:user:${userId}`);
            }
        }
    }

    // Очистка неудачных попыток (после успешной аутентификации)
    async clearFailedAttempts(login, userId = null) {
        await AccountLockout.clearAttempts(login, userId);
        if (userId != null) {
            await cacheService.invalidate(`${this.cachePrefix}:user:${userId}`);
        }
    }

    // Обновление времени последнего входа
    async updateLastLogin(userId) {
        try {
            const query = 'UPDATE users SET last_login = NOW() WHERE user_id = $1';
            await db.query(query, [userId]);

            // Инвалидируем кэш пользователя
            await cacheService.invalidate(`${this.cachePrefix}:user:${userId}`);
        } catch (error) {
            logger.error(`Ошибка обновления времени последнего входа: ${error.message}`);
        }
    }

    // Добавление токена в черный список
    async blacklistToken(token) {
        try {
            const decoded = jwt.decode(token);
            if (!decoded || typeof decoded.exp !== 'number') {
                logger.warn('blacklistToken: invalid or malformed token, skip');
                return;
            }
            const expiry = decoded.exp * 1000; // Конвертируем в миллисекунды
            const ttl = Math.max(0, (expiry - Date.now()) / 1000); // TTL в секундах

            if (ttl > 0) {
                // L1 cache (in-memory) for fast lookups
                const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
                const cacheKey = `${this.cachePrefix}:blacklist:${tokenHash}`;
                await cacheService.set(cacheKey, true, { ttl });

                // L2 persistent storage (database) survives restarts
                try {
                    const expiresAt = new Date(expiry);
                    await db.query(
                        'INSERT INTO token_blacklist (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT (token_hash) DO NOTHING',
                        [tokenHash, expiresAt]
                    );
                } catch (dbError) {
                    logger.error(`Ошибка сохранения токена в БД: ${dbError.message}`);
                    // Cache-based blacklist still works as fallback
                }
            }
        } catch (error) {
            logger.error(`Ошибка добавления токена в черный список: ${error.message}`);
        }
    }

    // Проверка, находится ли токен в черном списке
    // ARCH-102 / H-5: circuit breaker wraps DB lookup. In dev/test (or with the
    // AUTH_BLACKLIST_FAIL_OPEN=true operator override) a DB/breaker outage
    // still fails OPEN — availability-over-strict-security, matching the
    // original ARCH-102 trade-off and pinned by
    // tests/jest/unit/authServiceTest.test.js ("fail-OPEN on DB outage").
    // In production (the default), the same outage now fails CLOSED: it
    // throws BLACKLIST_UNAVAILABLE, which auth middleware maps to 503. Why
    // this changed: the 5-min L1 user-object cache (findUserById) can keep
    // serving a since-revoked user's data while the blacklist silently
    // fails open underneath it — that combined window is the actual exploit
    // surface, not the blacklist lookup in isolation.
    // [SEC-31] The in-memory L1 blacklist-hit cache remains single-replica
    // only; multi-replica correctness (shared L1 in Redis) is tracked under
    // B-003 — unaffected by this change.
    async isTokenBlacklisted(token) {
        try {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const cacheKey = `${this.cachePrefix}:blacklist:${tokenHash}`;

            // L1: Check in-memory cache first (fast path)
            const cached = await cacheService.get(cacheKey);
            if (cached !== null) {
                return true;
            }

            // L2: Database with circuit breaker
            try {
                const isBlacklisted = await this.blacklistBreaker.execute(async () => {
                    const result = await db.query(
                        'SELECT 1 FROM token_blacklist WHERE token_hash = $1 AND expires_at > NOW()',
                        [tokenHash]
                    );
                    return result.rows.length > 0;
                });

                if (isBlacklisted) {
                    // Populate L1 cache for future lookups
                    const decoded = jwt.decode(token);
                    if (decoded && decoded.exp) {
                        const ttl = Math.max(0, (decoded.exp * 1000 - Date.now()) / 1000);
                        if (ttl > 0) {
                            await cacheService.set(cacheKey, true, { ttl });
                        }
                    }
                    return true;
                }
            } catch (breakerError) {
                return this._handleBlacklistUnavailable(breakerError);
            }

            return false;
        } catch (error) {
            // _handleBlacklistUnavailable may have already thrown
            // BLACKLIST_UNAVAILABLE from the inner catch above and propagated
            // here — don't re-wrap, just let it continue up to the middleware.
            if (error.code === 'BLACKLIST_UNAVAILABLE') {
                throw error;
            }
            return this._handleBlacklistUnavailable(error);
        }
    }

    // H-5: shared decision point for both isTokenBlacklisted catch blocks —
    // fail-open (return false) unless we are in production AND the operator
    // hasn't set the AUTH_BLACKLIST_FAIL_OPEN escape hatch, in which case
    // fail closed by throwing a typed error for the middleware to map to 503.
    _handleBlacklistUnavailable(error) {
        const failOpenOverride = process.env.AUTH_BLACKLIST_FAIL_OPEN === 'true';
        if (process.env.NODE_ENV === 'production' && !failOpenOverride) {
            logger.error(`Blacklist DB check unavailable in production — failing CLOSED: ${error.message}`);
            const unavailableError = new Error('Blacklist check unavailable');
            unavailableError.code = 'BLACKLIST_UNAVAILABLE';
            throw unavailableError;
        }
        logger.warn(`Blacklist DB check unavailable (fail-open): ${error.message}`);
        return false;
    }

    // SEC-105: verify password without affecting lockout counters
    // For use in secondary auth flows (disable-2fa) where failed attempts
    // should not lock the account
    async verifyPasswordOnly(userId, password) {
        const result = await db.query(
            'SELECT password_hash FROM users WHERE user_id = $1 AND is_active = true',
            [userId]
        );
        const hash = result.rows[0]?.password_hash;
        if (!hash) return false;
        return bcrypt.compare(password, hash);
    }

    // Очистка просроченных токенов из черного списка
    async cleanupExpiredTokens() {
        try {
            const result = await db.query('DELETE FROM token_blacklist WHERE expires_at < NOW()');
            if (result.rowCount > 0) {
                logger.info(`Очищено ${result.rowCount} просроченных токенов из черного списка`);
            }
        } catch (error) {
            logger.error(`Ошибка очистки просроченных токенов: ${error.message}`);
        }
    }
}

module.exports = new AuthService();