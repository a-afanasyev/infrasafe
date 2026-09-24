'use strict';

/**
 * [A-03, вторая половина] Сверяющий проход: открытый алерт без намерения
 * отправить заявку в УК.
 *
 * ЧТО ЗАКРЫВАЕТ. `alertService.createAlert` коммитит алерт, и только потом
 * `sendNotifications` эмитит `ALERT_CREATED`; слушатель `alertForwarder` живёт
 * в том же процессе. Падение или рестарт между коммитом и слушателем оставляет
 * активную аварию без строки в `alert_request_map` — состояние, из которого
 * система сама не выходит: повторный алерт душит дедуп, а drain-воркер
 * доставляет существующие строки очереди, но не восстанавливает отсутствующие.
 * PR #237 сделал атомарной пару «намерение + очередь»; это — окно ДО неё.
 *
 * ГЛАВНЫЙ РИСК ДИЗАЙНА — не пропустить сироту, а не зациклиться на той, которую
 * починить нельзя. Два состояния выглядят как сирота, но ею не являются:
 *   - у типа/важности алерта нет правила эскалации — форвардер выйдет молча;
 *   - ни у одного затронутого здания нет `external_id` (УК их до сих пор не
 *     присылает — см. историю интеграции) — отправлять некуда.
 * В обоих случаях строка намерения не появится НИКОГДА, а условие отбора не
 * изменится: наивный проход звал бы форвардер на каждом тике до конца жизни
 * алерта. Поэтому оба распознаются ДО вызова и помечаются терминально
 * (`data.uk_reconcile.skipped_reason`). Осознанная цена: если `external_id`
 * приедет от УК позже, задним числом заявка не заведётся — но и сегодня она не
 * заводится, так что регрессии тут нет, а вечного цикла нет теперь.
 *
 * УСПЕХ НЕЛЬЗЯ ВЗЯТЬ ИЗ ВОЗВРАЩАЕМОГО ЗНАЧЕНИЯ: `sendAlertToUK` по контракту
 * никогда не бросает и на обычном пути возвращает undefined. Единственное
 * честное свидетельство — появилась ли строка намерения. Проход перечитывает
 * её после вызова.
 *
 * ЧЕГО ПРОХОД НЕ ВОССТАНАВЛИВАЕТ: метрический контекст [FE-119]
 * (`metric_label`, `metric_value`, пороги) в `infrastructure_alerts` не
 * хранится — он жил только в `alertData` в памяти. Восстановленная заявка
 * уходит в УК без этого блока (ключи присутствуют со значением null). Тикет без
 * контекста лучше отсутствующего тикета, но знать об этом надо.
 *
 * ФЛАГ — РУБИЛЬНИК, НЕ OPT-IN. `UK_INTENT_RECONCILE_ENABLED` по умолчанию
 * включён: механизм починки, выключенный по умолчанию, — это ровно тот способ,
 * которым в этом проекте уже однажды завёлся мёртвый подсистемный код (AUD-001).
 * Безопасность даёт не флаг, а гейты: выключенная интеграция с УК → тик пустой;
 * окно в сутки → старьё не воскрешается; пачка за тик → всплеска в УК нет.
 */

const db = require('../../config/database');
const logger = require('../../utils/logger');
const { unlockAdvisory, releaseClient } = require('../../utils/pgClient');
const envFlags = require('../../utils/envFlags');

const AlertIntentGap = require('../../models/AlertIntentGap');
const AlertRequestMap = require('../../models/AlertRequestMap');

const configProxy = require('./configProxy');
const alertForwarder = require('./alertForwarder');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const MIN_INTERVAL_MS = 10 * 1000;
const MAX_INTERVAL_MS = 10 * 60 * 1000;

const DEFAULT_MAX_AGE_HOURS = 24;
const MAX_AGE_HOURS_CEILING = 24 * 7;

// Слушатель `ALERT_CREATED` работает в том же процессе и укладывается в
// миллисекунды. Две минуты — не оценка его длительности, а запас, при котором
// проход заведомо не соревнуется с ним за одну и ту же сироту: перехватив алерт
// в полёте, он создал бы ВТОРУЮ заявку в УК вместо починки.
const GRACE_SECONDS = 120;

// Верхняя граница для патологии, которую мы не предвидели. Два предвиденных
// случая (нет правила, нет адресата) уже уходят терминальной пометкой, так что
// сюда попадает только устойчивый отказ — три попытки и явный warn оператору.
const MAX_ATTEMPTS = 3;

// Размер пачки за тик. Проход чинит редкие последствия аварии, а не гонит
// трафик: при интервале в минуту это потолок в 5 заявок/мин.
const BATCH_LIMIT = 5;

// Отдельный от drain-воркера ключ: у проходов разные периоды, и общий замок
// заставлял бы их ждать друг друга.
const ADVISORY_LOCK_KEY = 1187807154;

// Первый тик — не сразу после старта: приложение ещё поднимает пул и слушателей.
const WARMUP_DELAY_MS = 20 * 1000;

const SKIP_NO_RULE = 'no_rule';
const SKIP_NO_TARGET = 'no_target';

class AlertIntentReconciler {
    constructor() {
        this._timer = null;
        this._warmupTimer = null;
        this._running = false;
        this._stopped = false;
    }

    /** Рубильник. По умолчанию включён — см. шапку файла. */
    isEnabled() {
        return envFlags.isEnabled('UK_INTENT_RECONCILE_ENABLED', true);
    }

    intervalMs() {
        const raw = Number(process.env.UK_INTENT_RECONCILE_INTERVAL_MS);
        if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
        return Math.min(Math.max(Math.floor(raw), MIN_INTERVAL_MS), MAX_INTERVAL_MS);
    }

    maxAgeHours() {
        const raw = Number(process.env.UK_INTENT_RECONCILE_MAX_AGE_HOURS);
        if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_AGE_HOURS;
        return Math.min(Math.max(Math.floor(raw), 1), MAX_AGE_HOURS_CEILING);
    }

    start() {
        if (!this.isEnabled()) {
            logger.info('alertIntentReconciler disabled via UK_INTENT_RECONCILE_ENABLED');
            return;
        }
        if (this._timer) {
            logger.warn('alertIntentReconciler already started — skipping duplicate start');
            return;
        }
        this._stopped = false;
        const interval = this.intervalMs();
        logger.info(`alertIntentReconciler starting (interval=${interval}ms, window=${this.maxAgeHours()}h)`);

        this._warmupTimer = setTimeout(() => { void this._tick(); }, WARMUP_DELAY_MS);
        this._warmupTimer.unref();

        this._timer = setInterval(() => { void this._tick(); }, interval);
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
            logger.info('alertIntentReconciler stopped');
        }
    }

    /**
     * Один тик под межрепличным advisory-локом. Замок берётся и снимается на
     * ОДНОМ закреплённом клиенте: session-scoped локи привязаны к физическому
     * соединению, и снятие через пул нередко попадает на чужое (та же причина,
     * что в B-022 у drain-воркера).
     */
    async _tick() {
        if (this._stopped || this._running) return;
        this._running = true;
        try {
            const client = await db.getPool().connect();
            try {
                const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_KEY]);
                if (!(lockResult.rows[0] && lockResult.rows[0].locked === true)) return;
                try {
                    await this.reconcileOnce();
                } finally {
                    await unlockAdvisory(client, ADVISORY_LOCK_KEY, 'alertIntentReconciler'); // [N-21]
                }
            } finally {
                releaseClient(client);
            }
        } catch (err) {
            logger.error(`alertIntentReconciler tick failed: ${err.message}`);
        } finally {
            this._running = false;
        }
    }

    /**
     * Тело прохода без замка — точка, которую и проверяют юнит-тесты.
     * Никогда не бросает: проход фоновый, и его отказ не должен влиять ни на
     * что, кроме собственного лога.
     */
    async reconcileOnce() {
        if (!(await configProxy.isEnabled())) return;

        const orphans = await AlertIntentGap.findOrphans({
            graceSeconds: GRACE_SECONDS,
            maxAgeHours: this.maxAgeHours(),
            maxAttempts: MAX_ATTEMPTS,
            limit: BATCH_LIMIT,
        });
        if (!orphans.length) return;

        logger.warn(`alertIntentReconciler: ${orphans.length} открытых алертов без заявки в УК — восстанавливаю`);
        for (const orphan of orphans) {
            try {
                await this._reconcileOne(orphan);
            } catch (err) {
                // Соседние сироты не должны страдать от одной плохой строки.
                logger.error(`alertIntentReconciler: alert ${orphan.alert_id} — ${err.message}`);
            }
        }
    }

    /** Строка `infrastructure_alerts` → форма, которую ждёт форвардер. */
    _toAlertData(row) {
        return {
            alert_id: Number(row.alert_id),
            type: row.type,
            infrastructure_id: row.infrastructure_id,
            infrastructure_type: row.infrastructure_type,
            severity: row.severity,
            message: row.message,
            // ISO-строка, а не Date: тело события подписывается побайтово.
            created_at: row.created_at instanceof Date
                ? row.created_at.toISOString()
                : row.created_at,
            reopen_chain_id: row.reopen_chain_id || null,
            reopen_sequence: row.reopen_sequence || 1,
            previous_uk_request_number: row.previous_uk_request_number || null,
        };
    }

    async _reconcileOne(row) {
        const alertId = Number(row.alert_id);
        const attempts = Number(row.reconcile_attempts || 0) + 1;

        const skipReason = await this._terminalSkipReason(row);
        if (skipReason) {
            logger.info(`alertIntentReconciler: alert ${alertId} непочинИм (${skipReason}) — больше не повторяю`);
            await this._stamp(alertId, { attempts, skippedReason: skipReason });
            return;
        }

        await alertForwarder.sendAlertToUK(this._toAlertData(row));

        // sendAlertToUK по контракту не бросает и ничего не возвращает —
        // свидетельство успеха только одно: строка намерения появилась.
        const mappings = await AlertRequestMap.findByAlertId(alertId);
        const repaired = Array.isArray(mappings) && mappings.length > 0;

        if (repaired) {
            logger.info(`alertIntentReconciler: alert ${alertId} — заявка в УК восстановлена`);
            await this._stamp(alertId, { attempts, repaired: true });
            return;
        }

        if (attempts >= MAX_ATTEMPTS) {
            logger.warn(
                `alertIntentReconciler: alert ${alertId} — ${attempts} попыток без заявки в УК, ` +
                'прекращаю. Открытая авария осталась без тикета — разбирать руками.'
            );
        }
        await this._stamp(alertId, { attempts });
    }

    /**
     * Состояние, которое проход починить не может в принципе. Обе проверки —
     * только чтение, и обе повторяют ранние выходы `sendAlertToUK`: смысл не в
     * экономии вызова, а в том, чтобы отличить «не сработало» от «сработать не
     * может» ДО того, как счётчик попыток начнёт расти впустую.
     */
    async _terminalSkipReason(row) {
        const AlertRule = require('../../models/AlertRule');
        const rule = await AlertRule.findByTypeAndSeverity(row.type, row.severity);
        if (!rule) return SKIP_NO_RULE;

        // [N-07] Сбой чтения — «не знаю», а не «некуда»: пусть бросит. Внешний
        // цикл reconcileOnce его залогирует, пометки не будет, и алерт вернётся
        // на следующем тике — попытка при этом не засчитывается, иначе минутный
        // сбой пула за три тика исчерпал бы MAX_ATTEMPTS тем же исходом.
        const buildings = await alertForwarder.resolveBuildingIds(
            row.infrastructure_id, row.infrastructure_type, { throwOnError: true }
        );
        const hasTarget = Array.isArray(buildings) && buildings.some((b) => b && b.external_id);
        return hasTarget ? null : SKIP_NO_TARGET;
    }

    /** Отметка — best-effort: её отказ не должен ронять проход. */
    async _stamp(alertId, stamp) {
        try {
            await AlertIntentGap.recordAttempt(alertId, stamp);
        } catch (err) {
            logger.warn(`alertIntentReconciler: отметка попытки для alert ${alertId} не записана: ${err.message}`);
        }
    }
}

const singleton = new AlertIntentReconciler();

module.exports = singleton;
module.exports.AlertIntentReconciler = AlertIntentReconciler;
