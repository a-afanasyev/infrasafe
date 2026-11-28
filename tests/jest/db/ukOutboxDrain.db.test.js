/**
 * [Q-04, Q-05] Отказной путь outbox УК на живом Postgres.
 *
 * Q-05. UPDATE журнала dead-letter (`_recordNotificationFailure`) передавал
 * `response_code` в `jsonb_build_object` без приведения типа. Postgres не может
 * вывести тип такого параметра и отвечает 42P18; `catch` понижал это до warn, и
 * `infrastructure_alerts.data.notification_failures` для канала `uk_webhook` не
 * писался никогда. Мок `db.query` выполнял запрос «успешно» — увидеть это можно
 * только настоящим Postgres.
 *
 * Q-04. Повторяемые отказы (сеть, 5xx, 429) хоронили строку после пяти попыток,
 * то есть примерно через 30 с недоступности УК. Теперь граница — TTL строки
 * (`UK_OUTBOX_MAX_AGE_HOURS`, 24 ч), а пауза между попытками растёт до потолка.
 *
 * Отправка подменяется на уровне `ukWebhookClient.send` — БД не мокается.
 *
 * Как запускать
 * -------------
 *   npm run test:db      — требует живой Postgres в DB_* переменных.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const ukWebhookClient = require('../../../src/clients/ukWebhookClient');
const ukOutboxService = require('../../../src/services/uk/ukOutboxService');
const UkOutbox = require('../../../src/models/UkOutbox');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[Q-04] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '../../../', rel), 'utf8');
const INIT_SQL = read('database/init/01_init_database.sql');
const INIT_UK = read('database/init/03_uk_integration.sql');
const MIGRATION_022 = read('database/migrations/022_uk_outbox.sql');

function extractCreateTable(sql, table) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i');
    const found = re.exec(sql);
    if (!found) throw new Error(`[Q-04] DDL не найден в каноническом файле: ${table}`);
    return found[0];
}

// FK на users снят — аудиторские колонки к проверке не относятся.
const DDL = [
    extractCreateTable(INIT_SQL, 'infrastructure_alerts').replace(/ REFERENCES users\(user_id\)/g, ''),
    extractCreateTable(INIT_UK, 'alert_request_map'),
    extractCreateTable(MIGRATION_022, 'uk_outbox'),
    extractCreateTable(INIT_UK, 'integration_log'),
].join('\n');

const TABLES = 'uk_outbox, alert_request_map, infrastructure_alerts, integration_log';
const BUILDING_EXT = '11111111-2222-3333-4444-555555555555';
let seq = 0;

/** Алерт + намерение + строка outbox; возвращает { alertId, eventId }. */
async function seed({ ageHours = 0 } = {}) {
    seq += 1;
    const eventId = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    const alert = await db.query(
        `INSERT INTO infrastructure_alerts
            (type, infrastructure_id, infrastructure_type, severity, message)
         VALUES ('LEAK_DETECTED', '7', 'controller', 'CRITICAL', 'течь')
         RETURNING alert_id`
    );
    const alertId = Number(alert.rows[0].alert_id);
    await db.query(
        `INSERT INTO alert_request_map (infrasafe_alert_id, building_external_id, idempotency_key, status)
         VALUES ($1, $2, $3, 'pending')`,
        [alertId, BUILDING_EXT, eventId]
    );
    await db.query(
        `INSERT INTO uk_outbox (event_id, payload_body, status, next_attempt_at, created_at)
         VALUES ($1, '{}', 'pending', NOW(), NOW() - ($2 || ' hours')::interval)`,
        [eventId, String(ageHours)]
    );
    return { alertId, eventId };
}

const outboxRow = async (eventId) =>
    (await db.query('SELECT *, EXTRACT(EPOCH FROM (next_attempt_at - NOW())) AS wait_s FROM uk_outbox WHERE event_id = $1', [eventId])).rows[0];

const failures = async (alertId) =>
    (await db.query('SELECT data->\'notification_failures\' AS f FROM infrastructure_alerts WHERE alert_id = $1', [alertId])).rows[0].f;

/** Делает строку снова «к отправке» — время в тесте не ждём. */
const makeDue = (eventId) =>
    db.query('UPDATE uk_outbox SET next_attempt_at = NOW() - INTERVAL \'1 second\' WHERE event_id = $1', [eventId]);

describe('[Q-04, Q-05] отказной путь outbox УК', () => {
    let send;

    beforeAll(async () => {
        await db.init();
        await db.query(`DROP TABLE IF EXISTS ${TABLES} CASCADE`);
        await db.query(DDL);
    });

    afterAll(async () => {
        await db.query(`DROP TABLE IF EXISTS ${TABLES} CASCADE`);
        await db.close();
    });

    beforeEach(async () => {
        await db.query(`TRUNCATE ${TABLES} RESTART IDENTITY`);
        send = jest.spyOn(ukWebhookClient, 'send');
    });

    afterEach(() => send.mockRestore());

    test('[Q-05] dead-letter пишет notification_failures с кодом ответа', async () => {
        const { alertId, eventId } = await seed();
        send.mockResolvedValue({ outcome: 'dead', code: 422, error: 'UK 422: bad payload' });

        await ukOutboxService._drainOne();

        expect((await outboxRow(eventId)).status).toBe('dead');
        const f = await failures(alertId);
        expect(f).toHaveLength(1);
        expect(f[0]).toMatchObject({
            channel: 'uk_webhook', event_id: eventId, attempt_count: 1,
            response_code: 422, error: 'UK 422: bad payload',
        });
    });

    test('[Q-05] dead-letter без кода ответа (stale) пишет response_code = null', async () => {
        const { alertId, eventId } = await seed({ ageHours: 25 });

        await ukOutboxService._drainOne();

        expect(send).not.toHaveBeenCalled();
        expect((await outboxRow(eventId)).status).toBe('dead');
        const f = await failures(alertId);
        expect(f).toHaveLength(1);
        expect(f[0].response_code).toBeNull();
        expect(f[0].error).toMatch(/^stale/);
    });

    test('[Q-04] больше пяти повторяемых отказов — строка жива, пауза упирается в потолок', async () => {
        const { alertId, eventId } = await seed();
        send.mockResolvedValue({ outcome: 'retry', code: 503, error: 'UK 503 (retriable)' });

        const ATTEMPTS = 12;
        for (let i = 0; i < ATTEMPTS; i += 1) {
            await makeDue(eventId);
            await ukOutboxService._drainOne();
        }

        const row = await outboxRow(eventId);
        expect(row.status).toBe('pending');
        expect(row.attempt_count).toBe(ATTEMPTS);
        const cap = ukOutboxService.MAX_BACKOFF_SECONDS;
        expect(Number(row.wait_s)).toBeLessThanOrEqual(cap);
        expect(Number(row.wait_s)).toBeGreaterThan(cap - 5);
        expect(await failures(alertId)).toBeNull();
    });

    test('[Q-04] повторяемый отказ сетевого уровня (без кода) тоже не хоронит строку', async () => {
        const { eventId } = await seed();
        send.mockResolvedValue({ outcome: 'retry', error: 'ECONNREFUSED: connect' });

        for (let i = 0; i < 7; i += 1) {
            await makeDue(eventId);
            await ukOutboxService._drainOne();
        }

        expect((await outboxRow(eventId)).status).toBe('pending');
    });

    test('[Q-04] неповторяемый ответ (401) по-прежнему хоронит сразу', async () => {
        const { alertId, eventId } = await seed();
        send.mockResolvedValue({ outcome: 'dead', code: 401, error: 'UK 401: signature' });

        await ukOutboxService._drainOne();

        const row = await outboxRow(eventId);
        expect(row.status).toBe('dead');
        expect(row.attempt_count).toBe(1);
        expect((await failures(alertId))[0].response_code).toBe(401);
    });

    test('[Q-04] строка, пережившая TTL в повторах, уходит в dead без отправки', async () => {
        const { alertId, eventId } = await seed({ ageHours: 25 });
        await db.query('UPDATE uk_outbox SET attempt_count = 200 WHERE event_id = $1', [eventId]);

        await ukOutboxService._drainOne();

        expect(send).not.toHaveBeenCalled();
        expect((await outboxRow(eventId)).status).toBe('dead');
        expect(await failures(alertId)).toHaveLength(1);
    });

    test('[Q-04] долго повторяющаяся строка не задерживает свежую', async () => {
        const old = await seed({ ageHours: 3 });
        await db.query('UPDATE uk_outbox SET attempt_count = 30 WHERE event_id = $1', [old.eventId]);
        send.mockResolvedValue({ outcome: 'retry', code: 503, error: 'UK 503 (retriable)' });
        await ukOutboxService._drainOne();
        expect(send).toHaveBeenCalledTimes(1);

        const fresh = await seed();
        const next = await UkOutbox.pickNext();
        expect(next.event_id).toBe(fresh.eventId);
    });
});
