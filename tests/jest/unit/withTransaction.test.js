/**
 * [AR-11, остаток] Общий хелпер транзакций.
 *
 * Что было не так
 * ---------------
 * Пять мест писали `BEGIN`/`COMMIT` руками, и каждое несло СВОЮ копию защиты
 * отката. Копии эти появились не сразу и не вместе: `R2-22` научил не давать
 * упавшему `ROLLBACK` затирать исходную ошибку, `CO-2` — помечать клиент, чтобы
 * он не вернулся в пул с оборванной транзакцией, `AR-11` — не глотать сбой
 * отката молча. Каждый урок приходилось разносить по всем пяти местам вручную,
 * и шестое место начало бы этот путь заново.
 *
 * Хелпер не «красивее» — он делает так, что забыть про откат нельзя.
 *
 * Два режима, потому что мест два вида
 * -----------------------------------
 * Три места соединение ЗАВОДЯТ (модели, CLI) — им нужен connect + release.
 * Два места работают на ЧУЖОМ клиенте: воркер верификации держит его под
 * advisory-локом и освобождает двумя кадрами выше, а `alertService.resolveAlert`
 * берёт лок вокруг транзакции. Освободить такой клиент внутри хелпера значило
 * бы выдернуть соединение из-под вызывающего кода.
 */

jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));

const mockClient = { query: jest.fn(), release: jest.fn() };
// `on` нужен потому, что init() вешает обработчики idle-error и connect —
// без него падает сам init, а не проверяемая логика.
const mockPool = { connect: jest.fn(async () => mockClient), on: jest.fn() };

jest.mock('pg', () => ({ Pool: jest.fn(() => mockPool) }));

const db = require('../../../src/config/database');

/** Список SQL-команд, отданных клиенту. */
const sql = () => mockClient.query.mock.calls.map(([q]) => String(q).trim());

beforeEach(async () => {
    jest.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [] });
    // init() создаёт пул из замоканного pg и делает пробное connect/release.
    await db.init();
    jest.clearAllMocks();
    mockClient.query.mockResolvedValue({ rows: [] });
});

describe('[AR-11] withTransaction — своё соединение', () => {
    test('оборачивает работу в BEGIN…COMMIT и возвращает результат', async () => {
        const result = await db.withTransaction(async (client) => {
            await client.query('SELECT 1');
            return 'значение';
        });

        expect(result).toBe('значение');
        expect(sql()).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    });

    test('соединение берётся из пула и возвращается', async () => {
        await db.withTransaction(async () => {});

        expect(mockPool.connect).toHaveBeenCalledTimes(1);
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    test('исключение внутри откатывает транзакцию и пробрасывается', async () => {
        const boom = new Error('работа не удалась');

        await expect(db.withTransaction(async () => { throw boom; })).rejects.toBe(boom);

        expect(sql()).toEqual(['BEGIN', 'ROLLBACK']);
        expect(mockClient.release).toHaveBeenCalled();
    });

    test('упавший ROLLBACK не затирает исходную ошибку', async () => {
        // [R2-22] Причина отказа должна дойти до вызывающего: сбой отката —
        // это следствие, а не причина, и подменять им диагноз нельзя.
        const boom = new Error('исходная причина');
        mockClient.query.mockImplementation(async (q) => {
            if (String(q).trim() === 'ROLLBACK') throw new Error('соединение оборвано');
            return { rows: [] };
        });

        await expect(db.withTransaction(async () => { throw boom; })).rejects.toBe(boom);
    });

    test('после упавшего ROLLBACK соединение уничтожается, а не возвращается в пул', async () => {
        // [CO-2] Иначе следующий, ни в чём не повинный запрос упадёт с
        // «current transaction is aborted».
        mockClient.query.mockImplementation(async (q) => {
            if (String(q).trim() === 'ROLLBACK') throw new Error('соединение оборвано');
            return { rows: [] };
        });

        await expect(db.withTransaction(async () => { throw new Error('x') })).rejects.toThrow('x');

        expect(mockClient.release).toHaveBeenCalledWith(expect.any(Error));
    });

    test('сбой самого COMMIT тоже приводит к откату', async () => {
        mockClient.query.mockImplementation(async (q) => {
            if (String(q).trim() === 'COMMIT') throw new Error('коммит не прошёл');
            return { rows: [] };
        });

        await expect(db.withTransaction(async () => 'ok')).rejects.toThrow('коммит не прошёл');
        expect(sql()).toContain('ROLLBACK');
    });
});

describe('[AR-11] withTransaction — чужое соединение', () => {
    test('работает на переданном клиенте и НЕ трогает пул', async () => {
        const borrowed = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };

        await db.withTransaction(async (client) => {
            expect(client).toBe(borrowed);
            await client.query('SELECT 2');
        }, { client: borrowed });

        expect(mockPool.connect).not.toHaveBeenCalled();
        expect(borrowed.query.mock.calls.map(([q]) => q)).toEqual(['BEGIN', 'SELECT 2', 'COMMIT']);
    });

    test('чужое соединение не освобождается', async () => {
        const borrowed = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };

        await db.withTransaction(async () => {}, { client: borrowed });

        // Соединение держит вызывающий — он же и освободит. Освободить его
        // здесь значило бы выдернуть его из-под чужого кадра (воркер
        // верификации держит клиент под advisory-локом).
        expect(borrowed.release).not.toHaveBeenCalled();
    });

    test('откат идёт по чужому клиенту, но освобождение остаётся за вызывающим', async () => {
        const borrowed = {
            query: jest.fn(async (q) => {
                if (String(q).trim() === 'ROLLBACK') return { rows: [] };
                if (String(q).trim() === 'BEGIN') return { rows: [] };
                throw new Error('работа не удалась');
            }),
            release: jest.fn()
        };

        await expect(
            db.withTransaction(async (c) => { await c.query('SELECT 3'); }, { client: borrowed })
        ).rejects.toThrow('работа не удалась');

        expect(borrowed.query.mock.calls.map(([q]) => q)).toContain('ROLLBACK');
        expect(borrowed.release).not.toHaveBeenCalled();
    });
});

describe('[AR-11] границу сторожит тест', () => {
    const fs = require('fs');
    const path = require('path');

    /** Все .js под src/, кроме самого модуля БД. */
    function srcFiles(dir, acc = []) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) srcFiles(full, acc);
            else if (entry.name.endsWith('.js')) acc.push(full);
        }
        return acc;
    }

    test('никто, кроме db.withTransaction, не открывает транзакцию руками', () => {
        // Смысл сторожа: сама по себе строка BEGIN безобидна — опасно то, что
        // вместе с ней каждый раз переписывают откат. Три урока (R2-22, CO-2,
        // AR-11) разносили по пяти местам вручную; шестое начало бы заново.
        const root = path.join(__dirname, '../../../src');
        const dbModule = path.join(root, 'config', 'database.js');

        const offenders = srcFiles(root)
            .filter((f) => f !== dbModule)
            .filter((f) => /query\(\s*['"`]BEGIN/.test(fs.readFileSync(f, 'utf8')))
            .map((f) => path.relative(root, f));

        expect(offenders).toEqual([]);
    });
});
