const { v4: uuidv4 } = require('uuid');

const HEADER_NAME = 'x-correlation-id';

const correlationId = (req, res, next) => {
    const id = req.headers[HEADER_NAME] || uuidv4();
    req.correlationId = id;
    res.setHeader(HEADER_NAME, id);
    next();
};

module.exports = correlationId;
