/**
 * Ядро алертов против НАСТОЯЩЕГО Postgres (аудит 28.11.2026: Q-01, Q-02, Q-03, Q-08).
 *
 * Все четыре дефекта жили там, куда мок БД не дотягивается:
 *   Q-01 — `load_percent` в MV имеет тип NUMERIC, node-pg отдаёт его строкой,
 *          и `checkTransformerLoad` отбрасывал любую загрузку как «нет данных».
 *          Юнит-тесты подставляли числа — и были зелёными.
 *   Q-02 — проверку трансформаторов никто не запускал сам: только промах кэша
 *          при открытии всплывающего окна на карте.
 *   Q-03 — обычный путь `createAlert` не смотрел ни на активное подавление, ни
 *          на ожидающую верификацию того же кортежа.
 *   Q-08 — шлюз устойчивости считал аномальные сэмплы в окне и не замечал
 *          здоровых между ними: два одиночных всплеска давали алерт.
 *
 * DDL берётся из канонических database/init и database/migrations, а не
 * переписывается: типы столбцов MV и индексы — часть проверяемого поведения.
 *
 * Запуск: npm run test:db.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const alertService = require('../../../src/services/alertService');
const alertGates = require('../../../src/services/alert/alertGates');
const Transformer = require('../../../src/models/Transformer');
const AlertRule = require('../../../src/models/AlertRule');
const AlertSuppression = require('../../../src/models/AlertSuppression');
const { MvRefreshScheduler } = require('../../../src/services/mvRefreshService');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(`[db-test] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу.`);
}

const ROOT = path.join(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INIT = read('database/init/01_init_database.sql');
const INIT_UK = read('database/init/03_uk_integration.sql');
const M020 = read('database/migrations/020_mv_refresh_definer_wrapper.sql');
const M042 = read('database/migrations/042_controller_status_domain.sql');

function extract(sql, re, what) {
    const found = sql.match(re);
    if (!found || !found.length) throw new Error(`не найдено в каноническом файле: ${what}`);
    return found.join('\n');
}
const table = (sql, name) => extract(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`, 'i'), name);

const DDL = [
    'CREATE EXTENSION IF NOT EXISTS postgis;',
    table(INIT, 'users'),
    table(INIT, 'transformers'),
    table(INIT, 'buildings'),
    extract(INIT, /^ALTER TABLE buildings ADD COLUMN IF NOT EXISTS (?:primary|backup)_transformer_id .*$/gm, 'buildings.*_transformer_id'),
    table(INIT, 'controllers'),
    table(INIT, 'metrics'),
    table(INIT, 'infrastructure_alerts'),
    table(INIT_UK, 'alert_rules'),
    extract(INIT_UK, /INSERT INTO alert_rules [\s\S]*?ON CONFLICT \(alert_type, severity\) DO NOTHING;/, 'alert_rules seed'),
    read('database/migrations/024_alert_rules_extensions.sql'),
    read('database/migrations/025_alert_verifications.sql'),
    read('database/migrations/026_alert_suppressions.sql'),
    read('database/migrations/027_alert_lifecycle_v2.sql'),
    read('database/migrations/033_alert_verifications_last_checked.sql'),
    read('database/migrations/034_alert_verifications_dispatch.sql'),
    read('database/migrations/041_alert_rules_season_window.sql'),
    extract(M042, /CREATE MATERIALIZED VIEW mv_transformer_load_realtime AS[\s\S]*?;/, 'mv_transformer_load_realtime'),
    extract(M042, /CREATE UNIQUE INDEX idx_mv_transformer_load_id[\s\S]*?;/, 'idx_mv_transformer_load_id'),
    extract(M020, /CREATE OR REPLACE FUNCTION public\.refresh_mv_transformer_load\(\)[\s\S]*?\$\$;/, 'refresh_mv_transformer_load'),
].join('\n');

const TABLES = ['alert_verifications', 'alert_suppressions', 'infrastructure_alerts', 'alert_rules',
    'metrics', 'controllers', 'buildings', 'transformers', 'users'];

async function dropAll() {
    await db.query('DROP MATERIALIZED VIEW IF EXISTS mv_transformer_load_realtime CASCADE');
    await db.query('DROP FUNCTION IF EXISTS public.refresh_mv_transformer_load()');
    for (const t of TABLES) await db.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
}

let transformerId;
let buildingId;

async function newController(serial) {
    const r = await db.query(
        `INSERT INTO controllers (serial_number, building_id, status) VALUES ($1, $2, 'online') RETURNING controller_id`,
        [serial, buildingId]
    );
    return r.rows[0].controller_id;
}

// Сэмпл, отстоящий от NOW() на `agoSec` секунд.
async function sample(controllerId, agoSec, cols) {
    const names = Object.keys(cols);
    const params = names.map((_, i) => `$${i + 3}`);
    await db.query(
        `INSERT INTO metrics (controller_id, timestamp${names.map((n) => `, ${n}`).join('')})
         VALUES ($1, NOW() - ($2::int * INTERVAL '1 second')${params.map((p) => `, ${p}`).join('')})`,
        [controllerId, agoSec, ...names.map((n) => cols[n])]
    );
}

async function alertRows(type, infraType, infraId) {
    const r = await db.query(
        `SELECT alert_id, status FROM infrastructure_alerts
         WHERE type = $1 AND infrastructure_type = $2 AND infrastructure_id = $3::text ORDER BY alert_id`,
        [type, infraType, String(infraId)]
    );
    return r.rows;
}

beforeAll(async () => {
    await db.init();
    await dropAll();
    await db.query(DDL);

    const tr = await db.query(
        `INSERT INTO transformers (name, power_kva, voltage_kv) VALUES ('ТП-перегруз', 100, 10) RETURNING transformer_id`
    );
    transformerId = tr.rows[0].transformer_id;
    const b = await db.query(
        `INSERT INTO buildings (name, address, town, latitude, longitude, primary_transformer_id)
         VALUES ('Дом 1', 'ул. Тестовая, 1', 'Ташкент', 41.31, 69.24, $1) RETURNING building_id`,
        [transformerId]
    );
    buildingId = b.rows[0].building_id;
}, 60000);

afterAll(async () => {
    await dropAll();
    await db.close();
});

beforeEach(() => {
    alertService.activeAlerts.clear();
    alertService.lastChecks.clear();
});

describe('[Q-01/Q-02] перегрузка трансформатора по данным MV', () => {
    test('метрики → тик обновления MV → создан алерт о перегрузке', async () => {
        const c = await newController('Q01-1');
        // 3 × 80 А = 240 А; 240 × 0.4 / 100 кВА × 100 = 96 % ≥ порога CRITICAL (95).
        await sample(c, 30, { amperage_ph1: 80, amperage_ph2: 80, amperage_ph3: 80 });

        await new MvRefreshScheduler()._tick();

        const row = await Transformer.getLoadAnalytics(transformerId);
        expect(typeof row.load_percent).toBe('number');
        expect(row.load_percent).toBeCloseTo(96, 5);

        const rows = await alertRows('TRANSFORMER_CRITICAL_OVERLOAD', 'transformer', transformerId);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('active');
    });
});

describe('[Q-03] обычный путь createAlert уважает верификацию и подавление', () => {
    const ORIG_FLAG = process.env.ALERT_VERIFICATION_ENABLED;
    afterAll(() => {
        if (ORIG_FLAG === undefined) delete process.env.ALERT_VERIFICATION_ENABLED;
        else process.env.ALERT_VERIFICATION_ENABLED = ORIG_FLAG;
    });

    test('алерт в resolved_verifying: новый сэмпл течи не создаёт второго алерта, переоткрытие — создаёт', async () => {
        const c = await newController('Q03-verify');
        await sample(c, 30, { leak_sensor: true });
        await sample(c, 0, { leak_sensor: true });

        const first = await alertService.createAlert(alertService._buildLeakAlertData(c));
        expect(first).not.toBeNull();

        process.env.ALERT_VERIFICATION_ENABLED = 'true';
        await alertService.resolveAlert(first.alert_id, null);
        const resolvedAt = new Date();
        expect((await alertRows('LEAK_DETECTED', 'controller', c))[0].status).toBe('resolved_verifying');

        await sample(c, 0, { leak_sensor: true });
        const again = await alertService.createAlert(alertService._buildLeakAlertData(c));
        expect(again).toBeNull();
        expect(await alertRows('LEAK_DETECTED', 'controller', c)).toHaveLength(1);

        // Переоткрытие идёт через verify-режим (sinceTimestamp) и обязано пройти.
        const rule = await AlertRule.findByTypeAndSeverity('LEAK_DETECTED', 'CRITICAL');
        const since = new Date(resolvedAt.getTime() - 60 * 1000);
        const reopened = await alertService.createAlert(
            { ...alertService._buildLeakAlertData(c), reopen_chain_id: '00000000-0000-4000-8000-000000000001', reopen_sequence: 2 },
            { sinceTimestamp: since, ruleSnapshot: rule }
        );
        expect(reopened).not.toBeNull();
        expect(await alertRows('LEAK_DETECTED', 'controller', c)).toHaveLength(2);
    });

    test('активное подавление глушит новый алерт того же кортежа', async () => {
        const c = await newController('Q03-suppress');
        await sample(c, 30, { leak_sensor: true });
        await sample(c, 0, { leak_sensor: true });
        await AlertSuppression.create({
            infrastructure_type: 'controller', infrastructure_id: c, alert_type: 'LEAK_DETECTED',
            duration_hours: 1, reason: 'faulty_sensor'
        });

        const created = await alertService.createAlert(alertService._buildLeakAlertData(c));

        expect(created).toBeNull();
        expect(await alertRows('LEAK_DETECTED', 'controller', c)).toHaveLength(0);
    });

    test('нечисловой infrastructure_id не роняет проверку (в тех таблицах id — INTEGER)', async () => {
        // Тип с правилом — иначе до проверки дело не дойдёт; не-controller —
        // шлюз устойчивости для него fail-open.
        const created = await alertService.createAlert({
            type: 'LEAK_DETECTED', severity: 'CRITICAL', infrastructure_type: 'water_source',
            infrastructure_id: 'ws-abc', message: 'текстовый идентификатор', data: {}
        });

        expect(created).not.toBeNull();
    });
});

describe('[Q-08] шлюз устойчивости меряет непрерывную аварию', () => {
    const cases = [
        ['LEAK_DETECTED', 'CRITICAL', { leak_sensor: true }, { leak_sensor: false }],
        ['HEATING_FAILURE', 'CRITICAL', { hot_water_in_temp: 20 }, { hot_water_in_temp: 60 }],
        ['VOLTAGE_ANOMALY', 'WARNING',
            { electricity_ph1: 170, electricity_ph2: 220, electricity_ph3: 220 },
            { electricity_ph1: 220, electricity_ph2: 220, electricity_ph3: 220 }],
    ];

    test.each(cases)('%s: два одиночных всплеска со здоровыми между ними — отказ', async (type, severity, bad, good) => {
        const c = await newController(`Q08-blip-${type}`);
        await sample(c, 540, bad);
        await sample(c, 300, good);
        await sample(c, 0, bad);
        const rule = { min_persistence_seconds: 60 };

        const res = await alertGates.checkPersistenceGate(
            { type, severity, infrastructure_type: 'controller', infrastructure_id: c }, rule
        );

        expect(res.allowed).toBe(false);
    });

    test.each(cases)('%s: непрерывная авария дольше порога — пропуск', async (type, severity, bad, good) => {
        const c = await newController(`Q08-hold-${type}`);
        await sample(c, 400, good);
        await sample(c, 120, bad);
        await sample(c, 60, bad);
        await sample(c, 0, bad);
        const rule = { min_persistence_seconds: 60 };

        const res = await alertGates.checkPersistenceGate(
            { type, severity, infrastructure_type: 'controller', infrastructure_id: c }, rule
        );

        expect(res.allowed).toBe(true);
    });
});
