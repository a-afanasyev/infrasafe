const crypto = require('crypto');

const HEADER_NAME = 'x-correlation-id';
// [SEC-24] Only accept a well-formed UUID from the inbound header. An
// unvalidated header value flows verbatim into Morgan/Winston log lines, so
// a crafted value (newlines, ANSI, fake log entries) is a log-injection
// vector. Anything that isn't a UUID → generate a fresh one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const correlationId = (req, res, next) => {
    const incoming = req.headers[HEADER_NAME];
    const id = (typeof incoming === 'string' && UUID_RE.test(incoming))
        ? incoming
        : crypto.randomUUID();
    req.correlationId = id;
    res.setHeader(HEADER_NAME, id);
    next();
};

module.exports = correlationId;
