'use strict';

/**
 * [AR-21] Планировщик перевода молчащих контроллеров в offline.
 *
 * Логика «контроллер молчит больше 10 минут → offline» жила в
 * `controllerService.updateControllersStatusByActivity` с самого начала.
 * Вызывал её ровно один вход — admin-эндпоинт
 * `POST /api/controllers/update-status`, то есть кнопка, которую надо нажать
 * руками. По расписанию не вызывал никто.
 *
 * ⚠️ Поправка (12.08.2026). Здесь стояло «корректная и покрытая тестами». Это
 * было неверно: запрос писал в несуществующий столбец `updated_at` и падал
 * при каждом вызове — то есть функция не работала никогда. Юнит-тесты этого
 * не ловили, потому что БД в них замокана. Вскрылось на первом же тике этого
 * планировщика на проде; починено там же, проверка переехала на живую схему
 * в tests/jest/db/controllerStatus.db.test.js.
 *
 * Пока телеметрии нет, дыра невидима: переводить в offline нечего. Она
 * проявится в первый же день после подключения железа — контроллер замолчит,
 * а карта будет показывать его зелёным, пока кто-нибудь не заметит и не
 * нажмёт кнопку. Поэтому закрывается ДО приезда контроллеров.
 *
 * Форма скопирована с `mvRefreshService` осознанно: синглтон, cross-replica
 * advisory-лок, env-гейт, `unref()` на таймерах, тик никогда не бросает.
 * Четвёртый воркер в системе — не место для четвёртой архитектуры; сходство
 * даёт предсказуемость, когда его придётся разбирать в три часа ночи.
 *
 * Почему интервал 120 с при окне в 600 с: контроллер, замолчавший сразу после
 * тика, обязан быть замечен максимум через 600 + interval секунд. При равном
 * интервале задержка удваивалась бы, при слишком частом — впустую гоняли бы
 * запрос. Пятая часть окна даёт запас в 20 % от времени обнаружения.
 */

const db = require('../config/database');
const logger = require('../utils/logger');
const controllerService = require('./controllerService');

const DEFAULT_INTERVAL_SECONDS = 120;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 3600;
const WARMUP_DELAY_MS = 7000;

// Cross-replica advisory-лок. Значение обязано быть стабильным и отличным от
// ключей остальных воркеров (mvRefresh=3095635313, ukOutbox=1187807153,
// alertVerification=849608648):
//   crypto.createHash('sha256').update('infrasafe.controller_status_activity')
//     .digest().readUInt32BE(0)  → 2419108163
const ADVISORY_LOCK_KEY = 2419108163;

const FAILURE_LOG_THROTTLE_MS = 10 * 60 * 1000;

class ControllerStatusScheduler {
    constructor() {
        this._timer = null;
        this._warmupTimer = null;
        this._running = false;
        this._stopped = false;
        this._consecutiveFailures = 0;
        this._lastFailureLogAt = 0;
    }

    intervalSeconds() {
        const raw = Number(process.env.CONTROLLER_STATUS_INTERVAL_SECONDS);
        if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_SECONDS;
        return Math.min(Math.max(Math.floor(raw), MIN_INTERVAL_SECONDS), MAX_INTERVAL_SECONDS);
    }

    isEnabled() {
        const flag = (process.env.CONTROLLER_STATUS_SCHEDULER_ENABLED ?? 'true')
            .toString().toLowerCase();
        return flag !== 'false' && flag !== '0' && flag !== '';
    }

    start() {
        if (!this.isEnabled()) {
            logger.info('Планировщик статуса контроллеров выключен через CONTROLLER_STATUS_SCHEDULER_ENABLED');
            return;
        }
        if (this._timer) {
            logger.warn('Планировщик статуса контроллеров уже запущен — повторный start пропущен');
            return;
        }
        this._stopped = false;
        const intervalSec = this.intervalSeconds();
        logger.info(`Планировщик статуса контроллеров стартует (интервал ${intervalSec} с)`);

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
            logger.info('Планировщик статуса контроллеров остановлен');
        }
    }

    async _tick() {
        if (this._stopped) return;
        if (this._running) {
            logger.debug('Пересчёт статусов пропущен — предыдущий ещё идёт');
            return;
        }
        this._running = true;
        const startedAt = Date.now();
        try {
            // Лок берётся и снимается на ОДНОМ выделенном соединении: advisory-лок
            // сессионный, то есть привязан к физическому подключению. Через пул
            // захват и освобождение попали бы на разные соединения, и лок утёк бы
            // до конца жизни процесса. Тот же приём в mvRefreshService.
            const client = await db.getPool().connect();
            let locked = false;
            try {
                const lockResult = await client.query(
                    'SELECT pg_try_advisory_lock($1) AS locked',
                    [ADVISORY_LOCK_KEY]
                );
                locked = lockResult.rows[0] && lockResult.rows[0].locked === true;
                if (!locked) {
                    // Другая реплика уже пересчитывает. Не отказ — счётчик
                    // последовательных сбоев не трогаем.
                    logger.debug('Пересчёт статусов пропущен — лок держит другая реплика');
                    return;
                }

                const updated = await controllerService.updateControllersStatusByActivity();
                this._consecutiveFailures = 0;
                this._lastFailureLogAt = 0;
                // На здоровой системе менять почти всегда нечего, и лог на каждый
                // тик был бы шумом. Пишем, только когда статусы реально сдвинулись.
                if (updated > 0) {
                    logger.info(`Статус контроллеров пересчитан: изменено ${updated} за ${Date.now() - startedAt} мс`);
                } else {
                    logger.debug(`Статус контроллеров пересчитан: изменений нет (${Date.now() - startedAt} мс)`);
                }
            } finally {
                if (locked) {
                    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch((err) => {
                        logger.warn(`Пересчёт статусов: advisory_unlock не выполнен: ${err.message}`);
                    });
                }
                client.release();
            }
        } catch (err) {
            // Никогда не пробрасываем: одна сетевая икота не должна навсегда
            // выключить перевод контроллеров в offline.
            this._consecutiveFailures += 1;
            const now = Date.now();
            if (now - this._lastFailureLogAt >= FAILURE_LOG_THROTTLE_MS || this._consecutiveFailures === 1) {
                this._lastFailureLogAt = now;
                logger.error(
                    `Пересчёт статусов контроллеров не выполнен (подряд: ${this._consecutiveFailures}): ${err.message}`
                );
            }
        } finally {
            this._running = false;
        }
    }
}

module.exports = new ControllerStatusScheduler();
