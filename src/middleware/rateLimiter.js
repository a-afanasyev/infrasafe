const logger = require('../utils/logger');

// Простая реализация rate limiting без внешних зависимостей
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

        // Хранилище счетчиков запросов
        this.store = new Map();

        // Очистка устаревших записей каждую минуту
        setInterval(() => {
            this.cleanup();
        }, 60000);

        logger.info(`Rate limiter инициализирован: ${this.max} запросов в ${this.windowMs}ms`);
    }

    defaultKeyGenerator(req) {
        // Используем IP адрес и User-Agent для идентификации
        const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
        const userAgent = req.get('User-Agent') || 'unknown';
        return `${ip}:${userAgent.substring(0, 50)}`;
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

    middleware() {
        return (req, res, next) => {
            if (this.skip(req)) {
                return next();
            }

            const key = this.keyGenerator(req);
            const now = Date.now();

            let hitData = this.store.get(key);

            if (!hitData) {
                hitData = {
                    hits: 0,
                    resetTime: now + this.windowMs
                };
                this.store.set(key, hitData);
            }

            // Если окно времени истекло, сбрасываем счетчик
            if (now > hitData.resetTime) {
                hitData.hits = 0;
                hitData.resetTime = now + this.windowMs;
            }

            hitData.hits++;

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

        for (const [key, data] of this.store.entries()) {
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

        this.store = new Map();

        // Очистка каждую минуту
        setInterval(() => {
            this.cleanup();
        }, 60000);

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

    middleware() {
        return async (req, res, next) => {
            if (this.skip(req)) {
                return next();
            }

            const key = this.keyGenerator(req);
            const now = Date.now();

            let hitData = this.store.get(key);

            if (!hitData) {
                hitData = {
                    hits: 0,
                    resetTime: now + this.windowMs
                };
                this.store.set(key, hitData);
            }

            // Сброс если окно истекло
            if (now > hitData.resetTime) {
                hitData.hits = 0;
                hitData.resetTime = now + this.windowMs;
            }

            hitData.hits++;

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
}

// Предустановленные конфигурации для разных типов API

// Ограничения для аналитических эндпоинтов
const analyticsLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000, // 1 минута
    max: 30, // максимум 30 запросов в минуту
    message: 'Слишком много запросов к аналитике. Попробуйте позже.',
    standardHeaders: true,
    legacyHeaders: false
});

// Замедление при превышении лимитов аналитики
const analyticsSlowDown = new SimpleSlowDown({
    windowMs: 60 * 1000,
    delayAfter: 20, // начинаем замедлять после 20 запросов
    delayMs: 500, // задержка 500ms за каждый запрос сверх лимита
    maxDelayMs: 5000 // максимальная задержка 5 секунд
});

// Строгие ограничения для административных операций
const adminLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000, // 1 минута
    max: 100, // максимум 100 операций в минуту (увеличено для тестирования)
    message: 'Слишком много административных операций. Попробуйте позже.',
    keyGenerator: (req) => {
        // Для админских операций учитываем и IP, и пользователя
        const ip = req.ip || req.connection.remoteAddress;
        const userId = req.user ? req.user.user_id : 'anonymous';
        return `admin:${ip}:${userId}`;
    }
});

// Ограничения для auth-маршрутов
const authLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
    keyGenerator: (req) => `auth:login:${req.ip || req.connection.remoteAddress}`
});

const registerLimiter = new SimpleRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: 'Слишком много регистраций. Попробуйте через час.',
    keyGenerator: (req) => `auth:register:${req.ip || req.connection.remoteAddress}`
});

// Ограничения для CRUD операций
const crudLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000, // 1 минута
    max: 60, // максимум 60 операций в минуту
    message: 'Слишком много операций создания/изменения данных. Попробуйте позже.',
    skipSuccessfulRequests: false
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
        crud: crudLimiter.getStats()
    };
}

// Функция для сброса всех rate limiter'ов
function resetAllRateLimits() {
    analyticsLimiter.reset();
    analyticsSlowDown.store.clear();
    adminLimiter.reset();
    crudLimiter.reset();
    logger.info('Все rate limiter\'ы сброшены');
}

module.exports = {
    SimpleRateLimiter,
    SimpleSlowDown,
    applyAnalyticsRateLimit,
    applyAdminRateLimit,
    applyCrudRateLimit,
    getAllRateLimitStats,
    resetAllRateLimits,
    analyticsLimiter,
    adminLimiter,
    crudLimiter,
    authLimiter,
    registerLimiter,
    rateLimitStrict: adminLimiter.middleware()
};