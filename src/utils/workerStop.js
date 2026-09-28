'use strict';

/**
 * [N-22] Дождаться окончания идущего тика фонового воркера — с пределом.
 *
 * `stop()` у воркеров снимал таймеры и сразу возвращался, а gracefulShutdown
 * следом закрывал Redis и пул. Тик, пойманный SIGTERM посреди работы, падал на
 * закрытом пуле: у outbox это `markSent` после успешной отправки в УК, и после
 * рестарта событие уходило в УК повторно.
 *
 * Предел обязателен: между SIGTERM и SIGKILL у контейнера 10 с, у
 * gracefulShutdown — свой forceExit через 10 с, и воркеры останавливаются
 * параллельно. Не дождались — пишем об этом и идём дальше: зависший тик не
 * должен превращать штатную остановку в SIGKILL.
 */

const logger = require('./logger');

const STOP_WAIT_MS = 5000;
const POLL_MS = 25;

/**
 * @param {{ _running: boolean }} worker — воркер с флагом идущего тика
 * @param {string} name — имя для лога
 * @param {number} [timeoutMs=STOP_WAIT_MS]
 * @returns {Promise<boolean>} true — тик закончился (или его не было)
 */
async function waitForIdle(worker, name, timeoutMs = STOP_WAIT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (worker._running) {
        if (Date.now() >= deadline) {
            logger.warn(`${name}: остановка не дождалась идущего тика за ${timeoutMs} мс`);
            return false;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return true;
}

module.exports = { waitForIdle, STOP_WAIT_MS };
