/**
 * [CO-2 / AR-11] Возврат в пул соединения с неудавшимся ROLLBACK.
 *
 * Паттерн, скопированный по всем транзакционным местам: ROLLBACK оборачивается
 * в `.catch(log)`, но клиент возвращается в пул безусловным `client.release()`.
 * Если ROLLBACK упал не из-за разрыва TCP (такое соединение pg выкинет сам), а
 * на живом соединении с оборванной транзакцией, клиент вернётся в пул в
 * состоянии «current transaction is aborted» — и следующий заёмщик получит
 * непонятную ошибку на первом же запросе.
 *
 * Отметка ставится НА КЛИЕНТЕ, а не в локальной переменной: в
 * alertVerificationService откат делает `_processDue(executor)`, а release
 * вызывает кадр двумя уровнями выше — локальный флаг туда не доедет.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const logger = require('../../../src/utils/logger');
const db = require('../../../src/config/database');

function fakeClient({ rollbackFails = false } = {}) {
    return {
        release: jest.fn(),
        query: jest.fn().mockImplementation((sql) => {
            if (sql === 'ROLLBACK' && rollbackFails) {
                return Promise.reject(new Error('current transaction is aborted'));
            }
            return Promise.resolve({ rows: [] });
        })
    };
}

describe('[CO-2] safeRollback + releaseClient', () => {
    beforeEach(() => jest.clearAllMocks());

    test('удачный откат: клиент возвращается в пул как исправный', async () => {
        const client = fakeClient();

        await db.safeRollback(client, 'test');
        db.releaseClient(client);

        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledWith(undefined);
    });

    test('неудачный откат: клиент уничтожается, а не переиспользуется', async () => {
        const client = fakeClient({ rollbackFails: true });

        await db.safeRollback(client, 'test');
        db.releaseClient(client);

        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    test('неудачный откат логируется с контекстом и не пробрасывается', async () => {
        const client = fakeClient({ rollbackFails: true });

        await expect(db.safeRollback(client, 'Building.deleteCascade')).resolves.toBeUndefined();

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Building.deleteCascade')
        );
    });

    test('отметка переживает переход между кадрами', async () => {
        const client = fakeClient({ rollbackFails: true });

        // Откат делает вложенная функция, release — внешняя.
        const inner = async (executor) => { await db.safeRollback(executor, 'inner'); };
        await inner(client);
        db.releaseClient(client);

        expect(client.release.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    test('клиент без отката возвращается в пул исправным', () => {
        const client = fakeClient();

        db.releaseClient(client);

        expect(client.release).toHaveBeenCalledWith(undefined);
    });
});
