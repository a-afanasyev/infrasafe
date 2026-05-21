/**
 * [Sprint 4] redisClient utility — degraded-mode tests.
 *
 * The hot path of every consumer (rate-limiter, cache, dedup) is:
 *   if (client && redisClient.isReady()) { use Redis } else { fallback }
 *
 * These tests pin the contract:
 *   - Without REDIS_URL, getClient() returns null and isReady() returns false.
 *   - With a mock client injected, isReady() reflects its `status`.
 *   - _reset() returns the module to its initial unconfigured state.
 */

'use strict';

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

describe('redisClient utility', () => {
    let redisClient;

    beforeEach(() => {
        jest.resetModules();
        delete process.env.REDIS_URL;
        redisClient = require('../../../src/utils/redisClient');
    });

    afterEach(() => {
        redisClient._reset();
    });

    test('getClient returns null when REDIS_URL is unset', () => {
        expect(redisClient.getClient()).toBeNull();
    });

    test('isReady returns false when client is null', () => {
        expect(redisClient.isReady()).toBe(false);
    });

    test('_setClientForTest installs a mock that survives isReady()', () => {
        const mock = { status: 'ready', quit: jest.fn() };
        redisClient._setClientForTest(mock);

        expect(redisClient.getClient()).toBe(mock);
        expect(redisClient.isReady()).toBe(true);
    });

    test('isReady reflects status=connecting (not ready)', () => {
        const mock = { status: 'connecting' };
        redisClient._setClientForTest(mock);

        // ioredis status `connecting` !== `ready` → not usable.
        expect(redisClient.isReady()).toBe(false);
    });

    test('_reset clears mock and returns to initial state', () => {
        redisClient._setClientForTest({ status: 'ready' });
        redisClient._reset();

        expect(redisClient.getClient()).toBeNull();
        expect(redisClient.isReady()).toBe(false);
    });

    test('close() is safe when no client is configured', async () => {
        await expect(redisClient.close()).resolves.toBeUndefined();
    });

    test('close() calls quit on a mock client and clears state', async () => {
        const mock = { status: 'ready', quit: jest.fn().mockResolvedValue('OK') };
        redisClient._setClientForTest(mock);

        await redisClient.close();

        expect(mock.quit).toHaveBeenCalled();
        expect(redisClient.getClient()).toBeNull();
        expect(redisClient.isReady()).toBe(false);
    });
});
