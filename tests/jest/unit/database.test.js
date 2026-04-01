jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const mockClient = {
    release: jest.fn()
};

const mockPoolInstance = {
    connect: jest.fn().mockResolvedValue(mockClient),
    query: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined)
};

jest.mock('pg', () => ({
    Pool: jest.fn(() => mockPoolInstance)
}));

describe('Database module', () => {
    let db;
    let logger;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset module cache to get fresh state for each test
        jest.resetModules();

        // Re-mock after resetModules
        jest.mock('../../../src/utils/logger', () => ({
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn()
        }));
        jest.mock('pg', () => ({
            Pool: jest.fn(() => mockPoolInstance)
        }));

        mockPoolInstance.connect.mockResolvedValue(mockClient);
        mockPoolInstance.query.mockResolvedValue({ rows: [], rowCount: 0 });
        mockPoolInstance.end.mockResolvedValue(undefined);

        db = require('../../../src/config/database');
        logger = require('../../../src/utils/logger');
    });

    describe('init', () => {
        test('creates pool and verifies connection', async () => {
            const pool = await db.init();

            const { Pool } = require('pg');
            expect(Pool).toHaveBeenCalledTimes(1);
            expect(mockPoolInstance.connect).toHaveBeenCalledTimes(1);
            expect(mockClient.release).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('успешно подключена'));
        });

        test('throws when connection fails', async () => {
            mockPoolInstance.connect.mockRejectedValue(new Error('Connection refused'));

            await expect(db.init()).rejects.toThrow('Connection refused');
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Connection refused'));
        });
    });

    describe('query', () => {
        test('throws when pool not initialized', async () => {
            // Fresh module without init — pool is null
            jest.resetModules();
            jest.mock('../../../src/utils/logger', () => ({
                info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
            }));
            jest.mock('pg', () => ({
                Pool: jest.fn(() => mockPoolInstance)
            }));
            const freshDb = require('../../../src/config/database');

            await expect(freshDb.query('SELECT 1')).rejects.toThrow('не инициализирована');
        });

        test('executes query and returns result after init', async () => {
            await db.init();
            const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
            mockPoolInstance.query.mockResolvedValue(mockResult);

            const result = await db.query('SELECT * FROM users WHERE id = $1', [1]);

            expect(result).toEqual(mockResult);
            expect(mockPoolInstance.query).toHaveBeenCalledWith('SELECT * FROM users WHERE id = $1', [1]);
        });

        test('logs query duration', async () => {
            await db.init();
            mockPoolInstance.query.mockResolvedValue({ rows: [], rowCount: 0 });

            await db.query('SELECT 1');

            expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Выполнен запрос'));
        });

        test('throws and logs on query error', async () => {
            await db.init();
            mockPoolInstance.query.mockRejectedValue(new Error('syntax error'));

            await expect(db.query('INVALID SQL')).rejects.toThrow('syntax error');
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('syntax error'));
        });
    });

    describe('getPool', () => {
        test('throws when pool not initialized', () => {
            jest.resetModules();
            jest.mock('../../../src/utils/logger', () => ({
                info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
            }));
            jest.mock('pg', () => ({
                Pool: jest.fn(() => mockPoolInstance)
            }));
            const freshDb = require('../../../src/config/database');

            expect(() => freshDb.getPool()).toThrow('не инициализирована');
        });

        test('returns pool after init', async () => {
            await db.init();

            const pool = db.getPool();

            expect(pool).toBeDefined();
            expect(pool.query).toBeDefined();
        });
    });

    describe('close', () => {
        test('ends pool connection after init', async () => {
            await db.init();

            await db.close();

            expect(mockPoolInstance.end).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('закрыто'));
        });

        test('does nothing when pool not initialized', async () => {
            jest.resetModules();
            jest.mock('../../../src/utils/logger', () => ({
                info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn()
            }));
            jest.mock('pg', () => ({
                Pool: jest.fn(() => mockPoolInstance)
            }));
            const freshDb = require('../../../src/config/database');

            // Should not throw
            await freshDb.close();

            expect(mockPoolInstance.end).not.toHaveBeenCalled();
        });
    });
});
