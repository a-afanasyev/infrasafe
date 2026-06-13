/**
 * [B-001 + UK-URGENCY remnant] Build a UK request deep-link from the configured
 * template, with optional reopen-meta passthrough.
 *
 * Base behaviour (B-001): substitute ${uk_frontend_url} + ${uk_request_number}
 * into config.uk_request_url_template. Returns null when config is incomplete so
 * callers can skip rendering the link.
 *
 * Reopen passthrough (UK-URGENCY remnant): for an alert that is part of a reopen
 * chain (reopen_sequence > 1), append reopen context as query params so the UK
 * side (`onOpenRelated`) can show "Повторное обращение №N · связана с XXX" and
 * offer to open the related (previous) request. Non-reopen alerts get the
 * unchanged B-001 URL — no empty params are shipped. The previous request number
 * lives on the alert item as `previous_uk_request_number`; callers pass it here
 * as `related_request_number`.
 *
 * ⚠️ The reopen query-param NAMES (reopen_sequence / related_request /
 * reopen_chain_id) are a contract with the UK front-end and must match what their
 * deep-link handler reads — confirm before enabling on prod.
 *
 * Exposed both as a browser global (esbuild bundle:false keeps it global) and as
 * a CommonJS module for jsdom/node unit tests.
 */
(function (root) {
    'use strict';

    /**
     * @param {string} ukRequestNumber  the target UK request number
     * @param {{uk_frontend_url?: string, uk_request_url_template?: string}} config
     * @param {{reopen_sequence?: (number|string), related_request_number?: (string|null),
     *          reopen_chain_id?: (string|null)}} [reopenMeta]
     * @returns {string|null} the deep-link, or null when config/number is incomplete
     */
    function buildUkRequestUrl(ukRequestNumber, config, reopenMeta) {
        const cfg = config || {};
        const baseUrl = (cfg.uk_frontend_url || '').replace(/\/$/, '');
        const template = cfg.uk_request_url_template
            || '${uk_frontend_url}/dashboard?request=${uk_request_number}';
        if (!baseUrl || !ukRequestNumber) return null;

        let url = template
            .replace(/\$\{uk_frontend_url\}/g, baseUrl)
            .replace(/\$\{uk_request_number\}/g, encodeURIComponent(ukRequestNumber));

        // [UK-URGENCY] reopen passthrough — only for a real reopen (sequence > 1).
        // reopen_sequence === 1 is the original alert, not a reopen → no params.
        const seq = reopenMeta ? Number(reopenMeta.reopen_sequence) : NaN;
        if (Number.isFinite(seq) && seq > 1) {
            const params = new URLSearchParams();
            params.set('reopen_sequence', String(seq));
            if (reopenMeta.related_request_number) {
                params.set('related_request', String(reopenMeta.related_request_number));
            }
            if (reopenMeta.reopen_chain_id) {
                params.set('reopen_chain_id', String(reopenMeta.reopen_chain_id));
            }
            url += (url.indexOf('?') === -1 ? '?' : '&') + params.toString();
        }

        return url;
    }

    const api = { buildUkRequestUrl };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.UkLinkBuilder = api;
    }
})(typeof window !== 'undefined' ? window : this);
