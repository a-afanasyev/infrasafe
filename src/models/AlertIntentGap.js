'use strict';

/**
 * [A-03, вторая половина] Разрыв между открытым алертом и намерением отправить
 * заявку в УК.
 *
 * Первая половина находки (PR #237) закрыла окно ВНУТРИ пары «намерение +
 * очередь»: обе записи идут одной транзакцией. Но окно осталось РАНЬШЕ этой
 * пары. `alertService.createAlert` коммитит строку в `infrastructure_alerts`, и
 * только потом `sendNotifications` эмитит `ALERT_CREATED`; слушатель
 * `alertForwarder` живёт в том же процессе. Падение (или рестарт контейнера)
 * между коммитом и слушателем оставляет активную аварию БЕЗ строки в
 * `alert_request_map` — и это состояние необратимо само по себе: повторный
 * алерт душит дедуп по паре {инфраструктура, тип}, а drain-воркер умеет
 * доставлять существующие строки очереди, но не восстанавливать отсутствующие.
 *
 * Эта модель владеет двумя запросами сверяющего прохода:
 *   - findOrphans   — открытые алерты без единой строки намерения;
 *   - recordAttempt — отметка попытки в `data.uk_reconcile`.
 *
 * Отметка живёт в `data` (JSONB), а не в отдельной колонке, намеренно: там же
 * уже лежит `notification_failures`, оператор видит её в карточке алерта, и
 * миграции для этого не нужно. Цена — запись читается выражением, а не
 * колонкой; объём прохода это выдерживает (десятки строк в сутки).
 */

const db = require('../config/database');
const logger = require('../utils/logger');

// Статусы, при которых заявка в УК ещё имеет смысл. Совпадают с
// `requestProcessor._isAlertStillOpen`: `resolved_verifying` — переходное
// состояние ПОСЛЕ устранения, `engineer_required` идёт своим путём эскалации,
// и заводить на них свежий `alert.created` было бы дублем, а не починкой.
const OPEN_STATUSES = Object.freeze(['active', 'acknowledged']);

class AlertIntentGap {
    /**
     * Открытые алерты без строки в `alert_request_map`.
     *
     * Все четыре ограничения — часть поведения, а не оптимизация:
     *   graceSeconds — не трогать алерт, пока слушатель может быть в полёте
     *                  (иначе проход сам создаёт дубли);
     *   maxAgeHours  — не воскрешать старьё: заявка по суточной аварии УК уже
     *                  не поможет, а поток тикетов после долгого простоя — вред;
     *   maxAttempts  — верхняя граница для патологии, которую мы не предвидели;
     *   limit        — размер пачки за тик, чтобы проход не бурстил в УК.
     */
    static async findOrphans({ graceSeconds, maxAgeHours, maxAttempts, limit }) {
        try {
            const result = await db.query(
                `SELECT ia.alert_id,
                        ia.type,
                        ia.infrastructure_id,
                        ia.infrastructure_type,
                        ia.severity,
                        ia.message,
                        ia.created_at,
                        ia.reopen_chain_id,
                        ia.reopen_sequence,
                        ia.previous_uk_request_number,
                        COALESCE((ia.data->'uk_reconcile'->>'attempts')::int, 0) AS reconcile_attempts
                   FROM infrastructure_alerts ia
                  WHERE ia.status = ANY($1)
                    AND ia.created_at <  NOW() - ($2 || ' seconds')::interval
                    AND ia.created_at >= NOW() - ($3 || ' hours')::interval
                    AND ia.data->'uk_reconcile'->>'skipped_reason' IS NULL
                    AND COALESCE((ia.data->'uk_reconcile'->>'attempts')::int, 0) < $4
                    AND NOT EXISTS (
                        SELECT 1 FROM alert_request_map arm
                         WHERE arm.infrasafe_alert_id = ia.alert_id
                    )
                  ORDER BY ia.created_at
                  LIMIT $5`,
                [OPEN_STATUSES, String(graceSeconds), String(maxAgeHours), maxAttempts, limit]
            );
            return result.rows;
        } catch (error) {
            logger.error(`AlertIntentGap.findOrphans error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Отметить попытку сверки. `skippedReason` — терминальная пометка: алерт
     * больше не попадёт в отбор никогда. Ставится только на состояния, которые
     * проход не может исправить в принципе (нет правила эскалации, ни у одного
     * затронутого здания нет `external_id`), — иначе проход крутил бы их до
     * упора попыток на каждом рестарте.
     *
     * `repaired` — след состоявшейся починки. Из отбора алерт после неё уходит
     * сам (строка намерения появилась), но без отметки оператор не отличит
     * «заявку завёл проход» от «заявку завёл обычный путь», а это ровно то
     * событие, ради которого проход существует.
     *
     * `jsonb_set` с `COALESCE(data,'{}')` — не украшение: соседним ключом лежит
     * `notification_failures`, и перезапись всего `data` стёрла бы его молча.
     */
    static async recordAttempt(alertId, { attempts, skippedReason = null, repaired = false }) {
        // Новый объект, а не правка прочитанного: у прохода нет монополии на
        // строку — параллельно в `data` пишет запись отказов уведомлений.
        const stamp = {
            attempts,
            last_attempt_at: new Date().toISOString(),
            ...(skippedReason ? { skipped_reason: skippedReason } : {}),
            ...(repaired ? { repaired: true } : {})
        };
        try {
            const result = await db.query(
                `UPDATE infrastructure_alerts
                    SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{uk_reconcile}', $2::jsonb, true)
                  WHERE alert_id = $1`,
                [alertId, JSON.stringify(stamp)]
            );
            return result.rowCount === 1;
        } catch (error) {
            logger.error(`AlertIntentGap.recordAttempt error for alert ${alertId}: ${error.message}`);
            throw error;
        }
    }
}

module.exports = AlertIntentGap;
module.exports.OPEN_STATUSES = OPEN_STATUSES;
