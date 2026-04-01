jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

// We need a fresh CacheService instance for each test, not the singleton.
// Require the module path to get access to the constructor.
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
    // Clear REDIS_URL so Redis is not initialized
    delete process.env.REDIS_URL;
    CacheService = require('../../../src/services/cacheService').constructor;
    cacheService = new CacheService();
});

afterEach(() => {
    // Clean up the cleanup timer
    if (cacheService && cacheService.cleanupTimer) {
        clearInterval(cacheService.cleanupTimer);
        cacheService.cleanupTimer = null;
    }
});

describe('CacheService', () => {
    describe('get', () => {
        test('returns null for non-existent key', async () => {
            const result = await cacheService.get('nonexistent');
            expect(result).toBeNull();
        });

        test('returns data for existing key', async () => {
            await cacheService.set('test-key', { value: 42 });

            const result = await cacheService.get('test-key');

            expect(result).toEqual({ value: 42 });
        });

        test('returns null for expired key', async () => {
            // Set with very short TTL
            cacheService.analyticsCache.set('expired-key', {
                data: { value: 1 },
                timestamp: Date.now() - 200000, // 200 seconds ago
                ttl: 1000 // 1 second TTL
            });

            const result = await cacheService.get('expired-key', { ttl: 1 });

            expect(result).toBeNull();
        });

        test('respects custom TTL in options', async () => {
            cacheService.analyticsCache.set('ttl-key', {
                data: { value: 'fresh' },
                timestamp: Date.now() - 2000, // 2 seconds ago
                ttl: 5000 // 5 second TTL (ms)
            });

            const result = await cacheService.get('ttl-key', { ttl: 5 });

            expect(result).toEqual({ value: 'fresh' });
        });

        test('removes expired entries on access', async () => {
            cacheService.analyticsCache.set('stale-key', {
                data: { value: 'stale' },
                timestamp: Date.now() - 200000,
                ttl: 1000
            });

            await cacheService.get('stale-key', { ttl: 1 });

            expect(cacheService.analyticsCache.has('stale-key')).toBe(false);
        });
    });

    describe('set', () => {
        test('stores data in memory cache', async () => {
            await cacheService.set('new-key', { data: 'test' });

            expect(cacheService.analyticsCache.has('new-key')).toBe(true);
            const stored = cacheService.analyticsCache.get('new-key');
            expect(stored.data).toEqual({ data: 'test' });
        });

        test('stores timestamp with data', async () => {
            const before = Date.now();
            await cacheService.set('time-key', { data: 'test' });
            const after = Date.now();

            const stored = cacheService.analyticsCache.get('time-key');
            expect(stored.timestamp).toBeGreaterThanOrEqual(before);
            expect(stored.timestamp).toBeLessThanOrEqual(after);
        });

        test('stores custom TTL when provided', async () => {
            await cacheService.set('ttl-key', { data: 'test' }, { ttl: 120 });

            const stored = cacheService.analyticsCache.get('ttl-key');
            expect(stored.ttl).toBe(120000); // 120 seconds in ms
        });

        test('overwrites existing key', async () => {
            await cacheService.set('overwrite-key', { value: 1 });
            await cacheService.set('overwrite-key', { value: 2 });

            const result = await cacheService.get('overwrite-key');
            expect(result).toEqual({ value: 2 });
        });
    });

    describe('invalidate', () => {
        test('removes key from memory cache', async () => {
            await cacheService.set('to-delete', { data: 'gone' });
            expect(cacheService.analyticsCache.has('to-delete')).toBe(true);

            await cacheService.invalidate('to-delete');

            expect(cacheService.analyticsCache.has('to-delete')).toBe(false);
        });

        test('does not throw for non-existent key', async () => {
            await expect(cacheService.invalidate('nonexistent')).resolves.not.toThrow();
        });
    });

    describe('invalidatePattern', () => {
        test('removes all matching keys from memory cache', async () => {
            await cacheService.set('controller:1:data', { id: 1 });
            await cacheService.set('controller:2:data', { id: 2 });
            await cacheService.set('building:1:data', { id: 1 });

            await cacheService.invalidatePattern('controller:');

            expect(cacheService.analyticsCache.has('controller:1:data')).toBe(false);
            expect(cacheService.analyticsCache.has('controller:2:data')).toBe(false);
            expect(cacheService.analyticsCache.has('building:1:data')).toBe(true);
        });

        test('does nothing when no keys match', async () => {
            await cacheService.set('key1', { data: 1 });

            await cacheService.invalidatePattern('nomatch');

            expect(cacheService.analyticsCache.has('key1')).toBe(true);
        });
    });

    describe('getTransformerAnalytics / setTransformerAnalytics', () => {
        test('returns null when transformer analytics not cached', async () => {
            const result = await cacheService.getTransformerAnalytics(1);
            expect(result).toBeNull();
        });

        test('returns cached transformer analytics', async () => {
            const mockData = { load: 75, efficiency: 0.95 };
            await cacheService.setTransformerAnalytics(1, mockData);

            const result = await cacheService.getTransformerAnalytics(1);

            expect(result).toEqual(mockData);
        });

        test('returns null for expired transformer analytics', async () => {
            cacheService.analyticsCache.set('transformer:1:analytics', {
                data: { load: 50 },
                timestamp: Date.now() - 200000 // well past memoryTTL
            });

            const result = await cacheService.getTransformerAnalytics(1);

            expect(result).toBeNull();
        });
    });

    describe('invalidateTransformerCache', () => {
        test('removes transformer analytics from cache', async () => {
            await cacheService.setTransformerAnalytics(5, { load: 80 });
            expect(cacheService.analyticsCache.has('transformer:5:analytics')).toBe(true);

            await cacheService.invalidateTransformerCache(5);

            expect(cacheService.analyticsCache.has('transformer:5:analytics')).toBe(false);
        });
    });

    describe('getStats', () => {
        test('returns cache statistics', async () => {
            await cacheService.set('stat1', { data: 1 });
            await cacheService.set('stat2', { data: 2 });

            const stats = cacheService.getStats();

            expect(stats.memory_cache_size).toBe(2);
            expect(stats.memory_cache_max).toBe(1000);
            expect(stats.redis_available).toBe(false);
            expect(stats.memory_ttl_ms).toBe(60000);
            expect(stats.default_ttl_seconds).toBe(300);
        });
    });

    describe('clearAll', () => {
        test('clears all entries from memory cache', async () => {
            await cacheService.set('a', { data: 1 });
            await cacheService.set('b', { data: 2 });
            await cacheService.set('c', { data: 3 });
            expect(cacheService.analyticsCache.size).toBe(3);

            await cacheService.clearAll();

            expect(cacheService.analyticsCache.size).toBe(0);
        });
    });

    describe('cleanupMemoryCache', () => {
        test('removes expired entries', () => {
            cacheService.analyticsCache.set('expired', {
                data: 'old',
                timestamp: Date.now() - 200000,
                ttl: 1000
            });
            cacheService.analyticsCache.set('fresh', {
                data: 'new',
                timestamp: Date.now(),
                ttl: 300000
            });

            cacheService.cleanupMemoryCache();

            expect(cacheService.analyticsCache.has('expired')).toBe(false);
            expect(cacheService.analyticsCache.has('fresh')).toBe(true);
        });

        test('evicts oldest entries when exceeding maxMemoryItems', () => {
            cacheService.maxMemoryItems = 3;

            for (let i = 0; i < 5; i++) {
                cacheService.analyticsCache.set(`item-${i}`, {
                    data: i,
                    timestamp: Date.now() + i * 1000, // each newer
                    ttl: 600000
                });
            }

            cacheService.cleanupMemoryCache();

            expect(cacheService.analyticsCache.size).toBe(3);
        });
    });

    describe('close', () => {
        test('clears cleanup timer', async () => {
            expect(cacheService.cleanupTimer).not.toBeNull();

            await cacheService.close();

            expect(cacheService.cleanupTimer).toBeNull();
        });
    });
});
