/**
 * [N-21] utils/pgClient: упавший advisory_unlock уничтожает соединение.
 *
 * Поведение Postgres (лок живёт, пока живёт соединение) проверяется на живой
 * БД в tests/jest/db/advisoryUnlock.db.test.js. Здесь — контракт с pg
 * (`release(err)` уничтожает соединение) и рубеж: снимать лок в обход
 * помощника нельзя, иначе класс вернётся с первым новым воркером.
 */
jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const logger = require('../../../src/utils/logger');
const { unlockAdvisory, releaseClient, markForDiscard } = require('../../../src/utils/pgClient');

const fakeClient = (queryImpl) => ({ query: jest.fn(queryImpl), release: jest.fn() });

beforeEach(() => jest.clearAllMocks());

describe('[N-21] unlockAdvisory + releaseClient', () => {
    test('успешный unlock — клиент возвращается в пул (release без аргумента)', async () => {
        const client = fakeClient(async () => ({ rows: [{ pg_advisory_unlock: true }] }));

        await expect(unlockAdvisory(client, 42, 'w')).resolves.toBe(true);
        releaseClient(client);

        expect(client.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [42]);
        expect(client.release).toHaveBeenCalledWith(undefined);
    });

    test('упавший unlock — не бросает, логирует и уничтожает соединение', async () => {
        const boom = new Error('canceling statement due to statement timeout');
        const client = fakeClient(async () => { throw boom; });

        await expect(unlockAdvisory(client, 42, 'MV refresh')).resolves.toBe(false);
        releaseClient(client);

        expect(client.release).toHaveBeenCalledWith(boom);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('MV refresh'));
    });

    test('первая причина пометки сохраняется', () => {
        const client = fakeClient();
        const first = new Error('rollback failed');
        markForDiscard(client, first);
        markForDiscard(client, new Error('unlock failed'));

        releaseClient(client);

        expect(client.release).toHaveBeenCalledWith(first);
    });
});

describe('[N-21] рубеж: advisory_unlock только через помощник', () => {
    const SRC = path.join(__dirname, '../../../src');
    const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return files(full);
        return e.name.endsWith('.js') ? [full] : [];
    });

    test('в src нет прямых pg_advisory_unlock, кроме utils/pgClient.js', () => {
        const offenders = files(SRC)
            .filter((f) => !f.endsWith(path.join('utils', 'pgClient.js')))
            .filter((f) => fs.readFileSync(f, 'utf8')
                .split('\n')
                .some((line) => /pg_advisory_unlock\s*\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)))
            .map((f) => path.relative(SRC, f));
        expect(offenders).toEqual([]);
    });
});
