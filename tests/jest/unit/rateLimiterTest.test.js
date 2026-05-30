jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const { SimpleRateLimiter, SimpleSlowDown, getAllRateLimitStats, resetAllRateLimits, destroyAllLimiters } = require('../../../src/middleware/rateLimiter');

describe('SimpleRateLimiter', () => {
    let limiter;

    afterEach(() => {
        if (limiter) {
            limiter.destroy();
            limiter = null;
        }
    });

    describe('constructor', () => {
        test('initializes with default options', () => {
            limiter = new SimpleRateLimiter();
            expect(limiter.windowMs).toBe(60000);
            expect(limiter.max).toBe(100);
            expect(limiter.store.size).toBe(0);
        });

        test('initializes with custom options', () => {
            limiter = new SimpleRateLimiter({
                windowMs: 30000,
                max: 50,
                message: 'Custom message'
            });
            expect(limiter.windowMs).toBe(30000);
            expect(limiter.max).toBe(50);
            expect(limiter.message).toBe('Custom message');
        });
    });

    describe('middleware', () => {
        let req, res, next;

        beforeEach(() => {
            limiter = new SimpleRateLimiter({ windowMs: 60000, max: 3 });
            req = { ip: '127.0.0.1' };
            res = {
                set: jest.fn(),
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };
            next = jest.fn();
        });

        // [Sprint 4] middleware() now returns an async function — Redis-aware.
        // All call sites must await it.
        test('allows requests under the limit', async () => {
            const mw = limiter.middleware();
            await mw(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('sets rate limit headers', async () => {
            const mw = limiter.middleware();
            await mw(req, res, next);
            expect(res.set).toHaveBeenCalledWith('X-RateLimit-Limit', 3);
            expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', 2);
        });

        test('blocks requests over the limit', async () => {
            const mw = limiter.middleware();
            await mw(req, res, next);
            await mw(req, res, next);
            await mw(req, res, next);

            next.mockClear();
            res.status.mockClear();

            await mw(req, res, next); // exceeds limit
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: 'RATE_LIMIT_EXCEEDED'
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('sets Retry-After header when limit exceeded', async () => {
            const mw = limiter.middleware();
            await mw(req, res, next);
            await mw(req, res, next);
            await mw(req, res, next);
            await mw(req, res, next); // exceeds

            expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(Number));
        });

        test('tracks different IPs separately', async () => {
            const mw = limiter.middleware();
            const req2 = { ip: '192.168.1.1' };

            await mw(req, res, next);
            await mw(req, res, next);
            await mw(req, res, next);

            const next2 = jest.fn();
            await mw(req2, res, next2);
            expect(next2).toHaveBeenCalled();
        });

        test('skips rate limiting when skip function returns true', async () => {
            limiter = new SimpleRateLimiter({
                max: 1,
                skip: () => true
            });
            const mw = limiter.middleware();

            await mw(req, res, next);
            await mw(req, res, next);
            await mw(req, res, next);

            expect(next).toHaveBeenCalledTimes(3);
            expect(res.status).not.toHaveBeenCalledWith(429);
        });

        test('uses custom keyGenerator', async () => {
            limiter = new SimpleRateLimiter({
                max: 2,
                keyGenerator: (r) => `custom:${r.ip}`
            });
            const mw = limiter.middleware();

            await mw(req, res, next);
            await mw(req, res, next);

            expect(limiter.store.has('custom:127.0.0.1')).toBe(true);
        });

        test('resets counter when window expires', async () => {
            limiter = new SimpleRateLimiter({ windowMs: 1, max: 1 });
            const mw = limiter.middleware();

            await mw(req, res, next);

            const entry = limiter.store.get('127.0.0.1');
            entry.resetTime = Date.now() - 1;

            next.mockClear();
            await mw(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        test('sets legacy headers when enabled', async () => {
            limiter = new SimpleRateLimiter({ max: 10, legacyHeaders: true });
            const mw = limiter.middleware();
            await mw(req, res, next);
            expect(res.set).toHaveBeenCalledWith('X-RateLimit-Window', 60000);
            expect(res.set).toHaveBeenCalledWith('X-RateLimit-Current', 1);
        });
    });

    describe('defaultKeyGenerator', () => {
        test('uses req.ip', () => {
            limiter = new SimpleRateLimiter();
            const key = limiter.defaultKeyGenerator({ ip: '1.2.3.4' });
            expect(key).toBe('1.2.3.4');
        });

        test('falls back to connection.remoteAddress', () => {
            limiter = new SimpleRateLimiter();
            const key = limiter.defaultKeyGenerator({
                ip: undefined,
                connection: { remoteAddress: '5.6.7.8' }
            });
            expect(key).toBe('5.6.7.8');
        });

        test('falls back to socket.remoteAddress', () => {
            limiter = new SimpleRateLimiter();
            const key = limiter.defaultKeyGenerator({
                ip: undefined,
                connection: { remoteAddress: undefined },
                socket: { remoteAddress: '9.10.11.12' }
            });
            expect(key).toBe('9.10.11.12');
        });

        test('returns "unknown" when no address available', () => {
            limiter = new SimpleRateLimiter();
            const key = limiter.defaultKeyGenerator({
                ip: undefined,
                connection: { remoteAddress: undefined },
                socket: { remoteAddress: undefined }
            });
            expect(key).toBe('unknown');
        });
    });

    describe('cleanup', () => {
        test('removes expired entries', () => {
            limiter = new SimpleRateLimiter({ windowMs: 60000 });
            // Add an expired entry
            limiter.store.set('expired', {
                hits: 5,
                resetTime: Date.now() - 120000 // expired 2 minutes ago
            });
            // Add a valid entry
            limiter.store.set('valid', {
                hits: 1,
                resetTime: Date.now() + 30000
            });

            limiter.cleanup();

            expect(limiter.store.has('expired')).toBe(false);
            expect(limiter.store.has('valid')).toBe(true);
        });

        test('handles empty store without error', () => {
            limiter = new SimpleRateLimiter();
            expect(() => limiter.cleanup()).not.toThrow();
        });
    });

    // [SEC-6] In-memory store must be size-capped (FIFO eviction) so a
    // high-cardinality IP flood cannot grow memory unboundedly between the
    // 60s cleanup sweeps. Mirrors webhookVerifier's nonce-map hard cap.
    describe('store size cap (SEC-6)', () => {
        test('never exceeds the configured cap when flooded with distinct keys', async () => {
            const cap = 50;
            limiter = new SimpleRateLimiter({ windowMs: 60000, max: 100, maxStoreEntries: cap });
            const mw = limiter.middleware();
            const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

            // Insert far more distinct keys than the cap, all within the window
            // (so the 60s cleanup would NOT remove them — only the cap can).
            for (let i = 0; i < cap * 4; i++) {
                await mw({ ip: `10.0.0.${i}` }, res, jest.fn());
                expect(limiter.store.size).toBeLessThanOrEqual(cap);
            }

            expect(limiter.store.size).toBe(cap);
        });

        test('evicts the oldest entries first (FIFO)', async () => {
            const cap = 10;
            limiter = new SimpleRateLimiter({ windowMs: 60000, max: 100, maxStoreEntries: cap });
            const mw = limiter.middleware();
            const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

            for (let i = 0; i < cap * 2; i++) {
                await mw({ ip: `172.16.0.${i}` }, res, jest.fn());
            }

            // The earliest-inserted keys must have been evicted.
            expect(limiter.store.has('172.16.0.0')).toBe(false);
            // The most-recent keys must still be present.
            expect(limiter.store.has(`172.16.0.${cap * 2 - 1}`)).toBe(true);
        });
    });

    describe('getStats', () => {
        test('returns correct statistics', async () => {
            limiter = new SimpleRateLimiter({ windowMs: 60000, max: 100 });
            const mw = limiter.middleware();
            const req = { ip: '1.1.1.1' };
            const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

            await mw(req, res, jest.fn());
            await mw(req, res, jest.fn());

            const stats = limiter.getStats();
            expect(stats.active_keys).toBe(1);
            expect(stats.total_hits).toBe(2);
            expect(stats.store_size).toBe(1);
            expect(stats.window_ms).toBe(60000);
            expect(stats.max_requests).toBe(100);
        });

        test('excludes expired entries from active count', () => {
            limiter = new SimpleRateLimiter();
            limiter.store.set('expired', { hits: 10, resetTime: Date.now() - 1 });
            limiter.store.set('active', { hits: 5, resetTime: Date.now() + 60000 });

            const stats = limiter.getStats();
            expect(stats.active_keys).toBe(1);
            expect(stats.total_hits).toBe(5);
            expect(stats.store_size).toBe(2); // both still in store
        });
    });

    describe('reset', () => {
        test('clears all stored data', () => {
            limiter = new SimpleRateLimiter();
            limiter.store.set('key1', { hits: 1, resetTime: Date.now() + 60000 });
            limiter.store.set('key2', { hits: 2, resetTime: Date.now() + 60000 });

            limiter.reset();

            expect(limiter.store.size).toBe(0);
        });
    });

    describe('destroy', () => {
        test('clears cleanup interval', () => {
            limiter = new SimpleRateLimiter();
            expect(limiter.cleanupInterval).toBeTruthy();
            limiter.destroy();
            expect(limiter.cleanupInterval).toBeNull();
        });

        test('is safe to call multiple times', () => {
            limiter = new SimpleRateLimiter();
            limiter.destroy();
            expect(() => limiter.destroy()).not.toThrow();
        });
    });
});

describe('SimpleSlowDown', () => {
    let slowDown;

    afterEach(() => {
        if (slowDown) {
            slowDown.destroy();
            slowDown = null;
        }
    });

    describe('constructor', () => {
        test('initializes with default options', () => {
            slowDown = new SimpleSlowDown();
            expect(slowDown.windowMs).toBe(60000);
            expect(slowDown.delayAfter).toBe(50);
            expect(slowDown.delayMs).toBe(500);
            expect(slowDown.maxDelayMs).toBe(5000);
        });
    });

    describe('middleware', () => {
        test('does not delay requests under delayAfter', async () => {
            slowDown = new SimpleSlowDown({ delayAfter: 100, delayMs: 500 });
            const mw = slowDown.middleware();
            const req = { ip: '127.0.0.1' };
            const res = { set: jest.fn() };
            const next = jest.fn();

            await mw(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.set).not.toHaveBeenCalledWith('X-Current-Delay', expect.any(Number));
        });

        test('skips when skip function returns true', async () => {
            slowDown = new SimpleSlowDown({ delayAfter: 1, skip: () => true });
            const mw = slowDown.middleware();
            const req = { ip: '127.0.0.1' };
            const res = { set: jest.fn() };
            const next = jest.fn();

            await mw(req, res, next);
            await mw(req, res, next);
            await mw(req, res, next);

            expect(next).toHaveBeenCalledTimes(3);
        });
    });

    describe('cleanup', () => {
        test('removes expired entries', () => {
            slowDown = new SimpleSlowDown();
            slowDown.store.set('old', { hits: 10, resetTime: Date.now() - 120000 });
            slowDown.cleanup();
            expect(slowDown.store.has('old')).toBe(false);
        });
    });

    // [SEC-6] SimpleSlowDown shares the identical uncapped in-memory Map as
    // SimpleRateLimiter. Its in-memory store must be size-capped (FIFO
    // eviction) so a high-cardinality IP flood cannot grow memory unboundedly
    // between the 60s cleanup sweeps. Mirrors the SimpleRateLimiter cap tests.
    describe('store size cap (SEC-6)', () => {
        test('never exceeds the configured cap when flooded with distinct keys', async () => {
            const cap = 50;
            slowDown = new SimpleSlowDown({ windowMs: 60000, delayAfter: 1000, maxStoreEntries: cap });
            const mw = slowDown.middleware();
            const res = { set: jest.fn() };

            // Insert far more distinct keys than the cap, all within the window
            // (so the 60s cleanup would NOT remove them — only the cap can).
            for (let i = 0; i < cap * 4; i++) {
                await mw({ ip: `10.0.0.${i}` }, res, jest.fn());
                expect(slowDown.store.size).toBeLessThanOrEqual(cap);
            }

            expect(slowDown.store.size).toBe(cap);
        });

        test('evicts the oldest entries first (FIFO)', async () => {
            const cap = 10;
            slowDown = new SimpleSlowDown({ windowMs: 60000, delayAfter: 1000, maxStoreEntries: cap });
            const mw = slowDown.middleware();
            const res = { set: jest.fn() };

            for (let i = 0; i < cap * 2; i++) {
                await mw({ ip: `172.16.0.${i}` }, res, jest.fn());
            }

            // The earliest-inserted keys must have been evicted.
            expect(slowDown.store.has('172.16.0.0')).toBe(false);
            // The most-recent keys must still be present.
            expect(slowDown.store.has(`172.16.0.${cap * 2 - 1}`)).toBe(true);
        });
    });

    describe('destroy', () => {
        test('clears cleanup interval', () => {
            slowDown = new SimpleSlowDown();
            expect(slowDown.cleanupInterval).toBeTruthy();
            slowDown.destroy();
            expect(slowDown.cleanupInterval).toBeNull();
        });
    });
});

describe('Module-level functions', () => {
    test('getAllRateLimitStats returns stats for all limiters', () => {
        const stats = getAllRateLimitStats();
        expect(stats).toHaveProperty('analytics');
        expect(stats).toHaveProperty('analytics_slowdown');
        expect(stats).toHaveProperty('admin');
        expect(stats).toHaveProperty('crud');
        expect(stats).toHaveProperty('telemetry');
        expect(stats).toHaveProperty('auth');
        expect(stats).toHaveProperty('register');
    });

    // smoke test -- verifies no crash on cleanup
    test('resetAllRateLimits does not throw', () => {
        expect(() => resetAllRateLimits()).not.toThrow();
    });

    // smoke test -- verifies no crash on cleanup
    test('destroyAllLimiters does not throw', () => {
        expect(() => destroyAllLimiters()).not.toThrow();
    });
});
