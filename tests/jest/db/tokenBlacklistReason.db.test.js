/**
 * [A-02] Причина блокировки токена — против НАСТОЯЩЕГО Postgres.
 *
 * Различение «израсходован ротацией» и «погашен логаутом» существует ради
 * одного решения: отзывать ли ВСЕ сессии пользователя. Ошибка в любую сторону
 * заметна — либо кража остаётся без ответа, либо человека выкидывает со всех
 * устройств за обычный выход. Значит и домен причин, и то, что старые строки
 * остаются валидными, проверяются там, где это исполняется.
 *
 * Мок этого показать не может: CHECK-констрейнта у него нет вовсе, а NULL он
 * примет с тем же успехом, что и 'rotation'.
 *
 * DDL берётся из канонического init (таблица) и из самой миграции 044
 * (колонка + CHECK) — правило tests/CLAUDE.md.
 *
 * Запуск: npm run test:db.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[A-02] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const INIT_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/01_init_database.sql'),
    'utf8'
);
const MIGRATION_044 = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/044_token_blacklist_reason.sql'),
    'utf8'
);

const createTable = /CREATE TABLE IF NOT EXISTS token_blacklist \([\s\S]*?\n\);/i.exec(INIT_SQL);
if (!createTable) throw new Error('[A-02] DDL token_blacklist не найден в каноническом init');

// Из миграции берём ровно её содержательные операторы, без BEGIN/COMMIT:
// вложенная транзакция здесь не нужна, а COMMENT ON нечего проверять.
const migrationStatements = (MIGRATION_044.match(/ALTER TABLE token_blacklist[\s\S]*?;/g) || []);
if (migrationStatements.length < 3) {
    throw new Error('[A-02] в миграции 044 не найдены ожидаемые ALTER TABLE (колонка + CHECK)');
}

const insert = (hash, reason, expires = '1 hour') =>
    db.query(
        `INSERT INTO token_blacklist (token_hash, expires_at, reason)
         VALUES ($1, NOW() + $2::interval, $3)`,
        [hash, expires, reason]
    );

beforeAll(async () => {
    await db.init();
    await db.query('DROP TABLE IF EXISTS token_blacklist');
    await db.query(createTable[0]);
    await db.query(migrationStatements.join('\n'));
}, 20000);

beforeEach(async () => {
    await db.query('DELETE FROM token_blacklist');
});

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS token_blacklist');
    await db.close();
});

describe('[A-02] миграция 044: домен причин', () => {
    test.each(['rotation', 'logout', 'temp-token', 'manual'])('причина %s принимается', async (reason) => {
        await expect(insert(`hash-${reason}`, reason)).resolves.toBeDefined();
    });

    test('NULL разрешён — это строки, записанные ДО миграции', async () => {
        await expect(insert('hash-legacy', null)).resolves.toBeDefined();

        const { rows } = await db.query('SELECT reason FROM token_blacklist WHERE token_hash = $1', ['hash-legacy']);
        expect(rows[0].reason).toBeNull();
    });

    test('причина вне домена отвергается БД, а не только кодом', async () => {
        // Whitelist на стороне приложения не защищает от прямого SQL и от
        // будущего вызывающего, который о нём не знает (урок M-12b).
        await expect(insert('hash-bogus', 'stolen')).rejects.toThrow(/token_blacklist_reason_check/);
    });

    test('колонка не ломает существующую вставку без причины', async () => {
        // Expand-only: образ ОТКАТА пишет без `reason` и обязан продолжать
        // работать после применения схемы.
        await expect(db.query(
            `INSERT INTO token_blacklist (token_hash, expires_at) VALUES ($1, NOW() + interval '1 hour')`,
            ['hash-old-image']
        )).resolves.toBeDefined();

        const { rows } = await db.query('SELECT reason FROM token_blacklist WHERE token_hash = $1', ['hash-old-image']);
        expect(rows[0].reason).toBeNull();
    });

    test('миграция идемпотентна — повторное применение не падает', async () => {
        await expect(db.query(migrationStatements.join('\n'))).resolves.toBeDefined();
    });

    test('UNIQUE по token_hash сохранён — на нём держится обнаружение повтора', async () => {
        await insert('hash-dup', 'rotation');
        await expect(insert('hash-dup', 'rotation')).rejects.toMatchObject({ code: '23505' });
    });
});
