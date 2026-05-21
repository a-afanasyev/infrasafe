// [1A-FU-S-M2] CSP violation report sink.
//
// Browsers POST a JSON document here whenever a CSP directive blocks
// a resource (script-src, style-src, etc). The endpoint:
//   - is public (no JWT) — browsers cannot send auth headers on
//     report-uri requests by spec
//   - is rate-limited (per-IP) so a misbehaving page can't drown us
//   - parses both `application/csp-report` (legacy) and
//     `application/json` / `application/reports+json` (Reporting API v3)
//   - logs via winston at INFO so ops sees the volume; ERROR would
//     burn pager budget for what is normally noise during a CSP
//     rollout
//
// We deliberately do NOT persist reports to the DB. Volume can spike
// during a misconfigured rollout, and the log stream is the right
// place for time-bounded observability. If sustained reporting is
// needed later, swap the log line for a structured event sink.

'use strict';

const express = require('express');
const logger = require('../utils/logger');
const { SimpleRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Body parsers — Express's global json() handles application/json
// already; we add the legacy CSP report mime type here. Cap body size
// at 16KB — reports are small; anything larger is misuse / probe.
router.use(
    express.json({
        type: ['application/json', 'application/csp-report', 'application/reports+json'],
        limit: '16kb'
    })
);

// 100 reports per minute per IP. Burst is fine during a misconfig,
// sustained > 100/min is operator noise so we shed.
const cspReportLimiter = new SimpleRateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    message: 'Too many CSP reports',
    keyGenerator: (req) => `csp-report:${req.ip || req.connection.remoteAddress}`,
    standardHeaders: false,
    legacyHeaders: false
});

router.post('/', cspReportLimiter.middleware(), (req, res) => {
    try {
        // Pull out the most informative fields without dumping the full
        // body — keeps log lines bounded.
        const report = req.body || {};
        // Legacy shape: { "csp-report": { ... } }
        // Reporting API:  [{ type: 'csp-violation', body: { ... } }, ...]
        const legacy = report['csp-report'];
        const modern = Array.isArray(report) ? report.find(r => r.type === 'csp-violation') : null;
        const v = legacy || (modern && modern.body) || {};

        // Take only the fields we expect; ignore the rest. This also
        // hides any cookie-shaped value an attacker might inject hoping
        // to see it echoed in logs.
        const summary = {
            documentUri: typeof v['document-uri'] === 'string' ? v['document-uri'].slice(0, 256)
                : typeof v.documentURL === 'string' ? v.documentURL.slice(0, 256) : null,
            violatedDirective: typeof v['violated-directive'] === 'string' ? v['violated-directive'].slice(0, 128)
                : typeof v.effectiveDirective === 'string' ? v.effectiveDirective.slice(0, 128) : null,
            blockedUri: typeof v['blocked-uri'] === 'string' ? v['blocked-uri'].slice(0, 256)
                : typeof v.blockedURL === 'string' ? v.blockedURL.slice(0, 256) : null,
            sourceFile: typeof v['source-file'] === 'string' ? v['source-file'].slice(0, 256) : null,
            lineNumber: Number.isFinite(v['line-number']) ? v['line-number'] : null,
            disposition: typeof v.disposition === 'string' ? v.disposition.slice(0, 32) : null
        };

        // Drop reports that look entirely empty (some clients send
        // them on page navigation as a no-op).
        if (!summary.violatedDirective && !summary.blockedUri && !summary.documentUri) {
            return res.status(204).end();
        }

        logger.info(`CSP violation: ${JSON.stringify(summary)}`);
    } catch (err) {
        // Don't 500 — the browser doesn't care. Just log + move on.
        logger.warn(`CSP report handler error: ${err.message}`);
    }

    // Always 204 — Reporting API spec says any 2xx is fine. Browsers
    // ignore the body.
    res.status(204).end();
});

module.exports = router;
