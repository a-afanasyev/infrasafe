const crypto = require('crypto');

const HEADER_NAME = 'x-correlation-id';

const correlationId = (req, res, next) => {
    const id = req.headers[HEADER_NAME] || crypto.randomUUID();
    req.correlationId = id;
    res.setHeader(HEADER_NAME, id);
    next();
};

module.exports = correlationId;
