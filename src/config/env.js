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
    'TOTP_ENCRYPTION_KEY',
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

    // UK integration env vars: warn if missing (integration is optional,
    // defaults to disabled in DB, but if enabled without these it fails silently).
    // UK_API_ALLOWED_HOSTS is required by SSRF protection — without it,
    // validateUKApiUrl() throws at request time in production.
    if (isProduction) {
        const UK_VARS = [
            'UK_WEBHOOK_SECRET', 'UK_SERVICE_USER', 'UK_SERVICE_PASSWORD',
            'UK_API_ALLOWED_HOSTS'
        ];
        const missingUK = UK_VARS.filter(name => !process.env[name]);
        if (missingUK.length > 0) {
            logger.warn(
                `UK integration env vars not configured: ${missingUK.join(', ')}. ` +
                'Webhooks and outbound UK API calls will fail if integration is enabled.'
            );
        }
    }
}

module.exports = { validateEnv };
