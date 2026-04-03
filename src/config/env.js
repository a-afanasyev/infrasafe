require('dotenv').config();

const logger = require('../utils/logger');

const REQUIRED_VARS = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
];

const PRODUCTION_REQUIRED_VARS = [
    'CORS_ORIGINS',
];

function validateEnv() {
    // В тестовой среде пропускаем валидацию — тесты используют моки
    if (process.env.NODE_ENV === 'test') {
        return;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const requiredVars = isProduction
        ? [...REQUIRED_VARS, ...PRODUCTION_REQUIRED_VARS]
        : REQUIRED_VARS;

    const missing = requiredVars.filter(name => !process.env[name]);

    if (missing.length > 0) {
        const message = `Missing required environment variables: ${missing.join(', ')}`;
        logger.error(message);
        throw new Error(message);
    }
}

module.exports = { validateEnv };
