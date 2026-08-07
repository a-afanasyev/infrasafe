const logger = require('../utils/logger');
const redisClient = require('../utils/redisClient');
const { sendError } = require('../utils/apiResponse');

// [Sprint 4] Hybrid rate-limiter: Redis-backed when REDIS_URL is set
// (multi-replica safe), in-memory Map when not (single-replica only).
// The fallback is transparent — call sites use middleware() the same way.
//
// Key namespace prefix prevents collisions across multiple consumers
// sharing one Redis instance (e.g. multiple deployments on staging).
const REDIS_KEY_PREFIX = 'ratelimit:';
const REDIS_KEY_PREFIX_SD = 'slowdown:';

// [R2-13] Observability for silent Redis degradation. When a Redis op throws,
// the limiter falls back to the per-process in-memory store — which in a
// multi-replica deploy silently makes limits per-replica (e.g. auth 10/15min
// becomes 10×N). Log the transition ONCE (mirrors redisClient's `healthy` flag)
// so operators see the degradation instead of it passing unnoticed.
let _redisDegradedLogged = false;
function noteRedisDegraded(err) {
    if (!_redisDegradedLogged) {
        _redisDegradedLogged = true;
        logger.warn(`Rate limiter: Redis error — degraded to per-process in-memory store (limits become per-replica): ${err && err.message ? err.message : err}`);
    }
}

// [SEC-6] Hard cap on the in-memory fallback store so a high-cardinality
// IP flood cannot grow memory unboundedly between the 60s cleanup sweeps.
// Mirrors webhookVerifier's SEEN_SIGNATURE_MAX_ENTRIES pattern: when the
// Map reaches the cap, expired entries are swept first, then the oldest
// surviving entry is evicted FIFO. Redis-backed deployments are unaffected.
const DEFAULT_MAX_STORE_ENTRIES = 10000;

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
        // [SEC-6] Size cap for the in-memory fallback store.
        this.maxStoreEntries = options.maxStoreEntries || DEFAULT_MAX_STORE_ENTRIES;

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

    // [SEC-6] Enforce the store size cap before inserting a new key. Sweep
    // expired entries first (cheap), then FIFO-evict the oldest survivor if
    // still at the cap. Mirrors webhookVerifier's nonce-map hard cap.
    _enforceStoreCap() {
        if (this.store.size < this.maxStoreEntries) return;

        const now = Date.now();
        for (const [key, data] of this.store) {
            if (now > data.resetTime) this.store.delete(key);
        }

        while (this.store.size >= this.maxStoreEntries) {
            const oldestKey = this.store.keys().next().value;
            if (oldestKey === undefined) break;
            this.store.delete(oldestKey);
        }

        logger.warn(
            'Rate limiter: in-memory store reached its size cap; evicted oldest entries. ' +
            'Configure REDIS_URL for multi-replica-safe rate limiting.'
        );
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
        } catch (err) {
            noteRedisDegraded(err);
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
                    // [SEC-6] Cap the store before inserting a brand-new key.
                    this._enforceStoreCap();
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

                const retryAfter = Math.ceil(msUntilReset / 1000);
                res.set('Retry-After', retryAfter);

                // [AR-4] Канонический конверт. Прежняя форма клала в ключ `error`
                // СТРОКУ-код, тогда как в каноне `error` — объект: один ключ в двух
                // несовместимых формах, из-за чего фронт и гадал, что ему прислали.
                // Код переехал в `error.code`, машинные подробности — в `error.meta`,
                // человеку по-прежнему показывается `error.message`.
                return sendError(res, 429, this.message, {
                    code: 'RATE_LIMIT_EXCEEDED',
                    meta: {
                        limit: this.max,
                        current: hitData.hits,
                        remaining,
                        resetTime: new Date(hitData.resetTime).toISOString(),
                        retryAfter
                    }
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

    // Очистка всех данных. Без лога: reset() вызывается только из
    // resetAllRateLimits() (тесты + graceful shutdown), который уже пишет одну
    // сводную строку — пер-лимитерный лог не давал сигнала в проде, гонялся тысячи
    // раз в jest-прогоне (глобальный beforeEach) и триггерил CodeQL
    // js/clear-text-logging (FP: логировался store.size — счётчик, не ключи — но
    // sink сидел в методе «password»-лимитера). Просто чистим store.
    reset() {
        this.store.clear();
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
        // [SEC-6] Size cap for the in-memory fallback store (same as SimpleRateLimiter).
        this.maxStoreEntries = options.maxStoreEntries || DEFAULT_MAX_STORE_ENTRIES;

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

    // [SEC-6] Enforce the store size cap before inserting a new key. Sweep
    // expired entries first (cheap), then FIFO-evict the oldest survivor if
    // still at the cap. Mirrors SimpleRateLimiter._enforceStoreCap.
    _enforceStoreCap() {
        if (this.store.size < this.maxStoreEntries) return;

        const now = Date.now();
        for (const [key, data] of this.store) {
            if (now > data.resetTime) this.store.delete(key);
        }

        while (this.store.size >= this.maxStoreEntries) {
            const oldestKey = this.store.keys().next().value;
            if (oldestKey === undefined) break;
            this.store.delete(oldestKey);
        }

        logger.warn(
            'Slow down: in-memory store reached its size cap; evicted oldest entries. ' +
            'Configure REDIS_URL for multi-replica-safe rate limiting.'
        );
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
        } catch (err) {
            noteRedisDegraded(err);
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
                    // [SEC-6] Cap the store before inserting a brand-new key.
                    this._enforceStoreCap();
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

// [#150] Login/register caps are env-overridable so the E2E suite (many fresh
// logins + registrations from a single IP) can run green without tripping them.
// Prod leaves these UNSET → the secure defaults (10 / 5) apply. Only positive
// integers override. passwordChangeLimiter is intentionally NOT overridable — the
// E2E rate-limit test asserts its 5-per-window behaviour.
const envMax = (name, def) => {
    const n = parseInt(process.env[name], 10);
    return Number.isInteger(n) && n > 0 ? n : def;
};

const authLimiter = new SimpleRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: envMax('RATE_LIMIT_AUTH_MAX', 10),
    message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
    keyGenerator: (req) => `auth:login:${req.ip || req.connection.remoteAddress}`,
    namespace: 'auth-login'
});

const registerLimiter = new SimpleRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: envMax('RATE_LIMIT_REGISTER_MAX', 5),
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

// [H-4] GET /uk-requests-metrics is public (no app-level limiter existed
// before — only the nginx-edge general zone). It can return up to 10k rows
// per call, so a modest per-IP cap is warranted independent of the new
// service-token gate.
const ukInventoryLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 30,
    message: 'Слишком много запросов инвентаря UK. Попробуйте позже.',
    // [review fix 2026-07-23] Key includes the mount path: this limiter is
    // now shared by TWO inventory routes (/uk-requests-metrics and
    // /uk-buildings-metrics) — without the path component they'd share one
    // 30/min budget per IP, and UK's worker pairing both pulls (or an
    // anonymous caller on a token-less env) could starve one endpoint's
    // quota with the other's traffic.
    keyGenerator: (req) => `uk-inventory:${req.baseUrl || req.path}:${req.ip || req.connection.remoteAddress}`,
    standardHeaders: true,
    legacyHeaders: false,
    namespace: 'uk-inventory'
});

// [AR-7] Публичная карта: /api/buildings-metrics. Отдельный лимитер, а не
// переиспользованный analytics, намеренно — у аналитики есть slow-down
// (задержка после 20 запросов в минуту), и на публичной странице он бил бы по
// офису за одним NAT: двадцать сотрудников, открывших карту, это законный
// трафик, а не атака. Здесь нужен потолок против одного назойливого клиента,
// а не штраф за плотность.
//
// 60/мин при 15-секундном кэше означает максимум 4 реальных обращения к БД на
// IP в минуту для повторяющихся параметров. Работает лимитер прежде всего по
// запросам, которые кэш промахивают: клиент со случайным bbox платит
// LATERAL-сканом за каждый.
const mapDataLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    message: 'Слишком много запросов к данным карты. Попробуйте позже.',
    standardHeaders: true,
    legacyHeaders: false,
    namespace: 'map-data'
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

const applyUkInventoryRateLimit = [
    ukInventoryLimiter.middleware()
];

const applyMapDataRateLimit = [
    mapDataLimiter.middleware()
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
        uk_inventory: ukInventoryLimiter.getStats(),
        map_data: mapDataLimiter.getStats(),
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
    ukInventoryLimiter.reset();
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
    ukInventoryLimiter.destroy();
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
    applyUkInventoryRateLimit,
    applyMapDataRateLimit,
    getAllRateLimitStats,
    resetAllRateLimits,
    destroyAllLimiters,
    // [AUD-031] dropped dead bare exports analyticsLimiter/adminLimiter/
    // crudLimiter/telemetryLimiter (0 external importers; the apply*RateLimit
    // wrappers and rateLimitStrict are the public surface). Consts stay
    // internal — rateLimitStrict still binds adminLimiter below.
    authLimiter,
    registerLimiter,
    passwordChangeLimiter,
    rateLimitStrict: adminLimiter.middleware()
};