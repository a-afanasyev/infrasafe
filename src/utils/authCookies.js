// [P1-2] HttpOnly auth-cookie helpers.
//
// Sets and clears the access/refresh token cookies that the browser
// sends automatically with same-site requests. Cookies live alongside
// the existing Authorization header + req.body.refreshToken paths so
// the rollout is non-breaking — clients keep working off localStorage
// during the transitional release; a follow-up PR removes localStorage
// once we've confirmed cookies are functioning everywhere.
//
// Attributes:
//   httpOnly        — JS cannot read the cookie even if XSS exists
//   secure          — only sent over HTTPS (relaxed in non-production)
//   sameSite=strict — never sent on cross-site navigation (CSRF mitigation)
//   path=/          — sent on every request (so /api/* picks it up too)

'use strict';

const COOKIE_NAMES = Object.freeze({
    access: 'access_token',
    refresh: 'refresh_token'
});

// Default lifetimes mirror authService defaults. We use generous
// upper-bounds because the JWT itself carries the authoritative exp;
// browsers will stop sending an expired cookie regardless. The cookie's
// Max-Age just prevents zombie cookies hanging around for years.
const ACCESS_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;            // 1h
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // 7d

function baseOpts() {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/'
    };
}

function setAuthCookies(res, { accessToken, refreshToken } = {}) {
    if (accessToken) {
        res.cookie(COOKIE_NAMES.access, accessToken, {
            ...baseOpts(),
            maxAge: ACCESS_TOKEN_MAX_AGE_MS
        });
    }
    if (refreshToken) {
        res.cookie(COOKIE_NAMES.refresh, refreshToken, {
            ...baseOpts(),
            maxAge: REFRESH_TOKEN_MAX_AGE_MS
        });
    }
}

function clearAuthCookies(res) {
    // clearCookie matches name+path+sameSite+secure+httpOnly to issue
    // a Set-Cookie that the browser actually accepts as a clear.
    const opts = baseOpts();
    res.clearCookie(COOKIE_NAMES.access, opts);
    res.clearCookie(COOKIE_NAMES.refresh, opts);
}

// [P1-2] Extraction helpers used by middleware.
function extractAccessToken(req) {
    const authHeader = req.headers && req.headers.authorization;
    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) {
            return parts[1];
        }
    }
    if (req.cookies && typeof req.cookies[COOKIE_NAMES.access] === 'string') {
        return req.cookies[COOKIE_NAMES.access];
    }
    return null;
}

function extractRefreshToken(req) {
    if (req.body && typeof req.body.refreshToken === 'string' && req.body.refreshToken.length > 0) {
        return req.body.refreshToken;
    }
    if (req.cookies && typeof req.cookies[COOKIE_NAMES.refresh] === 'string') {
        return req.cookies[COOKIE_NAMES.refresh];
    }
    return null;
}

module.exports = {
    COOKIE_NAMES,
    ACCESS_TOKEN_MAX_AGE_MS,
    REFRESH_TOKEN_MAX_AGE_MS,
    setAuthCookies,
    clearAuthCookies,
    extractAccessToken,
    extractRefreshToken
};
