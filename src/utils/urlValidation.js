'use strict';

const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
];

// IPv6 internal ranges, matched against the normalized (bracket-stripped,
// lowercased) hostname. Node's URL.hostname returns IPv6 hosts WITH brackets
// (e.g. "[::1]"), so these must run after stripping the surrounding brackets.
const PRIVATE_IPV6_PATTERNS = [
    /^::1$/, // loopback
    /^::$/, // unspecified
    /^f[cd]/, // fc00::/7 ULA (fc.. / fd..)
    /^fe[89ab]/, // fe80::/10 link-local
];

// Strip surrounding IPv6 brackets and lowercase. Node's URL.hostname yields
// bracketed IPv6 literals ("[::1]"); the private-range checks need the raw form.
function normalizeHostname(hostname) {
    return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

// For an IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1) OR the deprecated
// IPv4-compatible (::a.b.c.d / Node-normalized ::7f00:1) IPv6 address, extract
// the embedded IPv4 in dotted-quad form so the existing IPv4 guards can run.
// The `ffff:` segment is optional so the compat form is covered too — Node
// normalizes ::127.0.0.1 -> [::7f00:1] and ::169.254.169.254 -> [::a9fe:a9fe],
// neither of which carries the ffff: prefix.
// Returns null when the host is not an embedded-IPv4 IPv6 literal.
function extractMappedIpv4(host) {
    const match = host.match(/^::(?:ffff:)?(.+)$/);
    if (!match) {
        return null;
    }
    const tail = match[1];
    // Dotted form: ::ffff:127.0.0.1
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail)) {
        return tail;
    }
    // Hex form: ::ffff:7f00:1  ->  7f00 0001  ->  127.0.0.1
    const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
        const high = parseInt(hexMatch[1], 16);
        const low = parseInt(hexMatch[2], 16);
        return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
    }
    return null;
}

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

    const hostname = normalizeHostname(parsed.hostname);
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

    for (const pattern of PRIVATE_IPV6_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new Error(`Private/internal IP not allowed: ${hostname}`);
        }
    }

    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — apply the IPv4 guards to the embedded address.
    const mappedIpv4 = extractMappedIpv4(hostname);
    if (mappedIpv4) {
        for (const pattern of PRIVATE_IP_PATTERNS) {
            if (pattern.test(mappedIpv4)) {
                throw new Error(`Private/internal IP not allowed: ${hostname}`);
            }
        }
    }

    // Host allowlist is OPTIONAL defense-in-depth. The core SSRF guards above
    // (private/RFC1918 IPs, link-local/metadata, localhost, https-in-prod) always
    // apply. The allowlist is enforced ONLY when UK_API_ALLOWED_HOSTS is set; when
    // unset we do not throw, so the canonical prod target (https://infrasafe.uz/uk)
    // is accepted (env.js declares this var "no longer needed").
    const allowedHosts = process.env.UK_API_ALLOWED_HOSTS;
    if (allowedHosts) {
        const hostList = allowedHosts.split(',').map(h => h.trim().toLowerCase());
        if (!hostList.includes(hostname)) {
            throw new Error(`Host "${hostname}" not in allowlist (UK_API_ALLOWED_HOSTS)`);
        }
    }
}

module.exports = { validateUKApiUrl };
