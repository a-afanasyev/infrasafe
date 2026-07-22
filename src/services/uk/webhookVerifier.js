'use strict';

/**
 * [P1-14 split] UK webhook HMAC verification + nonce replay protection +
 * integration log helpers.
 *
 * Owns:
 *   - verifyWebhookSignature — HMAC-SHA256 check with timing-safe compare
 *     and replay-window dedup (Redis-backed when configured, in-memory Map
 *     fallback otherwise).
 *   - isDuplicateEvent — looks up an event_id in integration_log (used by
 *     route handlers before delegating to the appropriate webhook handler).
 *   - logEvent — thin pass-through to IntegrationLog.create for cross-module
 *     callers (e.g., alertForwarder).
 *   - _resetSeenSignatures — test helper to clear the in-memory dedup map
 *     between deterministic-timestamp test cases.
 *
 * Module-level state:
 *   - _seenSignatures: Map<sigHash, expireAt(ms)>. Soft-cap with lazy sweep;
 *     hard-cap with oldest-eviction. Single-replica only; multi-replica
 *     deployments must set REDIS_URL so dedup goes through Redis.
 */

const crypto = require('crypto');
const IntegrationLog = require('../../models/IntegrationLog');
const logger = require('../../utils/logger');
const redisClient = require('../../utils/redisClient');

const WEBHOOK_TIMESTAMP_TOLERANCE_SEC = 300;
// [P0-2] Retain seen signatures for slightly longer than the timestamp
// tolerance so a sig with t=(now-299) cannot be replayed at t=(now+1).
const SEEN_SIGNATURE_TTL_MS = (WEBHOOK_TIMESTAMP_TOLERANCE_SEC + 10) * 1000;
const SEEN_SIGNATURE_TTL_SEC = WEBHOOK_TIMESTAMP_TOLERANCE_SEC + 10;
const SEEN_SIGNATURE_MAX_ENTRIES = 10000;
// [Sprint 4] Redis key prefix for nonce-dedup so it doesn't collide with
// rate-limiter / cache keys when sharing a Redis.
const DEDUP_KEY_PREFIX = 'ukwh:nonce:';

class UKWebhookVerifier {
    // [P0-2] sigHash → expireAt(ms). All-in-memory; single-replica today.
    _seenSignatures = new Map();

    /**
     * Test helper — clears the nonce-dedup map. Not part of the production
     * API; route handlers should never call this.
     */
    _resetSeenSignatures() {
        this._seenSignatures.clear();
    }

    /**
     * Verify webhook HMAC signature. Async to allow Redis dedup awaits.
     * Returns false on any verification failure, malformed header, expired
     * timestamp, or replay attempt — never throws.
     */
    async verifyWebhookSignature(rawBody, signatureHeader) {
        try {
            // [Sprint 9 / FIX-007 O5] Secret split: this verifier handles the
            // UK → InfraSafe direction, which UK signs with INFRASAFE_WEBHOOK_SECRET.
            // [R2-18] The backward-compat fallback to UK_WEBHOOK_SECRET (the
            // OUTBOUND sender secret) was removed once the rename+rotation completed
            // and prod INFRASAFE_WEBHOOK_SECRET was confirmed live. Keeping it would
            // mask a misconfig: if INFRASAFE_WEBHOOK_SECRET went missing, verification
            // would silently fall back to a different-direction secret instead of
            // failing closed. No fallback → a missing secret rejects every webhook.
            const secret = process.env.INFRASAFE_WEBHOOK_SECRET;
            if (!secret) {
                logger.error('ukWebhookVerifier.verifyWebhookSignature: INFRASAFE_WEBHOOK_SECRET not configured — rejecting webhook (fail-close)');
                return false;
            }

            if (!signatureHeader) return false;

            // Parse header: "t=<timestamp>,v1=<hex_signature>".
            // [CodeQL js/remote-property-injection] Only write to the two
            // known-good keys — any other parameter the sender provides is
            // discarded, so the parts object cannot be polluted with
            // attacker-chosen property names.
            const parts = {};
            for (const part of signatureHeader.split(',')) {
                const eqIdx = part.indexOf('=');
                if (eqIdx === -1) continue;
                const k = part.substring(0, eqIdx);
                if (k !== 't' && k !== 'v1') continue;
                const v = part.substring(eqIdx + 1);
                parts[k] = v;
            }

            const timestamp = parts['t'];
            const signature = parts['v1'];

            if (!timestamp || !signature) {
                return false;
            }

            // [Hardening] Validate the timestamp is a plain non-negative integer
            // BEFORE any arithmetic. parseInt('abc', 10) is NaN, and
            // `Math.abs(now - NaN) > TOLERANCE` is always false — a malformed
            // timestamp would silently pass the freshness gate instead of being
            // rejected. Not independently exploitable today (the HMAC binds
            // this exact timestamp string into the signature, so a forged
            // non-numeric `t` still requires the secret to produce a matching
            // `v1`), but the freshness check must reject malformed input on its
            // own merits rather than relying on that binding forever.
            if (!/^\d{1,15}$/.test(timestamp)) {
                return false;
            }
            const timestampInt = parseInt(timestamp, 10);
            if (!Number.isSafeInteger(timestampInt)) {
                return false;
            }

            // Replay protection
            const now = Math.floor(Date.now() / 1000);
            if (Math.abs(now - timestampInt) > WEBHOOK_TIMESTAMP_TOLERANCE_SEC) {
                return false;
            }

            // Compute expected HMAC
            const expected = crypto
                .createHmac('sha256', secret)
                .update(`${timestamp}.${rawBody}`)
                .digest('hex');

            // Length-safe comparison
            const sigBuf = Buffer.from(signature, 'hex');
            const expBuf = Buffer.from(expected, 'hex');
            if (sigBuf.length !== expBuf.length) {
                return false;
            }

            if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
                return false;
            }

            // [P0-2] Replay/nonce dedup. A signed payload is reusable for up
            // to WEBHOOK_TIMESTAMP_TOLERANCE_SEC seconds without this check.
            // Track sig hashes with TTL; reject if seen before.
            //
            // [Sprint 4] Redis-backed when available — multi-replica safe.
            // SET NX EX is atomic: returns OK only on first insert, nil
            // otherwise. If Redis is degraded, fall through to Map.
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
                        // [CodeQL js/log-injection] timestamp originates from the
                        // webhook header but the HMAC check above has already
                        // proven the entire signed payload is authentic — so
                        // `timestamp` cannot be attacker-shaped here. Still,
                        // cast to integer + truncate hash so a corrupt branch
                        // cannot land newlines in logs.
                        const tsInt = Number.parseInt(timestamp, 10) || 0;
                        logger.warn(
                            'ukWebhookVerifier.verifyWebhookSignature: replay attempt detected ' +
                            `(Redis) for signature ${sigHash.slice(0, 16)}... (timestamp ${tsInt})`
                        );
                        return false;
                    }
                    return true;
                } catch (err) {
                    logger.warn(`ukWebhookVerifier.verifyWebhookSignature: Redis dedup failed, using memory fallback: ${err.message}`);
                }
            }

            // In-memory fallback (single-replica only).
            const prevExpireAt = this._seenSignatures.get(sigHash);
            if (prevExpireAt !== undefined && prevExpireAt > nowMs) {
                const tsInt = Number.parseInt(timestamp, 10) || 0;
                logger.warn(
                    'ukWebhookVerifier.verifyWebhookSignature: replay attempt detected ' +
                    `(memory) for signature ${sigHash.slice(0, 16)}... (timestamp ${tsInt})`
                );
                return false;
            }

            // Lazy cleanup when the map grows past the soft cap.
            if (this._seenSignatures.size >= SEEN_SIGNATURE_MAX_ENTRIES) {
                for (const [k, v] of this._seenSignatures) {
                    if (v <= nowMs) this._seenSignatures.delete(k);
                }
                if (this._seenSignatures.size >= SEEN_SIGNATURE_MAX_ENTRIES) {
                    const oldestKey = this._seenSignatures.keys().next().value;
                    if (oldestKey !== undefined) {
                        this._seenSignatures.delete(oldestKey);
                        logger.warn(
                            `ukWebhookVerifier.verifyWebhookSignature: nonce map at hard cap ` +
                            `(${SEEN_SIGNATURE_MAX_ENTRIES}); evicted oldest entry. ` +
                            `Configure REDIS_URL to switch to multi-replica-safe dedup.`
                        );
                    }
                }
            }

            this._seenSignatures.set(sigHash, nowMs + SEEN_SIGNATURE_TTL_MS);
            return true;
        } catch (error) {
            logger.error(`ukWebhookVerifier.verifyWebhookSignature error: ${error.message}`);
            return false;
        }
    }

    /** Log an integration event. Thin pass-through. */
    async logEvent(data) {
        return IntegrationLog.create(data);
    }

    /**
     * Check if an event ID already exists in the log (duplicate detection).
     * [Variant A — UK deterministic event_id contract, 2026-07-22] A row with
     * status='error' is NOT a duplicate: UK's deterministic event_ids mean a
     * retry after our 5xx carries the SAME id, and treating the failed row as
     * "already processed" would drop the event permanently. The handlers'
     * insert-first path pairs with IntegrationLog.reclaimErrorByEventId so
     * the retry re-claims the error row race-safely.
     */
    async isDuplicateEvent(eventId) {
        const entry = await IntegrationLog.findByEventId(eventId);
        if (entry === null) return false;
        return entry.status !== 'error';
    }
}

const singleton = new UKWebhookVerifier();
module.exports = singleton;
module.exports.UKWebhookVerifier = UKWebhookVerifier;
