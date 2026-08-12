/**
 * [M-6] Отзыв сессий против настоящей схемы.
 *
 * Зачем отдельно от юнит-тестов
 * -----------------------------
 * `sessions_revoked_at` — НОВЫЙ столбец: его читает проекция
 * `User.AUTH_PROJECTION` и пишет `User.revokeSessions`. Ровно этот класс
 * дефекта — «код ссылается на столбец, которого в схеме нет» — сутки назад
 * дал прод-падение в пересчёте статусов контроллеров и прожил там всё время
 * существования функции, потому что БД в юнит-тестах замокана.
 *
 * Поэтому здесь схема собирается из канонического `01_init_database.sql` и
 * реальных файлов миграций 016 и 043 — не из переписанного в тесте DDL.
 * Если 043 забудут применить или в ней окажется опечатка, тест упадёт здесь,
 * а не на первом запросе к живой базе.
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const User = require('../../../src/models/User');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[db-test] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const repoFile = (rel) => fs.readFileSync(path.join(__dirname, '../../../', rel), 'utf8');

const INIT_SQL = repoFile('database/init/01_init_database.sql');

function ddlFor(table) {
    const match = INIT_SQL.match(
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`, 'i')
    );
    if (!match) throw new Error(`Не найден CREATE TABLE для ${table} в 01_init_database.sql`);
    return match[0];
}

let userId;

beforeAll(async () => {
    await db.init();
    await db.query(ddlFor('users'));
    // Обе миграции применяются из настоящих файлов: смысл теста в том, чтобы
    // проверить их, а не копию их содержимого.
    await db.query(repoFile('database/migrations/016_password_changed_at.sql'));
    await db.query(repoFile('database/migrations/043_sessions_revoked_at.sql'));
}, 20000);

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS users');
    await db.close();
});

beforeEach(async () => {
    await db.query('DELETE FROM users');
    const { rows } = await db.query(
        `INSERT INTO users (username, email, password_hash)
         VALUES ('victim', 'victim@example.com', 'x') RETURNING user_id`
    );
    userId = rows[0].user_id;
});

describe('[M-6] sessions_revoked_at на живой схеме', () => {
    test('проекция аутентификации читает новый столбец', async () => {
        // Если бы столбца в схеме не было, здесь была бы ошибка Postgres, а не
        // тихий undefined: проекция перечисляет столбцы поимённо.
        const user = await User.findAuthProjection(userId);

        expect(user).toHaveProperty('sessions_revoked_at', null);
    });

    test('revokeSessions проставляет отметку', async () => {
        await User.revokeSessions(userId);

        const user = await User.findAuthProjection(userId);
        expect(user.sessions_revoked_at).not.toBeNull();
        const ageMs = Date.now() - new Date(user.sessions_revoked_at).getTime();
        expect(ageMs).toBeLessThan(10_000);
    });

    test('повторный отзыв двигает отметку вперёд', async () => {
        await User.revokeSessions(userId);
        const first = (await User.findAuthProjection(userId)).sessions_revoked_at;

        await new Promise((resolve) => setTimeout(resolve, 1100));
        await User.revokeSessions(userId);
        const second = (await User.findAuthProjection(userId)).sessions_revoked_at;

        expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
    });

    test('отзыв не трогает password_changed_at', async () => {
        await db.query('UPDATE users SET password_changed_at = NOW() WHERE user_id = $1', [userId]);
        const before = (await User.findAuthProjection(userId)).password_changed_at;

        await User.revokeSessions(userId);

        // Склеивать два события нельзя: отметку смены пароля показывают в
        // аудите и на ней держится отдельная проверка 2FA-temp-token'ов.
        const after = (await User.findAuthProjection(userId)).password_changed_at;
        expect(new Date(after).getTime()).toBe(new Date(before).getTime());
    });

    test('отзыв одного пользователя не задевает других', async () => {
        const { rows } = await db.query(
            `INSERT INTO users (username, email, password_hash)
             VALUES ('bystander', 'bystander@example.com', 'x') RETURNING user_id`
        );
        const otherId = rows[0].user_id;

        await User.revokeSessions(userId);

        expect((await User.findAuthProjection(otherId)).sessions_revoked_at).toBeNull();
    });

    test('миграция 043 идемпотентна', async () => {
        // Раннер применяет каждую миграцию один раз, но повторный прогон не
        // должен ронять базу — это цена ошибки в ручном восстановлении.
        await expect(
            db.query(repoFile('database/migrations/043_sessions_revoked_at.sql'))
        ).resolves.toBeDefined();
    });
});
