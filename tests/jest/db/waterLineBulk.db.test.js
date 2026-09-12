/**
 * [AR-3(б)] Пакетные операции по водным линиям против НАСТОЯЩЕГО Postgres.
 *
 * Почему не мок. Вся содержательная часть этих методов живёт ВНУТРИ SQL:
 *
 *   * `= ANY($1)` с массивом int — работает ли передача массива параметром
 *     (мок сравнивает текст запроса и скажет «да» на любой форме);
 *   * `OR` по двум внешним ключам — здание, подключённое ТОЛЬКО горячей
 *     линией, обязано считаться связанным; потеря половины условия не меняет
 *     ни одной подстроки, которую проверяет мок;
 *   * `RETURNING line_id` — на нём стоит `affected` в ответе API;
 *   * и главное: у `buildings` есть внешние ключи на `water_lines` БЕЗ
 *     `ON DELETE`. То есть удаление связанной линии падает с 23503, а проверка
 *     связанных зданий — не украшение, а единственное, что превращает 500 в
 *     осмысленный 400. Мок этого не покажет: в нём нет ограничений.
 *
 * Претензия из BACKLOG.md (AR-3(б)) была про слои — сырые `pool.query` в
 * контроллере. Но переносить SQL, проверяя его моком, значит поменять адрес
 * дефекта и не проверить сам SQL.
 *
 * Как запускать
 * -------------
 *   npm run test:db      — требует живой Postgres в DB_* переменных.
 *
 * Suite НЕ пропускается при недоступной БД (пропуск = ложный зелёный) —
 * тот же принцип, что в accountLockout.db.test.js.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const WaterLine = require('../../../src/models/WaterLine');
const { WATER_LINE_STATUS, ALLOWED_STATUSES } = require('../../../src/models/WaterLine');

// Защита от запуска по живой базе: тест создаёт и чистит таблицы.
const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[AR-3(б)] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

// DDL берётся из КАНОНИЧЕСКИХ файлов схемы, а не переписывается здесь
// (правило tests/CLAUDE.md): переписанный стенд расходится со схемой ровно так
// же, как разъезжается запрос, и тест перестаёт быть свидетельством. Внешние
// ключи взяты оттуда же намеренно — без них тест не отличил бы рабочую проверку
// связанных зданий от выброшенной: боевые `fk_buildings_cold_water_line` и
// `fk_buildings_hot_water_line` идут БЕЗ `ON DELETE`, то есть запрещают удаление.
const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);
const MIGRATION_040 = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/040_water_lines_status_check.sql'),
    'utf8'
);

/** Вырезает блок `CREATE TABLE IF NOT EXISTS <table> ( … );` целиком. */
function extractCreateTable(sql, table) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i');
    const found = re.exec(sql);
    if (!found) throw new Error(`[AR-3(б)] DDL таблицы ${table} не найден в каноническом файле`);
    return found[0];
}

/** Вырезает все совпадения, падая на нуле: пустая выборка = молча неполный стенд. */
function extractAll(sql, re, what) {
    const found = sql.match(re);
    if (!found || !found.length) throw new Error(`[AR-3(б)] не найдено в каноническом файле: ${what}`);
    return found.join('\n');
}

const DDL = [
    // PostGIS — обе канонические таблицы объявляют колонку geom.
    'CREATE EXTENSION IF NOT EXISTS postgis;',
    extractCreateTable(INIT_SQL, 'water_lines'),
    extractCreateTable(INIT_SQL, 'buildings'),
    extractAll(
        INIT_SQL,
        /^ALTER TABLE buildings ADD COLUMN IF NOT EXISTS (?:cold|hot)_water_line_id .*$/gm,
        'колонки buildings.*_water_line_id'
    ),
    extractAll(
        INIT_SQL,
        /ALTER TABLE buildings ADD CONSTRAINT fk_buildings_(?:cold|hot)_water_line\s+FOREIGN KEY[^;]*;/g,
        'внешние ключи buildings → water_lines'
    ),
    // Домен статуса на стороне БД (M-12b) — чтобы проверить, что whitelist
    // модели и CHECK не разъехались.
    extractAll(
        MIGRATION_040,
        /ALTER TABLE water_lines\s+ADD CONSTRAINT water_lines_status_check\s+CHECK \([^;]*\);/,
        'CHECK домена water_lines.status (миграция 040)'
    ),
].join('\n');

/** Создаёт линию и возвращает её id. */
async function makeLine(name, status = WATER_LINE_STATUS.ACTIVE) {
    const { rows } = await db.query(
        'INSERT INTO water_lines (name, status) VALUES ($1, $2) RETURNING line_id',
        [name, status]
    );
    return rows[0].line_id;
}

/**
 * Создаёт здание, подключённое к указанным линиям (любая может быть null).
 * address/town/latitude/longitude заполняются потому, что каноническая схема
 * объявляет их NOT NULL — на переписанном вручную стенде этого видно не было бы.
 */
async function makeBuilding(name, { cold = null, hot = null } = {}) {
    const { rows } = await db.query(
        `INSERT INTO buildings (name, address, town, latitude, longitude, cold_water_line_id, hot_water_line_id)
         VALUES ($1, $2, 'Тестовый район', 41.3, 69.2, $3, $4) RETURNING building_id`,
        [name, `${name}, тестовый адрес`, cold, hot]
    );
    return rows[0].building_id;
}

const statusOf = async (id) => {
    const { rows } = await db.query('SELECT status, updated_at FROM water_lines WHERE line_id = $1', [id]);
    return rows[0] || null;
};

const existsLine = async (id) => {
    const { rows } = await db.query('SELECT 1 FROM water_lines WHERE line_id = $1', [id]);
    return rows.length > 0;
};

beforeAll(async () => {
    await db.init();
    // Стенд поднимается с нуля: извлечённые из init ALTER'ы идут без обёртки
    // `IF NOT EXISTS`, которая в каноническом файле живёт в DO-блоке, поэтому
    // повторный прогон по недоубранному стенду упал бы на дубле констрейнта.
    await db.query('DROP TABLE IF EXISTS buildings');
    await db.query('DROP TABLE IF EXISTS water_lines');
    await db.query(DDL);
}, 20000);

beforeEach(async () => {
    // buildings первыми — они ссылаются на water_lines.
    await db.query('DELETE FROM buildings');
    await db.query('DELETE FROM water_lines');
});

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS buildings');
    await db.query('DROP TABLE IF EXISTS water_lines');
    await db.close();
});

describe('[AR-3(б)] WaterLine.findConnectedBuildingIds', () => {
    test('находит здание, подключённое ХОЛОДНОЙ линией', async () => {
        const line = await makeLine('Холодная-1');
        const building = await makeBuilding('Дом 1', { cold: line });

        await expect(WaterLine.findConnectedBuildingIds([line])).resolves.toEqual([building]);
    });

    test('находит здание, подключённое ТОЛЬКО горячей линией', async () => {
        // Здесь ломается любая версия запроса, потерявшая вторую половину OR.
        const line = await makeLine('Горячая-1');
        const building = await makeBuilding('Дом 2', { hot: line });

        await expect(WaterLine.findConnectedBuildingIds([line])).resolves.toEqual([building]);
    });

    test('собирает здания по НЕСКОЛЬКИМ линиям и не дублирует дом на двух линиях', async () => {
        const cold = await makeLine('Холодная-2');
        const hot = await makeLine('Горячая-2');
        const both = await makeBuilding('Дом на двух линиях', { cold, hot });
        const onlyCold = await makeBuilding('Дом на холодной', { cold });

        const found = await WaterLine.findConnectedBuildingIds([cold, hot]);
        expect([...found].sort((a, b) => a - b)).toEqual([both, onlyCold].sort((a, b) => a - b));
    });

    test('несвязанная линия и пустой список дают пустой результат', async () => {
        const line = await makeLine('Ничья');
        await makeBuilding('Дом без линий');

        await expect(WaterLine.findConnectedBuildingIds([line])).resolves.toEqual([]);
        await expect(WaterLine.findConnectedBuildingIds([])).resolves.toEqual([]);
    });
});

describe('[AR-3(б)] WaterLine.deleteMany', () => {
    test('удаляет только перечисленные линии и возвращает их id', async () => {
        const a = await makeLine('A');
        const b = await makeLine('B');
        const keep = await makeLine('C');

        const deleted = await WaterLine.deleteMany([a, b]);
        expect([...deleted].sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));

        await expect(existsLine(a)).resolves.toBe(false);
        await expect(existsLine(b)).resolves.toBe(false);
        await expect(existsLine(keep)).resolves.toBe(true);
    });

    test('несуществующие id и пустой список: 0 удалённых, без ошибки', async () => {
        await expect(WaterLine.deleteMany([999999])).resolves.toEqual([]);
        await expect(WaterLine.deleteMany([])).resolves.toEqual([]);
    });

    test('связанная линия падает на внешнем ключе — поэтому проверка перед удалением обязательна', async () => {
        // Тест фиксирует ПРИЧИНУ существования проверки связанных зданий:
        // без неё пользователь получил бы 500 от ограничения БД.
        const line = await makeLine('Связанная');
        await makeBuilding('Потребитель', { cold: line });

        await expect(WaterLine.deleteMany([line])).rejects.toThrow();
        await expect(existsLine(line)).resolves.toBe(true);
    });
});

describe('[AR-3(б)] WaterLine.updateStatusMany', () => {
    test('меняет статус перечисленным линиям и двигает updated_at', async () => {
        const a = await makeLine('A', WATER_LINE_STATUS.ACTIVE);
        const b = await makeLine('B', WATER_LINE_STATUS.ACTIVE);
        const keep = await makeLine('C', WATER_LINE_STATUS.ACTIVE);
        const before = (await statusOf(a)).updated_at;

        const updated = await WaterLine.updateStatusMany([a, b], WATER_LINE_STATUS.MAINTENANCE);
        expect([...updated].sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));

        expect((await statusOf(a)).status).toBe(WATER_LINE_STATUS.MAINTENANCE);
        expect((await statusOf(b)).status).toBe(WATER_LINE_STATUS.MAINTENANCE);
        expect((await statusOf(keep)).status).toBe(WATER_LINE_STATUS.ACTIVE);
        expect((await statusOf(a)).updated_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    test('[M-12] статус вне домена отвергается 400 и НИЧЕГО не пишет', async () => {
        const line = await makeLine('A', WATER_LINE_STATUS.ACTIVE);

        await expect(WaterLine.updateStatusMany([line], 'demolished'))
            .rejects.toMatchObject({ statusCode: 400 });
        expect((await statusOf(line)).status).toBe(WATER_LINE_STATUS.ACTIVE);
    });

    test('пустой список ничего не меняет и не падает', async () => {
        await expect(WaterLine.updateStatusMany([], WATER_LINE_STATUS.INACTIVE)).resolves.toEqual([]);
    });

    test('[M-12b] whitelist модели не разъехался с CHECK в БД', async () => {
        // Два источника одного домена: ALLOWED_STATUSES в модели и
        // water_lines_status_check из миграции 040. Разъехаться они могут только
        // молча — новое значение в модели прошло бы assertValidStatus и упало бы
        // на CHECK'е уже 500-й. Проверяем каждое значение записью.
        const line = await makeLine('Все статусы');

        for (const status of ALLOWED_STATUSES) {
            await expect(WaterLine.updateStatusMany([line], status)).resolves.toEqual([line]);
            expect((await statusOf(line)).status).toBe(status);
        }
    });
});
