'use strict';

/**
 * [A12-10] Очистка журнала интеграции с УК по сроку хранения.
 *
 * `integration_log` рос бессрочно. Раз в сутки (и вскоре после старта —
 * процесс перезапускается при каждой выкатке, и «только раз в сутки» могло бы
 * не наступить никогда) удаляются строки старше срока.
 *
 * Срок — 90 дней по умолчанию, `INTEGRATION_LOG_RETENTION_DAYS`, но не меньше
 * 30: журнал держит дедупликацию `event_id` (UNIQUE), и после удаления строки
 * повторная доставка того же события была бы обработана заново. Нижняя граница
 * не даёт опечатке в переменной обнулить эту защиту.
 *
 * Форма — как у часовой уборки в authService (`setInterval` + `unref`), без
 * advisory-лока: DELETE по возрасту идемпотентен, две реплики, запустившие его
 * одновременно, ничего не ломают.
 */

const IntegrationLog = require('../../models/IntegrationLog');
const logger = require('../../utils/logger');
const envFlags = require('../../utils/envFlags');
const { waitForIdle } = require('../../utils/workerStop');

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const WARMUP_DELAY_MS = 60 * 1000;

class IntegrationLogRetention {
    constructor() {
        this._timer = null;
        this._warmupTimer = null;
        this._running = false;
        this._stopped = false;
    }

    retentionDays() {
        const raw = Number(process.env.INTEGRATION_LOG_RETENTION_DAYS);
        if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RETENTION_DAYS;
        return Math.min(Math.max(Math.floor(raw), MIN_RETENTION_DAYS), MAX_RETENTION_DAYS);
    }

    isEnabled() {
        return envFlags.isEnabled('INTEGRATION_LOG_RETENTION_ENABLED', true);
    }

    start() {
        if (!this.isEnabled()) {
            logger.info('Очистка integration_log выключена через INTEGRATION_LOG_RETENTION_ENABLED');
            return;
        }
        if (this._timer) {
            logger.warn('Очистка integration_log уже запущена — повторный start пропущен');
            return;
        }
        this._stopped = false;
        logger.info(`Очистка integration_log стартует (срок хранения ${this.retentionDays()} дн.)`);

        this._warmupTimer = setTimeout(() => { void this._tick(); }, WARMUP_DELAY_MS);
        this._warmupTimer.unref();

        this._timer = setInterval(() => { void this._tick(); }, INTERVAL_MS);
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
        }
        await waitForIdle(this, 'Очистка integration_log');
    }

    async _tick() {
        if (this._stopped || this._running) return;
        this._running = true;
        try {
            const days = this.retentionDays();
            const deleted = await IntegrationLog.deleteOlderThan(days);
            if (deleted > 0) {
                logger.info(`integration_log: удалено ${deleted} строк старше ${days} дн.`);
            }
        } catch (err) {
            // Никогда не пробрасываем: сбой уборки не должен ронять процесс,
            // следующий проход — через сутки или после рестарта.
            logger.error(`Очистка integration_log не выполнена: ${err.message}`);
        } finally {
            this._running = false;
        }
    }
}

module.exports = new IntegrationLogRetention();
