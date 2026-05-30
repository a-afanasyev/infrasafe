'use strict';

/**
 * [Sprint 9 / FIX-007] HMAC-signed webhook sender — InfraSafe → UK.
 *
 * Mirrors the verification side (src/services/uk/webhookVerifier.js):
 * same algorithm, same header format, same `${t}.${rawBody}` message
 * shape. This module just runs the inverse direction.
 *
 * Algorithm (per UK reference vector L1 in
 * docs/audit/2026-05-22-FIX-007-uk-integration-questions.md):
 *
 *   t       = Math.floor(Date.now() / 1000)            // unix seconds
 *   message = `${t}.${rawBody}`                        // literal '.'
 *   v1      = HMAC-SHA256(secret, message).hex()
 *   header  = `t=${t},v1=${v1}`
 *
 * CRITICAL: `t` is computed at SEND TIME, not at enqueue time. UK
 * enforces a 300s window — a stale `t` from enqueue would 401 after any
 * non-trivial drain delay. This is why ukOutboxService stores
 * `payload_body` only and lets the client compute the signature header
 * fresh on every send attempt.
 *
 * Response handling per FIX-007 contract:
 *
 *   202 → success (UK accepted the event)
 *   409 → success (idempotent re-delivery; UK already has this event_id)
 *   401 → terminal failure (signature/timestamp/secret mismatch)
 *   422 → terminal failure (malformed payload schema)
 *   429 → retriable (rate-limit); use exponential backoff
 *   503 → retriable (UK receiver not configured); use exponential backoff
 *   other 5xx / network errors → retriable
 *
 * Outcome shape returned to caller:
 *
 *   { outcome: 'success', code }
 *   { outcome: 'dead', code, error }       // 401/422
 *   { outcome: 'retry', code, error }      // 429/503/5xx/network
 *   { outcome: 'skip', error }             // missing secret / disabled
 *
 * The outbox drain worker translates these outcomes into UkOutbox row
 * transitions (markSent / markDead / markFailed with backoff /
 * resetForSkip).
 */

const crypto = require('crypto');
const axios = require('axios');

const logger = require('../utils/logger');
const { validateUKApiUrl } = require('../utils/urlValidation');

const ENDPOINT_PATH = '/api/v2/webhooks/infrasafe/alert';
const SIGNATURE_HEADER = 'x-webhook-signature';
const DEFAULT_TIMEOUT_MS = 5000;

const SUCCESS_CODES = new Set([202, 409]);
const DEAD_CODES = new Set([401, 422]);
const RETRY_CODES = new Set([429, 502, 503, 504]);

class UKWebhookClient {
    /**
     * Resolve the outbound HMAC secret. Supports dual-secret rotation per
     * O5 of the UK contract: when `UK_USE_NEXT_SECRET=true`, use
     * `UK_WEBHOOK_SECRET_NEXT` instead of `UK_WEBHOOK_SECRET`. UK accepts
     * either value during the rotation window.
     */
    _getSecret() {
        const useNext = String(process.env.UK_USE_NEXT_SECRET ?? '').toLowerCase() === 'true';
        if (useNext && process.env.UK_WEBHOOK_SECRET_NEXT) {
            return process.env.UK_WEBHOOK_SECRET_NEXT;
        }
        return process.env.UK_WEBHOOK_SECRET || null;
    }

    /**
     * Resolve UK base URL. Strips trailing `/api/v1` etc. so caller can set
     * `UK_API_URL=https://uk.example.com` bare (or with any other prefix)
     * and we always POST to `<host>${ENDPOINT_PATH}`.
     *
     * Returns null if not configured.
     */
    _getEndpoint() {
        const raw = process.env.UK_API_URL;
        if (!raw || typeof raw !== 'string') return null;
        // [SEC-5] SSRF guard: the admin config path runs validateUKApiUrl()
        // (blocks private IPs / cloud-metadata / localhost), but the env path
        // bypassed it. Validate the raw URL here so a compromised/misconfigured
        // UK_API_URL cannot redirect outbound POSTs at internal targets. On
        // rejection, log and return null — the caller (send()) already treats a
        // null endpoint as 'skip' (not-configured). Never throw uncaught.
        try {
            validateUKApiUrl(raw);
        } catch (error) {
            logger.warn(`ukWebhookClient._getEndpoint rejected UK_API_URL (SSRF guard): ${error.message}`);
            return null;
        }
        // Strip trailing slash and any /api/vN path suffix so the bare host
        // composes cleanly with ENDPOINT_PATH.
        const trimmed = raw.replace(/\/+$/, '').replace(/\/api\/v\d+$/, '');
        return `${trimmed}${ENDPOINT_PATH}`;
    }

    /**
     * Build the signature header for a body. Pure function — no I/O.
     * Exposed for the pin-test against UK reference vector (L1).
     */
    static sign(secret, timestamp, body) {
        const hmac = crypto
            .createHmac('sha256', secret)
            .update(`${timestamp}.${body}`)
            .digest('hex');
        return { t: timestamp, v1: hmac, header: `t=${timestamp},v1=${hmac}` };
    }

    /**
     * Send a single signed event. Caller passes the canonical body text
     * (must match exactly what was POSTed — re-stringify would invalidate
     * the signature).
     *
     * @param {string} payloadBody — canonical JSON body bytes
     * @returns {Promise<{outcome: 'success'|'dead'|'retry'|'skip', code?: number, error?: string}>}
     */
    async send(payloadBody) {
        const secret = this._getSecret();
        if (!secret) {
            return { outcome: 'skip', error: 'UK_WEBHOOK_SECRET not configured' };
        }

        const endpoint = this._getEndpoint();
        if (!endpoint) {
            return { outcome: 'skip', error: 'UK_API_URL not configured' };
        }

        const t = Math.floor(Date.now() / 1000);
        const { header } = UKWebhookClient.sign(secret, t, payloadBody);

        try {
            const response = await axios.post(endpoint, payloadBody, {
                headers: {
                    'Content-Type': 'application/json',
                    [SIGNATURE_HEADER]: header
                },
                // Important: send the body verbatim (string), not re-JSON.stringified.
                transformRequest: [(data) => data],
                timeout: DEFAULT_TIMEOUT_MS,
                // Accept any status; we decide the outcome below.
                validateStatus: () => true
            });

            const code = response.status;
            if (SUCCESS_CODES.has(code)) {
                return { outcome: 'success', code };
            }
            if (DEAD_CODES.has(code)) {
                const detail = response.data && typeof response.data === 'object'
                    ? response.data.detail || JSON.stringify(response.data)
                    : String(response.data || '').slice(0, 200);
                return { outcome: 'dead', code, error: `UK ${code}: ${detail}` };
            }
            if (RETRY_CODES.has(code)) {
                return { outcome: 'retry', code, error: `UK ${code} (retriable)` };
            }
            // Any other code we treat as retriable to avoid losing events
            // on unexpected UK responses. If a pattern emerges, harden later.
            return { outcome: 'retry', code, error: `UK ${code} (unexpected, treating as retriable)` };
        } catch (error) {
            // Network / timeout / DNS failures — retriable.
            const errMsg = error.code
                ? `${error.code}: ${error.message}`
                : error.message;
            logger.warn(`ukWebhookClient.send network error: ${errMsg}`);
            return { outcome: 'retry', error: errMsg };
        }
    }
}

const singleton = new UKWebhookClient();
module.exports = singleton;
module.exports.UKWebhookClient = UKWebhookClient;
