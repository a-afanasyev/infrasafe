/**
 * [N-09] Измеренный ноль в DTO `/buildings-metrics` остаётся нулём.
 *
 * Аудит 22.09.2026 прочитал `row.x ? parseFloat(row.x) : null` как «0 В на фазе
 * превращается в null» — оператор видел бы «Нет данных» вместо аварии. На живом
 * стенде это НЕ воспроизвелось: метрические колонки — `numeric`, драйвер `pg`
 * отдаёт их СТРОКОЙ (`'0.00'`), а непустая строка истинна. Поведение было верным
 * по совпадению: включи кто-нибудь `types.setTypeParser(1700, parseFloat)` —
 * обычная «оптимизация», — и ноль стал бы числом `0`, ложным, а находка ожила бы
 * молча. Поэтому маппинг переведён на явную проверку отсутствия, а тест ниже
 * гоняет ОБА представления: строку по умолчанию и число с парсером.
 *
 * Почему здесь, а не в юнитах: мок подставил бы в строку то, что решил автор
 * теста, а проверять нужно то, что возвращает настоящий драйвер из настоящей
 * колонки. DDL — из канонических файлов, как требует tests/CLAUDE.md.
 *
 * Как запускать: `npm run test:db` (живой Postgres в DB_*). Suite не
 * пропускается при недоступной БД — пропуск был бы ложным зелёным.
 */

const fs = require('fs');
const path = require('path');

const { types } = require('pg');
const db = require('../../../src/config/database');
const { getBuildingsWithMetrics } = require('../../../src/services/buildingMetricsService');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[N-09] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');
const INIT_SQL = read('database/init/01_init_database.sql');
const UK_MIGRATION = read('database/migrations/011_uk_integration.sql');

function extractCreateTable(sql, table) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i');
    const found = re.exec(sql);
    if (!found) throw new Error(`[N-09] DDL таблицы ${table} не найден в каноническом файле`);
    return found[0];
}

function extractLine(sql, re, what) {
    const found = re.exec(sql);
    if (!found) throw new Error(`[N-09] не найдено в каноническом файле: ${what}`);
    return found[0];
}

const DDL = [
    'CREATE EXTENSION IF NOT EXISTS postgis;',
    extractCreateTable(INIT_SQL, 'buildings'),
    extractCreateTable(INIT_SQL, 'controllers'),
    extractCreateTable(INIT_SQL, 'metrics'),
    // Запрос DTO читает `b.external_id` — колонку добавляет миграция 011.
    extractLine(UK_MIGRATION, /^ALTER TABLE buildings ADD COLUMN IF NOT EXISTS external_id .*$/m, 'buildings.external_id'),
].join('\n');

const dropAll = async () => {
    await db.query('DROP TABLE IF EXISTS metrics CASCADE');
    await db.query('DROP TABLE IF EXISTS controllers CASCADE');
    await db.query('DROP TABLE IF EXISTS buildings CASCADE');
};

describe('[N-09] DTO buildings-metrics: ноль из numeric-колонки не становится null', () => {
    let buildingId;

    beforeAll(async () => {
        await db.init();
        await dropAll();
        await db.query(DDL);
    });

    afterAll(async () => {
        await dropAll();
        await db.close();
    });

    beforeEach(async () => {
        await db.query('DELETE FROM metrics');
        await db.query('DELETE FROM controllers');
        await db.query('DELETE FROM buildings');

        const b = await db.query(
            `INSERT INTO buildings (name, address, town, latitude, longitude)
             VALUES ('Дом N-09', 'ул. Нулевая, 0', 'Ташкент', 41.311100, 69.279700)
             RETURNING building_id`
        );
        buildingId = b.rows[0].building_id;
        const c = await db.query(
            `INSERT INTO controllers (serial_number, building_id, status)
             VALUES ('N09-CTRL', $1, 'online') RETURNING controller_id`,
            [buildingId]
        );
        // Пропало питание на двух фазах, давления и температуры — ровный ноль.
        await db.query(
            `INSERT INTO metrics (controller_id, timestamp,
                electricity_ph1, electricity_ph2, electricity_ph3,
                cold_water_pressure, hot_water_in_pressure, air_temp)
             VALUES ($1, now(), 0, 0, 220.5, 0, 0, 0)`,
            [c.rows[0].controller_id]
        );
    });

    const fetchBuilding = async () => {
        const { data } = await getBuildingsWithMetrics(true);
        return data.find((row) => row.building_id === buildingId);
    };

    const expectZerosKept = (row) => {
        expect(row.electricity_ph1).toBe(0);
        expect(row.electricity_ph2).toBe(0);
        expect(row.cold_water_pressure).toBe(0);
        expect(row.hot_water_in_pressure).toBe(0);
        expect(row.air_temp).toBe(0);
        // Ненулевое значение приводится к числу.
        expect(row.electricity_ph3).toBe(220.5);
    };

    test('измеренный 0 остаётся 0, а не null (numeric приходит строкой)', async () => {
        const { rows } = await db.query('SELECT electricity_ph1 FROM metrics LIMIT 1');
        // Фиксируем, какое представление проверяется в этом тесте.
        expect(typeof rows[0].electricity_ph1).toBe('string');

        expectZerosKept(await fetchBuilding());
    });

    test('…и остаётся 0, когда драйвер отдаёт numeric числом', async () => {
        // Ровно тот сценарий, в котором прежний маппинг по истинности ломался:
        // с парсером `0` приходит числом и ложен.
        types.setTypeParser(1700, parseFloat);
        try {
            const { rows } = await db.query('SELECT electricity_ph1 FROM metrics LIMIT 1');
            expect(rows[0].electricity_ph1).toBe(0);

            expectZerosKept(await fetchBuilding());
        } finally {
            types.setTypeParser(1700, (value) => value);
        }
    });

    test('отсутствующее значение по-прежнему null', async () => {
        const row = await fetchBuilding();

        expect(row.amperage_ph1).toBeNull();
        expect(row.humidity).toBeNull();
    });
});
