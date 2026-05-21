/**
 * [Sprint 4] Rate-limiter Redis backing — contract tests.
 *
 * The rate-limiter must:
 *   - Prefer Redis when isReady() is true.
 *   - Fall back to in-memory Map when Redis is degraded or absent.
 *   - Namespace Redis keys so two limiter instances don't collide.
 *   - Survive Redis throwing — middleware should still call next().
 */

'use strict';

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

describe('[Sprint 4] SimpleRateLimiter — Redis path', () => {
    let SimpleRateLimiter;
    let redisClient;

    beforeEach(() => {
        jest.resetModules();
        delete process.env.REDIS_URL;
        ({ SimpleRateLimiter } = require('../../../src/middleware/rateLimiter'));
        redisClient = require('../../../src/utils/redisClient');
    });

    afterEach(() => {
        redisClient._reset();
    });

    function makeMockClient({ incrReturn = 1, pttlReturn = -1 } = {}) {
        const mock = {
            status: 'ready',
            multi: jest.fn(),
            pexpire: jest.fn().mockResolvedValue(1),
        };
        mock.multi.mockReturnValue({
            incr: jest.fn().mockReturnThis(),
            pttl: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([[null, incrReturn], [null, pttlReturn]]),
        });
        return mock;
    }

    test('uses Redis INCR when isReady()', async () => {
        const mock = makeMockClient({ incrReturn: 1, pttlReturn: -1 });
        redisClient._setClientForTest(mock);

        const limiter = new SimpleRateLimiter({ max: 5, windowMs: 1000, namespace: 'test1' });
        const req = { ip: '1.1.1.1' };
        const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await limiter.middleware()(req, res, next);

        expect(mock.multi).toHaveBeenCalled();
        expect(mock.pexpire).toHaveBeenCalledWith(expect.stringMatching(/^ratelimit:test1:1\.1\.1\.1$/), 1000);
        expect(next).toHaveBeenCalled();
    });

    test('blocks at max hits via Redis path', async () => {
        const mock = makeMockClient({ incrReturn: 6, pttlReturn: 500 });
        redisClient._setClientForTest(mock);

        const limiter = new SimpleRateLimiter({ max: 5, windowMs: 1000, namespace: 'test2' });
        const req = { ip: '1.1.1.1' };
        const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await limiter.middleware()(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(next).not.toHaveBeenCalled();
    });

    test('falls back to Map when Redis isReady() is false', async () => {
        // No mock installed → isReady() = false → fall back to memory.
        const limiter = new SimpleRateLimiter({ max: 3, windowMs: 1000, namespace: 'test3' });
        const req = { ip: '2.2.2.2' };
        const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await limiter.middleware()(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(limiter.store.size).toBe(1); // memory store populated
    });

    test('falls back to Map when Redis throws', async () => {
        const failingClient = {
            status: 'ready',
            multi: jest.fn().mockReturnValue({
                incr: jest.fn().mockReturnThis(),
                pttl: jest.fn().mockReturnThis(),
                exec: jest.fn().mockRejectedValue(new Error('Redis down')),
            }),
        };
        redisClient._setClientForTest(failingClient);

        const limiter = new SimpleRateLimiter({ max: 3, windowMs: 1000, namespace: 'test4' });
        const req = { ip: '3.3.3.3' };
        const res = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        await limiter.middleware()(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(limiter.store.size).toBe(1); // memory fallback used
    });

    test('namespace prevents key collisions across instances', () => {
        const a = new SimpleRateLimiter({ namespace: 'aaa' });
        const b = new SimpleRateLimiter({ namespace: 'bbb' });
        expect(a.namespace).toBe('aaa');
        expect(b.namespace).toBe('bbb');
        expect(a.namespace).not.toBe(b.namespace);
    });
});
