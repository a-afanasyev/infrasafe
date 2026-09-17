/**
 * [A-01] Условие записи TOTP-секрета — против НАСТОЯЩЕГО Postgres.
 *
 * Сервисная проверка (`generateSetup` отказывает при `totp_enabled`) закрывает
 * обход, но между чтением состояния и записью есть окно: два параллельных
 * запроса могут оба прочитать `totp_enabled=false`, а подтвердить 2FA успеет
 * только один — второй перезапишет уже включённый секрет. Поэтому условие
 * продублировано В САМОМ UPDATE, и проверять его надо там, где оно исполняется.
 *
 * Мок здесь бесполезен по существу: он сверяет подстроки текста запроса и
 * одинаково «пройдёт» и с `WHERE user_id = $3`, и с
 * `WHERE user_id = $3 AND totp_enabled = false` — то есть не может отличить
 * рабочий рубеж от снятого.
 *
 * Запуск: npm run test:db (требует живой Postgres в DB_*).
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const User = require('../../../src/models/User');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[A-01] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

// Колонки 2FA заводит канонический init-файл (миграция 012_totp_2fa) — берём
// оттуда, а не переписываем: переписанный стенд разъезжается со схемой.
const TOTP_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/04_totp_2fa.sql'),
    'utf8'
);
const totpColumns = TOTP_SQL.match(/ALTER TABLE users\s+ADD COLUMN IF NOT EXISTS [^;]+;/gi) || [];
if (!totpColumns.length) {
    throw new Error('[A-01] в database/init/04_totp_2fa.sql не найдены ALTER TABLE users ADD COLUMN');
}

const USERS_DDL = `
    CREATE TABLE IF NOT EXISTS users (
        user_id       SERIAL PRIMARY KEY,
        username      VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        role          VARCHAR(20) DEFAULT 'user',
        is_active     BOOLEAN DEFAULT true
    );
`;

// [A-01] `sessions_revoked_at` заводит миграция 043 — сброс 2FA отзывает сессии
// тем же запросом, поэтому колонка обязана быть в стенде.
const SESSIONS_DDL =
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;';

const makeUser = async (username, { enabled = false, secret = null } = {}) => {
    const { rows } = await db.query(
        `INSERT INTO users (username, totp_secret, totp_enabled)
         VALUES ($1, $2, $3) RETURNING user_id`,
        [username, secret, enabled]
    );
    return rows[0].user_id;
};

const readTotp = async (userId) => {
    const { rows } = await db.query(
        'SELECT totp_secret, totp_enabled, recovery_codes FROM users WHERE user_id = $1',
        [userId]
    );
    return rows[0];
};

beforeAll(async () => {
    await db.init();
    await db.query('DROP TABLE IF EXISTS users CASCADE');
    await db.query(USERS_DDL);
    await db.query(totpColumns.join('\n'));
    await db.query(SESSIONS_DDL);
}, 20000);

beforeEach(async () => {
    await db.query('DELETE FROM users');
});

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS users CASCADE');
    await db.close();
});

describe('[A-01] setTotpSecret не перезаписывает секрет включённой 2FA', () => {
    test('на аккаунте БЕЗ 2FA запись проходит', async () => {
        const id = await makeUser('pending');

        await expect(User.setTotpSecret(id, 'enc:new', '["hash"]')).resolves.toBeUndefined();

        const row = await readTotp(id);
        expect(row.totp_secret).toBe('enc:new');
        expect(row.totp_enabled).toBe(false);
    });

    test('на аккаунте С включённой 2FA запись ОТКЛОНЯЕТСЯ и ничего не меняет', async () => {
        const id = await makeUser('protected', { enabled: true, secret: 'enc:original' });

        await expect(User.setTotpSecret(id, 'enc:attacker', '["hash"]'))
            .rejects.toMatchObject({ statusCode: 409 });

        const row = await readTotp(id);
        expect(row.totp_secret).toBe('enc:original');   // секрет владельца цел
        expect(row.totp_enabled).toBe(true);
    });

    test('гонка: из двух одновременных записей выигрывает одна, вторая отклоняется после включения', async () => {
        // Моделирует окно между чтением состояния в generateSetup и записью.
        const id = await makeUser('racer');

        await User.setTotpSecret(id, 'enc:first', '["a"]');
        await db.query('UPDATE users SET totp_enabled = true WHERE user_id = $1', [id]);

        await expect(User.setTotpSecret(id, 'enc:second', '["b"]'))
            .rejects.toMatchObject({ statusCode: 409 });
        expect((await readTotp(id)).totp_secret).toBe('enc:first');
    });

    test('несуществующий пользователь — тоже отказ, а не тихий no-op', async () => {
        await expect(User.setTotpSecret(999999, 'enc:x', '["a"]'))
            .rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('[A-01] resetTotpByUsername — единственный легитимный путь сброса', () => {
    test('снимает секрет, флаг и коды И отзывает сессии одним запросом', async () => {
        const id = await makeUser('locked-out', { enabled: true, secret: 'enc:original' });
        await db.query('UPDATE users SET recovery_codes = $1 WHERE user_id = $2', ['["h"]', id]);

        const result = await User.resetTotpByUsername('locked-out');
        expect(result).toMatchObject({ user_id: id, username: 'locked-out' });

        const { rows } = await db.query(
            `SELECT totp_secret, totp_enabled, recovery_codes, sessions_revoked_at
               FROM users WHERE user_id = $1`,
            [id]
        );
        expect(rows[0].totp_secret).toBeNull();
        expect(rows[0].totp_enabled).toBe(false);
        expect(rows[0].recovery_codes).toBeNull();
        // Отзыв сессий — часть той же операции: сброс делают при подозрении на
        // угон, и прежние сессии обязаны умереть вместе с секретом.
        expect(rows[0].sessions_revoked_at).not.toBeNull();
    });

    test('после сброса запись секрета снова разрешена', async () => {
        const id = await makeUser('recovering', { enabled: true, secret: 'enc:original' });

        await User.resetTotpByUsername('recovering');
        await expect(User.setTotpSecret(id, 'enc:fresh', '["h"]')).resolves.toBeUndefined();
        expect((await readTotp(id)).totp_secret).toBe('enc:fresh');
    });

    test('неизвестный логин → null, ничего не меняется', async () => {
        await makeUser('someone', { enabled: true, secret: 'enc:original' });

        await expect(User.resetTotpByUsername('нет-такого')).resolves.toBeNull();
        const { rows } = await db.query('SELECT totp_enabled FROM users WHERE username = $1', ['someone']);
        expect(rows[0].totp_enabled).toBe(true);
    });
});
