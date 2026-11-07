const crypto = require('crypto');

const HEADER_NAME = 'x-correlation-id';
// [SEC-24] Only accept a well-formed UUID from the inbound header. An
// unvalidated header value flows verbatim into Morgan/Winston log lines, so
// a crafted value (newlines, ANSI, fake log entries) is a log-injection
// vector. Anything that isn't a UUID → generate a fresh one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// [S-PERIM-4] Edge-nginx передаёт свой $request_id (32 hex без дефисов) в том же
// заголовке — так строка access-лога nginx (с IP) и записи приложения
// связываются одним идентификатором. Такой же закрытый алфавит, инъекция
// в лог невозможна.
const NGINX_REQUEST_ID_RE = /^[0-9a-f]{32}$/i;

const isAcceptableId = (v) => typeof v === 'string' && (UUID_RE.test(v) || NGINX_REQUEST_ID_RE.test(v));

const correlationId = (req, res, next) => {
    const incoming = req.headers[HEADER_NAME];
    const id = isAcceptableId(incoming)
        ? incoming
        : crypto.randomUUID();
    req.correlationId = id;
    res.setHeader(HEADER_NAME, id);
    next();
};

module.exports = correlationId;
