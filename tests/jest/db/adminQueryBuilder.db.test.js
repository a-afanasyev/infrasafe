/**
 * [CO-5] `buildPaginatedList` против НАСТОЯЩЕГО Postgres.
 *
 * Претензия CO-5 дословно: «dbMock матчит запросы по подстрокам SQL:
 * `COUNT(*)` всегда возвращает `'0'`, пагинация непроверяема в принципе».
 * Существующий `adminQueryBuilder.test.js` (29 тестов) проверяет ТЕКСТ
 * собранного запроса — он нужен и остаётся, но подтвердить он может ровно
 * одно: что строка собралась так, как задумано. Что эта строка делает с
 * данными, из него не следует:
 *
 *   * LIMIT/OFFSET никогда не применялись к строкам — «страница 2» в моке
 *     возвращает те же канонические данные, что и страница 1;
 *   * `total` приходил из самого теста, поэтому арифметика totalPages
 *     (включая `Math.max(1, …)` на пустой выборке) не проверялась;
 *   * WHERE не исполнялся — ни `ILIKE`, ни `>=`/`<=`, ни OR-поиск;
 *   * и главное — экранирование подстановочных знаков (M-8). `%` и `_`
 *     экранируются в `validateSearchString` обратной косой чертой, и
 *     работает это только потому, что у `ILIKE` в PostgreSQL символ
 *     экранирования по умолчанию — именно `\`. Проверить такое утверждение
 *     можно исключительно запросом к живой БД: мок вернёт заготовку на любой
 *     строке шаблона.
 *
 * Здесь проверяется ПОВЕДЕНИЕ: строки, счётчики, порядок. Текстовые проверки
 * остаются на месте — эти два набора дополняют друг друга, а не заменяют.
 *
 * Как запускать
 * -------------
 *   npm run test:db      — требует живой Postgres в DB_* переменных.
 *
 * Suite НЕ пропускается при недоступной БД (пропуск = ложный зелёный).
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const { buildPaginatedList } = require('../../../src/utils/adminQueryBuilder');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[CO-5] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

// DDL берётся из канонического файла схемы (правило tests/CLAUDE.md).
const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);

function extractCreateTable(sql, table) {
    const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i');
    const found = re.exec(sql);
    if (!found) throw new Error(`[CO-5] DDL таблицы ${table} не найден в каноническом файле`);
    return found[0];
}

function extractAll(sql, re, what) {
    const found = sql.match(re);
    if (!found || !found.length) throw new Error(`[CO-5] не найдено в каноническом файле: ${what}`);
    return found.join('\n');
}

const DDL = [
    'CREATE EXTENSION IF NOT EXISTS postgis;',
    extractCreateTable(INIT_SQL, 'water_lines'),
    extractCreateTable(INIT_SQL, 'buildings'),
    extractAll(
        INIT_SQL,
        /^ALTER TABLE buildings ADD COLUMN IF NOT EXISTS (?:cold|hot)_water_line_id .*$/gm,
        'колонки buildings.*_water_line_id'
    ),
].join('\n');

/** `pool`, которого ждёт buildPaginatedList: ему нужен только .query. */
const pool = { query: (text, params) => db.query(text, params) };

/** Конфиг плоского листинга по зданиям — форма admin-контроллера. */
const BUILDINGS_CONFIG = {
    table: 'buildings',
    entityType: 'buildings',
    defaultSort: 'building_id',
    defaultLimit: 50,
    searchColumns: ['name', 'address'],
    filters: [
        { param: 'town', column: 'town', kind: 'exact' },
        { param: 'name', column: 'name', kind: 'like' },
        { param: 'year_min', column: 'construction_year', kind: 'gte', cast: 'int' },
        { param: 'year_max', column: 'construction_year', kind: 'lte', cast: 'int' },
    ],
};

const list = (config, query = {}) => buildPaginatedList(pool, config, { query });

async function makeBuilding({ name, address = 'адрес', town = 'Город', year = null, cold = null }) {
    const { rows } = await db.query(
        `INSERT INTO buildings (name, address, town, latitude, longitude, construction_year, cold_water_line_id)
         VALUES ($1, $2, $3, 41.3, 69.2, $4, $5) RETURNING building_id`,
        [name, address, town, year, cold]
    );
    return rows[0].building_id;
}

async function makeLine(name) {
    const { rows } = await db.query(
        'INSERT INTO water_lines (name) VALUES ($1) RETURNING line_id',
        [name]
    );
    return rows[0].line_id;
}

beforeAll(async () => {
    await db.init();
    await db.query('DROP TABLE IF EXISTS buildings');
    await db.query('DROP TABLE IF EXISTS water_lines');
    await db.query(DDL);
    // construction_year канонически добавляется отдельным ALTER'ом среди
    // десятков других; берём только нужную колонку, если её ещё нет.
    await db.query('ALTER TABLE buildings ADD COLUMN IF NOT EXISTS construction_year INTEGER');
}, 20000);

beforeEach(async () => {
    await db.query('DELETE FROM buildings');
    await db.query('DELETE FROM water_lines');
});

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS buildings');
    await db.query('DROP TABLE IF EXISTS water_lines');
    await db.close();
});

describe('[CO-5] пагинация считает строки, а не заготовку мока', () => {
    test('total, totalPages и вторая страница — по реальным строкам', async () => {
        const ids = [];
        for (let i = 1; i <= 7; i++) ids.push(await makeBuilding({ name: `Дом ${i}` }));

        const page1 = await list(BUILDINGS_CONFIG, { limit: 3, page: 1 });
        expect(page1.pagination).toEqual({ total: 7, page: 1, limit: 3, totalPages: 3 });
        expect(page1.data.map((r) => r.building_id)).toEqual(ids.slice(0, 3));

        const page2 = await list(BUILDINGS_CONFIG, { limit: 3, page: 2 });
        // Именно это в моке неотличимо от страницы 1.
        expect(page2.data.map((r) => r.building_id)).toEqual(ids.slice(3, 6));

        const page3 = await list(BUILDINGS_CONFIG, { limit: 3, page: 3 });
        expect(page3.data.map((r) => r.building_id)).toEqual(ids.slice(6));
    });

    test('пустая выборка: total 0, но totalPages 1 (Math.max), а не 0', async () => {
        const res = await list(BUILDINGS_CONFIG, { limit: 10 });

        expect(res.data).toEqual([]);
        expect(res.pagination).toEqual({ total: 0, page: 1, limit: 10, totalPages: 1 });
    });

    test('страница за пределами данных отдаёт пустой список, не ломая total', async () => {
        await makeBuilding({ name: 'Единственный' });

        const res = await list(BUILDINGS_CONFIG, { limit: 10, page: 5 });
        expect(res.data).toEqual([]);
        expect(res.pagination.total).toBe(1);
    });

    test('limit срезается до потолка 200', async () => {
        await makeBuilding({ name: 'Дом' });

        const res = await list(BUILDINGS_CONFIG, { limit: 1000 });
        expect(res.pagination.limit).toBe(200);
        expect(res.data).toHaveLength(1);
    });
});

describe('[CO-5] WHERE действительно исполняется', () => {
    test('exact-фильтр отбирает по значению и сужает total', async () => {
        await makeBuilding({ name: 'А', town: 'Ташкент' });
        await makeBuilding({ name: 'Б', town: 'Ташкент' });
        await makeBuilding({ name: 'В', town: 'Самарканд' });

        const res = await list(BUILDINGS_CONFIG, { town: 'Ташкент' });
        expect(res.data.map((r) => r.name).sort()).toEqual(['А', 'Б']);
        expect(res.pagination.total).toBe(2);
    });

    test('like-фильтр ищет подстроку и не зависит от регистра', async () => {
        await makeBuilding({ name: 'Олмазор-11В' });
        await makeBuilding({ name: 'Чилонзор-2' });

        const res = await list(BUILDINGS_CONFIG, { name: 'олмазор' });
        expect(res.data.map((r) => r.name)).toEqual(['Олмазор-11В']);
    });

    test('[M-8] знаки подстановки в значении ищутся БУКВАЛЬНО', async () => {
        // Сердцевина CO-5. `validateSearchString` экранирует % и _ обратной
        // косой чертой, и это работает лишь потому, что у ILIKE в PostgreSQL
        // символ экранирования по умолчанию — `\`. Мок подтвердить такое не
        // может в принципе: он не исполняет шаблон.
        await makeBuilding({ name: 'Скидка 50% на воду' });
        await makeBuilding({ name: 'Обычный дом' });

        const literal = await list(BUILDINGS_CONFIG, { name: '50%' });
        expect(literal.data.map((r) => r.name)).toEqual(['Скидка 50% на воду']);

        // Запрос из одного '%' обязан найти ровно те строки, где этот символ
        // ЕСТЬ. Со сломанным экранированием '%' стал бы подстановочным знаком и
        // вернул ОБА дома — разница между 1 и 2 строками и есть проверка.
        const singlePercent = await list(BUILDINGS_CONFIG, { name: '%' });
        expect(singlePercent.data.map((r) => r.name)).toEqual(['Скидка 50% на воду']);
        expect(singlePercent.pagination.total).toBe(1);

        // То же для подчёркивания: '_' как шаблон совпал бы с любым одним
        // символом, то есть нашёл бы оба дома.
        await makeBuilding({ name: 'дом_с_подчёркиванием' });
        const underscore = await list(BUILDINGS_CONFIG, { name: 'дом_с' });
        expect(underscore.data.map((r) => r.name)).toEqual(['дом_с_подчёркиванием']);
    });

    test('gte/lte с приведением к int режут диапазон', async () => {
        await makeBuilding({ name: '1980', year: 1980 });
        await makeBuilding({ name: '1995', year: 1995 });
        await makeBuilding({ name: '2010', year: 2010 });

        const res = await list(BUILDINGS_CONFIG, { year_min: '1990', year_max: '2000' });
        expect(res.data.map((r) => r.construction_year)).toEqual([1995]);
    });

    test('нечисловое значение в диапазоне ПРОПУСКАЕТ фильтр, а не роняет запрос', async () => {
        // Ветка `if (!Number.isFinite(outValue)) continue;` — в моке она
        // отличима от рабочей только по тексту SQL; здесь видно поведение.
        await makeBuilding({ name: 'А', year: 1980 });
        await makeBuilding({ name: 'Б', year: 2010 });

        const res = await list(BUILDINGS_CONFIG, { year_min: 'abc' });
        expect(res.pagination.total).toBe(2);
    });

    test('search идёт по НЕСКОЛЬКИМ колонкам через OR', async () => {
        await makeBuilding({ name: 'Дом у реки', address: 'ул. Полевая' });
        await makeBuilding({ name: 'Ромашка', address: 'ул. Речная, 5' });
        await makeBuilding({ name: 'Тюльпан', address: 'ул. Горная' });

        const res = await list(BUILDINGS_CONFIG, { search: 'реч' });
        // Совпадение по адресу — вторая половина OR. Её потеря не меняет ни
        // одной подстроки, за которую цепляется мок.
        expect(res.data.map((r) => r.name)).toEqual(['Ромашка']);
    });
});

describe('[CO-5] сортировка применяется к строкам', () => {
    test('order=desc реально разворачивает выдачу', async () => {
        await makeBuilding({ name: 'Ант' });
        await makeBuilding({ name: 'Бета' });
        await makeBuilding({ name: 'Вега' });

        const asc = await list(BUILDINGS_CONFIG, { sort: 'name', order: 'asc' });
        const desc = await list(BUILDINGS_CONFIG, { sort: 'name', order: 'desc' });

        expect(asc.data.map((r) => r.name)).toEqual(['Ант', 'Бета', 'Вега']);
        expect(desc.data.map((r) => r.name)).toEqual(['Вега', 'Бета', 'Ант']);
    });

    test('sortAliasMap подменяет колонку на настоящую', async () => {
        const first = await makeBuilding({ name: 'Я последний по алфавиту' });
        const second = await makeBuilding({ name: 'А первый по алфавиту' });

        const res = await list(
            { ...BUILDINGS_CONFIG, sortAliasMap: { name: 'building_id' } },
            { sort: 'name', order: 'asc' }
        );

        // Сортировка идёт по building_id, а не по name — иначе первым был бы
        // «А первый по алфавиту».
        expect(res.data.map((r) => r.building_id)).toEqual([first, second]);
    });

    test('колонка сортировки вне whitelist не доходит до SQL', async () => {
        await makeBuilding({ name: 'Дом' });

        // validateSortOrder отбрасывает неизвестную колонку и подставляет
        // дефолтную — запрос обязан отработать, а не упасть.
        const res = await list(BUILDINGS_CONFIG, { sort: 'nonexistent_column; DROP TABLE buildings' });
        expect(res.data).toHaveLength(1);

        const { rows } = await db.query("SELECT to_regclass('public.buildings') IS NOT NULL AS alive");
        expect(rows[0].alive).toBe(true);
    });
});

describe('[CO-5] JOIN + GROUP BY: COUNT считает базовые строки', () => {
    const LINES_CONFIG = {
        table: 'water_lines',
        entityType: 'water_lines',
        tableAlias: 'wl',
        defaultSort: 'line_id',
        selectSql: `
            wl.*,
            COUNT(DISTINCT b.building_id) AS connected_buildings_count
            FROM water_lines wl
            LEFT JOIN buildings b ON wl.line_id = b.cold_water_line_id
        `,
        groupBy: 'GROUP BY wl.line_id',
        filters: [{ param: 'status', column: 'wl.status', kind: 'exact' }],
    };

    test('строки схлопываются группировкой, а total остаётся числом линий', async () => {
        // Документированное поведение: COUNT намеренно идёт БЕЗ GROUP BY и без
        // JOIN — «сколько линий», а не «сколько строк после соединения».
        // Проверяемо только исполнением: соединение размножает строки трижды.
        const line = await makeLine('Линия-1');
        await makeLine('Линия-2');
        for (const n of [1, 2, 3]) await makeBuilding({ name: `Потребитель ${n}`, cold: line });

        const res = await list(LINES_CONFIG, {});

        expect(res.pagination.total).toBe(2);
        expect(res.data).toHaveLength(2);
        const withConsumers = res.data.find((r) => r.line_id === line);
        expect(Number(withConsumers.connected_buildings_count)).toBe(3);
    });

    test('граница: фильтровать по колонке из JOIN нельзя — COUNT её не видит', async () => {
        // Не дефект, а ограничение конструкции, которое стоит знать до того,
        // как кто-то добавит такой фильтр в конфиг: WHERE попадает В ОБА
        // запроса, а COUNT строится только по базовой таблице. В моке это
        // навсегда невидимо — там оба запроса возвращают заготовку.
        const line = await makeLine('Линия-1');
        await makeBuilding({ name: 'Потребитель', cold: line });

        const badConfig = {
            ...LINES_CONFIG,
            filters: [{ param: 'town', column: 'b.town', kind: 'exact' }],
        };

        await expect(list(badConfig, { town: 'Ташкент' })).rejects.toThrow(/b\.town|missing FROM-clause/i);
    });
});
