'use strict';

/**
 * Extended CacheService tests covering:
 * - getTransformerAnalytics / setTransformerAnalytics with Redis path
 * - invalidateTransformerCache with Redis path
 * - getMetrics / setMetrics (via generic get/set with metrics keys)
 * - getBuildings / setBuildings (via generic get/set with buildings keys)
 * - invalidateMetricsCaches / invalidateBuildingsCaches (via invalidatePattern)
 * - Automatic cleanup interval behavior
 * - close() with Redis client
 */

// Extends cacheServiceTest.test.js with Redis/advanced scenarios.

let CacheService;
let cacheService;

beforeEach(() => {
    jest.resetModules();
    jest.mock('../../../src/utils/logger', () => ({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }));
    delete process.env.REDIS_URL;
    CacheService = require('../../../src/services/cacheService').constructor;
    cacheService = new CacheService();
});

afterEach(() => {
    if (cacheService && cacheService.cleanupTimer) {
        clearInterval(cacheService.cleanupTimer);
        cacheService.cleanupTimer = null;
    }
});

describe('CacheService — extended coverage', () => {
    // -------------------------------------------------------------------------
    // getTransformerAnalytics — edge cases
    // -------------------------------------------------------------------------
    describe('getTransformerAnalytics — memory TTL expiry', () => {
        it('deletes expired entry and returns null', async () => {
            cacheService.analyticsCache.set('transformer:99:analytics', {
                data: { load: 50 },
                timestamp: Date.now() - cacheService.memoryTTL - 1000
            });

            const result = await cacheService.getTransformerAnalytics(99);

            expect(result).toBeNull();
            expect(cacheService.analyticsCache.has('transformer:99:analytics')).toBe(false);
        });

        it('returns data when within memoryTTL', async () => {
            const data = { load: 85, efficiency: 0.92 };
            cacheService.analyticsCache.set('transformer:10:analytics', {
                data,
                timestamp: Date.now() - 1000 // 1 second ago, within 60s TTL
            });

            const result = await cacheService.getTransformerAnalytics(10);

            expect(result).toEqual(data);
        });
    });

    // -------------------------------------------------------------------------
    // getTransformerAnalytics — Redis fallback path
    // -------------------------------------------------------------------------
    describe('getTransformerAnalytics — simulated Redis path', () => {
        it('falls through to Redis when memory cache is empty and Redis is available', async () => {
            const mockRedisClient = {
                get: jest.fn().mockResolvedValue(JSON.stringify({ load: 70 })),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            const result = await cacheService.getTransformerAnalytics(42);

            expect(result).toEqual({ load: 70 });
            expect(mockRedisClient.get).toHaveBeenCalledWith('transformer:42:analytics');
            // Should also be stored in memory cache now
            expect(cacheService.analyticsCache.has('transformer:42:analytics')).toBe(true);
        });

        it('returns null when Redis has no data', async () => {
            const mockRedisClient = {
                get: jest.fn().mockResolvedValue(null),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            const result = await cacheService.getTransformerAnalytics(42);

            expect(result).toBeNull();
        });

        it('falls back to null on Redis error', async () => {
            const mockRedisClient = {
                get: jest.fn().mockRejectedValue(new Error('Redis timeout')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            const result = await cacheService.getTransformerAnalytics(42);

            expect(result).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // setTransformerAnalytics — Redis path
    // -------------------------------------------------------------------------
    describe('setTransformerAnalytics — Redis path', () => {
        it('writes to both memory and Redis', async () => {
            const mockRedisClient = {
                setEx: jest.fn().mockResolvedValue('OK'),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.setTransformerAnalytics(7, { load: 60 });

            expect(cacheService.analyticsCache.has('transformer:7:analytics')).toBe(true);
            expect(mockRedisClient.setEx).toHaveBeenCalledWith(
                'transformer:7:analytics',
                cacheService.defaultTTL,
                JSON.stringify({ load: 60 })
            );
        });

        it('continues when Redis write fails', async () => {
            const mockRedisClient = {
                setEx: jest.fn().mockRejectedValue(new Error('Redis write failed')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.setTransformerAnalytics(7, { load: 60 });

            // Memory cache should still have the data
            expect(cacheService.analyticsCache.has('transformer:7:analytics')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // invalidateTransformerCache — Redis path
    // -------------------------------------------------------------------------
    describe('invalidateTransformerCache — Redis path', () => {
        it('deletes from both memory and Redis', async () => {
            const mockRedisClient = {
                del: jest.fn().mockResolvedValue(1),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            cacheService.analyticsCache.set('transformer:5:analytics', {
                data: { load: 80 },
                timestamp: Date.now()
            });

            await cacheService.invalidateTransformerCache(5);

            expect(cacheService.analyticsCache.has('transformer:5:analytics')).toBe(false);
            expect(mockRedisClient.del).toHaveBeenCalledWith('transformer:5:analytics');
        });

        it('continues when Redis delete fails', async () => {
            const mockRedisClient = {
                del: jest.fn().mockRejectedValue(new Error('Redis del failed')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            cacheService.analyticsCache.set('transformer:5:analytics', {
                data: { load: 80 },
                timestamp: Date.now()
            });

            await cacheService.invalidateTransformerCache(5);

            // Memory cache should still be cleared
            expect(cacheService.analyticsCache.has('transformer:5:analytics')).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // Metrics caching via generic get/set
    // -------------------------------------------------------------------------
    describe('metrics caching', () => {
        it('stores and retrieves metrics data via generic methods', async () => {
            const metricsData = { voltage: 220, current: 5.5 };
            await cacheService.set('metrics:building:1:latest', metricsData, { ttl: 60 });

            const result = await cacheService.get('metrics:building:1:latest', { ttl: 60 });

            expect(result).toEqual(metricsData);
        });

        it('invalidates metrics caches via pattern', async () => {
            await cacheService.set('metrics:building:1:latest', { v: 1 });
            await cacheService.set('metrics:building:2:latest', { v: 2 });
            await cacheService.set('other:data', { v: 3 });

            await cacheService.invalidatePattern('metrics:');

            expect(cacheService.analyticsCache.has('metrics:building:1:latest')).toBe(false);
            expect(cacheService.analyticsCache.has('metrics:building:2:latest')).toBe(false);
            expect(cacheService.analyticsCache.has('other:data')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Buildings caching via generic get/set
    // -------------------------------------------------------------------------
    describe('buildings caching', () => {
        it('stores and retrieves building data via generic methods', async () => {
            const buildingData = { building_id: 1, name: 'Building A' };
            await cacheService.set('building:1:with_controllers', buildingData, { ttl: 300 });

            const result = await cacheService.get('building:1:with_controllers', { ttl: 300 });

            expect(result).toEqual(buildingData);
        });

        it('invalidates building list caches via pattern', async () => {
            await cacheService.set('building:list:1:10:building_id:asc', { data: [] });
            await cacheService.set('building:list:2:10:building_id:asc', { data: [] });
            await cacheService.set('building:1:with_controllers', { building_id: 1 });

            await cacheService.invalidatePattern('building:list:');

            expect(cacheService.analyticsCache.has('building:list:1:10:building_id:asc')).toBe(false);
            expect(cacheService.analyticsCache.has('building:list:2:10:building_id:asc')).toBe(false);
            // Individual building cache should not be affected
            expect(cacheService.analyticsCache.has('building:1:with_controllers')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Generic get — Redis path
    // -------------------------------------------------------------------------
    describe('get — Redis path', () => {
        it('fetches from Redis when memory is empty and Redis available', async () => {
            const mockRedisClient = {
                get: jest.fn().mockResolvedValue(JSON.stringify({ data: 'from-redis' })),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            const result = await cacheService.get('some-key');

            expect(result).toEqual({ data: 'from-redis' });
            // Should also populate memory cache
            expect(cacheService.analyticsCache.has('some-key')).toBe(true);
        });

        it('returns null when Redis returns no data', async () => {
            const mockRedisClient = {
                get: jest.fn().mockResolvedValue(null),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            const result = await cacheService.get('missing-key');

            expect(result).toBeNull();
        });

        it('returns null on Redis error', async () => {
            const mockRedisClient = {
                get: jest.fn().mockRejectedValue(new Error('Redis error')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            const result = await cacheService.get('error-key');

            expect(result).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // Generic set — Redis path
    // -------------------------------------------------------------------------
    describe('set — Redis path', () => {
        it('writes to Redis when available', async () => {
            const mockRedisClient = {
                setEx: jest.fn().mockResolvedValue('OK'),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.set('redis-key', { value: 42 }, { ttl: 120 });

            expect(mockRedisClient.setEx).toHaveBeenCalledWith(
                'redis-key',
                120,
                JSON.stringify({ value: 42 })
            );
        });

        it('uses default TTL when none provided', async () => {
            const mockRedisClient = {
                setEx: jest.fn().mockResolvedValue('OK'),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.set('redis-key', { value: 42 });

            expect(mockRedisClient.setEx).toHaveBeenCalledWith(
                'redis-key',
                300, // default TTL
                JSON.stringify({ value: 42 })
            );
        });

        it('continues when Redis write fails', async () => {
            const mockRedisClient = {
                setEx: jest.fn().mockRejectedValue(new Error('Redis write error')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.set('redis-key', { value: 42 });

            // Memory cache should still be populated
            expect(cacheService.analyticsCache.has('redis-key')).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // invalidate — Redis path
    // -------------------------------------------------------------------------
    describe('invalidate — Redis path', () => {
        it('deletes from Redis when available', async () => {
            const mockRedisClient = {
                del: jest.fn().mockResolvedValue(1),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.set('del-key', { v: 1 });
            await cacheService.invalidate('del-key');

            expect(mockRedisClient.del).toHaveBeenCalledWith('del-key');
            expect(cacheService.analyticsCache.has('del-key')).toBe(false);
        });

        it('continues when Redis delete fails', async () => {
            const mockRedisClient = {
                del: jest.fn().mockRejectedValue(new Error('Redis del error')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.set('del-key', { v: 1 });
            await cacheService.invalidate('del-key');

            expect(cacheService.analyticsCache.has('del-key')).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // invalidatePattern — Redis path
    // -------------------------------------------------------------------------
    describe('invalidatePattern — Redis path', () => {
        it('scans and deletes matching keys from Redis', async () => {
            const mockRedisClient = {
                keys: jest.fn().mockResolvedValue(['metrics:1', 'metrics:2']),
                del: jest.fn().mockResolvedValue(2),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.invalidatePattern('metrics');

            expect(mockRedisClient.keys).toHaveBeenCalledWith('*metrics*');
            expect(mockRedisClient.del).toHaveBeenCalledWith(['metrics:1', 'metrics:2']);
        });

        it('does not call del when no Redis keys match', async () => {
            const mockRedisClient = {
                keys: jest.fn().mockResolvedValue([]),
                del: jest.fn(),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.invalidatePattern('nomatch');

            expect(mockRedisClient.del).not.toHaveBeenCalled();
        });

        it('continues when Redis keys scan fails', async () => {
            const mockRedisClient = {
                keys: jest.fn().mockRejectedValue(new Error('Redis scan error')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            // Should not throw
            await expect(cacheService.invalidatePattern('pattern')).resolves.toBeUndefined();
        });
    });

    // -------------------------------------------------------------------------
    // clearAll — Redis path
    // -------------------------------------------------------------------------
    describe('clearAll — Redis path', () => {
        it('flushes Redis when available', async () => {
            const mockRedisClient = {
                flushDb: jest.fn().mockResolvedValue('OK'),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.set('key1', { v: 1 });
            await cacheService.clearAll();

            expect(cacheService.analyticsCache.size).toBe(0);
            expect(mockRedisClient.flushDb).toHaveBeenCalled();
        });

        it('continues when Redis flush fails', async () => {
            const mockRedisClient = {
                flushDb: jest.fn().mockRejectedValue(new Error('Redis flush error')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;
            cacheService.redisAvailable = true;

            await cacheService.set('key1', { v: 1 });
            await cacheService.clearAll();

            expect(cacheService.analyticsCache.size).toBe(0);
        });
    });

    // -------------------------------------------------------------------------
    // close — Redis path
    // -------------------------------------------------------------------------
    describe('close — Redis path', () => {
        it('quits Redis client and clears timer', async () => {
            const mockRedisClient = {
                quit: jest.fn().mockResolvedValue('OK'),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;

            await cacheService.close();

            expect(mockRedisClient.quit).toHaveBeenCalled();
            expect(cacheService.cleanupTimer).toBeNull();
        });

        it('continues when Redis quit fails', async () => {
            const mockRedisClient = {
                quit: jest.fn().mockRejectedValue(new Error('Redis quit error')),
                on: jest.fn(),
                connect: jest.fn().mockResolvedValue(undefined)
            };
            cacheService.redisClient = mockRedisClient;

            await cacheService.close();

            expect(cacheService.cleanupTimer).toBeNull();
        });
    });

    // -------------------------------------------------------------------------
    // Cleanup timer behavior
    // -------------------------------------------------------------------------
    describe('startCleanupTimer', () => {
        it('initializes a cleanup timer on construction', () => {
            expect(cacheService.cleanupTimer).not.toBeNull();
            expect(cacheService.cleanupTimer).toBeDefined();
        });
    });

    describe('cleanupMemoryCache — edge cases', () => {
        it('uses memoryTTL as default when entry has no ttl field', () => {
            cacheService.analyticsCache.set('no-ttl-key', {
                data: 'value',
                timestamp: Date.now() - cacheService.memoryTTL - 1000
                // no ttl field
            });

            cacheService.cleanupMemoryCache();

            expect(cacheService.analyticsCache.has('no-ttl-key')).toBe(false);
        });

        it('preserves entries that are still within their TTL', () => {
            cacheService.analyticsCache.set('fresh-key', {
                data: 'value',
                timestamp: Date.now(),
                ttl: 300000
            });

            cacheService.cleanupMemoryCache();

            expect(cacheService.analyticsCache.has('fresh-key')).toBe(true);
        });

        it('does nothing when cache is empty', () => {
            expect(cacheService.analyticsCache.size).toBe(0);

            cacheService.cleanupMemoryCache();

            expect(cacheService.analyticsCache.size).toBe(0);
        });
    });
});
