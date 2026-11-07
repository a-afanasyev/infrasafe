/**
 * [S-INJ-2, аудит 05.11.2026] Metric.findByControllerId / aggregateByControllerId
 * против НАСТОЯЩЕГО Postgres.
 *
 * Что проверяется и почему здесь, а не на моке:
 *   * LIMIT стоит ВСЕГДА и равен metricsQuery.maxRows — мок не отличит
 *     «LIMIT в тексте запроса» от «LIMIT, который реально режет выдачу»;
 *   * агрегаты считаются SQL по ВСЕМУ периоду: экстремум, лежащий в строке
 *     за пределами первых maxRows (по времени — самой старой), обязан попасть
 *     в max. Ревью плана: при одном измерении в минуту неделя = 10 080 строк,
 *     и JS-агрегация по обрезанной выборке теряла старые экстремумы;
 *   * форма ответа агрегата совпадает с прежним aggregateMetrics (JS).
 *
 * Запуск: npm run test:db (живой Postgres в DB_*). Набор НЕ пропускает себя при
 * недоступной БД — см. accountLockout.db.test.js, R2-24.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const Metric = require('../../../src/models/Metric');
const { metricsQuery } = require('../../../src/config/thresholds');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[R2-24] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

// DDL таблицы metrics — из канонического init, FK на controllers срезан:
// стенду нужна одна таблица, а не вся схема.
const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);
const metricsDdlMatch = INIT_SQL.match(/CREATE TABLE IF NOT EXISTS metrics \([\s\S]*?\n\);/);
if (!metricsDdlMatch) throw new Error('CREATE TABLE metrics не найден в 01_init_database.sql');
const METRICS_DDL = metricsDdlMatch[0].replace(/\s+REFERENCES\s+controllers\(controller_id\)/, '');

const CONTROLLER_ID = 424242;
const ROWS = metricsQuery.maxRows + 50; // заведомо больше потолка

// Ряд: timestamp убывает от T0 назад по минуте; electricity_ph1 = 220 везде,
// кроме САМОЙ СТАРОЙ строки (999) — она в сырой выдаче (DESC + LIMIT) не
// появляется, но в агрегате обязана быть.
const T0 = Date.UTC(2026, 0, 31, 12, 0, 0);
const tsOf = (i) => new Date(T0 - i * 60_000).toISOString();

beforeAll(async () => {
    await db.init();
    await db.query('DROP TABLE IF EXISTS metrics');
    await db.query(METRICS_DDL);
    const values = [];
    const params = [];
    for (let i = 0; i < ROWS; i++) {
        const v = i === ROWS - 1 ? 999 : 220;
        params.push(CONTROLLER_ID, tsOf(i), v, 20 + (i % 5));
        const b = params.length;
        values.push(`($${b - 3}, $${b - 2}, $${b - 1}, $${b})`);
    }
    await db.query(
        `INSERT INTO metrics (controller_id, timestamp, electricity_ph1, air_temp) VALUES ${values.join(',')}`,
        params
    );
}, 30000);

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS metrics');
    await db.close();
});

describe('[S-INJ-2] Metric.findByControllerId — LIMIT всегда', () => {
    test(`без limit отдаёт ровно maxRows (${metricsQuery.maxRows}) самых новых строк`, async () => {
        const rows = await Metric.findByControllerId(CONTROLLER_ID, tsOf(ROWS), tsOf(0));
        expect(rows).toHaveLength(metricsQuery.maxRows);
        expect(new Date(rows[0].timestamp).toISOString()).toBe(tsOf(0));
        // самая старая строка (с экстремумом 999) обрезана
        expect(rows.some((r) => Number(r.electricity_ph1) === 999)).toBe(false);
    });

    test('limit больше потолка — приводится к потолку; кривой limit — тоже', async () => {
        expect(await Metric.findByControllerId(CONTROLLER_ID, null, null, 10 ** 9)).toHaveLength(metricsQuery.maxRows);
        expect(await Metric.findByControllerId(CONTROLLER_ID, null, null, 'abc')).toHaveLength(metricsQuery.maxRows);
        expect(await Metric.findByControllerId(CONTROLLER_ID, null, null, 7)).toHaveLength(7);
    });
});

describe('[S-INJ-2] Metric.aggregateByControllerId — по всему периоду, в SQL', () => {
    test('экстремум за пределами maxRows присутствует в max', async () => {
        const agg = await Metric.aggregateByControllerId(CONTROLLER_ID, tsOf(ROWS), tsOf(0));
        expect(agg.count).toBe(ROWS);
        expect(agg.electricity_ph1.max).toBe(999);
        expect(agg.electricity_ph1.min).toBe(220);
        expect(agg.electricity_ph1.count).toBe(ROWS);
        expect(agg.electricity_ph1.avg).toBeCloseTo((220 * (ROWS - 1) + 999) / ROWS, 3);
    });

    test('форма ответа — как у прежнего aggregateMetrics: period и null для пустых колонок', async () => {
        const agg = await Metric.aggregateByControllerId(CONTROLLER_ID, tsOf(ROWS), tsOf(0));
        expect(new Date(agg.period.start).toISOString()).toBe(tsOf(ROWS - 1));
        expect(new Date(agg.period.end).toISOString()).toBe(tsOf(0));
        expect(agg.humidity).toBeNull();          // колонка без значений
        expect(agg.air_temp.min).toBe(20);
        expect(agg.leak_sensor).toBeUndefined();  // не числовая — в агрегате нет
    });

    test('пустой период → { count: 0, period: null }', async () => {
        const agg = await Metric.aggregateByControllerId(CONTROLLER_ID, '2000-01-01T00:00:00Z', '2000-01-02T00:00:00Z');
        expect(agg).toEqual({ count: 0, period: null });
    });
});
