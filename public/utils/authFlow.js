/**
 * [R2-12] Shared 2FA/auth network + validation layer.
 *
 * The full login → verify-2fa / setup-2fa → confirm-2fa flow is implemented in
 * TWO places with divergent UI orchestration: public/login.js (full-page login,
 * class-based, redirects on success) and public/script.js (inline map-login
 * modal, closes + reloads the map). Those UI layers stay separate — merging them
 * has historically reintroduced subtle ordering bugs (see the map-modal 2FA
 * condition-order note in CLAUDE.md).
 *
 * What IS shared and dangerous to duplicate is the network + validation layer:
 *   • the QR-code data-URI validation — a security check (it gates what goes
 *     into img.src); duplicated verbatim, it could drift out of sync between the
 *     two auth paths. Single-sourced here.
 *   • the auth endpoint paths.
 *   • the POST-JSON boilerplate (fetch + parse), a 1:1 substitution that leaves
 *     each call site's branching untouched.
 *
 * Exposed both as a browser global (esbuild bundle:false keeps it global) and as
 * a CommonJS module for jsdom/node unit tests.
 */
(function (root) {
    'use strict';

    const AUTH_ENDPOINTS = {
        login: '/api/auth/login',
        verify2fa: '/api/auth/verify-2fa',
        setup2fa: '/api/auth/setup-2fa',
        confirm2fa: '/api/auth/confirm-2fa',
    };

    // The totpService produces exactly `data:image/png;base64,<...>`
    // (src/services/totpService.js QRCode.toDataURL). Anything else is a server
    // regression or an injection attempt — refuse to render it into img.src.
    const QR_PREFIX = 'data:image/png;base64,';
    const QR_MAX_LEN = 8 * 1024; // 8KB — actual QR is ~1-2KB

    /**
     * True only for a well-formed PNG data-URI QR code within the size bound.
     * @param {*} url
     * @returns {boolean}
     */
    function validateQrCodeUrl(url) {
        const s = String(url == null ? '' : url);
        return s.startsWith(QR_PREFIX) && s.length <= QR_MAX_LEN;
    }

    /**
     * POST a JSON body and parse the JSON response. Never throws on a non-2xx or
     * an empty/invalid body — returns { res, data } so the caller keeps full
     * control over branching (res.ok, data.success, data.requires2FA, …) exactly
     * as before. A missing/invalid body yields data = {}.
     * @param {string} path
     * @param {object} body
     * @returns {Promise<{res: Response, data: any}>}
     */
    async function postJson(path, body) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
        let data = {};
        try {
            data = await res.json();
        } catch (_) {
            data = {};
        }
        return { res, data };
    }

    const api = { AUTH_ENDPOINTS, validateQrCodeUrl, postJson, QR_PREFIX, QR_MAX_LEN };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.AuthFlow = api;
    }
})(typeof window !== 'undefined' ? window : this);
