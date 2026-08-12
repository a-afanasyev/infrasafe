/**
 * [R2-24] `AccountLockout` против НАСТОЯЩЕГО Postgres.
 *
 * Что было не так
 * ---------------
 * Юнит-тесты модели есть, но БД в них замокана: они проверяют, что в
 * `db.query` ушла строка, содержащая нужные подстроки. Вся арифметика при
 * этом остаётся непроверенной, а она вся живёт ВНУТРИ SQL:
 *
 *   * `failed_attempts + 1 >= $2` — на какой именно попытке защёлкивается лок;
 *   * `($3 || ' milliseconds')::interval` — приведение числа миллисекунд к
 *     интервалу через конкатенацию строк (единственный способ ошибиться тихо:
 *     `'900000 milliseconds'` и `'900000'` ведут себя по-разному);
 *   * CTE `user_update` — переносится ли лок на `users.account_locked_until`,
 *     то есть на тот столбец, который реально проверяет auth-middleware;
 *   * `ON CONFLICT (login) DO UPDATE` — накопление счётчика, а не перезапись.
 *
 * Мок скажет «да» на любой из этих вопросов, потому что он ни одного из них
 * не задаёт. Это и есть претензия R2-24: самый security-критичный SQL в
 * проекте покрыт тестами, которые не могут его опровергнуть.
 *
 * Как запускать
 * -------------
 *   npm run test:db      — требует живой Postgres в DB_* переменных.
 *
 * Suite НЕ пропускается при недоступной БД: пропуск по недоступности
 * означал бы зелёный прогон без единой проверки — ровно тот ложнозелёный
 * исход, ради предотвращения которого этот файл и написан. В CI Postgres
 * уже поднят сервисом (job `test` в .github/workflows/ci.yml).
 */

const fs = require('fs');
const path = require('path');

const db = require('../../../src/config/database');
const AccountLockout = require('../../../src/models/AccountLockout');

// Защита от запуска по живой базе: тест создаёт и чистит таблицы, и попадание
// в dev/prod-базу стоило бы данных. Требуем, чтобы имя БД само себя объявляло
// тестовым — дешевле любой эвристики и не обходится случайно.
const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[R2-24] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const LOCKOUT_DDL = fs.readFileSync(
    path.join(__dirname, '../../../database/init/05_account_lockout.sql'),
    'utf8'
);

// Минимальный стенд для `users`: CTE в recordFailedAttempt трогает ровно два
// столбца, и воспроизводить здесь всю боевую таблицу незачем. Если запрос
// когда-нибудь начнёт трогать третий — тест упадёт на неизвестном столбце,
// что и есть нужный сигнал.
const USERS_DDL = `
    CREATE TABLE IF NOT EXISTS users (
        user_id              SERIAL PRIMARY KEY,
        username             VARCHAR(255) UNIQUE NOT NULL,
        account_locked_until TIMESTAMPTZ NULL
    );
`;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

let userId;

beforeAll(async () => {
    await db.init();
    await db.query(USERS_DDL);
    await db.query(LOCKOUT_DDL);
}, 20000);

afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS account_lockout');
    await db.query('DROP TABLE IF EXISTS users');
    await db.close();
});

beforeEach(async () => {
    await db.query('DELETE FROM account_lockout');
    await db.query('DELETE FROM users');
    const { rows } = await db.query(
        "INSERT INTO users (username) VALUES ('victim') RETURNING user_id"
    );
    userId = rows[0].user_id;
});

/** Текущее значение зеркала блокировки на строке пользователя. */
async function userLockedUntil() {
    const { rows } = await db.query(
        'SELECT account_locked_until FROM users WHERE user_id = $1',
        [userId]
    );
    return rows[0].account_locked_until;
}

describe('[R2-24] recordFailedAttempt — счётчик', () => {
    test('первая неудача создаёт строку со счётчиком 1 и без блокировки', async () => {
        const result = await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);

        expect(result.failed_attempts).toBe(1);
        expect(result.locked_until).toBeNull();
    });

    test('повторные неудачи накапливаются, а не перезаписывают', async () => {
        const seen = [];
        for (let i = 0; i < 3; i += 1) {
            const r = await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
            seen.push(r.failed_attempts);
        }

        // Именно это и проверяет ON CONFLICT DO UPDATE. Ошибка здесь означала
        // бы вечную единицу — то есть отсутствие блокировки в принципе.
        expect(seen).toEqual([1, 2, 3]);
    });

    test('блокировка защёлкивается ровно на попытке номер maxAttempts', async () => {
        for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
            const r = await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
            expect(r.locked_until).toBeNull();
        }

        const last = await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        expect(last.failed_attempts).toBe(MAX_ATTEMPTS);
        expect(last.locked_until).not.toBeNull();
    });

    test('счётчики разных login независимы', async () => {
        await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        const other = await AccountLockout.recordFailedAttempt('someone-else', MAX_ATTEMPTS, LOCKOUT_MS, null);

        expect(other.failed_attempts).toBe(1);
    });
});

describe('[R2-24] recordFailedAttempt — длительность блокировки', () => {
    test('locked_until отстоит от текущего момента примерно на lockoutMs', async () => {
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        }
        const record = await AccountLockout.get('victim');

        // Проверяем именно приведение `($3 || ' milliseconds')::interval`:
        // потеря единицы измерения дала бы 900000 СЕКУНД (10.4 суток) вместо
        // 15 минут, и мок этого не заметил бы никогда.
        const deltaMs = new Date(record.locked_until).getTime() - Date.now();
        expect(deltaMs).toBeGreaterThan(LOCKOUT_MS - 60_000);
        expect(deltaMs).toBeLessThan(LOCKOUT_MS + 60_000);
    });

    test('дробное значение lockoutMs не ломает приведение к интервалу', async () => {
        // authService складывает базовую длительность с crypto-джиттером;
        // если когда-нибудь туда придёт нецелое число, `'900000.5 milliseconds'`
        // обязано остаться валидным интервалом, а не свалить запрос.
        const oddMs = LOCKOUT_MS + 0.5;
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, oddMs, userId);
        }
        const record = await AccountLockout.get('victim');
        expect(record.locked_until).not.toBeNull();
    });

    test('неудача после блокировки продлевает окно (скользящее, не фиксированное)', async () => {
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        }
        const first = (await AccountLockout.get('victim')).locked_until;

        await new Promise((resolve) => setTimeout(resolve, 1100));
        await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        const second = (await AccountLockout.get('victim')).locked_until;

        // Фиксируем фактическое поведение CASE-ветки: она пересчитывает
        // NOW() + interval на КАЖДОЙ попытке после порога. Продолжающийся
        // перебор отодвигает разблокировку — так и задумано.
        expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
    });
});

describe('[R2-24] зеркало на users.account_locked_until', () => {
    test('до блокировки строка пользователя не трогается', async () => {
        await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);

        expect(await userLockedUntil()).toBeNull();
    });

    test('блокировка попадает на users в том же запросе', async () => {
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        }

        // H-1: auth-middleware смотрит именно на этот столбец. Если CTE не
        // сработает, блокировка не отзовёт уже выданный JWT — а это и была
        // исходная уязвимость, ради которой CTE появился.
        const mirrored = await userLockedUntil();
        expect(mirrored).not.toBeNull();

        const record = await AccountLockout.get('victim');
        expect(new Date(mirrored).getTime()).toBe(new Date(record.locked_until).getTime());
    });

    test('без userId строка пользователя не трогается вовсе', async () => {
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, null);
        }

        // Неизвестный login (несуществующий аккаунт) обязан копить счётчик,
        // но не может ссылаться ни на какую строку users.
        expect(await userLockedUntil()).toBeNull();
        expect((await AccountLockout.get('victim')).locked_until).not.toBeNull();
    });
});

describe('[R2-24] clearAttempts', () => {
    test('удаляет счётчик и снимает зеркало', async () => {
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        }

        await AccountLockout.clearAttempts('victim', userId);

        expect(await AccountLockout.get('victim')).toBeNull();
        expect(await userLockedUntil()).toBeNull();
    });

    test('вызов на чистом состоянии безвреден', async () => {
        await expect(AccountLockout.clearAttempts('never-seen', userId)).resolves.toBeUndefined();
    });
});

describe('[R2-24] cleanup', () => {
    test('удаляет только протухшие записи и не трогает активную блокировку', async () => {
        // Активная блокировка.
        for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
            await AccountLockout.recordFailedAttempt('victim', MAX_ATTEMPTS, LOCKOUT_MS, userId);
        }
        // Старая запись с истёкшей блокировкой.
        await db.query(
            `INSERT INTO account_lockout (login, failed_attempts, first_attempt_at, last_attempt_at, locked_until)
             VALUES ('stale', 5, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days')`
        );
        // Свежая незаблокированная запись — под условие возраста не подпадает.
        await AccountLockout.recordFailedAttempt('recent', MAX_ATTEMPTS, LOCKOUT_MS, null);

        const deleted = await AccountLockout.cleanup(24 * 60 * 60 * 1000);

        expect(deleted).toBe(1);
        expect(await AccountLockout.get('stale')).toBeNull();
        expect(await AccountLockout.get('victim')).not.toBeNull();
        expect(await AccountLockout.get('recent')).not.toBeNull();
    });
});
