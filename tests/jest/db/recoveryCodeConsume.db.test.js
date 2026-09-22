/**
 * [N-18] Код восстановления — одноразовый и под параллельными запросами.
 *
 * Погашение было «прочитать → bcrypt → безусловно переписать recovery_codes».
 * Два запроса с ОДНИМ кодом читали один и тот же набор, оба находили код, оба
 * записывали набор без него — вход проходил дважды (ASVS V2.6.1). Два запроса с
 * РАЗНЫМИ кодами теряли обновление: второй переписывал набор, прочитанный до
 * записи первого, и погашенный код ВОЗВРАЩАЛСЯ. Остаток «проверить после A-11»
 * из отчёта 08.09.
 *
 * Почему против живой БД: дефект живёт в окне между SELECT и UPDATE, а мок
 * исполняет запросы по очереди и окна не имеет вовсе.
 *
 * Как запускать: `npm run test:db`. Suite не пропускается при недоступной БД.
 */

process.env.TOTP_ENCRYPTION_KEY = process.env.TOTP_ENCRYPTION_KEY
    || 'totp-test-key-that-is-at-least-32-bytes-long-123456';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const db = require('../../../src/config/database');
const totpService = require('../../../src/services/totpService');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[N-18] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

// Колонки 2FA — из канонического init-файла, как в totpSecretGuard.db.test.js.
const TOTP_SQL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/04_totp_2fa.sql'),
    'utf8'
);
const totpColumns = TOTP_SQL.match(/ALTER TABLE users\s+ADD COLUMN IF NOT EXISTS [^;]+;/gi) || [];
if (!totpColumns.length) {
    throw new Error('[N-18] в database/init/04_totp_2fa.sql не найдены ALTER TABLE users ADD COLUMN');
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

const CODES = ['A1B2-C3D4', 'E5F6-A7B8', 'C9D0-E1F2'];

// Окно гонки — это время bcrypt между чтением и записью. В проде коды
// захэшированы с 12 раундами (~250 мс); 8 держат окно заметным и тест быстрым.
const BCRYPT_ROUNDS = 8;
const PARALLEL = 5;

// Холодный пул прячет гонку: каждый запрос сначала открывает соединение, и это
// дольше bcrypt — запросы выстраиваются в очередь сами. В проде пул тёплый.
async function warmPool() {
    await Promise.all(Array.from({ length: PARALLEL + 1 }, () => db.query('SELECT pg_sleep(0.05)')));
}

async function makeUserWithCodes(codes) {
    const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, BCRYPT_ROUNDS)));
    const { rows } = await db.query(
        `INSERT INTO users (username, totp_secret, totp_enabled, recovery_codes)
         VALUES ('n18-user', $1, true, $2::jsonb) RETURNING user_id`,
        [totpService.encrypt('JBSWY3DPEHPK3PXP'), JSON.stringify(hashed)]
    );
    return rows[0].user_id;
}

async function remainingCodes(userId) {
    const { rows } = await db.query('SELECT recovery_codes FROM users WHERE user_id = $1', [userId]);
    return rows[0].recovery_codes;
}

describe('[N-18] погашение кода восстановления атомарно', () => {
    beforeAll(async () => {
        await db.init();
        await db.query('DROP TABLE IF EXISTS users CASCADE');
        await db.query(USERS_DDL);
        await db.query(totpColumns.join('\n'));
    }, 20000);

    afterAll(async () => {
        await db.query('DROP TABLE IF EXISTS users CASCADE');
        await db.close();
    });

    beforeEach(async () => {
        await db.query('DELETE FROM users');
    });

    test('один и тот же код параллельно — вход проходит ровно один раз', async () => {
        const userId = await makeUserWithCodes(CODES);
        await warmPool();

        const results = await Promise.all(
            Array.from({ length: PARALLEL }, () => totpService.verifyCode(userId, CODES[0]))
        );

        expect(results.filter((r) => r.valid)).toHaveLength(1);
        expect(await remainingCodes(userId)).toHaveLength(CODES.length - 1);
    });

    test('два разных кода параллельно — оба гасятся, ни один не возвращается', async () => {
        const userId = await makeUserWithCodes(CODES);
        await warmPool();

        const results = await Promise.all([
            totpService.verifyCode(userId, CODES[0]),
            totpService.verifyCode(userId, CODES[1]),
        ]);

        expect(results.every((r) => r.valid)).toBe(true);
        const left = await remainingCodes(userId);
        expect(left).toHaveLength(1);
        // Оставшийся — именно третий код: первые два погашены оба.
        expect(await bcrypt.compare(CODES[2], left[0])).toBe(true);
    });

    test('последовательно: погашенный код второй раз не принимается', async () => {
        const userId = await makeUserWithCodes(CODES);

        await expect(totpService.verifyCode(userId, CODES[0])).resolves.toMatchObject({ valid: true });
        await expect(totpService.verifyCode(userId, CODES[0])).resolves.toMatchObject({ valid: false });
    });
});
