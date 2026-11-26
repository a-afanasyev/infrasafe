/**
 * [A12-10] Очистка `integration_log` по сроку — против НАСТОЯЩЕГО Postgres.
 *
 * Граница «старше N дней» живёт внутри SQL (`($1 || ' days')::interval`),
 * а замоканная БД сверяет только подстроки запроса: перепутанный знак
 * сравнения стёр бы свежий журнал, и юнит-тест остался бы зелёным.
 *
 * Запуск: npm run test:db (см. tests/CLAUDE.md).
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const IntegrationLog = require('../../../src/models/IntegrationLog');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[A12-10] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

// DDL берётся из канонической схемы, а не переписывается здесь.
const UK_SQL = fs.readFileSync(path.join(__dirname, '../../../database/init/03_uk_integration.sql'), 'utf8');
const TABLE_DDL = /CREATE TABLE IF NOT EXISTS integration_log \([\s\S]*?\);/.exec(UK_SQL);
if (!TABLE_DDL) {
    throw new Error('[A12-10] в database/init/03_uk_integration.sql не найден CREATE TABLE integration_log');
}

const insertAged = async (label, ageDays) => {
    await db.query(
        `INSERT INTO integration_log (direction, entity_type, entity_id, action, status, created_at)
         VALUES ('from_uk', 'request', $1, 'request.status_changed', 'success',
                 NOW() - ($2 || ' days')::interval)`,
        [label, String(ageDays)]
    );
};

const remaining = async () => {
    const { rows } = await db.query('SELECT entity_id FROM integration_log ORDER BY entity_id');
    return rows.map((r) => r.entity_id);
};

beforeAll(async () => {
    await db.init();
    await db.query('DROP TABLE IF EXISTS integration_log');
    await db.query(TABLE_DDL[0]);
}, 20000);

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS integration_log');
    await db.close();
});

beforeEach(async () => {
    await db.query('DELETE FROM integration_log');
});

describe('[A12-10] IntegrationLog.deleteOlderThan', () => {
    test('удаляет строки старше срока и не трогает более свежие', async () => {
        await insertAged('d001', 1);
        await insertAged('d089', 89);
        await insertAged('d091', 91);
        await insertAged('d400', 400);

        const deleted = await IntegrationLog.deleteOlderThan(90);

        expect(deleted).toBe(2);
        expect(await remaining()).toEqual(['d001', 'd089']);
    });

    test('срок — параметр: при 30 днях уходит и то, что пережило бы 90', async () => {
        await insertAged('d029', 29);
        await insertAged('d031', 31);

        expect(await IntegrationLog.deleteOlderThan(30)).toBe(1);
        expect(await remaining()).toEqual(['d029']);
    });

    test('пустая таблица — ноль, а не ошибка', async () => {
        expect(await IntegrationLog.deleteOlderThan(90)).toBe(0);
    });

    test.each([0, -5, 1.5, NaN, '90; DROP TABLE integration_log', null, undefined])(
        'некорректный срок %p отвергается и ничего не удаляет',
        async (bad) => {
            await insertAged('d400', 400);
            await expect(IntegrationLog.deleteOlderThan(bad)).rejects.toThrow(/days/);
            expect(await remaining()).toEqual(['d400']);
        }
    );
});
