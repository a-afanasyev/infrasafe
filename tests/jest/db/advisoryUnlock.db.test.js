/**
 * [N-21] Соединение, на котором не удалось снять advisory-лок, не возвращается
 * в пул.
 *
 * Воркеры держат сессионный `pg_advisory_lock` на выделенном клиенте и в
 * `finally` делают `pg_advisory_unlock`. Ошибка этого запроса только
 * логировалась, и клиент уходил в пул ВМЕСТЕ с локом: сессионный лок живёт,
 * пока живёт соединение. Следующие тики на других соединениях видели «лок у
 * другой реплики» и молча пропускались — воркер вставал, не сообщая ни о чём.
 *
 * Почему против живой БД: суть дефекта — в том, что делает Postgres с локом
 * при возврате соединения в пул и при его уничтожении. Мок этого не знает.
 *
 * Сбой самого unlock моделируется обёрткой клиента: вызвать его отказ на
 * настоящем соединении, не разрывая это соединение, нельзя, а разрыв как раз
 * освободил бы лок и спрятал дефект.
 *
 * Как запускать: `npm run test:db`. Suite не пропускается при недоступной БД.
 */

const { Client } = require('pg');
const db = require('../../../src/config/database');
const { unlockAdvisory, releaseClient } = require('../../../src/utils/pgClient');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[N-21] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

const KEY = 9021021;

/**
 * Наблюдатель — ОТДЕЛЬНОЕ соединение вне пула, «другая реплика». Из пула брать
 * нельзя: пул может отдать то самое соединение, что держит лок, а сессионный
 * advisory-лок реентерабелен, и проверка соврала бы «свободен».
 */
async function lockIsFree() {
    const probe = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
    await probe.connect();
    try {
        const { rows } = await probe.query('SELECT pg_try_advisory_lock($1) AS got', [KEY]);
        if (rows[0].got) await probe.query('SELECT pg_advisory_unlock($1)', [KEY]);
        return rows[0].got;
    } finally {
        await probe.end();
    }
}

/** Уничтожение соединения асинхронно: бэкенд отпускает лок через миллисекунды. */
async function eventuallyFree(timeoutMs = 2000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
        if (await lockIsFree()) return true;
        if (Date.now() > until) return false;
        await new Promise((r) => setTimeout(r, 50));
    }
}

/** Клиент, у которого отказывает ровно запрос unlock — как при statement_timeout. */
function failingUnlock(client) {
    const realQuery = client.query.bind(client);
    client.query = (text, ...rest) => (
        typeof text === 'string' && text.includes('pg_advisory_unlock')
            ? Promise.reject(new Error('canceling statement due to statement timeout'))
            : realQuery(text, ...rest)
    );
    return () => { client.query = realQuery; };
}

describe('[N-21] неудачный advisory_unlock не оставляет лок в пуле', () => {
    beforeAll(async () => {
        await db.init();
    });

    afterAll(async () => {
        await db.close();
    });

    test('упал unlock — соединение уничтожено, лок свободен', async () => {
        const client = await db.getPool().connect();
        await client.query('SELECT pg_advisory_lock($1)', [KEY]);
        const restore = failingUnlock(client);

        const unlocked = await unlockAdvisory(client, KEY, 'N-21 test');
        restore();
        releaseClient(client);

        expect(unlocked).toBe(false);
        // Уничтоженное соединение забирает сессионный лок с собой.
        await expect(eventuallyFree()).resolves.toBe(true);
    });

    test('…а прежний путь (release без пометки) оставлял лок занятым', async () => {
        // Фиксация механизма дефекта, а не нового кода: без этого теста первый
        // мог бы проходить по совпадению.
        const client = await db.getPool().connect();
        await client.query('SELECT pg_advisory_lock($1)', [KEY]);
        client.release();

        await expect(lockIsFree()).resolves.toBe(false);

        // Уборка: закрытие пула рвёт все его соединения и с ними лок.
        await db.close();
        await db.init();
        await expect(eventuallyFree()).resolves.toBe(true);
    });

    test('успешный unlock — соединение возвращается в пул как обычно', async () => {
        const client = await db.getPool().connect();
        await client.query('SELECT pg_advisory_lock($1)', [KEY]);

        const unlocked = await unlockAdvisory(client, KEY, 'N-21 test');
        releaseClient(client);

        expect(unlocked).toBe(true);
        await expect(lockIsFree()).resolves.toBe(true);
    });
});
