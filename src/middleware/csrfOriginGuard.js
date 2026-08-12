// [SEC-23] Server-side CSRF defense via Origin/Referer validation.
//
// SameSite=Strict cookies (src/utils/authCookies.js) are the primary CSRF
// defense; this is defense-in-depth at the request layer. The client-side
// csrf.js token was never validated server-side — this closes that gap without
// a token-plumbing rewrite.
//
// Policy = "validate-if-present", scoped to COOKIE-authenticated state-changing
// requests:
//   - Only POST/PUT/PATCH/DELETE, and only when the request is authenticated by
//     a cookie (Bearer-authenticated API clients & HMAC webhooks are CSRF-immune
//     and skipped — they have no ambient credential a browser would attach).
//   - If an Origin header is PRESENT it must be an exact allowlist match, else
//     403. Else if a Referer is PRESENT its origin must match, else 403 (a
//     malformed/empty Referer is rejected, not crashed).
//   - If BOTH are absent → allow: browsers always attach Origin to cross-site
//     mutations, and SameSite=Strict already blocks cross-site cookies, so the
//     absent case is safe and keeps non-browser cookie clients / supertest working.

'use strict';

const { COOKIE_NAMES } = require('../utils/authCookies');
const getAllowedOrigins = require('../utils/allowedOrigins');
const { sendError } = require('../utils/apiResponse');
const logger = require('../utils/logger');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// [M-4] Шаги, на которых временная кука 2FA работает как учётные данные.
// Список закрытый: на всех прочих маршрутах она ничего не аутентифицирует, и
// расширять его без нужды нельзя.
const TEMP_TOKEN_PATHS = new Set(['/auth/verify-2fa', '/auth/setup-2fa', '/auth/confirm-2fa']);

// Mirror src/utils/authCookies.js extractAccessToken: a cookie counts only when
// it is a non-empty STRING. cookie-parser can turn `j:{...}` into an object —
// a truthy check would wrongly treat that as cookie-auth and block a valid
// Bearer client.
function hasCookie(req, name) {
    const v = req.cookies && req.cookies[name];
    return typeof v === 'string' && v.length > 0;
}

// Normalize a trailing slash exactly like isPublicRoute (src/routes/index.js):
// Express non-strict routing accepts /auth/refresh/, which would otherwise dodge
// an exact-match path check.
function normalizePath(p) {
    return p && p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function csrfOriginGuard(req, res, next) {
    if (!MUTATING.has(req.method)) {
        return next();
    }

    const path = normalizePath(req.path);
    // access cookie authenticates every route; refresh cookie is an auth
    // credential ONLY for /auth/refresh (it rotates both cookies there).
    //
    // [M-4] Временная кука 2FA — тоже учётные данные, но только на трёх шагах
    // потока. Формально sameSite=strict уже не даёт браузеру отправить её с
    // чужого origin, но access/refresh точно так же strict и всё равно
    // проверяются здесь: guard — второй рубеж, а не замена первому.
    const cookieAuth =
        hasCookie(req, COOKIE_NAMES.access) ||
        (path === '/auth/refresh' && hasCookie(req, COOKIE_NAMES.refresh)) ||
        (TEMP_TOKEN_PATHS.has(path) && hasCookie(req, COOKIE_NAMES.temp));

    if (!cookieAuth) {
        return next();
    }

    const headers = req.headers || {};
    const allowed = getAllowedOrigins();

    const reject = (reason) => {
        // Log only the static reason (one of our own literals). Do NOT interpolate
        // req.path/req.method/headers — that's a log-injection sink (CodeQL
        // js/log-injection). The request is still correlatable via the
        // x-correlation-id response header + the morgan access log.
        logger.warn(`[SEC-23] CSRF origin check blocked: ${reason}`);
        return sendError(res, 403, 'Cross-origin request blocked');
    };

    // Origin takes precedence. "Present" = the header key exists (an empty or
    // non-string value is present-but-invalid → reject, not treated as absent).
    if ('origin' in headers) {
        const origin = headers.origin;
        if (typeof origin === 'string' && allowed.includes(origin)) {
            return next();
        }
        return reject('origin-not-allowed');
    }

    if ('referer' in headers) {
        const ref = headers.referer;
        if (typeof ref !== 'string' || ref.length === 0) {
            return reject('referer-empty');
        }
        let refOrigin;
        try {
            refOrigin = new URL(ref).origin;
        } catch {
            return reject('referer-malformed');
        }
        if (allowed.includes(refOrigin)) {
            return next();
        }
        return reject('referer-not-allowed');
    }

    // Neither header present → allow (see policy note above).
    return next();
}

module.exports = csrfOriginGuard;
