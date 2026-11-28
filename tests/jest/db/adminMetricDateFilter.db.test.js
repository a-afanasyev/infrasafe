/**
 * [Q-20(г)] Нечисловая дата в фильтре админского списка метрик — 400, а не 500.
 *
 * `start_date`/`end_date` уходят в `timestamp >= $1` как текст, и разбирает их
 * Postgres. На мусор он отвечает кодами класса 22 (не 22P02/22003, которые
 * обработчик уже знал), а catch контроллера через toClientError превращал
 * любую ошибку без статуса в глухую 500. Какие именно коды — проверяется здесь,
 * на живой базе: из текста запроса их не вывести.
 *
 * Запуск: npm run test:db.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const { getOptimizedMetrics } = require('../../../src/controllers/admin/adminMetricController');
const errorHandler = require('../../../src/middleware/errorHandler');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[db-test] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

// Минимальный стенд: фильтр трогает только `timestamp`. Тип столбца сверяется
// с каноническим DDL — разойдись он, тест проверял бы не то приведение.
const INIT_SQL = fs.readFileSync(path.join(__dirname, '../../../database/init/01_init_database.sql'), 'utf8');
if (!/CREATE TABLE IF NOT EXISTS metrics \([\s\S]*?\btimestamp timestamptz NOT NULL/.test(INIT_SQL)) {
    throw new Error('в 01_init_database.sql у metrics.timestamp не timestamptz — обновите стенд');
}

const run = async (query) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.set = () => res;
    let forwarded = null;
    await getOptimizedMetrics({ query }, res, (err) => { forwarded = err; });
    if (forwarded) errorHandler(forwarded, { correlationId: 't' }, res, () => {});
    return { res, pgCode: forwarded && forwarded.code };
};

beforeAll(async () => {
    await db.init();
    await db.query('DROP TABLE IF EXISTS metrics CASCADE');
    await db.query('CREATE TABLE metrics (metric_id bigserial PRIMARY KEY, controller_id integer, timestamp timestamptz NOT NULL)');
}, 20000);

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS metrics CASCADE');
    await db.close();
});

describe('[Q-20] admin metrics: мусор в start_date/end_date', () => {
    test.each([
        ['start_date', 'not-a-date', '22007'],
        ['end_date', '2026-13-45', '22008'],
    ])('%s=%s → 400 (Postgres %s), текст СУБД наружу не уходит', async (param, value, code) => {
        const { res, pgCode } = await run({ [param]: value });

        expect(pgCode).toBe(code);
        expect(res.statusCode).toBe(400);
        expect(JSON.stringify(res.body)).not.toMatch(/invalid input|out of range|timestamp/i);
    });

    test('валидная дата по-прежнему 200', async () => {
        const { res } = await run({ start_date: '2026-01-01' });
        expect(res.statusCode).toBe(200);
    });
});
