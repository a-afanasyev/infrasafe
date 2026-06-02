const correlationId = require('../../../src/middleware/correlationId');

describe('correlationId middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = { headers: {} };
        res = {
            setHeader: jest.fn()
        };
        next = jest.fn();
    });

    test('generates UUID when no header present', () => {
        correlationId(req, res, next);

        expect(req.correlationId).toBeDefined();
        // UUID v4 format: 8-4-4-4-12 hex chars
        expect(req.correlationId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
        expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', req.correlationId);
        expect(next).toHaveBeenCalled();
    });

    test('uses existing x-correlation-id header when it is a valid UUID', () => {
        const validUuid = '11111111-2222-3333-4444-555555555555';
        req.headers['x-correlation-id'] = validUuid;

        correlationId(req, res, next);

        expect(req.correlationId).toBe(validUuid);
        expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', validUuid);
        expect(next).toHaveBeenCalled();
    });

    test('replaces a non-UUID / injection header with a generated UUID [SEC-24]', () => {
        // Log-injection attempt: newline + fake log line in the header value.
        req.headers['x-correlation-id'] = 'evil\nINFO: admin logged in role=admin';

        correlationId(req, res, next);

        // Malicious value must NOT be propagated into req/logs/response.
        expect(req.correlationId).not.toBe('evil\nINFO: admin logged in role=admin');
        expect(req.correlationId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
        expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', req.correlationId);
    });

    test('replaces a non-string header value with a generated UUID [SEC-24]', () => {
        req.headers['x-correlation-id'] = ['array', 'value'];

        correlationId(req, res, next);

        expect(req.correlationId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
    });

    test('sets unique IDs for different requests', () => {
        const req2 = { headers: {} };
        const res2 = { setHeader: jest.fn() };

        correlationId(req, res, next);
        correlationId(req2, res2, next);

        expect(req.correlationId).not.toBe(req2.correlationId);
    });
});
