'use strict';

/**
 * [H-3] HMAC service-key gate for POST /api/metrics/telemetry.
 *
 * The route is public (default-deny JWT gate does not apply — see
 * PUBLIC_ROUTES in src/routes/index.js) because industrial controllers /
 * the future MQTT bridge (docs telemetry ADR, PR #138) can't hold a user
 * JWT. Without this, anyone who learns a `serial_number` (seed values are
 * predictable, e.g. `CRTL_OL_01`) can inject fabricated metrics that drive
 * the LEAK/VOLTAGE/HEATING alert pipeline straight through to the UK
 * integration.
 *
 * Scheme is byte-for-byte the same as the UK inbound webhook verifier
 * (src/services/uk/webhookVerifier.js): header `t=<unixSeconds>,v1=<hex>`,
 * HMAC-SHA256 over `${t}.${rawBody}`, 300s tolerance, timingSafeEqual,
 * Redis-backed replay dedup with an in-memory fallback. Implemented as a
 * thin standalone module rather than extending UKWebhookVerifier — that
 * class also owns UK-integration-specific concerns (IntegrationLog
 * lookups) that don't belong on the telemetry ingestion path, and telemetry
 * has its own dormant-until-configured rollout (TELEMETRY_HMAC_SECRET),
 * distinct from the UK secret's already-live fail-closed requirement.
 *
 * Dormant-until-configured (matches this repo's flag convention: env
 * presence IS the flag): TELEMETRY_HMAC_SECRET unset → next() unchanged
 * (the endpoint stays exactly as it is today — no production clients exist
 * yet, per the telemetry ADR). Once set, every request must carry a valid,
 * fresh, non-replayed signature or the request is rejected with 401.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const redisClient = require('../utils/redisClient');
const { sendError } = require('../utils/apiResponse');

const TIMESTAMP_TOLERANCE_SEC = 300;
const SEEN_SIGNATURE_TTL_MS = (TIMESTAMP_TOLERANCE_SEC + 10) * 1000;
const SEEN_SIGNATURE_TTL_SEC = TIMESTAMP_TOLERANCE_SEC + 10;
const SEEN_SIGNATURE_MAX_ENTRIES = 10000;
const DEDUP_KEY_PREFIX = 'telemetryhmac:nonce:';
const HEADER_NAME = 'x-telemetry-signature';

// sigHash -> expireAt(ms). Single-replica fallback when Redis is unavailable
// — mirrors webhookVerifier's dedup map exactly.
const seenSignatures = new Map();

/**
 * Test helper — clears the in-memory dedup map between deterministic-
 * timestamp test cases. Not part of the request-handling API.
 */
function _resetSeenSignatures() {
    seenSignatures.clear();
}

function parseSignatureHeader(headerValue) {
    // [CodeQL js/remote-property-injection] Only write to the two known-good
    // keys — mirrors webhookVerifier's parsing so an attacker-chosen
    // parameter name can never pollute the parsed object.
    const parts = {};
    for (const part of headerValue.split(',')) {
        const eqIdx = part.indexOf('=');
        if (eqIdx === -1) continue;
        const k = part.substring(0, eqIdx);
        if (k !== 't' && k !== 'v1') continue;
        parts[k] = part.substring(eqIdx + 1);
    }
    return parts;
}

/**
 * Returns true if the signature is valid, fresh, and not a replay. Never
 * throws — any failure resolves to false. Await'd by the middleware.
 */
async function verifyTelemetrySignature(secret, rawBody, headerValue) {
    if (!headerValue || typeof headerValue !== 'string') return false;
    if (typeof rawBody !== 'string') return false;

    const { t: timestamp, v1: signature } = parseSignatureHeader(headerValue);
    if (!timestamp || !signature) return false;

    // [Hardening] Validate the timestamp is a plain non-negative integer
    // BEFORE any arithmetic — parseInt('abc', 10) is NaN, and
    // `Math.abs(now - NaN) > TOLERANCE` is always false, which would let a
    // malformed timestamp silently pass the freshness gate. See the same
    // fix applied to webhookVerifier.js.
    if (!/^\d{1,15}$/.test(timestamp)) return false;
    const timestampInt = parseInt(timestamp, 10);
    if (!Number.isSafeInteger(timestampInt)) return false;

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampInt) > TIMESTAMP_TOLERANCE_SEC) return false;

    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

    let sigBuf, expBuf;
    try {
        sigBuf = Buffer.from(signature, 'hex');
        expBuf = Buffer.from(expected, 'hex');
    } catch {
        return false;
    }
    if (sigBuf.length !== expBuf.length) return false;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

    // Replay/nonce dedup — Redis-backed (multi-replica safe) with an
    // in-memory fallback, identical pattern to webhookVerifier.
    const nowMs = Date.now();
    const sigHash = crypto.createHash('sha256').update(signature).digest('hex');

    const client = redisClient.getClient();
    if (client && redisClient.isReady()) {
        try {
            const setResult = await client.set(
                `${DEDUP_KEY_PREFIX}${sigHash}`,
                '1',
                'EX',
                SEEN_SIGNATURE_TTL_SEC,
                'NX'
            );
            if (setResult === null) {
                logger.warn(`telemetryHmac: replay attempt detected (Redis) for signature ${sigHash.slice(0, 16)}...`);
                return false;
            }
            return true;
        } catch (err) {
            logger.warn(`telemetryHmac: Redis dedup failed, using memory fallback: ${err.message}`);
        }
    }

    const prevExpireAt = seenSignatures.get(sigHash);
    if (prevExpireAt !== undefined && prevExpireAt > nowMs) {
        logger.warn(`telemetryHmac: replay attempt detected (memory) for signature ${sigHash.slice(0, 16)}...`);
        return false;
    }

    if (seenSignatures.size >= SEEN_SIGNATURE_MAX_ENTRIES) {
        for (const [k, v] of seenSignatures) {
            if (v <= nowMs) seenSignatures.delete(k);
        }
        if (seenSignatures.size >= SEEN_SIGNATURE_MAX_ENTRIES) {
            const oldestKey = seenSignatures.keys().next().value;
            if (oldestKey !== undefined) seenSignatures.delete(oldestKey);
        }
    }

    seenSignatures.set(sigHash, nowMs + SEEN_SIGNATURE_TTL_MS);
    return true;
}

/**
 * Express middleware. Dormant when TELEMETRY_HMAC_SECRET is unset (the
 * current, pre-existing behavior of the route). Once set, requires header
 * `x-telemetry-signature: t=<unixSeconds>,v1=<hex>` computed over the raw
 * request body; missing/invalid/stale/replayed → 401.
 */
async function verifyTelemetryHmac(req, res, next) {
    const secret = process.env.TELEMETRY_HMAC_SECRET;
    if (!secret) {
        return next();
    }

    const headerValue = req.headers[HEADER_NAME];
    if (typeof req.rawBody !== 'string') {
        // express.json's verify hook always sets this; a missing rawBody
        // means something upstream changed — fail closed, not open.
        logger.error('telemetryHmac: req.rawBody missing — cannot verify signature');
        return sendError(res, 400, 'Request body could not be verified');
    }

    const valid = await verifyTelemetrySignature(secret, req.rawBody, headerValue);
    if (!valid) {
        return sendError(res, 401, 'Invalid or missing telemetry signature');
    }
    next();
}

module.exports = {
    verifyTelemetryHmac,
    verifyTelemetrySignature,
    _resetSeenSignatures,
};
