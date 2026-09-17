/**
 * [A-06] Обновление здания не должно стирать связи, которых не касалось.
 *
 * Находка аудита 08.09.2026. `Building.update` был UPDATE с ФИКСИРОВАННЫМИ
 * шестнадцатью колонками: любое поле, отсутствующее в теле запроса,
 * превращалось в `undefined`, драйвер отправлял его как NULL, и колонка
 * очищалась. То есть «поле не передано» и «поле сброшено» были одним и тем же —
 * а смена НАЗВАНИЯ здания удаляла инфраструктурные связи.
 *
 * Почему тест против живой БД, а не мока. Весь дефект живёт внутри SQL и в том,
 * как драйвер переводит `undefined` в параметр запроса. Мок сверяет подстроки
 * текста запроса — текст же не менялся: там всегда стояло `SET … = $9, …`.
 * Мок сказал бы «запрос тот же» и на старом поведении, и на новом (правило
 * tests/CLAUDE.md: SQL проверяется здесь).
 *
 * Внешние ключи берутся из канонического файла схемы намеренно: без них тест
 * прошёл бы и на выдуманных id, то есть перестал бы отличать сохранённую связь
 * от записанного мусора.
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
const Building = require('../../../src/models/Building');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[A-06] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);

/** Вырезает блок `CREATE TABLE IF NOT EXISTS <table> ( … );` целиком. */
function extractCreateTable(sql, table) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i');
    const found = re.exec(sql);
    if (!found) throw new Error(`[A-06] DDL таблицы ${table} не найден в каноническом файле`);
    return found[0];
}

/** Вырезает все совпадения, падая на нуле: пустая выборка = молча неполный стенд. */
function extractAll(sql, re, what) {
    const found = sql.match(re);
    if (!found || !found.length) throw new Error(`[A-06] не найдено в каноническом файле: ${what}`);
    return found.join('\n');
}

const DDL = [
    'CREATE EXTENSION IF NOT EXISTS postgis;',
    extractCreateTable(INIT_SQL, 'transformers'),
    extractCreateTable(INIT_SQL, 'water_lines'),
    extractCreateTable(INIT_SQL, 'buildings'),
    // ВСЕ восемь колонок связей, а не только две проверяемые: старый запрос
    // писал в каждую из них, и стенд без них падал бы на отсутствии колонки,
    // маскируя настоящую причину отказа.
    extractAll(
        INIT_SQL,
        /^ALTER TABLE buildings ADD COLUMN IF NOT EXISTS (?:(?:primary|backup)_(?:transformer|line)|(?:cold|hot)_water_(?:line|supplier))_id .*$/gm,
        'колонки связей buildings.*_id'
    ),
    // Внешние ключи — из тех же DO-блоков канонического файла, но без обёртки
    // IF NOT EXISTS: стенд поднимается с нуля.
    extractAll(
        INIT_SQL,
        /ALTER TABLE buildings ADD CONSTRAINT fk_buildings_primary_transformer\s+FOREIGN KEY[^;]*;/,
        'внешний ключ buildings → transformers'
    ),
    extractAll(
        INIT_SQL,
        /ALTER TABLE buildings ADD CONSTRAINT fk_buildings_cold_water_line\s+FOREIGN KEY[^;]*;/,
        'внешний ключ buildings → water_lines'
    ),
].join('\n');

/** Здание со всеми обязательными полями канонической схемы. */
async function makeBuilding(fields) {
    const cols = Object.keys(fields);
    const params = cols.map((_c, i) => `$${i + 1}`).join(', ');
    const { rows } = await db.query(
        `INSERT INTO buildings (${cols.join(', ')}) VALUES (${params}) RETURNING building_id`,
        Object.values(fields)
    );
    return rows[0].building_id;
}

async function readBuilding(id) {
    const { rows } = await db.query('SELECT * FROM buildings WHERE building_id = $1', [id]);
    return rows[0];
}

describe('[A-06] Building.update — частичное обновление', () => {
    let transformerId;
    let waterLineId;
    let buildingId;

    beforeAll(async () => {
        await db.init();
        await db.query('DROP TABLE IF EXISTS buildings CASCADE');
        await db.query('DROP TABLE IF EXISTS transformers CASCADE');
        await db.query('DROP TABLE IF EXISTS water_lines CASCADE');
        await db.query(DDL);
    });

    afterAll(async () => {
        await db.query('DROP TABLE IF EXISTS buildings CASCADE');
        await db.query('DROP TABLE IF EXISTS transformers CASCADE');
        await db.query('DROP TABLE IF EXISTS water_lines CASCADE');
        await db.close();
    });

    beforeEach(async () => {
        await db.query('DELETE FROM buildings');
        await db.query('DELETE FROM transformers');
        await db.query('DELETE FROM water_lines');

        const t = await db.query(
            "INSERT INTO transformers (name, power_kva, voltage_kv) VALUES ('ТП-Олмазор', 400, 10) RETURNING transformer_id"
        );
        transformerId = t.rows[0].transformer_id;
        const w = await db.query(
            "INSERT INTO water_lines (name) VALUES ('ХВС-1') RETURNING line_id"
        );
        waterLineId = w.rows[0].line_id;

        buildingId = await makeBuilding({
            name: 'Дом 1',
            address: 'ул. Пример, 1',
            town: 'Ташкент',
            latitude: 41.31,
            longitude: 69.24,
            has_hot_water: true,
            primary_transformer_id: transformerId,
            cold_water_line_id: waterLineId,
        });
    });

    test('смена названия НЕ трогает инфраструктурные связи', async () => {
        // Сердцевина находки: раньше здесь обе связи обнулялись, потому что их
        // не было в теле запроса.
        await Building.update(buildingId, { name: 'Дом 1 (переименован)' });

        const row = await readBuilding(buildingId);
        expect(row.name).toBe('Дом 1 (переименован)');
        expect(row.primary_transformer_id).toBe(transformerId);
        expect(row.cold_water_line_id).toBe(waterLineId);
        // И остальные поля на месте — их тоже никто не передавал.
        expect(row.address).toBe('ул. Пример, 1');
        expect(row.has_hot_water).toBe(true);
    });

    test('явный null — это СБРОС связи, и он работает', async () => {
        // Отличие «не передано» от «сброшено» должно быть выразимым, иначе
        // отвязать здание станет нечем.
        await Building.update(buildingId, { primary_transformer_id: null });

        const row = await readBuilding(buildingId);
        expect(row.primary_transformer_id).toBeNull();
        // Вторая связь не пострадала.
        expect(row.cold_water_line_id).toBe(waterLineId);
        expect(row.name).toBe('Дом 1');
    });

    test('обновление координат не трогает ни связи, ни признак ГВС', async () => {
        await Building.update(buildingId, { latitude: 41.4, longitude: 69.3 });

        const row = await readBuilding(buildingId);
        expect(Number(row.latitude)).toBeCloseTo(41.4, 5);
        expect(row.has_hot_water).toBe(true);
        expect(row.primary_transformer_id).toBe(transformerId);
    });

    test('поле, которого нет в белом списке, до SQL не доходит', async () => {
        // Иначе частичное обновление стало бы дырой: тело запроса задаёт
        // колонки.
        await Building.update(buildingId, { name: 'Дом 2', building_id: 999999 });

        const row = await readBuilding(buildingId);
        expect(row.building_id).toBe(buildingId);
        expect(row.name).toBe('Дом 2');
    });

    test('пустое тело — это ошибка запроса, а не тихий успех', async () => {
        // Молча вернуть строку значило бы подтвердить несуществующую запись.
        await expect(Building.update(buildingId, {})).rejects.toMatchObject({ statusCode: 400 });
    });

    test('несуществующее здание → null, а не исключение', async () => {
        await expect(Building.update(999999, { name: 'нет такого' })).resolves.toBeNull();
    });

    test('связь можно переставить на другой объект', async () => {
        const t2 = await db.query(
            "INSERT INTO transformers (name, power_kva, voltage_kv) VALUES ('ТП-Фараби', 250, 10) RETURNING transformer_id"
        );
        await Building.update(buildingId, { primary_transformer_id: t2.rows[0].transformer_id });

        const row = await readBuilding(buildingId);
        expect(row.primary_transformer_id).toBe(t2.rows[0].transformer_id);
    });
});
