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

    test('uses existing x-correlation-id header', () => {
        req.headers['x-correlation-id'] = 'existing-id-123';

        correlationId(req, res, next);

        expect(req.correlationId).toBe('existing-id-123');
        expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'existing-id-123');
        expect(next).toHaveBeenCalled();
    });

    test('sets unique IDs for different requests', () => {
        const req2 = { headers: {} };
        const res2 = { setHeader: jest.fn() };

        correlationId(req, res, next);
        correlationId(req2, res2, next);

        expect(req.correlationId).not.toBe(req2.correlationId);
    });
});
