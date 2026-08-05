'use strict';

/**
 * [AR-2 / Task 6] Прикладные метрики InfraSafe в формате Prometheus.
 *
 * ⚠️ ИМЕНА СЕРИЙ — ВНЕШНИЙ КОНТРАКТ. Они зафиксированы в отдельном репозитории
 * `profk-observability` ЕЩЁ ДО появления этого кода:
 *   - `alloy/config.alloy` — строфа скрейпа `infrasafe_app`: путь
 *     /internal/metrics, bearer-токен, интервал 30 с;
 *   - `prometheus/rules/infrasafe.yml` — правила, ссылающиеся на конкретные
 *     имена. Переименование здесь ломает алерты там, причём молча: правило на
 *     несуществующую серию не срабатывает НИКОГДА — худший вид ложной зелёности.
 *
 * Дисциплина кардинальности: метки только из ограниченных перечислений
 * (тип алерта, severity, исход, имя предохранителя). Никаких id зданий,
 * контроллеров или трансформаторов — иначе число серий растёт с данными.
 *
 * Модуль намеренно «листовой»: зависит только от prom-client, config/database
 * и logger. Благодаря этому его может требовать даже utils/circuitBreaker, не
 * создавая цикла.
 */

const client = require('prom-client');
const db = require('../config/database');
const logger = require('../utils/logger');

const registry = new client.Registry();

// Числовое выражение состояния предохранителя: правилам нужен порядок
// (0 → норма, 2 → отказ), строковая метка для этого не годится.
const BREAKER_STATE_VALUE = Object.freeze({ CLOSED: 0, HALF_OPEN: 1, OPEN: 2 });

// ---------------------------------------------------------------- счётчики --

const alertChecksTotal = new client.Counter({
    name: 'infrasafe_alert_checks_total',
    help: 'Проверок условий алертов, по типу и исходу (created|gate_denied|deduped|cooldown|error)',
    labelNames: ['type', 'outcome'],
    registers: [registry]
});

const alertsCreatedTotal = new client.Counter({
    name: 'infrasafe_alerts_created_total',
    help: 'Созданных алертов, по типу и серьёзности',
    labelNames: ['type', 'severity'],
    registers: [registry]
});

const circuitBreakerOpenedTotal = new client.Counter({
    name: 'infrasafe_circuit_breaker_opened_total',
    help: 'Сколько раз предохранитель переходил в OPEN',
    labelNames: ['breaker'],
    registers: [registry]
});

const outboxDeadTotal = new client.Counter({
    name: 'infrasafe_uk_outbox_dead_total',
    help: 'Строк uk_outbox, помеченных dead (исчерпаны попытки доставки в УК)',
    registers: [registry]
});

const collectErrorsTotal = new client.Counter({
    name: 'infrasafe_metrics_collect_errors_total',
    help: 'Ошибок сбора гейджей из БД во время скрейпа (значения при этом устаревают)',
    labelNames: ['collector'],
    registers: [registry]
});

// ------------------------------------------------------------------ гейджи --

const circuitBreakerState = new client.Gauge({
    name: 'infrasafe_circuit_breaker_state',
    help: 'Состояние предохранителя: 0=CLOSED, 1=HALF_OPEN, 2=OPEN',
    labelNames: ['breaker'],
    registers: [registry]
});

const verificationWorkerLastTick = new client.Gauge({
    name: 'infrasafe_verification_worker_last_tick_timestamp_seconds',
    help: 'Unix-время последнего завершённого тика воркера верификации алертов',
    registers: [registry]
});

/**
 * Гейджи, значение которых живёт в БД, а не в процессе.
 *
 * Почему из БД, а не счётчиком в памяти: при рестарте процесса счётчик
 * обнулился бы, и `time() - 0` дало бы разницу в 56 лет — правило
 * InfrasafeTelemetryStale начало бы firing'овать сразу после каждого деплоя.
 *
 * ⚠️ Почему НЕ через `collect()`-колбэк самого гейджа, как обычно делают:
 * registry.metrics() запускает все `get()` через Promise.all. При АСИНХРОННОМ
 * collect() гейдж уходит в ожидание БД, а счётчик ошибок в это время уже
 * сериализуется — и ошибка сбора появлялась бы только на СЛЕДУЮЩЕМ скрейпе.
 * Поэтому сбор вынесен в явный шаг `refresh()`, который роут ждёт ДО
 * сериализации.
 */
const telemetryLastReceived = new client.Gauge({
    name: 'infrasafe_telemetry_last_received_timestamp_seconds',
    help: 'Unix-время последней принятой телеметрии',
    registers: [registry]
});

const expectedControllers = new client.Gauge({
    name: 'infrasafe_expected_controllers',
    help: 'Активных контроллеров, от которых ожидается телеметрия (гейт для правила staleness)',
    registers: [registry]
});

const outboxPending = new client.Gauge({
    name: 'infrasafe_uk_outbox_pending',
    help: 'Строк uk_outbox в статусе pending (очередь доставки в УК)',
    registers: [registry]
});

const DB_COLLECTORS = [
    ['telemetry_last_received', async () => {
        const { rows } = await db.query('SELECT MAX(timestamp) AS last_ts FROM metrics');
        const lastTs = rows[0] && rows[0].last_ts;
        // Телеметрии не было НИ РАЗУ ⇒ публикуем NaN, а не 0. Незаданный гейдж
        // prom-client отдаёт как 0, и тогда `time() - 0 > 900` истинно всегда:
        // правило InfrasafeTelemetryStale firing'овало бы круглосуточно на
        // площадке без контроллеров (случай profk). Сравнения с NaN ложны —
        // это честное «неизвестно» вместо «протухло».
        telemetryLastReceived.set(lastTs ? Math.floor(new Date(lastTs).getTime() / 1000) : NaN);
    }],
    ['expected_controllers', async () => {
        // ⚠️ Домен статусов контроллера противоречив: схема ставит
        // `DEFAULT 'active'` БЕЗ CHECK (01_init_database.sql:120), а
        // controllerService при обновлении валидирует
        // ['online','offline','maintenance'] — в базе живут оба набора
        // (прод infrasafe.uz: online=2, active=0; dev: online=21, active=10).
        //
        // Поэтому считаем от ОБРАТНОГО: ожидается телеметрия от всего, что не
        // выведено в обслуживание. Фильтр `status = 'active'` давал бы на проде
        // 0, гейт `expected_controllers > 0` не проходил бы никогда, и правило
        // InfrasafeTelemetryStale молчало бы вечно — ровно та ложная зелёность,
        // от которой предостерегает profk-observability.
        //
        // 'offline' входит в счёт намеренно: молчащий контроллер — это и есть
        // авария, которую правило обязано увидеть.
        const { rows } = await db.query(
            "SELECT COUNT(*)::int AS count FROM controllers WHERE status IS DISTINCT FROM 'maintenance'"
        );
        expectedControllers.set(rows[0] ? Number(rows[0].count) : 0);
    }],
    ['uk_outbox_pending', async () => {
        const { rows } = await db.query(
            'SELECT status, COUNT(*)::int as count FROM uk_outbox GROUP BY status'
        );
        const pending = rows.find(r => r.status === 'pending');
        outboxPending.set(pending ? Number(pending.count) : 0);
    }]
];

/**
 * Обновить гейджи из БД. Падение одного коллектора не отменяет остальные и не
 * роняет скрейп: счётчики, живущие в процессе, ценны сами по себе, а факт
 * деградации виден по infrasafe_metrics_collect_errors_total.
 */
async function refresh() {
    for (const [name, collect] of DB_COLLECTORS) {
        try {
            await collect();
        } catch (error) {
            collectErrorsTotal.inc({ collector: name });
            logger.warn(`metrics: сбор ${name} не удался: ${error.message}`);
        }
    }
}

// -------------------------------------------------------------------- API ---

function recordAlertCheck(type, outcome) {
    alertChecksTotal.inc({ type, outcome });
}

function recordAlertCreated(type, severity) {
    alertsCreatedTotal.inc({ type, severity });
}

function setCircuitBreakerState(breaker, state) {
    const value = BREAKER_STATE_VALUE[state];
    if (value === undefined) return;
    circuitBreakerState.set({ breaker }, value);
}

function incCircuitBreakerOpened(breaker) {
    circuitBreakerOpenedTotal.inc({ breaker });
}

function incOutboxDead() {
    outboxDeadTotal.inc();
}

function markVerificationTick(unixSeconds = Math.floor(Date.now() / 1000)) {
    verificationWorkerLastTick.set(unixSeconds);
}

/**
 * Метрики процесса (heap, event-loop lag, GC). Вызывается ЯВНО из server.js,
 * а не при загрузке модуля: иначе каждый юнит-тест, косвенно требующий
 * metrics.js, поднимал бы сборщики и таймеры.
 */
function enableDefaultMetrics() {
    client.collectDefaultMetrics({ register: registry, prefix: 'infrasafe_nodejs_' });
}

function resetForTests() {
    registry.resetMetrics();
}

module.exports = {
    registry,
    refresh,
    contentType: registry.contentType,
    recordAlertCheck,
    recordAlertCreated,
    setCircuitBreakerState,
    incCircuitBreakerOpened,
    incOutboxDead,
    markVerificationTick,
    enableDefaultMetrics,
    resetForTests,
    // экспортируется для тестов и для явности контракта
    BREAKER_STATE_VALUE,
    _gauges: { telemetryLastReceived, expectedControllers, outboxPending }
};
