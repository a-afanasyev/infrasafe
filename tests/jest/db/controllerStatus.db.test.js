/**
 * [AR-21 follow-up] `updateControllersStatusByActivity` против настоящей схемы.
 *
 * Почему этот файл появился
 * -------------------------
 * Волна E завела планировщик, который вызывает этот пересчёт по расписанию.
 * На первом же тике на проде он упал:
 *
 *     column "updated_at" of relation "controllers" does not exist
 *
 * Запрос писал `SET status = ..., updated_at = NOW()`, а такого столбца у
 * `controllers` нет ни в `01_init_database.sql`, ни на обеих площадках.
 * То есть функция была сломана ВСЕГДА: любой вызов бросал исключение.
 * Не замечали потому, что единственным входом была admin-кнопка
 * `POST /api/controllers/update-status`, которую никто не нажимал.
 *
 * Юнит-тесты на неё есть, и они зелёные — БД в них замокана, а мок примет
 * любое имя столбца. Ровно та претензия, что и в R2-24, повторённая через
 * сутки на соседнем запросе. Поэтому проверка живёт здесь, на живой схеме:
 * DDL контроллеров берётся из канонического init-скрипта, а не пишется
 * заново, иначе тест разъедется со схемой ровно так же незаметно.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const controllerService = require('../../../src/services/controllerService');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[db-test] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);

/** Вырезать реальный CREATE TABLE из канонического init-скрипта. */
function ddlFor(table) {
    const match = INIT_SQL.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i')
    );
    if (!match) throw new Error(`Не найден CREATE TABLE для ${table} в 01_init_database.sql`);
    return match[0];
}

// Заглушка под внешний ключ controllers.building_id. Настоящая `buildings`
// тянет PostGIS и десяток столбцов, к делу не относящихся.
const BUILDINGS_STUB = `
    CREATE TABLE IF NOT EXISTS buildings (
        building_id SERIAL PRIMARY KEY,
        name        VARCHAR(255)
    );
`;

// Из `metrics` запросу нужны ровно два столбца; воспроизводить всю таблицу
// телеметрии незачем. Если запрос когда-нибудь начнёт читать третий — тест
// упадёт на неизвестном столбце, что и есть нужный сигнал.
const METRICS_STUB = `
    CREATE TABLE IF NOT EXISTS metrics (
        metric_id     SERIAL PRIMARY KEY,
        controller_id INTEGER NOT NULL,
        timestamp     TIMESTAMPTZ NOT NULL
    );
`;

// Домен статуса из миграции 042 — без него тест принял бы значение вне домена.
const STATUS_CHECK = `
    ALTER TABLE controllers DROP CONSTRAINT IF EXISTS controllers_status_check;
    ALTER TABLE controllers ADD CONSTRAINT controllers_status_check
        CHECK (status IN ('online', 'offline', 'maintenance'));
`;

let buildingId;

beforeAll(async () => {
    await db.init();
    await db.query(BUILDINGS_STUB);
    await db.query(ddlFor('controllers'));
    await db.query(STATUS_CHECK);
    await db.query(METRICS_STUB);
}, 20000);

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS metrics');
    await db.query('DROP TABLE IF EXISTS controllers');
    await db.query('DROP TABLE IF EXISTS buildings');
    await db.close();
});

beforeEach(async () => {
    await db.query('DELETE FROM metrics');
    await db.query('DELETE FROM controllers');
    await db.query('DELETE FROM buildings');
    const { rows } = await db.query(
        "INSERT INTO buildings (name) VALUES ('дом') RETURNING building_id"
    );
    buildingId = rows[0].building_id;
});

/** Контроллер с заданным статусом. */
async function addController(serial, status) {
    const { rows } = await db.query(
        `INSERT INTO controllers (serial_number, building_id, status)
         VALUES ($1, $2, $3) RETURNING controller_id`,
        [serial, buildingId, status]
    );
    return rows[0].controller_id;
}

/** Сэмпл телеметрии `minutesAgo` минут назад. */
async function addMetric(controllerId, minutesAgo) {
    await db.query(
        `INSERT INTO metrics (controller_id, timestamp)
         VALUES ($1, NOW() - ($2 || ' minutes')::interval)`,
        [controllerId, String(minutesAgo)]
    );
}

async function statusOf(controllerId) {
    const { rows } = await db.query(
        'SELECT status FROM controllers WHERE controller_id = $1',
        [controllerId]
    );
    return rows[0].status;
}

describe('[AR-21] пересчёт статусов на живой схеме', () => {
    test('запрос вообще выполняется на канонической таблице', async () => {
        // Тест, которого не хватало: он падал бы всё время существования
        // функции. Мок не мог его провалить в принципе.
        await expect(controllerService.updateControllersStatusByActivity())
            .resolves.toEqual({ updated: 0, total: 0 });
    });

    test('замолчавший контроллер переводится в offline', async () => {
        const id = await addController('SN-SILENT', 'online');
        await addMetric(id, 30);   // окно — 10 минут

        const result = await controllerService.updateControllersStatusByActivity();

        expect(result.updated).toBe(1);
        expect(await statusOf(id)).toBe('offline');
    });

    test('контроллер без телеметрии вовсе переводится в offline', async () => {
        const id = await addController('SN-NEVER', 'online');

        await controllerService.updateControllersStatusByActivity();

        expect(await statusOf(id)).toBe('offline');
    });

    test('свежая телеметрия возвращает контроллер в online', async () => {
        const id = await addController('SN-BACK', 'offline');
        await addMetric(id, 1);

        await controllerService.updateControllersStatusByActivity();

        expect(await statusOf(id)).toBe('online');
    });

    test('maintenance не трогается ни при каком молчании', async () => {
        const id = await addController('SN-MAINT', 'maintenance');
        await addMetric(id, 120);

        const result = await controllerService.updateControllersStatusByActivity();

        // Обслуживание — решение человека, и автоматика не вправе его снимать.
        expect(await statusOf(id)).toBe('maintenance');
        expect(result.updated).toBe(0);
    });

    test('уже offline при молчании не пересчитывается повторно', async () => {
        const id = await addController('SN-STILL', 'offline');
        await addMetric(id, 30);

        const result = await controllerService.updateControllersStatusByActivity();

        // `IS DISTINCT FROM` бережёт от холостых UPDATE на каждом тике: иначе
        // планировщик раз в две минуты переписывал бы всю таблицу.
        expect(result.updated).toBe(0);
    });

    test('total считает все контроллеры, а не только изменённые', async () => {
        const silent = await addController('SN-A', 'online');
        await addMetric(silent, 30);
        const fresh = await addController('SN-B', 'online');
        await addMetric(fresh, 1);

        const result = await controllerService.updateControllersStatusByActivity();

        expect(result).toEqual({ updated: 1, total: 2 });
    });
});
