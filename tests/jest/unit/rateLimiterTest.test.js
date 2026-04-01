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

        test('allows requests under the limit', () => {
            const mw = limiter.middleware();
            mw(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        test('sets rate limit headers', () => {
            const mw = limiter.middleware();
            mw(req, res, next);
            expect(res.set).toHaveBeenCalledWith('X-RateLimit-Limit', 3);
            expect(res.set).toHaveBeenCalledWith('X-RateLimit-Remaining', 2);
        });

        test('blocks requests over the limit', () => {
            const mw = limiter.middleware();
            mw(req, res, next); // 1
            mw(req, res, next); // 2
            mw(req, res, next); // 3

            next.mockClear();
            res.status.mockClear();

            mw(req, res, next); // 4 - exceeds limit of 3
            expect(res.status).toHaveBeenCalledWith(429);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    error: 'RATE_LIMIT_EXCEEDED'
                })
            );
            expect(next).not.toHaveBeenCalled();
        });

        test('sets Retry-After header when limit exceeded', () => {
            const mw = limiter.middleware();
            mw(req, res, next);
            mw(req, res, next);
            mw(req, res, next);
            mw(req, res, next); // exceeds

            expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(Number));
        });

        test('tracks different IPs separately', () => {
            const mw = limiter.middleware();
            const req2 = { ip: '192.168.1.1' };

            // Max out first IP
            mw(req, res, next);
            mw(req, res, next);
            mw(req, res, next);

            // Second IP should still work
            const next2 = jest.fn();
            mw(req2, res, next2);
            expect(next2).toHaveBeenCalled();
        });

        test('skips rate limiting when skip function returns true', () => {
            limiter = new SimpleRateLimiter({
                max: 1,
                skip: () => true
            });
            const mw = limiter.middleware();

            mw(req, res, next);
            mw(req, res, next);
            mw(req, res, next); // All should pass

            expect(next).toHaveBeenCalledTimes(3);
            expect(res.status).not.toHaveBeenCalledWith(429);
        });

        test('uses custom keyGenerator', () => {
            limiter = new SimpleRateLimiter({
                max: 2,
                keyGenerator: (r) => `custom:${r.ip}`
            });
            const mw = limiter.middleware();

            mw(req, res, next);
            mw(req, res, next);

            expect(limiter.store.has('custom:127.0.0.1')).toBe(true);
        });

        test('resets counter when window expires', () => {
            limiter = new SimpleRateLimiter({ windowMs: 1, max: 1 });
            const mw = limiter.middleware();

            mw(req, res, next); // 1 - allowed

            // Manually expire the window
            const entry = limiter.store.get('127.0.0.1');
            entry.resetTime = Date.now() - 1;

            next.mockClear();
            mw(req, res, next); // should be allowed (window expired)
            expect(next).toHaveBeenCalled();
        });

        test('sets legacy headers when enabled', () => {
            limiter = new SimpleRateLimiter({ max: 10, legacyHeaders: true });
            const mw = limiter.middleware();
            mw(req, res, next);
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

    describe('getStats', () => {
        test('returns correct statistics', () => {
            limiter = new SimpleRateLimiter({ windowMs: 60000, max: 100 });
            const mw = limiter.middleware();
            const req = { ip: '1.1.1.1' };
            const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };

            mw(req, res, jest.fn());
            mw(req, res, jest.fn());

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
