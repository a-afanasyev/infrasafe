/**
 * [N-29] statement_timeout — параметр подключения, а не отдельный запрос.
 *
 * Пул ставил таймаут fire-and-forget запросом `SET statement_timeout` в событии
 * `connect`. Два следствия:
 *
 *   - упади этот SET (оборвалось соединение, отказ сервера) — соединение молча
 *     работает БЕЗ таймаута, и запрос к заблокированной таблице висит вечно;
 *   - первый запрос пользователя встаёт в очередь клиента, пока SET ещё
 *     выполняется. pg это уже помечает как устаревшее («Calling client.query()
 *     when the client is already executing a query is deprecated and will be
 *     removed in pg@9.0») — после обновления pg порядок перестанет быть гарантией.
 *
 * Таймаут, переданный в конфиге пула, уходит в стартовом пакете соединения:
 * отдельного запроса нет, и соединение без таймаута не может возникнуть.
 *
 * Как запускать: `npm run test:db`. Suite не пропускается при недоступной БД.
 */

const db = require('../../../src/config/database');

const DB_NAME = process.env.DB_NAME || '';
if (!/test/i.test(DB_NAME)) {
    throw new Error(
        `[N-29] Отказ: DB_NAME='${DB_NAME}' не похоже на тестовую базу. ` +
        'Задайте DB_NAME с "test" в имени (в CI это infrasafe_test).'
    );
}

describe('[N-29] statement_timeout на каждом соединении пула', () => {
    afterEach(async () => {
        jest.restoreAllMocks();
        await db.close();
    });

    test('таймаут не ставится отдельным запросом, который может упасть или встать в очередь', async () => {
        // Наблюдаем настоящий клиент pg, а не мок: записываем, что пул шлёт в
        // соединения. Событие 'warning' процесса в песочницу jest не доходит,
        // поэтому DeprecationWarning pg ловится только вне jest (см. бэклог).
        const { Client } = require('pg');
        const sent = [];
        const realQuery = Client.prototype.query;
        jest.spyOn(Client.prototype, 'query').mockImplementation(function (text, ...rest) {
            sent.push(typeof text === 'string' ? text : (text && text.text) || '');
            return realQuery.call(this, text, ...rest);
        });

        await db.init();
        await Promise.all([1, 2, 3].map(() => db.query('SELECT 1')));

        expect(sent.filter((t) => /SET\s+statement_timeout/i.test(t))).toEqual([]);
    });

    test('первое же соединение свежего пула уже с таймаутом', async () => {
        await db.init();
        const client = await db.getPool().connect();
        try {
            const { rows } = await client.query('SHOW statement_timeout');
            expect(rows[0].statement_timeout).toBe(`${db.STATEMENT_TIMEOUT_MS / 1000}s`);
        } finally {
            client.release();
        }
    });
});
