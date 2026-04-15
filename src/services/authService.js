const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');
const db = require('../config/database');
const { CircuitBreakerFactory } = require('../utils/circuitBreaker');

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
            // Проверяем блокировку аккаунта
            await this.checkAccountLockout(login);

            // Находим пользователя
            const user = await this.findUserByUsernameOrEmail(login, login);
            if (!user) {
                await this.recordFailedAttempt(login);
                const error = new Error('Неверное имя пользователя или пароль');
                error.code = 'INVALID_CREDENTIALS';
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
                await this.recordFailedAttempt(login);
                const error = new Error('Неверное имя пользователя или пароль');
                error.code = 'INVALID_CREDENTIALS';
                throw error;
            }

            // Сбрасываем счетчик неудачных попыток
            await this.clearFailedAttempts(login);

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
            this.jwtSecret,
            { expiresIn: '5m', issuer: 'infrasafe-api', audience: 'infrasafe-client' }
        );
    }

    // Верификация временного токена для 2FA
    verifyTempToken(token) {
        const decoded = jwt.verify(token, this.jwtSecret, {
            issuer: 'infrasafe-api',
            audience: 'infrasafe-client'
        });
        if (decoded.scope !== '2fa') {
            throw new Error('Invalid token scope');
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
                    `INSERT INTO token_blacklist (token_hash, expires_at, created_at)
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
            this.validatePassword(newPassword);

            // Хэшируем новый пароль
            const hashedNewPassword = await this.hashPassword(newPassword);

            // Обновляем пароль в базе данных
            const query = `
                UPDATE users
                SET password_hash = $1, password_changed_at = NOW()
                WHERE user_id = $2
            `;
            await db.query(query, [hashedNewPassword, userId]);

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

    // Проверка пароля
    async verifyPassword(password, hash) {
        return await bcrypt.compare(password, hash);
    }

    // Поиск пользователя по ID
    async findUserById(userId) {
        try {
            const cacheKey = `${this.cachePrefix}:user:${userId}`;

            const cached = await cacheService.get(cacheKey, { ttl: 300 }); // 5 минут
            if (cached) {
                return cached;
            }

            const query = 'SELECT user_id, username, email, role, is_active, account_locked_until, created_at, updated_at FROM users WHERE user_id = $1';
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
    validateUserData({ username, email, password }) {
        if (!username || username.trim().length < 3) {
            throw new Error('Имя пользователя должно содержать минимум 3 символа');
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error('Некорректный email адрес');
        }

        this.validatePassword(password);
    }

    // Валидация пароля
    validatePassword(password) {
        if (!password || password.length < 8) {
            throw new Error('Пароль должен содержать минимум 8 символов');
        }

        if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
            throw new Error('Пароль должен содержать строчные и заглавные буквы, а также цифры');
        }
    }

    // Проверка блокировки аккаунта
    async checkAccountLockout(login) {
        const cacheKey = `${this.cachePrefix}:lockout:${login}`;
        const lockoutData = await cacheService.get(cacheKey);

        if (lockoutData && Date.now() < lockoutData.lockedUntil) {
            const error = new Error(`Аккаунт заблокирован до ${new Date(lockoutData.lockedUntil).toLocaleString()}`);
            error.code = 'ACCOUNT_LOCKED';
            throw error;
        }
    }

    // Запись неудачной попытки входа
    async recordFailedAttempt(login) {
        const cacheKey = `${this.cachePrefix}:attempts:${login}`;
        let attempts = await cacheService.get(cacheKey) || { count: 0, firstAttempt: Date.now() };

        attempts.count++;
        attempts.lastAttempt = Date.now();

        if (attempts.count >= this.maxLoginAttempts) {
            // Блокируем аккаунт
            const lockoutKey = `${this.cachePrefix}:lockout:${login}`;
            await cacheService.set(lockoutKey, {
                lockedAt: Date.now(),
                lockedUntil: Date.now() + this.lockoutDuration
            }, { ttl: this.lockoutDuration / 1000 });

            logger.warn(`Аккаунт ${login} заблокирован из-за превышения лимита попыток входа`);
        } else {
            await cacheService.set(cacheKey, attempts, { ttl: this.lockoutDuration / 1000 });
        }
    }

    // Очистка неудачных попыток
    async clearFailedAttempts(login) {
        const attemptsKey = `${this.cachePrefix}:attempts:${login}`;
        const lockoutKey = `${this.cachePrefix}:lockout:${login}`;

        await cacheService.invalidate(attemptsKey);
        await cacheService.invalidate(lockoutKey);
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
    // ARCH-102: circuit breaker wraps DB lookup — fail-open on outage
    async isTokenBlacklisted(token) {
        try {
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            const cacheKey = `${this.cachePrefix}:blacklist:${tokenHash}`;

            // L1: Check in-memory cache first (fast path)
            const cached = await cacheService.get(cacheKey);
            if (cached !== null) {
                return true;
            }

            // L2: Database with circuit breaker — fail-open when breaker is open
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
                // Circuit breaker open or DB error — fail-open: assume not blacklisted
                logger.warn(`Blacklist DB check unavailable (circuit breaker): ${breakerError.message}`);
            }

            return false;
        } catch (error) {
            logger.error(`Ошибка проверки черного списка токенов: ${error.message}`);
            return false;
        }
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