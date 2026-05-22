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
    //
    // [Sprint 9 / FIX-007 O5] Two-direction secret split:
    //   INFRASAFE_WEBHOOK_SECRET — verifier secret for UK → InfraSafe inbound.
    //                              Falls back to UK_WEBHOOK_SECRET during the
    //                              rename migration (see webhookVerifier.js).
    //   UK_WEBHOOK_SECRET        — sender secret for InfraSafe → UK outbound
    //                              (the new HMAC-webhook channel).
    //   UK_API_URL               — base host for the outbound webhook POST.
    //
    // UK_SERVICE_USER / UK_SERVICE_PASSWORD / UK_API_ALLOWED_HOSTS were
    // required by the deleted ukApiClient JWT path — no longer needed.
    if (isProduction) {
        // Inbound verifier needs at least one of the two secret names
        // (rename migration window).
        const hasInboundSecret =
            !!process.env.INFRASAFE_WEBHOOK_SECRET ||
            !!process.env.UK_WEBHOOK_SECRET;
        if (!hasInboundSecret) {
            logger.warn(
                'UK integration inbound verifier secret not configured ' +
                '(INFRASAFE_WEBHOOK_SECRET or UK_WEBHOOK_SECRET). ' +
                'Incoming UK webhooks will be rejected (401) if integration is enabled.'
            );
        }

        // Outbound sender needs UK_WEBHOOK_SECRET + UK_API_URL only when the
        // sender is actually turned on (UK_USE_WEBHOOK_SENDER=true). Default
        // false → not required.
        const senderEnabled =
            String(process.env.UK_USE_WEBHOOK_SENDER ?? 'false').toLowerCase() === 'true' ||
            process.env.UK_USE_WEBHOOK_SENDER === '1';
        if (senderEnabled) {
            const missingSender = [];
            if (!process.env.UK_WEBHOOK_SECRET) missingSender.push('UK_WEBHOOK_SECRET');
            if (!process.env.UK_API_URL)       missingSender.push('UK_API_URL');
            if (missingSender.length > 0) {
                logger.warn(
                    `UK outbound sender enabled but missing: ${missingSender.join(', ')}. ` +
                    'Drain worker will skip events until configured (ukOutboxService).'
                );
            }
        }
    }
}

module.exports = { validateEnv };
