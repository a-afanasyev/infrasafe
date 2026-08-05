const logger = require('../utils/logger');
const redisClient = require('../utils/redisClient');

// [Sprint 4] Cache namespace prefix — avoids key collisions when this
// Redis is shared (e.g. with the rate-limiter under `ratelimit:*`).
const CACHE_PREFIX = 'cache:';

class CacheService {
    constructor() {
        this.defaultTTL = 300; // 5 минут (seconds; Redis TTL)
        this.analyticsCache = new Map(); // L1 in-memory
        this.memoryTTL = 60000; // 1 минута (ms; L1 TTL)
        this.maxMemoryItems = 1000;

        // [Sprint 4] Use shared redisClient instead of an own connection.
        // L2 (Redis) is consulted only when isReady() — call sites stay
        // unchanged through degraded mode.
        this.startCleanupTimer();
    }

    // [Sprint 4] Helpers — single source of truth for L2 availability.
    get redisAvailable() {
        return redisClient.isReady();
    }
    get redisClient() {
        return redisClient.getClient();
    }
    _k(key) {
        return `${CACHE_PREFIX}${key}`;
    }

    // Очистка устаревших записей из memory cache
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupMemoryCache();
        }, 60000); // Очистка каждую минуту
        this.cleanupTimer.unref();
    }

    cleanupMemoryCache() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, cached] of this.analyticsCache.entries()) {
            if (now - cached.timestamp > (cached.ttl || this.memoryTTL)) {
                this.analyticsCache.delete(key);
                cleanedCount++;
            }
        }

        // Если превышен лимит, удаляем самые старые записи
        if (this.analyticsCache.size > this.maxMemoryItems) {
            const entries = Array.from(this.analyticsCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);

            const toDelete = entries.slice(0, entries.length - this.maxMemoryItems);
            toDelete.forEach(([key]) => {
                this.analyticsCache.delete(key);
                cleanedCount++;
            });
        }

        if (cleanedCount > 0) {
            logger.debug(`Очищено ${cleanedCount} записей из memory cache`);
        }
    }

    // Для часто запрашиваемой аналитики трансформаторов
    async getTransformerAnalytics(transformerId) {
        const cacheKey = `transformer:${transformerId}:analytics`;

        // Сначала проверяем memory cache
        if (this.analyticsCache.has(cacheKey)) {
            const cached = this.analyticsCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.memoryTTL) {
                logger.debug(`Cache hit (memory) для ${cacheKey}`);
                return cached.data;
            } else {
                // Удаляем устаревшую запись
                this.analyticsCache.delete(cacheKey);
            }
        }

        // Затем проверяем Redis
        if (this.redisAvailable) {
            try {
                const redisData = await this.redisClient.get(this._k(cacheKey));
                if (redisData) {
                    const parsed = JSON.parse(redisData);

                    // Сохраняем в memory cache для быстрого доступа
                    this.analyticsCache.set(cacheKey, {
                        data: parsed,
                        timestamp: Date.now()
                    });

                    logger.debug(`Cache hit (Redis) для ${cacheKey}`);
                    return parsed;
                }
            } catch (error) {
                logger.warn('Ошибка получения из Redis:', error.message);
            }
        }

        return null; // Кэш пуст, нужно загрузить из БД
    }

    async setTransformerAnalytics(transformerId, data) {
        const cacheKey = `transformer:${transformerId}:analytics`;

        // Memory cache
        this.analyticsCache.set(cacheKey, {
            data,
            timestamp: Date.now()
        });

        // Redis cache
        if (this.redisAvailable) {
            try {
                await this.redisClient.setex(this._k(cacheKey), this.defaultTTL, JSON.stringify(data));
                logger.debug(`Cache set (Redis) для ${cacheKey}`);
            } catch (error) {
                logger.warn('Не удалось сохранить в Redis:', error.message);
            }
        }

        logger.debug(`Cache set (memory) для ${cacheKey}`);
    }

    // [DE-5] `invalidateTransformerCache` (ед. ч.) удалён 2026-08-05: его не
    // вызывал никто. Живая инвалидация — `analyticsService.
    // invalidateTransformerCaches` (мн. ч.), и она идёт через
    // `invalidatePattern('transformer')`, который снимает все ключи
    // трансформатора разом, а не только `:analytics`. Два близких имени, живое
    // из них было одно.

    // Универсальные методы кэширования
    async get(key, options = {}) {
        const ttl = options.ttl ? options.ttl * 1000 : this.memoryTTL; // convert seconds to ms

        // Memory cache
        if (this.analyticsCache.has(key)) {
            const cached = this.analyticsCache.get(key);
            if (Date.now() - cached.timestamp < (cached.ttl || ttl || this.memoryTTL)) {
                return cached.data;
            } else {
                this.analyticsCache.delete(key);
            }
        }

        // Redis cache
        if (this.redisAvailable) {
            try {
                const redisData = await this.redisClient.get(this._k(key));
                if (redisData) {
                    const parsed = JSON.parse(redisData);
                    this.analyticsCache.set(key, {
                        data: parsed,
                        timestamp: Date.now()
                    });
                    return parsed;
                }
            } catch (error) {
                logger.warn('Ошибка получения из Redis:', error.message);
            }
        }

        return null;
    }

    async set(key, data, options = {}) {
        const ttl = options.ttl || this.defaultTTL;

        // Memory cache
        this.analyticsCache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: options.ttl ? options.ttl * 1000 : this.memoryTTL
        });

        // Redis cache
        if (this.redisAvailable) {
            try {
                await this.redisClient.setex(this._k(key), ttl, JSON.stringify(data));
            } catch (error) {
                logger.warn('Не удалось сохранить в Redis:', error.message);
            }
        }
    }

    async invalidate(key) {
        // Memory cache
        this.analyticsCache.delete(key);

        // Redis cache
        if (this.redisAvailable) {
            try {
                await this.redisClient.del(this._k(key));
            } catch (error) {
                logger.warn('Не удалось очистить Redis:', error.message);
            }
        }
    }

    // Паттерн для инвалидации группы ключей
    async invalidatePattern(pattern) {
        // Memory cache - проходим по всем ключам
        for (const key of this.analyticsCache.keys()) {
            if (key.includes(pattern)) {
                this.analyticsCache.delete(key);
            }
        }

        // Redis cache — SCAN avoids blocking on large keysets (vs KEYS).
        // Match within our cache namespace only (don't wipe rate-limiter
        // keys etc. that share the same Redis instance).
        if (this.redisAvailable) {
            try {
                const matchPattern = `${CACHE_PREFIX}*${pattern}*`;
                const keysToDelete = [];
                let cursor = '0';
                do {
                    const result = await this.redisClient.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
                    cursor = result[0];
                    keysToDelete.push(...result[1]);
                } while (cursor !== '0');
                if (keysToDelete.length > 0) {
                    await this.redisClient.del(keysToDelete);
                }
            } catch (error) {
                logger.warn('Не удалось очистить Redis по паттерну:', error.message);
            }
        }
    }

    // Статистика кэша
    getStats() {
        return {
            memory_cache_size: this.analyticsCache.size,
            memory_cache_max: this.maxMemoryItems,
            redis_available: this.redisAvailable,
            memory_ttl_ms: this.memoryTTL,
            default_ttl_seconds: this.defaultTTL
        };
    }

    // Очистка всего кэша. [Sprint 4] Only deletes keys in our namespace
    // — never flushdb (would wipe rate-limiter / dedup keys too).
    async clearAll() {
        // Memory cache
        this.analyticsCache.clear();

        // Redis cache — scoped deletion via SCAN over CACHE_PREFIX.
        if (this.redisAvailable) {
            try {
                let cursor = '0';
                const keys = [];
                do {
                    const result = await this.redisClient.scan(cursor, 'MATCH', `${CACHE_PREFIX}*`, 'COUNT', 200);
                    cursor = result[0];
                    keys.push(...result[1]);
                } while (cursor !== '0');
                if (keys.length > 0) {
                    await this.redisClient.del(keys);
                }
                logger.info(`Redis cache очищен (${keys.length} keys)`);
            } catch (error) {
                logger.warn('Не удалось очистить Redis:', error.message);
            }
        }

        logger.info('Memory cache очищен');
    }

    // Закрытие соединений. [Sprint 4] redisClient is a shared singleton —
    // closing here would break other consumers (rate-limiter, dedup).
    // The server.js graceful-shutdown handler is responsible for closing
    // the Redis connection once.
    async close() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}

// Экспортируем синглтон
module.exports = new CacheService();