/**
 * [A-03] Намерение отправить заявку в УК и постановка события в очередь —
 * ОДНА транзакция.
 *
 * Находка аудита 08.09.2026. Записи шли порознь: сначала `alert_request_map`,
 * затем `uk_outbox`. Падение между ними — или отказ второй записи — оставляло
 * намерение без очереди. Дальше заявка в УК не уходила НИКОГДА: повторный алерт
 * душит дедуп (для пары {алерт, здание} строка уже есть), а drain-воркер умеет
 * доставлять существующие строки, но не восстанавливать отсутствующие. Активная
 * авария молча оставалась без тикета.
 *
 * Почему тест против живой БД. Проверяется ОТКАТ — то, чего в моке не
 * существует: замоканный `db.query` выполняет обе вставки «успешно» и покажет
 * зелёное и на прежнем, неатомарном коде. Свидетельством может быть только
 * настоящая транзакция настоящего Postgres.
 *
 * Как запускать
 * -------------
 *   npm run test:db      — требует живой Postgres в DB_* переменных.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const AlertRequestMap = require('../../../src/models/AlertRequestMap');
const UkOutbox = require('../../../src/models/UkOutbox');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[A-03] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const INIT_UK = fs.readFileSync(
    path.join(__dirname, '../../../database/init/03_uk_integration.sql'),
    'utf8'
);
const MIGRATION_022 = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/022_uk_outbox.sql'),
    'utf8'
);

function extractCreateTable(sql, table, what) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i');
    const found = re.exec(sql);
    if (!found) throw new Error(`[A-03] DDL не найден в каноническом файле: ${what}`);
    return found[0];
}

// DDL из канонических файлов, а не переписанный здесь: уникальный индекс по
// `idempotency_key` и пара `(alert, building)` — часть проверяемого поведения
// (на них держится разбор гонки), и переписанный стенд разошёлся бы со схемой.
const DDL = [
    extractCreateTable(INIT_UK, 'alert_request_map', 'alert_request_map'),
    extractCreateTable(MIGRATION_022, 'uk_outbox', 'uk_outbox'),
].join('\n');

const ALERT_ID = 4242;
const BUILDING_EXT = '11111111-2222-3333-4444-555555555555';

const intent = (key) => ({
    infrasafe_alert_id: ALERT_ID,
    building_external_id: BUILDING_EXT,
    idempotency_key: key,
    status: 'pending',
});

async function countRows() {
    const arm = await db.query('SELECT COUNT(*)::int AS n FROM alert_request_map');
    const outbox = await db.query('SELECT COUNT(*)::int AS n FROM uk_outbox');
    return { arm: arm.rows[0].n, outbox: outbox.rows[0].n };
}

describe('[A-03] намерение и очередь пишутся атомарно', () => {
    beforeAll(async () => {
        await db.init();
        await db.query('DROP TABLE IF EXISTS alert_request_map CASCADE');
        await db.query('DROP TABLE IF EXISTS uk_outbox CASCADE');
        await db.query(DDL);
    });

    afterAll(async () => {
        await db.query('DROP TABLE IF EXISTS alert_request_map CASCADE');
        await db.query('DROP TABLE IF EXISTS uk_outbox CASCADE');
        await db.close();
    });

    beforeEach(async () => {
        await db.query('DELETE FROM alert_request_map');
        await db.query('DELETE FROM uk_outbox');
    });

    test('успешная транзакция оставляет обе строки', async () => {
        const key = '00000000-0000-4000-8000-000000000001';

        await db.withTransaction(async (client) => {
            await AlertRequestMap.create(intent(key), client);
            await UkOutbox.enqueue({ event_id: key, payload_body: '{"ok":true}' }, client);
        });

        expect(await countRows()).toEqual({ arm: 1, outbox: 1 });
    });

    test('падение ПОСЛЕ очереди не оставляет ни намерения, ни события', async () => {
        // Сценарий «процесс умер между записью и коммитом».
        const key = '00000000-0000-4000-8000-000000000002';

        await expect(db.withTransaction(async (client) => {
            await AlertRequestMap.create(intent(key), client);
            await UkOutbox.enqueue({ event_id: key, payload_body: '{"ok":true}' }, client);
            throw new Error('крэш до коммита');
        })).rejects.toThrow('крэш до коммита');

        expect(await countRows()).toEqual({ arm: 0, outbox: 0 });
    });

    test('отказ постановки в очередь откатывает намерение', async () => {
        // Сердцевина находки: раньше намерение оставалось, очередь — нет, и
        // заявка не уходила никогда.
        const key = '00000000-0000-4000-8000-000000000003';

        await expect(db.withTransaction(async (client) => {
            await AlertRequestMap.create(intent(key), client);
            // payload_body NOT NULL — отказ на стороне БД, а не в JS-проверке.
            await client.query(
                `INSERT INTO uk_outbox (event_id, payload_body, status, next_attempt_at, created_at)
                 VALUES ($1, NULL, 'pending', NOW(), NOW())`,
                [key]
            );
        })).rejects.toThrow();

        expect(await countRows()).toEqual({ arm: 0, outbox: 0 });
    });

    test('после отката повтор проходит начисто — мусора в уникальных ключах нет', async () => {
        // Если бы откат оставлял строку, повтор упёрся бы в UNIQUE и пара
        // {алерт, здание} осталась бы без заявки уже по другой причине.
        const failed = '00000000-0000-4000-8000-000000000004';
        await expect(db.withTransaction(async (client) => {
            await AlertRequestMap.create(intent(failed), client);
            throw new Error('откат');
        })).rejects.toThrow('откат');

        const retry = '00000000-0000-4000-8000-000000000005';
        await db.withTransaction(async (client) => {
            await AlertRequestMap.create(intent(retry), client);
            await UkOutbox.enqueue({ event_id: retry, payload_body: '{"retry":true}' }, client);
        });

        expect(await countRows()).toEqual({ arm: 1, outbox: 1 });
    });

    test('повторная постановка того же события идемпотентна и не ломает транзакцию', async () => {
        // ON CONFLICT DO NOTHING: дубликат — успех, а не отказ. Внутри
        // транзакции это важно вдвойне: ошибка отравила бы её целиком.
        const key = '00000000-0000-4000-8000-000000000006';
        await db.withTransaction(async (client) => {
            await AlertRequestMap.create(intent(key), client);
            await UkOutbox.enqueue({ event_id: key, payload_body: '{"first":true}' }, client);
        });

        const second = await db.withTransaction(async (client) => (
            UkOutbox.enqueue({ event_id: key, payload_body: '{"second":true}' }, client)
        ));

        expect(second).toBeNull();
        expect(await countRows()).toEqual({ arm: 1, outbox: 1 });
    });

    test('без клиента модели по-прежнему пишут через пул', async () => {
        // executor по умолчанию — пул: путь, которым идут все остальные
        // вызывающие, не должен был измениться.
        const key = '00000000-0000-4000-8000-000000000007';
        await AlertRequestMap.create(intent(key));
        await UkOutbox.enqueue({ event_id: key, payload_body: '{"pool":true}' });

        expect(await countRows()).toEqual({ arm: 1, outbox: 1 });
    });
});
