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
    query: jest.fn()
}));

const db = require('../../../src/config/database');
const logger = require('../../../src/utils/logger');
const { MvRefreshScheduler } = require('../../../src/services/mvRefreshService');

const ORIG_ENV = { ...process.env };

describe('MvRefreshScheduler', () => {
    let scheduler;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...ORIG_ENV };
        delete process.env.MV_REFRESH_ENABLED;
        delete process.env.MV_REFRESH_INTERVAL_SECONDS;
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

    test('_tick calls refresh function once and logs success', async () => {
        db.query.mockResolvedValue({ rows: [] });

        await scheduler._tick();

        expect(db.query).toHaveBeenCalledWith('SELECT refresh_transformer_analytics()');
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(logger.info).toHaveBeenCalledWith(
            expect.stringContaining('MV refresh succeeded')
        );
    });

    test('_tick skips when a previous run is still in progress', async () => {
        // First tick hangs on the DB call. We start it, then call _tick again
        // synchronously while _running is still true.
        let release;
        db.query.mockImplementationOnce(
            () => new Promise(resolve => { release = resolve; })
        );

        const firstTick = scheduler._tick();
        // _running flips to true synchronously inside _tick BEFORE awaiting
        // db.query, so the next synchronous call sees it.
        const secondTick = scheduler._tick();

        await secondTick;
        // Only the first call to db.query has happened — second tick was a no-op.
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('previous run still in progress')
        );

        release({ rows: [] });
        await firstTick;
    });

    test('_tick swallows DB errors and logs', async () => {
        db.query.mockRejectedValueOnce(new Error('connection refused'));

        await expect(scheduler._tick()).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('MV refresh failed')
        );
        expect(scheduler._running).toBe(false);
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
