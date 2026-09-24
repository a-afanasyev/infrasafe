'use strict';

/**
 * Возврат выделенного клиента pg в пул — с учётом того, в каком состоянии он.
 *
 * Клиент, взятый через `pool.connect()`, несёт состояние СЕССИИ: открытую
 * транзакцию, сессионные advisory-локи. Если убрать это состояние не удалось,
 * возвращать соединение в пул нельзя — следующий, ни в чём не повинный
 * пользователь получит его вместе с мусором. Такой клиент помечается, и
 * `releaseClient` передаёт pg ошибку, что заставляет пул уничтожить соединение.
 *
 * Два источника пометки:
 *   - [CO-2] упавший ROLLBACK (`config/database.js#safeRollback`) — соединение в
 *     «current transaction is aborted»;
 *   - [N-21] упавший `pg_advisory_unlock` — соединение держит сессионный лок, и
 *     тики воркера на других соединениях молча пропускаются как «лок у другой
 *     реплики». Уничтожение соединения лок освобождает.
 *
 * Модуль отдельный от `config/database.js` намеренно: тесты воркеров мокают
 * `config/database`, а поведение возврата в пул — не то, что мок должен
 * подменять молча.
 */

const logger = require('./logger');

const DISCARD = Symbol('pgClient.discard');

/**
 * Пометить клиент как непригодный к возврату в пул. Первая причина сохраняется.
 *
 * @param {object} client — клиент pg из `pool.connect()`
 * @param {Error} reason
 */
function markForDiscard(client, reason) {
    if (!client[DISCARD]) client[DISCARD] = reason;
}

/**
 * Вернуть клиент в пул; помеченный — уничтожить.
 *
 * @param {object} client
 */
function releaseClient(client) {
    client.release(client[DISCARD] || undefined);
}

/**
 * Снять сессионный advisory-лок. Ошибка не пробрасывается (вызов стоит в
 * `finally`, и исходная ошибка тика важнее), но клиент помечается на
 * уничтожение, и это видно в логе.
 *
 * @param {object} client
 * @param {number} key
 * @param {string} context — имя воркера для лога
 * @returns {Promise<boolean>} true — лок снят
 */
async function unlockAdvisory(client, key, context) {
    try {
        await client.query('SELECT pg_advisory_unlock($1)', [key]);
        return true;
    } catch (error) {
        markForDiscard(client, error);
        logger.warn(`${context}: advisory_unlock failed, соединение будет уничтожено: ${error.message}`);
        return false;
    }
}

module.exports = { markForDiscard, releaseClient, unlockAdvisory };
