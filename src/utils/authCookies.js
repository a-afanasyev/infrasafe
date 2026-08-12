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
    refresh: 'refresh_token',
    // [M-4] Промежуточный токен 2FA. До этого он ездил в теле ответа логина и
    // обратно в теле каждого шага — то есть был читаем скриптом на странице,
    // ровно как access/refresh до P1-2.
    temp: 'temp_token'
});

// Default lifetimes mirror authService defaults. We use generous
// upper-bounds because the JWT itself carries the authoritative exp;
// browsers will stop sending an expired cookie regardless. The cookie's
// Max-Age just prevents zombie cookies hanging around for years.
const ACCESS_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;            // 1h
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // 7d
// [M-4] Совпадает с expiresIn самого temp-токена (authService.generateTempToken).
// Кука, пережившая токен, — только мусор в браузере: сервер её всё равно
// отвергнет, а пользователь получит невнятную ошибку вместо чистого повтора.
const TEMP_TOKEN_MAX_AGE_MS = 5 * 60 * 1000;               // 5m

// [1A-FU-C-L1] `secure` flag must be ON behind staging TLS too.
// Staging environments often run NODE_ENV=development with nginx
// terminating TLS in front — without this override, cookies are sent
// over plain HTTP and the Set-Cookie's `Secure` attribute is missing,
// so an HTTP-side observer (man-in-the-middle in transit) sees them.
//
// [1A-FU2-S-L2] Precedence note: if NODE_ENV=production, the cookie is
// ALWAYS Secure — SECURE_COOKIES has no effect (and is not consulted).
// SECURE_COOKIES only matters for environments running NODE_ENV !=
// 'production' (e.g. staging with NODE_ENV=development behind nginx TLS).
// If a future env needs to FORCE-DISABLE Secure in production (e.g. a
// local production-mode container without TLS for debugging), this
// function would need an explicit `SECURE_COOKIES=false` escape hatch.
function isCookieSecure() {
    if (process.env.NODE_ENV === 'production') return true;
    if (process.env.SECURE_COOKIES === 'true') return true;
    return false;
}

function baseOpts() {
    return {
        httpOnly: true,
        secure: isCookieSecure(),
        sameSite: 'strict',
        path: '/'
    };
}

// [M-4] Выставить куку промежуточного токена 2FA.
function setTempCookie(res, tempToken) {
    if (!tempToken) return;
    res.cookie(COOKIE_NAMES.temp, tempToken, {
        ...baseOpts(),
        maxAge: TEMP_TOKEN_MAX_AGE_MS
    });
}

function setAuthCookies(res, { accessToken, refreshToken } = {}) {
    // [M-4] Полные токены выдаются только когда 2FA-поток завершён, поэтому
    // временная кука снимается здесь, а не в каждом терминальном контроллере:
    // так её нельзя забыть снять на новом пути. Снятие несуществующей куки
    // безвредно, поэтому вызов безусловный (в том числе на refresh).
    res.clearCookie(COOKIE_NAMES.temp, baseOpts());
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
    res.clearCookie(COOKIE_NAMES.temp, opts);
}

// [P1-2 / 1A-FU-S-L4] Extraction helpers used by middleware.
//
// Cookie comes FIRST in the precedence. With localStorage now removed
// from the in-browser clients (P1-2 Phase 2, [1A-FU-C-M1]), JS can no
// longer set an Authorization header on its own behalf — anything in
// the Authorization slot is either a programmatic API client (curl,
// service-to-service) or an XSS-injected header. The browser-set
// HttpOnly cookie is the trusted source.
//
// The header path stays as a fallback specifically for those
// non-browser clients. If a future feature wants to disable header
// auth entirely, that's a single conditional here.
function extractAccessToken(req) {
    if (req.cookies && typeof req.cookies[COOKIE_NAMES.access] === 'string'
        && req.cookies[COOKIE_NAMES.access].length > 0) {
        return req.cookies[COOKIE_NAMES.access];
    }
    const authHeader = req.headers && req.headers.authorization;
    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1]) {
            return parts[1];
        }
    }
    return null;
}

function extractRefreshToken(req) {
    // Same precedence inversion as extractAccessToken — cookie first.
    // req.body.refreshToken stays as a fallback for the legacy
    // payload-based refresh flow (used by older clients during the
    // transitional window and by programmatic refresh callers).
    if (req.cookies && typeof req.cookies[COOKIE_NAMES.refresh] === 'string'
        && req.cookies[COOKIE_NAMES.refresh].length > 0) {
        return req.cookies[COOKIE_NAMES.refresh];
    }
    if (req.body && typeof req.body.refreshToken === 'string' && req.body.refreshToken.length > 0) {
        return req.body.refreshToken;
    }
    return null;
}

/**
 * [M-4] Промежуточный токен 2FA: кука вперёд, тело — запасной путь.
 *
 * Тело остаётся читаемым для скрипта на странице, поэтому приоритет у куки.
 * Сам путь через тело держится ТОЛЬКО на время выкладки: у пользователя с
 * открытой вкладкой JS закэширован и ещё шлёт токен в теле. Убрать его —
 * отдельный PR, после того как новый бандл разойдётся.
 */
function extractTempToken(req) {
    if (req.cookies && typeof req.cookies[COOKIE_NAMES.temp] === 'string'
        && req.cookies[COOKIE_NAMES.temp].length > 0) {
        return req.cookies[COOKIE_NAMES.temp];
    }
    if (req.body && typeof req.body.tempToken === 'string' && req.body.tempToken.length > 0) {
        return req.body.tempToken;
    }
    return null;
}

module.exports = {
    COOKIE_NAMES,
    ACCESS_TOKEN_MAX_AGE_MS,
    REFRESH_TOKEN_MAX_AGE_MS,
    TEMP_TOKEN_MAX_AGE_MS,
    setAuthCookies,
    setTempCookie,
    clearAuthCookies,
    extractAccessToken,
    extractRefreshToken,
    extractTempToken
};
