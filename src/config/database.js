require('dotenv').config();

const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

// Инициализация подключения к базе данных
const init = async () => {
    try {
        pool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            password: process.env.DB_PASSWORD,
            port: parseInt(process.env.DB_PORT || '5432'),
            max: 20,
            min: 2,
            idleTimeoutMillis: 30000,
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

module.exports = {
    init,
    query,
    getPool,
    close
};