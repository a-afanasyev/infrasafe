'use strict';

/**
 * Materialized view refresh scheduler — Sprint 6 / P0-6.
 *
 * `mv_transformer_load_realtime` (the live transformer-load analytics view)
 * was never refreshed automatically — dashboards showed stale data the
 * moment a controller pushed a new metric. This scheduler closes that
 * hole by calling a dedicated SECURITY DEFINER wrapper —
 * `refresh_mv_transformer_load()` — added by migration 020.
 *
 * Why a wrapper rather than `REFRESH MATERIALIZED VIEW CONCURRENTLY`
 * directly: the app connects as `infrasafe_runtime`, which deliberately
 * does NOT own materialized views (per migration 017). A direct REFRESH
 * fails with `must be owner of materialized view`. The wrapper is
 * SECURITY DEFINER, owned by the bootstrap user (which owns the MV), so
 * it bypasses ownership while EXECUTE is granted only to the runtime role.
 *
 * Why not the pre-existing `refresh_transformer_analytics()` helper:
 * that one also INSERTs an audit row into `public.logs`, which is
 * partitioned by date with no auto-partition creation. A missing
 * partition raises and masks the fact that REFRESH itself succeeded.
 *
 * The earlier `refresh_power_materialized_views()` function from migration
 * 003_v2 (which would have refreshed building/line MVs too) was never
 * applied — the building/line MVs were dropped by migration 012, leaving
 * only `mv_transformer_load_realtime`. If those MVs are reinstated later,
 * extend the wrapper function with additional REFRESH statements.
 *
 * Design:
 * - Singleton — one timer per process. Multi-replica safety is provided by a
 *   cross-replica Postgres advisory lock ([R2-25], mirrors ukOutboxService /
 *   alertVerificationService): each tick tries `pg_try_advisory_lock` on one
 *   checked-out client; if another replica already holds it, the tick is a
 *   quiet no-op. The in-process `_running` mutex still guards intra-process
 *   overlap.
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

// [R2-25] Cross-replica advisory lock key. Deterministic so every replica
// contends on the same lock; the exact value only needs to be stable and
// distinct from the other schedulers' keys (ukOutbox=1187807153,
// alertVerification=849608648).
//   crypto.createHash('sha256').update('infrasafe.mv_transformer_load_refresh')
//     .digest().readUInt32BE(0)  → 0xb883a571 → 3095635313
const ADVISORY_LOCK_KEY = 3095635313;

// [Sprint 7 / H2] Failure-log throttling. The first failure logs in full;
// while failures persist, repeat the log at most once per window so a
// sustained outage doesn't flood the log at one line per tick.
const FAILURE_LOG_THROTTLE_MS = 10 * 60 * 1000; // 10 minutes
// After this many consecutive failures the condition is no longer
// transient — escalate the throttled log from error to warn.
const FAILURE_ESCALATE_THRESHOLD = 5;

class MvRefreshScheduler {
    constructor() {
        this._timer = null;
        this._warmupTimer = null;
        this._running = false;
        this._stopped = false;
        // [Sprint 7 / H2] Consecutive-failure tracking for log backoff.
        this._consecutiveFailures = 0;
        this._lastFailureLogAt = 0;
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
            // [R2-25] Acquire + release the cross-replica advisory lock on ONE
            // checked-out client. Session-scoped advisory locks are bound to the
            // physical connection, so lock and unlock must run on the same
            // client (going through the pool wrapper would land them on
            // arbitrary connections and leak the lock). The refresh itself stays
            // on the pool (db.query) — it only needs the lock to be HELD, which
            // it is for the whole tick via this client's session. Auto-releases
            // if the process dies (the backend session closes).
            const client = await db.getPool().connect();
            let locked = false;
            try {
                const lockResult = await client.query(
                    'SELECT pg_try_advisory_lock($1) AS locked',
                    [ADVISORY_LOCK_KEY]
                );
                locked = lockResult.rows[0] && lockResult.rows[0].locked === true;
                if (!locked) {
                    // Another replica is refreshing; quiet skip. Not a failure —
                    // leave the consecutive-failure counter untouched.
                    logger.debug('MV refresh skipped — advisory lock held by another replica');
                    return;
                }

                await db.query('SELECT public.refresh_mv_transformer_load()');
                const durationMs = Date.now() - startedAt;
                this._consecutiveFailures = 0;
                this._lastFailureLogAt = 0;
                logger.info(`MV refresh succeeded in ${durationMs}ms`);
            } finally {
                if (locked) {
                    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
                        logger.warn(`MV refresh: advisory_unlock failed: ${err.message}`);
                    });
                }
                client.release();
            }
        } catch (err) {
            const durationMs = Date.now() - startedAt;
            // Never rethrow — the scheduler must keep ticking. A failed
            // refresh leaves the previous (slightly stale) snapshot in place,
            // which is strictly better than crashing the app.
            this._consecutiveFailures += 1;
            this._logFailure(err, durationMs);
        } finally {
            this._running = false;
        }
    }

    /**
     * [Sprint 7 / H2] Log a failed refresh with backoff. A line is emitted
     * on the first failure, on the tick that crosses the escalation
     * threshold, and at most once per FAILURE_LOG_THROTTLE_MS otherwise —
     * so a sustained outage doesn't flood the log at one line per tick.
     * Once failures stop being transient the line is elevated from error
     * to warn.
     */
    _logFailure(err, durationMs) {
        const now = Date.now();
        const isFirst = this._consecutiveFailures === 1;
        const justEscalated = this._consecutiveFailures === FAILURE_ESCALATE_THRESHOLD;
        const windowElapsed = (now - this._lastFailureLogAt) >= FAILURE_LOG_THROTTLE_MS;
        if (!isFirst && !justEscalated && !windowElapsed) {
            return;
        }
        this._lastFailureLogAt = now;
        const msg = `MV refresh failed after ${durationMs}ms `
            + `(consecutive failures: ${this._consecutiveFailures}): ${err.message}`;
        if (this._consecutiveFailures >= FAILURE_ESCALATE_THRESHOLD) {
            logger.warn(msg);
        } else {
            logger.error(msg);
        }
    }
}

const singleton = new MvRefreshScheduler();

module.exports = singleton;
module.exports.MvRefreshScheduler = MvRefreshScheduler;
