require('dotenv').config();

const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

// Инициализация подключения к базе данных
const init = async () => {
    try {
        // Phase 11.9 (ARCH-014): pool parameters are env-driven so ops can
        // tune capacity per environment without code changes. Defaults
        // match the prior hardcoded values.
        pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT || '5432'),
            max: parseInt(process.env.DB_POOL_MAX || '20', 10),
            min: parseInt(process.env.DB_POOL_MIN || '2', 10),
            idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10),
            connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECT_TIMEOUT || '5000', 10),
        });

        // Обработка ошибок idle-клиентов
        pool.on('error', (err) => {
            logger.error('Unexpected error on idle database client:', err.message);
        });

        // Устанавливаем statement_timeout для каждого нового соединения
        // [R2-27] Guard the fire-and-forget query: an unhandled rejection here
        // (e.g. connection dropped mid-SET) would bubble to the process-level
        // unhandledRejection handler → gracefulShutdown(1), i.e. a restart on a
        // non-fatal per-connection error. Log and move on instead.
        pool.on('connect', (client) => {
            client.query('SET statement_timeout = 30000').catch((err) => {
                logger.warn(`Failed to set statement_timeout on new DB connection: ${err.message}`);
            });
        });

        // Проверка соединения
        const client = await pool.connect();
        logger.info('База данных успешно подключена');
        client.release();

        return pool;
    } catch (error) {
        logger.error(`Ошибка подключения к базе данных: ${error.message}`);
        throw error;
    }
};

// Выполнение SQL-запроса
const query = async (text, params) => {
    if (!pool) {
        throw new Error('База данных не инициализирована. Вызовите db.init() сначала.');
    }

    try {
        const start = Date.now();
        const result = await pool.query(text, params);
        const duration = Date.now() - start;

        logger.debug(`Выполнен запрос: ${text}, длительность: ${duration}ms, строк: ${result.rowCount}`);

        return result;
    } catch (error) {
        logger.error(`Ошибка выполнения запроса: ${error.message}`);
        throw error;
    }
};

// Получение объекта pool
const getPool = () => {
    if (!pool) {
        throw new Error('База данных не инициализирована. Вызовите db.init() сначала.');
    }
    return pool;
};

// Завершение работы с базой данных
const close = async () => {
    if (pool) {
        await pool.end();
        logger.info('Соединение с базой данных закрыто');
    }
};

// [CO-2] Отметка «этот клиент испорчен неудавшимся ROLLBACK». Живёт НА объекте
// клиента, а не в локальной переменной: откат и release нередко находятся в
// разных кадрах (alertVerificationService откатывает внутри `_processDue`, а
// освобождает соединение вызывающий двумя уровнями выше). Symbol — чтобы не
// столкнуться с полями самого pg.
const BROKEN_BY_FAILED_ROLLBACK = Symbol('brokenByFailedRollback');

/**
 * Откатить транзакцию, не маскируя исходную ошибку.
 *
 * Упавший ROLLBACK не пробрасывается (иначе он подменит собой настоящую
 * причину сбоя), но клиент помечается: `releaseClient` уничтожит соединение
 * вместо возврата в пул. Без этого соединение могло вернуться в состоянии
 * «current transaction is aborted», и падал бы уже следующий, ни в чём не
 * повинный запрос.
 */
const safeRollback = async (client, context = 'transaction') => {
    try {
        await client.query('ROLLBACK');
    } catch (rollbackError) {
        client[BROKEN_BY_FAILED_ROLLBACK] = rollbackError;
        logger.warn(`${context}: ROLLBACK failed: ${rollbackError.message}`);
    }
};

/**
 * Вернуть клиент в пул. Если откат не удался — передаём ошибку в `release`,
 * что заставляет pg уничтожить соединение, а не переиспользовать его.
 */
const releaseClient = (client) => {
    client.release(client[BROKEN_BY_FAILED_ROLLBACK] || undefined);
};

/**
 * [AR-11] Выполнить работу в транзакции.
 *
 * До этого пять мест писали BEGIN/COMMIT руками, и каждое несло свою копию
 * защиты отката. Копии появлялись не вместе: R2-22 научил не давать упавшему
 * ROLLBACK затирать исходную ошибку, CO-2 — помечать клиент, чтобы он не
 * вернулся в пул с оборванной транзакцией, AR-11 — не глотать сбой отката
 * молча. Каждый урок приходилось разносить по всем местам вручную. Здесь он
 * один, и забыть про него нельзя.
 *
 * Два режима — потому что мест два вида:
 *   * без `client` — хелпер сам берёт соединение из пула и сам возвращает;
 *   * с `client` — работает на ЧУЖОМ соединении и НЕ освобождает его.
 *     Так устроены воркер верификации (держит клиент под advisory-локом и
 *     освобождает двумя кадрами выше) и `alertService.resolveAlert`. Освободить
 *     такой клиент здесь значило бы выдернуть соединение из-под вызывающего.
 *
 * Порядок в ветке отказа существенный: сначала откат (он же помечает клиент
 * при неудаче), потом освобождение — иначе метка не успела бы доехать до
 * `releaseClient`, и соединение с оборванной транзакцией вернулось бы в пул.
 *
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 * @param {{ client?: object, context?: string }} [opts]
 */
const withTransaction = async (fn, { client = null, context = 'transaction' } = {}) => {
    const owned = client === null;
    // Пул берём через `module.exports.getPool`, а не через локальную функцию.
    // Разница не косметическая: места, которые этот хелпер заменил, все звали
    // `db.getPool()`, то есть публичный экспорт, и тесты подменяют именно его
    // (`jest.spyOn(db, 'getPool')`). Замыкание на локальную ссылку прошло бы
    // мимо подмены — и мимо любого другого перехвата на границе модуля.
    const conn = owned ? await module.exports.getPool().connect() : client;
    try {
        await conn.query('BEGIN');
        try {
            const result = await fn(conn);
            await conn.query('COMMIT');
            return result;
        } catch (error) {
            await safeRollback(conn, context);
            throw error;
        }
    } finally {
        if (owned) releaseClient(conn);
    }
};

module.exports = {
    init,
    query,
    getPool,
    close,
    safeRollback,
    releaseClient,
    withTransaction
};