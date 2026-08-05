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
    // [PR-6 / security audit 2026-07-11] Enforce-phase promotions from
    // warn-only to hard-required. Each promotion requires the operator
    // pre-deploy checklist below to have already been satisfied on the prod
    // host BEFORE this code is deployed — see the runbook note at the bottom
    // of this file. A missing value here is now a boot-time crash, not a
    // silent degradation.
    //   - INFRASAFE_WEBHOOK_SECRET: prod confirmed live since R2-18.
    //   - TELEMETRY_HMAC_SECRET: requires the H-3 rollout flip already done.
    //   - UK_INVENTORY_TOKEN: requires the H-4 rollout flip AND UK
    //     confirmation already done.
    'INFRASAFE_WEBHOOK_SECRET',
    'TELEMETRY_HMAC_SECRET',
    'UK_INVENTORY_TOKEN',
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
            // Always required in production (PRODUCTION_REQUIRED_VARS above):
            // JWT_SECRET, JWT_REFRESH_SECRET, JWT_2FA_SECRET, TOTP_ENCRYPTION_KEY,
            // INFRASAFE_WEBHOOK_SECRET, TELEMETRY_HMAC_SECRET, UK_INVENTORY_TOKEN.
            'JWT_SECRET', 'JWT_REFRESH_SECRET', 'JWT_2FA_SECRET', 'TOTP_ENCRYPTION_KEY',
            'INFRASAFE_WEBHOOK_SECRET', 'TELEMETRY_HMAC_SECRET', 'UK_INVENTORY_TOKEN',
            // UK_WEBHOOK_SECRET (outbound sender) remains optional — only
            // required when UK_USE_WEBHOOK_SENDER=true (checked separately
            // below) — but length-checked here whenever it's set.
            'UK_WEBHOOK_SECRET',
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
    //                              [R2-18] No fallback: this is THE inbound secret
    //                              (the UK_WEBHOOK_SECRET rename-window fallback was
    //                              removed in webhookVerifier.js).
    //   UK_WEBHOOK_SECRET        — sender secret for InfraSafe → UK outbound
    //                              (the HMAC-webhook channel). NOT used for inbound.
    //   UK_API_URL               — base host for the outbound webhook POST.
    //
    // UK_SERVICE_USER / UK_SERVICE_PASSWORD were required by the deleted
    // ukApiClient JWT path — no longer needed.
    // [R2-19] UK_API_ALLOWED_HOSTS is the allowlist-only SSRF mitigation:
    // optional, but RECOMMENDED in prod (set to the outbound host, e.g.
    // infrasafe.uz). validateUKApiUrl enforces it when set; the block below
    // warns if it's missing while an outbound target exists.
    if (isProduction) {
        // [PR-6] INFRASAFE_WEBHOOK_SECRET is now in PRODUCTION_REQUIRED_VARS —
        // presence is already guaranteed by the missing-vars check above, so the
        // warn that used to live here is unreachable dead code. Removed.

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

        // [R2-19] SSRF defense-in-depth nudge. When an outbound UK target exists
        // (UK_API_URL set) but no host allowlist is configured, the outbound URL
        // is constrained only by the private-IP string checks — which can't catch
        // a public host that RESOLVES to an internal IP. Recommend the allowlist
        // (validateUKApiUrl enforces it when set). Kept a warn, not a hard fail,
        // so the canonical unconfigured path still works (SEC-5).
        if (process.env.UK_API_URL && !process.env.UK_API_ALLOWED_HOSTS) {
            logger.warn(
                'UK_API_ALLOWED_HOSTS is not set — the outbound UK API host is not ' +
                'allowlisted (SSRF defense-in-depth). Recommended: set ' +
                'UK_API_ALLOWED_HOSTS to the target host (e.g. infrasafe.uz).'
            );
        }

        // [PR-6] UK_API_ALLOWED_HOSTS: conditional HARD FAIL when the outbound
        // webhook sender is actually enabled — an SSRF mitigation that matters
        // is worth more than a warn once we know the outbound path is live.
        // Sender-off keeps the softer nudge above (UK_API_URL set but sender
        // off is a "getting ready" state, not an active SSRF exposure).
        if (senderEnabled && !process.env.UK_API_ALLOWED_HOSTS) {
            const message =
                'UK_API_ALLOWED_HOSTS is required when UK_USE_WEBHOOK_SENDER=true ' +
                '(SSRF mitigation for the outbound UK API target).';
            logger.error(message);
            throw new Error(message);
        }

        // [PR-6] TELEMETRY_HMAC_SECRET and UK_INVENTORY_TOKEN are now in
        // PRODUCTION_REQUIRED_VARS — presence is already guaranteed by the
        // missing-vars check above, so the dormant-until-set warns that used
        // to live here are unreachable dead code. Removed.
    }
}

// [EN-1] Списки экспортируются, чтобы drift-guard в тестах сверял с ними
// `.env.example` автоматически, а не хранил собственную копию, которая устареет.
module.exports = { validateEnv, REQUIRED_VARS, PRODUCTION_REQUIRED_VARS };
