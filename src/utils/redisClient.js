/**
 * Redis client singleton.
 *
 * Optional service: if REDIS_URL is unset/empty, this module returns
 * `null` from getClient() and `false` from isReady() — call sites
 * must fall back to in-memory implementations.
 *
 * Lazy init: the connection isn't opened until the first getClient()
 * call, so importing this module is free during tests.
 *
 * Reconnection: ioredis handles transient connection loss automatically.
 * If the connection becomes unhealthy, isReady() returns false and
 * cache/rate-limiter call sites bypass Redis (degraded mode) instead of
 * blocking on retries.
 */

const Redis = require('ioredis');
const logger = require('./logger');

let client = null;
let connectionAttempted = false;
let healthy = false;

/**
 * [M-7/M-11] Опубликовать состояние Redis метрикой.
 *
 * Флаг `healthy` живёт здесь и здесь же меняется во всех трёх переходах —
 * значит и сигнал наружу должен рождаться здесь, а не у каждого потребителя
 * отдельно. Так деградация видна независимо от того, кто первым напоролся:
 * лимитер, кэш или дедуп вебхуков.
 *
 * Лог гасится флагом, чтобы не залить вывод, — и потому после рестарта повод
 * узнать о деградации исчезал вовсе. Метрика описывает СОСТОЯНИЕ, а не событие:
 * правило `infrasafe_redis_degraded == 1` горит, пока проблема не устранена.
 *
 * require внутри функции намеренно: `observability/metrics` тянет
 * `config/database`, и статический импорт здесь завязал бы клиент Redis на
 * готовность БД при загрузке модуля.
 */
function noteHealth(degraded) {
    try {
        require('../observability/metrics').setRedisDegraded(degraded);
    } catch (err) {
        // Наблюдаемость не имеет права ломать работу с Redis.
        logger.debug(`Redis: не удалось выставить метрику деградации: ${err.message}`);
    }
}

function getRedisUrl() {
    const url = process.env.REDIS_URL;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
}

function init() {
    if (connectionAttempted) return client;
    connectionAttempted = true;

    const url = getRedisUrl();
    if (!url) {
        // debug level — frequent in dev/CI where REDIS_URL is intentionally unset.
        logger.debug('Redis: REDIS_URL not set — falling back to in-memory state (single-replica only)');
        return null;
    }

    try {
        client = new Redis(url, {
            // Don't queue commands during initial connection — fail fast
            // so degraded-mode kicks in immediately if Redis is unreachable.
            enableOfflineQueue: false,
            // Bounded reconnection: 100ms..2s exponential. Beyond 2s we
            // accept that we're operating in degraded mode and stop trying
            // to back-pressure the caller.
            retryStrategy: (times) => Math.min(50 * Math.pow(2, times), 2000),
            // Per-command timeout — if Redis is hung, fall through to
            // memory backing rather than block request lifecycle.
            commandTimeout: 1000,
            maxRetriesPerRequest: 1,
            lazyConnect: false,
        });

        client.on('ready', () => {
            healthy = true;
            noteHealth(false);
            logger.info('Redis: connection ready');
        });
        client.on('error', (err) => {
            // Avoid log flood: only log first error per unhealthy window.
            if (healthy) {
                healthy = false;
                logger.warn(`Redis: connection error — degraded mode (in-memory fallback): ${err.message}`);
            }
            noteHealth(true);
        });
        client.on('end', () => {
            healthy = false;
            noteHealth(true);
        });
        client.on('reconnecting', () => {
            // No log — reconnects can be frequent under load.
        });

        return client;
    } catch (err) {
        logger.warn(`Redis: failed to construct client — degraded mode: ${err.message}`);
        client = null;
        return null;
    }
}

/**
 * Returns the singleton ioredis client, or `null` when Redis is not
 * configured. Always call isReady() before issuing commands — the
 * client may exist but be temporarily disconnected.
 */
function getClient() {
    if (!connectionAttempted) init();
    return client;
}

/**
 * True only when the connection is currently in the 'ready' state.
 * Cache miss / rate-limiter / dedup paths must check this and fall back
 * to in-memory state when false.
 */
function isReady() {
    return healthy && client !== null && client.status === 'ready';
}

/**
 * Graceful shutdown — called from src/server.js SIGTERM handler.
 */
async function close() {
    if (client) {
        try {
            await client.quit();
        } catch {
            client.disconnect();
        }
        client = null;
        healthy = false;
        connectionAttempted = false;
    }
}

module.exports = {
    getClient,
    isReady,
    close,
    // Test seam — swap a mock client without touching env.
    _setClientForTest: (mock) => {
        client = mock;
        connectionAttempted = true;
        healthy = mock !== null && (mock.status === 'ready' || mock.status === undefined);
    },
    _reset: () => {
        if (client && typeof client.disconnect === 'function') {
            try { client.disconnect(); } catch { /* ignore */ }
        }
        client = null;
        connectionAttempted = false;
        healthy = false;
    },
};
