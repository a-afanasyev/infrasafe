/**
 * [A-03, вторая половина] Сверяющий проход по активным алертам без намерения.
 *
 * Первая половина (PR #237) сделала атомарной пару «намерение + очередь». Но
 * окно осталось РАНЬШЕ этой пары: алерт коммитится в `infrastructure_alerts`, и
 * только потом `sendNotifications` эмитит `ALERT_CREATED`. Падение процесса
 * между коммитом и слушателем — и активная авария навсегда остаётся без строки
 * в `alert_request_map`: повторный алерт душит дедуп, outbox отсутствующую
 * строку не восстанавливает.
 *
 * Проход ищет ровно эти алерты. Самое важное в нём — не то, что он находит, а
 * то, чего он НЕ находит: алерт с намерением, свежий алерт (слушатель ещё в
 * полёте), алерт вне окна, алерт с исчерпанными попытками и алерт, помеченный
 * как заведомо непередаваемый. Ошибка в любом из этих исключений даёт либо
 * дубль заявки в УК, либо вечный цикл — поэтому проверяется каждое.
 *
 * Почему против живой БД. Весь отбор — это SQL: `NOT EXISTS`, интервалы от
 * `NOW()`, и чтение счётчика попыток из JSONB. Мок сверяет текст запроса, а
 * текст одинаков при любом смысле условий (правило tests/CLAUDE.md: SQL
 * проверяется здесь). Отдельно проверяется, что отметка попытки НЕ затирает
 * соседние ключи в `data` — этого мок не видит в принципе.
 *
 * Как запускать
 * -------------
 *   npm run test:db      — требует живой Postgres в DB_* переменных.
 *
 * Suite НЕ пропускается при недоступной БД: пропуск — это ложный зелёный.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const AlertIntentGap = require('../../../src/models/AlertIntentGap');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[A-03] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);
const INIT_UK = fs.readFileSync(
    path.join(__dirname, '../../../database/init/03_uk_integration.sql'),
    'utf8'
);
const MIGRATION_027 = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/027_alert_lifecycle_v2.sql'),
    'utf8'
);

function extractCreateTable(sql, table, what) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i');
    const found = re.exec(sql);
    if (!found) throw new Error(`[A-03] DDL не найден в каноническом файле: ${what}`);
    return found[0];
}

// FK на `users` снимается: аудиторские колонки `acknowledged_by`/`resolved_by`
// к отбору отношения не имеют, а таблица users потянула бы за собой половину
// схемы. Всё остальное — дословно из канонического файла: статусы, `data` и
// `created_at` и есть предмет проверки.
const ALERTS_DDL = extractCreateTable(INIT_SQL, 'infrastructure_alerts', 'infrastructure_alerts')
    .replace(/ REFERENCES users\(user_id\)/g, '');

// Reopen-колонки живут в 027 — тот же приём, что и в остальной сьюте: DDL
// берётся из канонических файлов, а не переписывается здесь.
const REOPEN_COLUMNS = `
ALTER TABLE infrastructure_alerts
    ADD COLUMN IF NOT EXISTS reopen_chain_id UUID,
    ADD COLUMN IF NOT EXISTS reopen_sequence INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS previous_alert_id INTEGER,
    ADD COLUMN IF NOT EXISTS previous_uk_request_number VARCHAR(20);
`;
if (!/reopen_chain_id UUID/.test(MIGRATION_027)) {
    throw new Error('[A-03] миграция 027 больше не добавляет reopen_chain_id — стенд разошёлся со схемой');
}

const DDL = [
    ALERTS_DDL,
    REOPEN_COLUMNS,
    extractCreateTable(INIT_UK, 'alert_request_map', 'alert_request_map'),
].join('\n');

const BUILDING_EXT = '11111111-2222-3333-4444-555555555555';

// Умолчания прохода, продублированные здесь намеренно: тест задаёт окно сам,
// иначе он проверял бы не отбор, а совпадение с текущими умолчаниями сервиса.
const OPTS = Object.freeze({ graceSeconds: 120, maxAgeHours: 24, maxAttempts: 3, limit: 50 });

/** Вставляет алерт с явным возрастом и статусом; возвращает alert_id. */
async function insertAlert({ ageMinutes = 30, status = 'active', data = null } = {}) {
    const res = await db.query(
        `INSERT INTO infrastructure_alerts
            (type, infrastructure_id, infrastructure_type, severity, message, status, data, created_at)
         VALUES ('LEAK_DETECTED', '7', 'controller', 'CRITICAL', 'течь', $1, $2::jsonb,
                 NOW() - ($3 || ' minutes')::interval)
         RETURNING alert_id`,
        [status, data === null ? null : JSON.stringify(data), String(ageMinutes)]
    );
    return Number(res.rows[0].alert_id);
}

const ids = (rows) => rows.map((r) => Number(r.alert_id));

describe('[A-03] отбор активных алертов без намерения', () => {
    beforeAll(async () => {
        await db.init();
        await db.query('DROP TABLE IF EXISTS alert_request_map CASCADE');
        await db.query('DROP TABLE IF EXISTS infrastructure_alerts CASCADE');
        await db.query(DDL);
    });

    afterAll(async () => {
        await db.query('DROP TABLE IF EXISTS alert_request_map CASCADE');
        await db.query('DROP TABLE IF EXISTS infrastructure_alerts CASCADE');
        await db.close();
    });

    beforeEach(async () => {
        await db.query('TRUNCATE alert_request_map, infrastructure_alerts RESTART IDENTITY');
    });

    test('активный алерт без строки в alert_request_map — находится', async () => {
        const alertId = await insertAlert();
        const rows = await AlertIntentGap.findOrphans(OPTS);
        expect(ids(rows)).toEqual([alertId]);
        expect(rows[0].reconcile_attempts).toBe(0);
        // Поля, из которых пересобирается alertData для форвардера.
        expect(rows[0].type).toBe('LEAK_DETECTED');
        expect(rows[0].infrastructure_type).toBe('controller');
        expect(rows[0].severity).toBe('CRITICAL');
    });

    test('алерт с намерением — НЕ находится', async () => {
        const alertId = await insertAlert();
        await db.query(
            `INSERT INTO alert_request_map (infrasafe_alert_id, building_external_id, idempotency_key, status)
             VALUES ($1, $2, gen_random_uuid(), 'pending')`,
            [alertId, BUILDING_EXT]
        );
        expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([]);
    });

    test('свежий алерт внутри grace — НЕ находится (слушатель ещё в полёте)', async () => {
        await insertAlert({ ageMinutes: 0 });
        expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([]);
    });

    test('алерт старше окна — НЕ находится', async () => {
        await insertAlert({ ageMinutes: 25 * 60 });
        expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([]);
    });

    test.each(['resolved', 'resolved_verifying', 'engineer_required'])(
        'алерт в статусе %s — НЕ находится',
        async (status) => {
            await insertAlert({ status });
            expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([]);
        }
    );

    test('acknowledged — находится: авария не закрыта, заявка нужна', async () => {
        const alertId = await insertAlert({ status: 'acknowledged' });
        expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([alertId]);
    });

    test('исчерпанные попытки — НЕ находится', async () => {
        await insertAlert({ data: { uk_reconcile: { attempts: 3 } } });
        expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([]);
    });

    test('помеченный как непередаваемый — НЕ находится даже при нулевых попытках', async () => {
        await insertAlert({ data: { uk_reconcile: { attempts: 0, skipped_reason: 'no_target' } } });
        expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([]);
    });

    test('порядок — от старых к новым, limit соблюдается', async () => {
        const older = await insertAlert({ ageMinutes: 300 });
        const newer = await insertAlert({ ageMinutes: 30 });
        const all = ids(await AlertIntentGap.findOrphans(OPTS));
        expect(all).toEqual([older, newer]);
        const capped = ids(await AlertIntentGap.findOrphans({ ...OPTS, limit: 1 }));
        expect(capped).toEqual([older]);
    });
});

describe('[A-03] отметка попытки', () => {
    beforeAll(async () => {
        await db.init();
        await db.query('DROP TABLE IF EXISTS alert_request_map CASCADE');
        await db.query('DROP TABLE IF EXISTS infrastructure_alerts CASCADE');
        await db.query(DDL);
    });

    afterAll(async () => {
        await db.query('DROP TABLE IF EXISTS alert_request_map CASCADE');
        await db.query('DROP TABLE IF EXISTS infrastructure_alerts CASCADE');
        await db.close();
    });

    beforeEach(async () => {
        await db.query('TRUNCATE alert_request_map, infrastructure_alerts RESTART IDENTITY');
    });

    const readReconcile = async (alertId) => {
        const res = await db.query(
            "SELECT data->'uk_reconcile' AS r, data AS full FROM infrastructure_alerts WHERE alert_id = $1",
            [alertId]
        );
        return res.rows[0];
    };

    test('счётчик растёт и выводит алерт из отбора на пороге', async () => {
        const alertId = await insertAlert();
        await AlertIntentGap.recordAttempt(alertId, { attempts: 1 });
        let rows = await AlertIntentGap.findOrphans(OPTS);
        expect(rows[0].reconcile_attempts).toBe(1);

        await AlertIntentGap.recordAttempt(alertId, { attempts: 3 });
        rows = await AlertIntentGap.findOrphans(OPTS);
        expect(ids(rows)).toEqual([]);
    });

    test('причина отказа выводит алерт из отбора немедленно', async () => {
        const alertId = await insertAlert();
        await AlertIntentGap.recordAttempt(alertId, { attempts: 1, skippedReason: 'no_rule' });
        expect(ids(await AlertIntentGap.findOrphans(OPTS))).toEqual([]);
        const { r } = await readReconcile(alertId);
        expect(r.skipped_reason).toBe('no_rule');
        expect(typeof r.last_attempt_at).toBe('string');
    });

    test('соседние ключи data не затираются', async () => {
        // Именно сюда alertService пишет отказы каналов уведомления. Отметка
        // попытки, сделанная через перезапись `data`, стёрла бы их молча.
        const alertId = await insertAlert({ data: { notification_failures: [{ channel: 'uk' }], probe: 1 } });
        await AlertIntentGap.recordAttempt(alertId, { attempts: 1 });
        const { full } = await readReconcile(alertId);
        expect(full.notification_failures).toEqual([{ channel: 'uk' }]);
        expect(full.probe).toBe(1);
        expect(full.uk_reconcile.attempts).toBe(1);
    });

    test('починка оставляет след — иначе её не отличить от обычного пути', async () => {
        const alertId = await insertAlert();
        await AlertIntentGap.recordAttempt(alertId, { attempts: 1, repaired: true });
        const { r } = await readReconcile(alertId);
        expect(r.repaired).toBe(true);
        expect(r.skipped_reason).toBeUndefined();
    });

    test('data был NULL — отметка создаёт объект, а не падает', async () => {
        const alertId = await insertAlert({ data: null });
        await AlertIntentGap.recordAttempt(alertId, { attempts: 1 });
        const { r } = await readReconcile(alertId);
        expect(r.attempts).toBe(1);
    });
});
