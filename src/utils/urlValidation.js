'use strict';

const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/,
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'];

function validateUKApiUrl(url) {
    if (!url || typeof url !== 'string') {
        throw new Error('UK API URL is required');
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid UK API URL: ${url}`);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopment = process.env.NODE_ENV === 'development';
    const allowedProtocols = isProduction ? ['https:'] : ['https:', 'http:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
        throw new Error(`Only HTTPS URLs allowed for UK API (got ${parsed.protocol})`);
    }

    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.includes(hostname)) {
        if (!(isDevelopment && hostname === 'localhost')) {
            throw new Error(`Blocked hostname: ${hostname}`);
        }
    }

    for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new Error(`Private/internal IP not allowed: ${hostname}`);
        }
    }

    const allowedHosts = process.env.UK_API_ALLOWED_HOSTS;
    if (isProduction && !allowedHosts) {
        throw new Error(
            'UK_API_ALLOWED_HOSTS must be configured in production ' +
            '(comma-separated list of allowed UK API hostnames)'
        );
    }
    if (allowedHosts) {
        const hostList = allowedHosts.split(',').map(h => h.trim().toLowerCase());
        if (!hostList.includes(hostname)) {
            throw new Error(`Host "${hostname}" not in allowlist (UK_API_ALLOWED_HOSTS)`);
        }
    }
}

module.exports = { validateUKApiUrl };
