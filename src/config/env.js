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
    // [SEC-34h] 2FA temp-tokens are signed with a dedicated secret in prod.
    'JWT_2FA_SECRET',
];

// [SEC-12] NODE_ENV gates the security posture (Helmet CSP, Swagger exposure).
// An unset/unknown value silently falls back to the weaker dev posture, so we
// fail fast unless NODE_ENV is one of the known environments.
const VALID_NODE_ENVS = ['development', 'production', 'test'];

function validateEnv() {
    // [SEC-12] Assert NODE_ENV BEFORE any other branch (incl. the test
    // early-return below) so an unset/unknown value can never ship the dev
    // security posture by accident.
    const nodeEnv = process.env.NODE_ENV;
    if (!VALID_NODE_ENVS.includes(nodeEnv)) {
        const message =
            `Invalid NODE_ENV: ${nodeEnv === undefined ? '(unset)' : `"${nodeEnv}"`}. ` +
            `Must be one of: ${VALID_NODE_ENVS.join(', ')}.`;
        logger.error(message);
        throw new Error(message);
    }

    // В тестовой среде пропускаем валидацию — тесты используют моки
    if (nodeEnv === 'test') {
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

    // [SEC-34h] The presence filter above guarantees JWT_2FA_SECRET is set in
    // production, but not that it actually differs from JWT_SECRET. A shared
    // value defeats the credential-class separation, so fail fast on equality.
    if (isProduction && process.env.JWT_2FA_SECRET === process.env.JWT_SECRET) {
        const message =
            'JWT_2FA_SECRET must differ from JWT_SECRET in production (SEC-34h): ' +
            'the 2FA temp-token must use a dedicated signing secret.';
        logger.error(message);
        throw new Error(message);
    }

    // [R2-26] Presence alone is not enough — a short/low-entropy secret (e.g.
    // JWT_SECRET=1) passes the filter above but is trivially brute-forceable.
    // Enforce a minimum length for crypto secrets in production.
    if (isProduction) {
        const MIN_SECRET_LEN = 32;
        // JWT/TOTP secrets are always required; the UK webhook HMAC keys are
        // optional (integration may be off) so they're only length-checked when set
        // — a short HMAC key would let an attacker brute-force it and forge inbound
        // UK webhooks (building.deleted etc.).
        const secretVars = [
            'JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_2FA_SECRET', 'TOTP_ENCRYPTION_KEY',
            'INFRASAFE_WEBHOOK_SECRET', 'UK_WEBHOOK_SECRET',
        ];
        const weak = secretVars.filter(
            name => process.env[name] && process.env[name].length < MIN_SECRET_LEN
        );
        if (weak.length > 0) {
            const message =
                `Weak secrets in production (min ${MIN_SECRET_LEN} chars): ${weak.join(', ')}. ` +
                'Generate with e.g. `openssl rand -base64 32`.';
            logger.error(message);
            throw new Error(message);
        }
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
