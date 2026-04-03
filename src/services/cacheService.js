const logger = require('../utils/logger');

class CacheService {
    constructor() {
        this.defaultTTL = 300; // 5 минут
        this.analyticsCache = new Map(); // In-memory cache для критических данных
        this.memoryTTL = 60000; // 1 минута в памяти
        this.maxMemoryItems = 1000; // Максимум элементов в памяти

        // Инициализация Redis (опционально)
        this.redisClient = null;
        this.redisAvailable = false;

        this.initRedis();
        this.startCleanupTimer();
    }

    // Инициализация Redis (если доступен)
    async initRedis() {
        try {
            // Пытаемся подключиться к Redis, если он указан в конфигурации
            if (process.env.REDIS_URL) {
                const Redis = require('redis');
                this.redisClient = Redis.createClient({
                    url: process.env.REDIS_URL,
                    retry_unfulfilled_commands: false,
                    socket: {
                        connectTimeout: 5000,
                        lazyConnect: true
                    }
                });

                this.redisClient.on('error', (err) => {
                    logger.warn('Redis недоступен:', err.message);
                    this.redisAvailable = false;
                });

                this.redisClient.on('connect', () => {
                    logger.info('Redis подключен успешно');
                    this.redisAvailable = true;
                });

                await this.redisClient.connect();
            }
        } catch (error) {
            logger.warn('Redis не настроен, используется только memory cache:', error.message);
            this.redisAvailable = false;
        }
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
                const redisData = await this.redisClient.get(cacheKey);
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
                await this.redisClient.setEx(cacheKey, this.defaultTTL, JSON.stringify(data));
                logger.debug(`Cache set (Redis) для ${cacheKey}`);
            } catch (error) {
                logger.warn('Не удалось сохранить в Redis:', error.message);
            }
        }

        logger.debug(`Cache set (memory) для ${cacheKey}`);
    }

    // Инвалидация кэша при обновлении данных
    async invalidateTransformerCache(transformerId) {
        const cacheKey = `transformer:${transformerId}:analytics`;

        // Удаляем из memory cache
        this.analyticsCache.delete(cacheKey);

        // Удаляем из Redis
        if (this.redisAvailable) {
            try {
                await this.redisClient.del(cacheKey);
                logger.debug(`Cache invalidated (Redis) для ${cacheKey}`);
            } catch (error) {
                logger.warn('Не удалось очистить Redis:', error.message);
            }
        }

        logger.debug(`Cache invalidated (memory) для ${cacheKey}`);
    }

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
                const redisData = await this.redisClient.get(key);
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
                await this.redisClient.setEx(key, ttl, JSON.stringify(data));
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
                await this.redisClient.del(key);
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

        // Redis cache - используем SCAN для поиска по паттерну (KEYS блокирует Redis)
        if (this.redisAvailable) {
            try {
                const matchPattern = `*${pattern}*`;
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

    // Очистка всего кэша
    async clearAll() {
        // Memory cache
        this.analyticsCache.clear();

        // Redis cache
        if (this.redisAvailable) {
            try {
                await this.redisClient.flushDb();
                logger.info('Redis cache очищен');
            } catch (error) {
                logger.warn('Не удалось очистить Redis:', error.message);
            }
        }

        logger.info('Memory cache очищен');
    }

    // Закрытие соединений
    async close() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        if (this.redisClient) {
            try {
                await this.redisClient.quit();
                logger.info('Redis соединение закрыто');
            } catch (error) {
                logger.warn('Ошибка закрытия Redis:', error.message);
            }
        }
    }
}

// Экспортируем синглтон
module.exports = new CacheService();