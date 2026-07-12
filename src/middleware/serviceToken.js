'use strict';

/**
 * [H-4] Static service-token gate for machine-to-machine endpoints that
 * can't carry a user JWT (e.g. GET /uk-requests-metrics — UK's reconciliation
 * worker, not a logged-in user).
 *
 * Dormant-until-configured, matching this repo's flag convention (env
 * presence IS the flag): if the named env var is unset, the gate is a no-op
 * (current, pre-existing behavior of the route is preserved). Once set, the
 * request must carry a matching value in the given header or it is rejected
 * with 401. Comparison is constant-time (crypto.timingSafeEqual) so a
 * partial-match timing side-channel can't leak the token byte-by-byte.
 *
 * This is deliberately a shared-secret header, not a signed request (unlike
 * telemetryHmac/webhookVerifier) — GET requests here have no meaningful body
 * to bind a signature to, and the ARCH-114 spec anticipated exactly this
 * "service-token auth for both inventory endpoints" shape for a future
 * SEC-115. Rollout requires coordination: the token must be shared with UK
 * out-of-band and confirmed live on their side BEFORE the operator sets the
 * env var here (see docs/audit/2026-05-24-ARCH-114-uk-requests-inventory-spec.md).
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// Per-envVar "already warned" tracking so multiple gates (e.g. telemetry +
// UK inventory, if this factory is reused later) don't share one flag.
const warnedEnvVars = new Set();

/**
 * @param {object} opts
 * @param {string} opts.envVar - name of the env var holding the expected token
 * @param {string} opts.header - request header name the caller must send it in
 * @returns {import('express').RequestHandler}
 */
function requireServiceToken({ envVar, header }) {
    return function serviceTokenMiddleware(req, res, next) {
        const expected = process.env[envVar];
        if (!expected) {
            if (!warnedEnvVars.has(envVar) && process.env.NODE_ENV === 'production') {
                warnedEnvVars.add(envVar);
                logger.warn(`serviceToken: ${envVar} not set — ${req.baseUrl || req.path} accepts unauthenticated requests`);
            }
            return next();
        }

        const provided = req.headers[header];
        if (!provided || typeof provided !== 'string') {
            return res.status(401).json({ success: false, message: 'Service token required' });
        }

        const expectedBuf = Buffer.from(expected);
        const providedBuf = Buffer.from(provided);
        if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
            return res.status(401).json({ success: false, message: 'Invalid service token' });
        }

        next();
    };
}

module.exports = { requireServiceToken };
