// [SEC-23] Single source of truth for the allowed web origins.
//
// Used by BOTH the CORS middleware (src/server.js) and the CSRF Origin guard
// (src/middleware/csrfOriginGuard.js) so the two can't drift.
//
// CONTRACT: always returns string[] — never a bare string. The guard does
// `getAllowedOrigins().includes(origin)`; if this returned a string fallback,
// `.includes()` would silently become a SUBSTRING check (e.g.
// 'http://localhost:8080'.includes('local') === true), defeating exact-origin
// matching. Hence the fallback is an array too.
//
// Reads process.env at call-time (not import-time) so config/tests can vary it.

'use strict';

const FALLBACK = Object.freeze(['http://localhost:8080']);

function getAllowedOrigins() {
    const raw = process.env.CORS_ORIGINS;
    if (typeof raw !== 'string' || raw.trim() === '') {
        return [...FALLBACK];
    }
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : [...FALLBACK];
}

module.exports = getAllowedOrigins;
