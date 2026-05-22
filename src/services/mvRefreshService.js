'use strict';

/**
 * Materialized view refresh scheduler — Sprint 6 / P0-6.
 *
 * `mv_transformer_load_realtime` (the live transformer-load analytics view)
 * was never refreshed automatically — dashboards showed stale data the
 * moment a controller pushed a new metric. This scheduler closes that
 * hole by calling `refresh_transformer_analytics()` (defined in init schema)
 * which wraps `REFRESH MATERIALIZED VIEW CONCURRENTLY` + writes an entry
 * to `public.logs` so DBAs see refresh history.
 *
 * The earlier `refresh_power_materialized_views()` function from migration
 * 003_v2 (which would have refreshed building/line MVs too) was never
 * applied — the building/line MVs were dropped by migration 012, leaving
 * only `mv_transformer_load_realtime`. If those MVs are reinstated later,
 * extend `_tick()` to call additional REFRESH statements.
 *
 * Design:
 * - Singleton — one timer per process. Multi-replica safety is delegated
 *   to a future advisory-lock guard (tracked as a follow-up); on a single
 *   replica the singleton is sufficient.
 * - `REFRESH MATERIALIZED VIEW CONCURRENTLY` is non-blocking for readers,
 *   so we can run on a tight interval without freezing queries.
 * - In-flight mutex (`_running`) prevents overlap when a refresh takes
 *   longer than the interval — we skip the tick instead of queueing.
 * - `timer.unref()` lets the Node event loop exit if other work has
 *   stopped (e.g. tests), so the scheduler doesn't keep the process up.
 * - Env controls: MV_REFRESH_ENABLED (default true), MV_REFRESH_INTERVAL_SECONDS
 *   (default 60, clamped to [10, 3600]).
 */

const db = require('../config/database');
const logger = require('../utils/logger');

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 3600;
const WARMUP_DELAY_MS = 5000;

class MvRefreshScheduler {
    constructor() {
        this._timer = null;
        this._warmupTimer = null;
        this._running = false;
        this._stopped = false;
    }

    intervalSeconds() {
        const raw = Number(process.env.MV_REFRESH_INTERVAL_SECONDS);
        if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_SECONDS;
        return Math.min(Math.max(Math.floor(raw), MIN_INTERVAL_SECONDS), MAX_INTERVAL_SECONDS);
    }

    isEnabled() {
        const flag = (process.env.MV_REFRESH_ENABLED ?? 'true').toString().toLowerCase();
        return flag !== 'false' && flag !== '0' && flag !== '';
    }

    start() {
        if (!this.isEnabled()) {
            logger.info('MV refresh scheduler disabled via MV_REFRESH_ENABLED');
            return;
        }
        if (this._timer) {
            logger.warn('MV refresh scheduler already started — skipping duplicate start');
            return;
        }
        this._stopped = false;
        const intervalSec = this.intervalSeconds();
        logger.info(`MV refresh scheduler starting (interval=${intervalSec}s)`);

        // First run after a small warmup so we don't contend with app startup.
        this._warmupTimer = setTimeout(() => { void this._tick(); }, WARMUP_DELAY_MS);
        this._warmupTimer.unref();

        this._timer = setInterval(() => { void this._tick(); }, intervalSec * 1000);
        this._timer.unref();
    }

    async stop() {
        this._stopped = true;
        if (this._warmupTimer) {
            clearTimeout(this._warmupTimer);
            this._warmupTimer = null;
        }
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            logger.info('MV refresh scheduler stopped');
        }
    }

    async _tick() {
        if (this._stopped) return;
        if (this._running) {
            // Previous refresh is still running — skip; don't queue overlap.
            logger.debug('MV refresh skipped — previous run still in progress');
            return;
        }
        this._running = true;
        const startedAt = Date.now();
        try {
            await db.query('SELECT refresh_transformer_analytics()');
            const durationMs = Date.now() - startedAt;
            logger.info(`MV refresh succeeded in ${durationMs}ms`);
        } catch (err) {
            const durationMs = Date.now() - startedAt;
            // Never rethrow — the scheduler must keep ticking. A failed
            // refresh leaves the previous (slightly stale) snapshot in place,
            // which is strictly better than crashing the app.
            logger.error(`MV refresh failed after ${durationMs}ms: ${err.message}`);
        } finally {
            this._running = false;
        }
    }
}

const singleton = new MvRefreshScheduler();

module.exports = singleton;
module.exports.MvRefreshScheduler = MvRefreshScheduler;
