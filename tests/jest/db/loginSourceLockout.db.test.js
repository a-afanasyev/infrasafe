/**
 * [аудит #12, п. 9] Перебор пароля блокирует ИСТОЧНИК, а не учётную запись —
 * на настоящем Postgres и настоящем authService.
 *
 * Что было не так
 * ---------------
 * Счётчик промахов ключевался строкой логина, а блокировка зеркалилась в
 * `users.account_locked_until` — столбец, который вход проверяет независимо от
 * источника. Аноним, пять раз введя неверный пароль к `admin`, закрывал
 * администратору вход на 15 минут с любого адреса. Повторяя раз в 15 минут,
 * держал панель закрытой сколько угодно.
 *
 * Что теперь
 * ----------
 *   * счётчик привязан к паре «источник + учётная запись»: пять промахов
 *     запирают этот источник, остальные входят как раньше;
 *   * парольные промахи больше не пишут `users.account_locked_until` —
 *     владелец входит с любого другого адреса;
 *   * общий тормоз на учётную запись остаётся, но высокий (50 промахов со всех
 *     источников): одному адресу его не набрать, а распределённый перебор не
 *     получает бесконечных попыток. Он приостанавливает только новые входы.
 *
 * Почему на живой БД: вся арифметика счётчика — в SQL модели, а ключи, которые
 * в неё передаёт сервис, и есть предмет правки. Мок ответил бы «да» на всё.
 *
 * Запуск: npm run test:db.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'db-test-jwt-secret-not-for-production';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'db-test-refresh-secret-not-for-production';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const db = require('../../../src/config/database');
const authService = require('../../../src/services/authService');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[db-test] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const repoFile = (rel) => fs.readFileSync(path.join(__dirname, '../../../', rel), 'utf8');

const INIT_SQL = repoFile('database/init/01_init_database.sql');
const USERS_DDL = INIT_SQL.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/i);
if (!USERS_DDL) throw new Error('Не найден CREATE TABLE для users в 01_init_database.sql');
const TOTP_COLUMNS = repoFile('database/init/04_totp_2fa.sql')
    .match(/ALTER TABLE users\s+ADD COLUMN IF NOT EXISTS [^;]+;/gi) || [];
if (!TOTP_COLUMNS.length) throw new Error('в 04_totp_2fa.sql не найдены ALTER TABLE users ADD COLUMN');

const PASSWORD = 'CorrectHorse9';
const A = '203.0.113.10';
const B = '198.51.100.20';

let userId;

const login = (name, password, source) => authService.authenticateUser(name, password, source);
const miss = (name, source) => expect(login(name, 'WrongPass1', source)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
const missTimes = async (n, name, source) => { for (let i = 0; i < n; i++) await miss(name, source); };

const sessionLock = async () => {
    const { rows } = await db.query('SELECT account_locked_until FROM users WHERE user_id = $1', [userId]);
    return rows[0].account_locked_until;
};

beforeAll(async () => {
    await db.init();
    await db.query('DROP TABLE IF EXISTS account_lockout');
    await db.query('DROP TABLE IF EXISTS users CASCADE');
    await db.query(USERS_DDL[0]);
    for (const ddl of TOTP_COLUMNS) await db.query(ddl);
    await db.query(repoFile('database/migrations/016_password_changed_at.sql'));
    await db.query(repoFile('database/migrations/043_sessions_revoked_at.sql'));
    await db.query(repoFile('database/init/05_account_lockout.sql'));
}, 30000);

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS account_lockout');
    await db.query('DROP TABLE IF EXISTS users CASCADE');
    await db.close();
});

beforeEach(async () => {
    await db.query('DELETE FROM account_lockout');
    await db.query('DELETE FROM users');
    const { rows } = await db.query(
        `INSERT INTO users (username, email, password_hash, role, is_active)
         VALUES ('victim', 'victim@example.com', $1, 'admin', true) RETURNING user_id`,
        [bcrypt.hashSync(PASSWORD, 4)]
    );
    userId = rows[0].user_id;
});

describe('перебор блокирует источник', () => {
    test('пять промахов с одного адреса запирают этот адрес — даже для верного пароля', async () => {
        await missTimes(5, 'victim', A);

        await expect(login('victim', PASSWORD, A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });

    test('владелец с другого адреса входит, пока атакующий заперт', async () => {
        await missTimes(5, 'victim', A);

        const user = await login('victim', PASSWORD, B);
        expect(user.user_id).toBe(userId);
    });

    test('парольные промахи не трогают users.account_locked_until', async () => {
        await missTimes(5, 'victim', A);

        expect(await sessionLock()).toBeNull();
    });

    test('логин и e-mail одной учётной записи делят счётчик источника', async () => {
        // Иначе у атакующего было бы по пять попыток на каждое имя записи.
        await missTimes(3, 'victim', A);
        await missTimes(2, 'victim@example.com', A);

        await expect(login('victim', PASSWORD, A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        await expect(login('victim@example.com', PASSWORD, A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });

    test('соседние адреса одной IPv6-подсети /64 — один источник', async () => {
        // /64 выдаётся одному абоненту целиком: считать адреса порознь значило
        // бы дать ему 2^64 независимых счётчиков.
        for (let i = 1; i <= 5; i++) await miss('victim', `2001:db8:aa:bb::${i}`);

        await expect(login('victim', PASSWORD, '2001:db8:aa:bb:ffff:ffff:ffff:1'))
            .rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        // другая /64 — другой источник
        await expect(login('victim', PASSWORD, '2001:db8:aa:cc::1')).resolves.toMatchObject({ user_id: userId });
    });

    test('IPv4-mapped форма того же адреса не даёт второй счётчик', async () => {
        await missTimes(3, 'victim', A);
        await missTimes(2, 'victim', `::ffff:${A}`);

        await expect(login('victim', PASSWORD, A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });

    test('успешный вход обнуляет счётчик своего источника', async () => {
        await missTimes(4, 'victim', A);
        await login('victim', PASSWORD, A);
        await missTimes(4, 'victim', A);

        await expect(login('victim', PASSWORD, A)).resolves.toMatchObject({ user_id: userId });
    });

    test('вызов без источника не падает и считается общим «неизвестным» источником', async () => {
        await missTimes(5, 'victim', undefined);

        await expect(login('victim', PASSWORD, undefined)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        await expect(login('victim', PASSWORD, B)).resolves.toMatchObject({ user_id: userId });
    });
});

describe('несуществующий логин', () => {
    test('запирает источник так же, как существующий (нет оракула)', async () => {
        await missTimes(5, 'ghost', A);

        await expect(login('ghost', 'WrongPass1', A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    });

    test('введённая строка не сохраняется в таблице — в поле логина часто вставляют пароль', async () => {
        await miss('MyRealPassword123!', A);

        const { rows } = await db.query('SELECT login FROM account_lockout ORDER BY login');
        // счётчик источника и общий тормоз — оба по хэшу строки
        expect(rows.length).toBe(2);
        for (const row of rows) expect(row.login).not.toContain('MyRealPassword123!');
    });
});

describe('общий тормоз на учётную запись', () => {
    const sources = Array.from({ length: 10 }, (_, i) => `192.0.2.${i + 1}`);

    test('одному источнику его не набрать: после пяти промахов он заперт сам', async () => {
        await missTimes(5, 'victim', A);
        // дальнейшие попытки с A отбиваются блокировкой источника и в общий счёт не идут
        for (let i = 0; i < 60; i++) {
            await expect(login('victim', 'WrongPass1', A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        }

        await expect(login('victim', PASSWORD, B)).resolves.toMatchObject({ user_id: userId });
    }, 120000);

    test('50 промахов с десяти источников приостанавливают новые входы и не пишут users.account_locked_until', async () => {
        for (const source of sources) await missTimes(5, 'victim', source);

        await expect(login('victim', PASSWORD, B)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        expect(await sessionLock()).toBeNull();
    }, 60000);

    test('49 промахов — ещё не тормоз', async () => {
        for (const source of sources.slice(0, 9)) await missTimes(5, 'victim', source);
        await missTimes(4, 'victim', sources[9]);

        await expect(login('victim', PASSWORD, B)).resolves.toMatchObject({ user_id: userId });
    }, 60000);
});

// [Q-11] Попытка резервируется ДО сверки пароля. Раньше счётчик только
// читался, а промах записывался после bcrypt — параллельная пачка проходила
// проверку раньше, чем фиксировался пятый (или пятидесятый) промах.
describe('[Q-11] параллельная пачка не обгоняет счётчик', () => {
    const settle = (promises) => Promise.allSettled(promises).then((results) =>
        results.map((r) => (r.status === 'fulfilled' ? 'OK' : r.reason.code)));
    const count = (codes, code) => codes.filter((c) => c === code).length;
    let verifySpy;
    beforeEach(() => { verifySpy = jest.spyOn(authService, 'verifyPassword'); });
    afterEach(() => { verifySpy.mockRestore(); });

    test('12 параллельных промахов с одного адреса: до сверки пароля доходят ровно 5', async () => {
        const codes = await settle(Array.from({ length: 12 }, () => login('victim', 'WrongPass1', A)));

        expect(verifySpy).toHaveBeenCalledTimes(5);
        expect(count(codes, 'INVALID_CREDENTIALS')).toBe(5);
        expect(count(codes, 'ACCOUNT_LOCKED')).toBe(7);
        await expect(login('victim', PASSWORD, A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    }, 60000);

    test('несуществующий логин — та же картина (нет оракула)', async () => {
        const codes = await settle(Array.from({ length: 12 }, () => login('ghost', 'WrongPass1', A)));

        expect(count(codes, 'INVALID_CREDENTIALS')).toBe(5);
        expect(count(codes, 'ACCOUNT_LOCKED')).toBe(7);
    }, 60000);

    test('общий тормоз: 60 параллельных промахов с 60 адресов — до сверки доходят ровно 50', async () => {
        const sources = Array.from({ length: 60 }, (_, i) => `192.0.2.${i + 1}`);
        const codes = await settle(sources.map((s) => login('victim', 'WrongPass1', s)));

        expect(verifySpy).toHaveBeenCalledTimes(50);
        expect(count(codes, 'INVALID_CREDENTIALS')).toBe(50);
        expect(count(codes, 'ACCOUNT_LOCKED')).toBe(10);
    }, 120000);

    test('верный пароль среди параллельных попыток в пределах порога проходит и обнуляет счётчики', async () => {
        const wrong = Array.from({ length: 4 }, () => login('victim', 'WrongPass1', A));
        const [right] = await Promise.allSettled([login('victim', PASSWORD, A), ...wrong]);

        expect(right.status).toBe('fulfilled');
        // Исход проигравших гонку промахов не важен; важно, что после успеха
        // ни один счётчик не держит потраченную верным входом попытку.
        await login('victim', PASSWORD, A);
        const { rows } = await db.query('SELECT login FROM account_lockout');
        expect(rows).toEqual([]);
    }, 60000);

    test('верный пароль пятой попыткой проходит', async () => {
        await missTimes(4, 'victim', A);
        await expect(login('victim', PASSWORD, A)).resolves.toMatchObject({ user_id: userId });
    });

    test('отказ из-за тормоза не тратит попытку источника', async () => {
        for (let i = 1; i <= 50; i++) await miss('victim', `192.0.2.${i}`);

        await expect(login('victim', PASSWORD, B)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        const { rows } = await db.query(
            "SELECT failed_attempts FROM account_lockout WHERE login = $1", [`src:${B}|uid:${userId}`]);
        expect(rows.every((r) => r.failed_attempts === 0)).toBe(true);
    }, 60000);

    test('отбитая попытка не продлевает действующую блокировку', async () => {
        await missTimes(5, 'victim', A);
        const key = `src:${A}|uid:${userId}`;
        const before = (await db.query('SELECT locked_until FROM account_lockout WHERE login = $1', [key])).rows[0];

        await expect(login('victim', 'WrongPass1', A)).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
        const after = (await db.query('SELECT locked_until FROM account_lockout WHERE login = $1', [key])).rows[0];
        expect(after.locked_until).toEqual(before.locked_until);
    });

    test('истёкшая блокировка: счёт начинается заново', async () => {
        await missTimes(5, 'victim', A);
        await db.query("UPDATE account_lockout SET locked_until = NOW() - INTERVAL '1 second'");

        await expect(login('victim', PASSWORD, A)).resolves.toMatchObject({ user_id: userId });
    });

    test('сбой bcrypt не возвращает попытку (fail-closed)', async () => {
        verifySpy.mockRejectedValueOnce(new Error('bcrypt exploded'));
        await expect(login('victim', PASSWORD, A)).rejects.toThrow('bcrypt exploded');

        const { rows } = await db.query(
            'SELECT failed_attempts FROM account_lockout WHERE login = $1', [`src:${A}|uid:${userId}`]);
        expect(rows[0].failed_attempts).toBe(1);
    });
});

describe('деактивированная учётная запись', () => {
    beforeEach(async () => {
        await db.query('UPDATE users SET is_active = false WHERE user_id = $1', [userId]);
    });

    test('с неверным паролем неотличима от несуществующей', async () => {
        // Раньше ACCOUNT_DISABLED возвращался до сверки пароля — аноним узнавал,
        // что запись существует и выключена.
        await expect(login('victim', 'WrongPass1', A)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    test('с верным паролем — ACCOUNT_DISABLED', async () => {
        await expect(login('victim', PASSWORD, A)).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
    });
});
