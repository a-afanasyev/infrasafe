'use strict';

/**
 * [Sprint 6 / P0-6] Materialized view refresh scheduler — contract tests.
 *
 * The scheduler must:
 *   - Skip start when disabled via env.
 *   - Call refresh_power_materialized_views() once per tick.
 *   - Skip overlapping ticks when a previous refresh is still in flight.
 *   - Swallow DB errors so a transient failure doesn't crash the loop.
 *   - Stop cleanly (clear all timers).
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock('../../../src/config/database', () => ({
    query: jest.fn(),
    getPool: jest.fn()
}));

const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const { MvRefreshScheduler } = require('../../../src/services/mvRefreshService');

const ORIG_ENV = { ...process.env };

// [R2-25] The advisory lock runs on a checked-out client. This fake models a
// pool client whose pg_try_advisory_lock returns `lockAcquired`; all other
// client.query calls (the unlock) resolve empty. `client.release` is tracked
// so tests can assert the connection is always returned to the pool.
function makeClientMock(lockAcquired = true) {
    const release = jest.fn();
    const query = jest.fn((sql) => {
        if (typeof sql === 'string' && sql.includes('pg_try_advisory_lock')) {
            return Promise.resolve({ rows: [{ locked: lockAcquired }] });
        }
        return Promise.resolve({ rows: [] });
    });
    return { query, release, connect: jest.fn() };
}

describe('MvRefreshScheduler', () => {
    let scheduler;
    let clientMock;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...ORIG_ENV };
        delete process.env.MV_REFRESH_ENABLED;
        delete process.env.MV_REFRESH_INTERVAL_SECONDS;
        // Default: lock is acquired, pool hands out our client mock.
        clientMock = makeClientMock(true);
        db.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(clientMock) });
        scheduler = new MvRefreshScheduler();
    });

    afterEach(async () => {
        await scheduler.stop();
    });

    afterAll(() => {
        process.env = ORIG_ENV;
    });

    test('intervalSeconds defaults to 60', () => {
        expect(scheduler.intervalSeconds()).toBe(60);
    });

    test('intervalSeconds clamps below MIN to 10', () => {
        process.env.MV_REFRESH_INTERVAL_SECONDS = '3';
        expect(scheduler.intervalSeconds()).toBe(10);
    });

    test('intervalSeconds clamps above MAX to 3600', () => {
        process.env.MV_REFRESH_INTERVAL_SECONDS = '999999';
        expect(scheduler.intervalSeconds()).toBe(3600);
    });

    test('intervalSeconds ignores non-numeric values, returns default', () => {
        process.env.MV_REFRESH_INTERVAL_SECONDS = 'not-a-number';
        expect(scheduler.intervalSeconds()).toBe(60);
    });

    test('isEnabled defaults to true', () => {
        expect(scheduler.isEnabled()).toBe(true);
    });

    test.each(['false', 'FALSE', '0', ''])(
        'isEnabled returns false for MV_REFRESH_ENABLED=%p',
        (value) => {
            process.env.MV_REFRESH_ENABLED = value;
            expect(scheduler.isEnabled()).toBe(false);
        }
    );

    test('start() skips when disabled', () => {
        process.env.MV_REFRESH_ENABLED = 'false';
        scheduler.start();
        expect(scheduler._timer).toBeNull();
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('disabled')
        );
    });

    test('start() schedules an interval timer', () => {
        scheduler.start();
        expect(scheduler._timer).not.toBeNull();
    });

    test('start() warns on duplicate start', () => {
        scheduler.start();
        scheduler.start();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('already started')
        );
    });

    test('_tick calls SECURITY DEFINER wrapper once and logs success', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await scheduler._tick();

        expect(db.query).toHaveBeenCalledWith(
            'SELECT public.refresh_mv_transformer_load()'
        );
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('MV refresh succeeded')
        );
    });

    test('_tick acquires the advisory lock, refreshes, then unlocks and releases the client', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await scheduler._tick();

        // Lock acquired then released on the SAME checked-out client.
        expect(clientMock.query).toHaveBeenCalledWith(
            'SELECT pg_try_advisory_lock($1) AS locked',
            [3095635313]
        );
        expect(clientMock.query).toHaveBeenCalledWith(
            'SELECT pg_advisory_unlock($1)',
            [3095635313]
        );
        // Client always returned to the pool.
        expect(clientMock.release).toHaveBeenCalledTimes(1);
    });

    test('_tick skips the refresh when another replica holds the advisory lock', async () => {
        clientMock = makeClientMock(false); // lock NOT acquired
        db.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(clientMock) });
        db.query.mockResolvedValue({ rows: [] });

        await scheduler._tick();

        // Refresh never ran; no unlock (we never held the lock); client released.
        expect(db.query).not.toHaveBeenCalled();
        expect(clientMock.query).not.toHaveBeenCalledWith(
            'SELECT pg_advisory_unlock($1)',
            [3095635313]
        );
        expect(clientMock.release).toHaveBeenCalledTimes(1);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('advisory lock held by another replica')
        );
    });

    test('a lost advisory lock is NOT counted as a failure', async () => {
        clientMock = makeClientMock(false);
        db.getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(clientMock) });

        await scheduler._tick();

        expect(scheduler._consecutiveFailures).toBe(0);
    });

    test('_tick releases the client even when the refresh throws', async () => {
        db.query.mockRejectedValueOnce(new Error('connection refused'));

        await expect(scheduler._tick()).resolves.toBeUndefined();

        // Lock was held → unlock attempted, and the client is released.
        expect(clientMock.query).toHaveBeenCalledWith(
            'SELECT pg_advisory_unlock($1)',
            [3095635313]
        );
        expect(clientMock.release).toHaveBeenCalledTimes(1);
        expect(scheduler._consecutiveFailures).toBe(1);
    });

    test('_tick skips when a previous run is still in progress', async () => {
        // First tick hangs on the advisory-lock acquisition (the first await
        // inside the critical section). _running is set true synchronously at
        // the top of _tick — before any await — so the second, synchronous
        // call sees it and no-ops.
        let releaseLock;
        clientMock.query.mockImplementation((sql) => {
            if (typeof sql === 'string' && sql.includes('pg_try_advisory_lock')) {
                return new Promise(resolve => { releaseLock = () => resolve({ rows: [{ locked: true }] }); });
            }
            return Promise.resolve({ rows: [] });
        });
        db.query.mockResolvedValue({ rows: [] });

        const firstTick = scheduler._tick();
        const secondTick = scheduler._tick();

        await secondTick;
        // Second tick was a no-op — it never reached the pool for a refresh.
        expect(db.query).not.toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('previous run still in progress')
        );

        // Unblock the first tick and let it complete a single refresh.
        releaseLock();
        await firstTick;
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('_tick swallows DB errors and logs', async () => {
        db.query.mockRejectedValueOnce(new Error('connection refused'));

        await expect(scheduler._tick()).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('MV refresh failed')
        );
        expect(scheduler._running).toBe(false);
    });

    test('_consecutiveFailures increments when a tick fails', async () => {
        db.query.mockRejectedValue(new Error('connection refused'));

        await scheduler._tick();
        expect(scheduler._consecutiveFailures).toBe(1);

        await scheduler._tick();
        expect(scheduler._consecutiveFailures).toBe(2);
    });

    test('_consecutiveFailures resets to 0 after a successful tick', async () => {
        db.query.mockRejectedValueOnce(new Error('connection refused'));
        await scheduler._tick();
        expect(scheduler._consecutiveFailures).toBe(1);

        db.query.mockResolvedValueOnce({ rows: [] });
        await scheduler._tick();
        expect(scheduler._consecutiveFailures).toBe(0);
    });

    test('escalates to logger.warn after 5 consecutive failures', async () => {
        db.query.mockRejectedValue(new Error('connection refused'));

        for (let i = 0; i < 5; i++) {
            await scheduler._tick();
        }

        expect(scheduler._consecutiveFailures).toBe(5);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('MV refresh failed')
        );
    });

    test('_tick is a no-op after stop()', async () => {
        await scheduler.stop();
        db.query.mockResolvedValue({ rows: [] });

        await scheduler._tick();

        expect(db.query).not.toHaveBeenCalled();
    });

    test('stop() clears the timer and warmup timer', async () => {
        scheduler.start();
        expect(scheduler._timer).not.toBeNull();
        expect(scheduler._warmupTimer).not.toBeNull();

        await scheduler.stop();

        expect(scheduler._timer).toBeNull();
        expect(scheduler._warmupTimer).toBeNull();
        expect(scheduler._stopped).toBe(true);
    });

    test('stop() is safe when never started', async () => {
        await expect(scheduler.stop()).resolves.toBeUndefined();
    });
});
