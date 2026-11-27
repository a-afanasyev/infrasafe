/**
 * `powerAnalyticsService.getTransformerPower` против НАСТОЯЩЕГО Postgres.
 *
 * Дефект найден проверкой за авторизацией 27.11.2026: `GET /api/power-analytics/
 * transformers/:id` отвечал 500 на ЛЮБОМ идентификаторе. Запрос оборачивал общий
 * SELECT в подзапрос и фильтровал `WHERE transformer_id = $1`, а подзапрос отдаёт
 * этот столбец под именем `id` — Postgres отвечал «column "transformer_id" does
 * not exist». Маршрут не работал никогда.
 *
 * Юнит-тест сервиса при этом зелёный: БД в нём замокана и сверяет только текст
 * запроса. Четвёртый прод-дефект того же класса (см. tests/CLAUDE.md) —
 * поэтому проверка здесь, на живой схеме.
 *
 * Запуск: npm run test:db.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const powerAnalyticsService = require('../../../src/services/powerAnalyticsService');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(`[db-test] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу.`);
}

const INIT_SQL = fs.readFileSync(path.join(__dirname, '../../../database/init/01_init_database.sql'), 'utf8');

function extract(re, what) {
    const found = INIT_SQL.match(re);
    if (!found || !found.length) throw new Error(`не найдено в каноническом файле: ${what}`);
    return found.join('\n');
}

const DDL = [
    'CREATE EXTENSION IF NOT EXISTS postgis;',
    extract(/CREATE TABLE IF NOT EXISTS transformers \([\s\S]*?\n\);/i, 'transformers'),
    extract(/CREATE TABLE IF NOT EXISTS buildings \([\s\S]*?\n\);/i, 'buildings'),
    extract(/^ALTER TABLE buildings ADD COLUMN IF NOT EXISTS (?:primary|backup)_transformer_id .*$/gm, 'buildings.*_transformer_id'),
    extract(/CREATE TABLE IF NOT EXISTS controllers \([\s\S]*?\n\);/i, 'controllers'),
    extract(/CREATE TABLE IF NOT EXISTS metrics \([\s\S]*?\n\);/i, 'metrics'),
].join('\n');

let withLoad;
let idle;

beforeAll(async () => {
    await db.init();
    for (const t of ['metrics', 'controllers', 'buildings', 'transformers']) await db.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    await db.query(DDL);

    const tr = await db.query(
        `INSERT INTO transformers (name, power_kva, voltage_kv) VALUES ('ТП-нагруженный', 630, 10), ('ТП-пустой', 400, 10) RETURNING transformer_id`
    );
    [withLoad, idle] = tr.rows.map((r) => r.transformer_id);
    const b = await db.query(
        `INSERT INTO buildings (name, address, town, latitude, longitude, primary_transformer_id)
         VALUES ('Дом 1', 'ул. Тестовая, 1', 'Ташкент', 41.31, 69.24, $1) RETURNING building_id`,
        [withLoad]
    );
    const c = await db.query(
        `INSERT INTO controllers (serial_number, building_id, status) VALUES ('PT-DB-1', $1, 'online') RETURNING controller_id`,
        [b.rows[0].building_id]
    );
    await db.query(
        `INSERT INTO metrics (controller_id, timestamp, electricity_ph1, electricity_ph2, electricity_ph3, amperage_ph1, amperage_ph2, amperage_ph3)
         VALUES ($1, NOW(), 220, 221, 219, 10, 11, 12)`,
        [c.rows[0].controller_id]
    );
}, 30000);

afterAll(async () => {
    for (const t of ['metrics', 'controllers', 'buildings', 'transformers']) await db.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    await db.close();
});

describe('getTransformerPower на живой схеме', () => {
    test('существующий трансформатор с нагрузкой — запрос выполняется и возвращает его строку', async () => {
        const row = await powerAnalyticsService.getTransformerPower(withLoad);

        expect(row).not.toBeNull();
        expect(Number(row.id ?? row.transformer_id)).toBe(withLoad);
        expect(JSON.stringify(row)).toContain('ТП-нагруженный');
    });

    test('трансформатор без зданий — строка есть, а не ошибка', async () => {
        const row = await powerAnalyticsService.getTransformerPower(idle);

        expect(row).not.toBeNull();
        expect(Number(row.id ?? row.transformer_id)).toBe(idle);
    });

    test('несуществующий идентификатор — null, а не исключение', async () => {
        await expect(powerAnalyticsService.getTransformerPower(999999999)).resolves.toBeNull();
    });

    test('фильтр действительно отбирает одну строку, а не возвращает первую попавшуюся', async () => {
        const a = await powerAnalyticsService.getTransformerPower(withLoad);
        const b = await powerAnalyticsService.getTransformerPower(idle);

        expect(Number(a.id ?? a.transformer_id)).not.toBe(Number(b.id ?? b.transformer_id));
    });

    test('общий список по-прежнему отдаёт оба трансформатора', async () => {
        const all = await powerAnalyticsService.getTransformersPower();
        expect(all.length).toBe(2);
    });
});
