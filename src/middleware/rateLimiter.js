const logger = require('../utils/logger');
const redisClient = require('../utils/redisClient');

// [Sprint 4] Hybrid rate-limiter: Redis-backed when REDIS_URL is set
// (multi-replica safe), in-memory Map when not (single-replica only).
// The fallback is transparent — call sites use middleware() the same way.
//
// Key namespace prefix prevents collisions across multiple consumers
// sharing one Redis instance (e.g. multiple deployments on staging).
const REDIS_KEY_PREFIX = 'ratelimit:';
const REDIS_KEY_PREFIX_SD = 'slowdown:';

class SimpleRateLimiter {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 60000; // 1 минута
        this.max = options.max || 100; // максимум запросов
        this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
        this.message = options.message || 'Слишком много запросов. Попробуйте позже.';
        this.standardHeaders = options.standardHeaders !== false;
        this.legacyHeaders = options.legacyHeaders !== false;
        this.keyGenerator = options.keyGenerator || this.defaultKeyGenerator;
        this.skip = options.skip || (() => false);
        // Per-instance namespace prefix — for stats / reset isolation
        // when multiple limiter instances share one Redis.
        this.namespace = options.namespace || `g${Math.floor(Math.random() * 1e6)}`;

        // In-memory fallback store. Used when Redis is not configured
        // OR when it temporarily becomes unhealthy (degraded mode).
        this.store = new Map();

        // Очистка устаревших записей каждую минуту
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000);
        this.cleanupInterval.unref();

        logger.info(`Rate limiter инициализирован: ${this.max} запросов в ${this.windowMs}ms`);
    }

    defaultKeyGenerator(req) {
        return req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    }

    cleanup() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, data] of this.store.entries()) {
            if (now - data.resetTime > this.windowMs) {
                this.store.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.debug(`Rate limiter: очищено ${cleanedCount} устаревших записей`);
        }
    }

    async _redisIncrement(key, now) {
        const client = redisClient.getClient();
        if (!client || !redisClient.isReady()) return null;

        const fullKey = `${REDIS_KEY_PREFIX}${this.namespace}:${key}`;
        try {
            const pipeline = client.multi();
            pipeline.incr(fullKey);
            pipeline.pttl(fullKey);
            const results = await pipeline.exec();
            const hits = results && results[0] ? results[0][1] : null;
            let pttl = results && results[1] ? results[1][1] : -1;
            if (hits === 1 || pttl < 0) {
                await client.pexpire(fullKey, this.windowMs);
                pttl = this.windowMs;
            }
            return { hits, resetTime: now + Math.max(0, pttl) };
        } catch {
            return null;
        }
    }

    middleware() {
        return async (req, res, next) => {
            if (this.skip(req)) {
                return next();
            }

            const key = this.keyGenerator(req);
            const now = Date.now();

            let hitData = await this._redisIncrement(key, now);
            if (!hitData) {
                let memData = this.store.get(key);
                if (!memData) {
                    memData = { hits: 0, resetTime: now + this.windowMs };
                    this.store.set(key, memData);
                }
                if (now > memData.resetTime) {
                    memData.hits = 0;
                    memData.resetTime = now + this.windowMs;
                }
                memData.hits++;
                hitData = { hits: memData.hits, resetTime: memData.resetTime };
            }

            const remaining = Math.max(0, this.max - hitData.hits);
            const msUntilReset = Math.max(0, hitData.resetTime - now);

            // Устанавливаем заголовки
            if (this.standardHeaders) {
                res.set('X-RateLimit-Limit', this.max);
                res.set('X-RateLimit-Remaining', remaining);
                res.set('X-RateLimit-Reset', new Date(hitData.resetTime).toISOString());
            }

            if (this.legacyHeaders) {
                res.set('X-RateLimit-Window', this.windowMs);
                res.set('X-RateLimit-Current', hitData.hits);
            }

            // Проверяем превышение лимита
            if (hitData.hits > this.max) {
                logger.warn(`Rate limit exceeded for ${key}: ${hitData.hits}/${this.max}`);

                res.set('Retry-After', Math.ceil(msUntilReset / 1000));

                return res.status(429).json({
                    success: false,
                    message: this.message,
                    error: 'RATE_LIMIT_EXCEEDED',
                    limit: this.max,
                    current: hitData.hits,
                    remaining: remaining,
                    reset_time: new Date(hitData.resetTime).toISOString(),
                    retry_after_seconds: Math.ceil(msUntilReset / 1000)
                });
            }

            next();
        };
    }

    // Статистика rate limiter'а
    getStats() {
        const now = Date.now();
        let activeKeys = 0;
        let totalHits = 0;

        for (const [, data] of this.store.entries()) {
            if (now <= data.resetTime) {
                activeKeys++;
                totalHits += data.hits;
            }
        }

        return {
            active_keys: activeKeys,
            total_hits: totalHits,
            store_size: this.store.size,
            window_ms: this.windowMs,
            max_requests: this.max
        };
    }

    // Очистка всех данных
    reset() {
        const oldSize = this.store.size;
        this.store.clear();
        logger.info(`Rate limiter сброшен: очищено ${oldSize} записей`);
    }

    // Остановка интервала очистки для предотвращения утечки таймеров
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Slow down middleware - замедляет запросы при превышении лимитов
class SimpleSlowDown {
    constructor(options = {}) {
        this.windowMs = options.windowMs || 60000; // 1 минута
        this.delayAfter = options.delayAfter || 50; // начинаем замедлять после N запросов
        this.delayMs = options.delayMs || 500; // задержка за каждый запрос сверх лимита
        this.maxDelayMs = options.maxDelayMs || 5000; // максимальная задержка
        this.keyGenerator = options.keyGenerator || this.defaultKeyGenerator;
        this.skip = options.skip || (() => false);
        this.namespace = options.namespace || `sd${Math.floor(Math.random() * 1e6)}`;

        this.store = new Map();

        // Очистка каждую минуту
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000);
        this.cleanupInterval.unref();

        logger.info(`Slow down инициализирован: замедление после ${this.delayAfter} запросов`);
    }

    defaultKeyGenerator(req) {
        const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
        return ip;
    }

    cleanup() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, data] of this.store.entries()) {
            if (now - data.resetTime > this.windowMs) {
                this.store.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.debug(`Slow down: очищено ${cleanedCount} устаревших записей`);
        }
    }

    async _redisIncrement(key, now) {
        const client = redisClient.getClient();
        if (!client || !redisClient.isReady()) return null;
        const fullKey = `${REDIS_KEY_PREFIX_SD}${this.namespace || 'default'}:${key}`;
        try {
            const pipeline = client.multi();
            pipeline.incr(fullKey);
            pipeline.pttl(fullKey);
            const results = await pipeline.exec();
            const hits = results && results[0] ? results[0][1] : null;
            let pttl = results && results[1] ? results[1][1] : -1;
            if (hits === 1 || pttl < 0) {
                await client.pexpire(fullKey, this.windowMs);
                pttl = this.windowMs;
            }
            return { hits, resetTime: now + Math.max(0, pttl) };
        } catch {
            return null;
        }
    }

    middleware() {
        return async (req, res, next) => {
            if (this.skip(req)) {
                return next();
            }

            const key = this.keyGenerator(req);
            const now = Date.now();

            let hitData = await this._redisIncrement(key, now);
            if (!hitData) {
                let memData = this.store.get(key);
                if (!memData) {
                    memData = { hits: 0, resetTime: now + this.windowMs };
                    this.store.set(key, memData);
                }
                if (now > memData.resetTime) {
                    memData.hits = 0;
                    memData.resetTime = now + this.windowMs;
                }
                memData.hits++;
                hitData = { hits: memData.hits, resetTime: memData.resetTime };
            }

            // Вычисляем задержку
            if (hitData.hits > this.delayAfter) {
                const extraHits = hitData.hits - this.delayAfter;
                const delay = Math.min(extraHits * this.delayMs, this.maxDelayMs);

                if (delay > 0) {
                    logger.debug(`Slow down: задержка ${delay}ms для ${key} (${hitData.hits} запросов)`);

                    res.set('X-Delay-After', this.delayAfter);
                    res.set('X-Current-Delay', delay);

                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            next();
        };
    }

    // Остановка интервала очистки для предотвращения утечки таймеров
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Предустановленные конфигурации для разных типов API

// [Sprint 4] Each limiter instance has an explicit `namespace` so its
// Redis keys don't collide with other instances. Without this, two
// limiters with similar keyGenerators could share state via Redis.
const analyticsLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Слишком много запросов к аналитике. Попробуйте позже.',
    standardHeaders: true,
    legacyHeaders: false,
    namespace: 'analytics'
});

const analyticsSlowDown = new SimpleSlowDown({
    windowMs: 60 * 1000,
    delayAfter: 20,
    delayMs: 500,
    maxDelayMs: 5000,
    namespace: 'analytics-slowdown'
});

const adminLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 20,
    message: 'Слишком много административных операций. Попробуйте позже.',
    keyGenerator: (req) => {
        const ip = req.ip || req.connection.remoteAddress;
        const userId = req.user ? req.user.user_id : 'anonymous';
        return `admin:${ip}:${userId}`;
    },
    namespace: 'admin'
});

const authLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
    keyGenerator: (req) => `auth:login:${req.ip || req.connection.remoteAddress}`,
    namespace: 'auth-login'
});

const registerLimiter = new SimpleRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Слишком много регистраций. Попробуйте через час.',
    keyGenerator: (req) => `auth:register:${req.ip || req.connection.remoteAddress}`,
    namespace: 'auth-register'
});

const passwordChangeLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Слишком много попыток смены пароля. Попробуйте через 15 минут.',
    keyGenerator: (req) => {
        const ip = req.ip || req.connection.remoteAddress;
        const userId = req.user ? req.user.user_id : 'anonymous';
        return `auth:change-password:${ip}:${userId}`;
    },
    namespace: 'auth-pwd-change'
});

const telemetryLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    message: 'Слишком много запросов телеметрии. Попробуйте позже.',
    keyGenerator: (req) => `telemetry:${req.ip || req.connection.remoteAddress}`,
    standardHeaders: true,
    legacyHeaders: false,
    namespace: 'telemetry'
});

const crudLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: 'Слишком много операций создания/изменения данных. Попробуйте позже.',
    skipSuccessfulRequests: false,
    namespace: 'crud'
});

// Middleware для применения к конкретным роутам
const applyAnalyticsRateLimit = [
    analyticsSlowDown.middleware(),
    analyticsLimiter.middleware()
];

const applyAdminRateLimit = [
    adminLimiter.middleware()
];

const applyCrudRateLimit = [
    crudLimiter.middleware()
];

const applyTelemetryRateLimit = [
    telemetryLimiter.middleware()
];

// Функция для получения статистики всех rate limiter'ов
function getAllRateLimitStats() {
    return {
        analytics: analyticsLimiter.getStats(),
        analytics_slowdown: {
            store_size: analyticsSlowDown.store.size,
            window_ms: analyticsSlowDown.windowMs,
            delay_after: analyticsSlowDown.delayAfter
        },
        admin: adminLimiter.getStats(),
        crud: crudLimiter.getStats(),
        telemetry: telemetryLimiter.getStats(),
        auth: authLimiter.getStats(),
        register: registerLimiter.getStats(),
        password_change: passwordChangeLimiter.getStats()
    };
}

// Функция для сброса всех rate limiter'ов
function resetAllRateLimits() {
    analyticsLimiter.reset();
    analyticsSlowDown.store.clear();
    adminLimiter.reset();
    crudLimiter.reset();
    telemetryLimiter.reset();
    authLimiter.reset();
    registerLimiter.reset();
    passwordChangeLimiter.reset();
    logger.info('Все rate limiter\'ы сброшены');
}

// Остановка всех таймеров очистки (для graceful shutdown и тестов)
function destroyAllLimiters() {
    analyticsLimiter.destroy();
    analyticsSlowDown.destroy();
    adminLimiter.destroy();
    crudLimiter.destroy();
    telemetryLimiter.destroy();
    authLimiter.destroy();
    registerLimiter.destroy();
    passwordChangeLimiter.destroy();
    logger.info('Все rate limiter таймеры остановлены');
}

module.exports = {
    SimpleRateLimiter,
    SimpleSlowDown,
    applyAnalyticsRateLimit,
    applyAdminRateLimit,
    applyCrudRateLimit,
    applyTelemetryRateLimit,
    getAllRateLimitStats,
    resetAllRateLimits,
    destroyAllLimiters,
    analyticsLimiter,
    adminLimiter,
    crudLimiter,
    telemetryLimiter,
    authLimiter,
    registerLimiter,
    passwordChangeLimiter,
    rateLimitStrict: adminLimiter.middleware()
};